#!/usr/bin/env python3
"""PreToolUse(Bash) git guardrail for Claude Code.

Threat model: a *tripwire for accidents* by a cooperative agent, not a security boundary. It only
runs inside Claude Code (Codex and OpenCode children never pass through it) and a determined
caller can always obfuscate around it. The authoritative protection for `main` belongs on the
server (GitHub branch protection), when the plan allows it.

Feature-branch pushes stay allowed (agents open PRs); commands that rewrite or discard history,
or land on main without a PR, are blocked. A small quote-aware scanner strips comments and
literal heredoc bodies, and pulls out code that will run anyway ($(...), backticks, heredocs fed
to a shell, bash -c); then only real git/gh invocations are judged, by meaning rather than
spelling. Regression cases live in block-dangerous-git.cases; run test-block-dangerous-git.sh
after any edit.
"""

import json
import re
import shlex
import subprocess
import sys

PROTECTED = {"main", "master"}
SEPARATORS = {";", "&&", "||", "|", "&", "(", ")", "|&", ";;", "{", "}"}
# words that can precede a command without being the command
PREFIXES = {
    "sudo", "env", "command", "time", "nohup", "exec", "builtin",
    "if", "then", "else", "elif", "do", "while", "until", "!",
}
SHELLS = {"bash", "sh", "zsh", "dash"}
ALL_PATHS = {".", ":/", "*", ":/*", "./"}
GIT_VALUE_OPTS = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"}
PUSH_VALUE_OPTS = {"-o", "--push-option", "--repo", "--receive-pack", "--exec"}
MAX_DEPTH = 4


class Blocked(Exception):
    pass


# --- scanning ---------------------------------------------------------------------------------

def _read_paren_body(s: str, i: int) -> tuple[str, int]:
    """s[i] is just past '$('. Return (body, index past the matching ')'), quote-aware."""
    depth, j, quote = 1, i, None
    while j < len(s):
        c = s[j]
        if quote:
            if c == "\\" and quote == '"':
                j += 2
                continue
            if c == quote:
                quote = None
        elif c in "'\"":
            quote = c
        elif c == "\\":
            j += 2
            continue
        elif c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                return s[i:j], j + 1
        j += 1
    return s[i:], len(s)


def substitutions(text: str) -> list[str]:
    """Command substitutions in text treated as double-quoted (e.g. an unquoted heredoc body)."""
    found, i = [], 0
    while i < len(text):
        if text.startswith("$(", i):
            body, i = _read_paren_body(text, i + 2)
            found.append(body)
        elif text[i] == "`":
            end = text.find("`", i + 1)
            end = len(text) if end == -1 else end
            found.append(text[i + 1:end])
            i = end + 1
        else:
            i += 1
    return found


def scan(cmd: str) -> tuple[str, list[str]]:
    """Return (cmd with comments and heredoc bodies removed, nested scripts that will execute)."""
    out: list[str] = []
    nested: list[str] = []
    pending: list[tuple[str, bool]] = []  # heredocs opened on this line: (tag, expands)
    line_start = 0  # index in `out` where the current line began
    quote = None
    i, n = 0, len(cmd)
    while i < n:
        c = cmd[i]
        if quote == "'":
            out.append(c)
            if c == "'":
                quote = None
            i += 1
            continue
        if c == "\\" and i + 1 < n:
            out.append(cmd[i:i + 2])
            i += 2
            continue
        if quote == '"':
            if cmd.startswith("$(", i) or c == "`":
                pass  # fall through to substitution handling below
            else:
                out.append(c)
                if c == '"':
                    quote = None
                i += 1
                continue
        if cmd.startswith("$(", i):
            body, i = _read_paren_body(cmd, i + 2)
            nested.append(body)
            out.append(" __subst__ ")
            continue
        if c == "`":
            end = cmd.find("`", i + 1)
            end = n if end == -1 else end
            nested.append(cmd[i + 1:end])
            out.append(" __subst__ ")
            i = end + 1
            continue
        if c in "'\"":
            quote = c
            out.append(c)
            i += 1
            continue
        if c == "#" and (not out or out[-1][-1:] in " \t\n;&|()"):
            while i < n and cmd[i] != "\n":
                i += 1
            continue
        if cmd.startswith("<<<", i):  # here-string: an ordinary word follows, not a body
            out.append("<<<")
            i += 3
            continue
        m = re.match(r"<<(-?)\s*(['\"]?)([A-Za-z_][A-Za-z0-9_]*)\2", cmd[i:])
        if m:
            pending.append((m.group(3), m.group(2) == ""))
            out.append(" ")
            i += m.end()
            continue
        if c == "\n":
            words = re.split(r"[\s;&|()]+", "".join(out[line_start:]))
            fed_to_shell = any(w.rsplit("/", 1)[-1] in SHELLS | {"eval", "source", "."} for w in words)
            out.append("\n")
            i += 1
            for tag, expands in pending:
                body_lines = []
                while i < n:
                    end = cmd.find("\n", i)
                    end = n if end == -1 else end
                    line = cmd[i:end]
                    i = end + 1
                    if line.strip() == tag:
                        break
                    body_lines.append(line)
                body = "\n".join(body_lines)
                if fed_to_shell:
                    nested.append(body)
                elif expands:
                    nested.extend(substitutions(body))
            pending = []
            line_start = len(out)
            continue
        out.append(c)
        i += 1
    return "".join(out), nested


def tokenize(cmd: str) -> list[str]:
    lexer = shlex.shlex(cmd.replace("\n", " ; "), posix=True, punctuation_chars=True)
    lexer.whitespace_split = True
    lexer.commenters = ""  # scan() already removed real comments
    return list(lexer)


def split_commands(tokens: list[str]) -> list[list[str]]:
    cmds, cur = [], []
    for tok in tokens:
        if tok in SEPARATORS:
            if cur:
                cmds.append(cur)
            cur = []
        else:
            cur.append(tok)
    if cur:
        cmds.append(cur)
    return cmds


# --- judging ----------------------------------------------------------------------------------

def options(args: list[str]) -> list[str]:
    """Arguments before a bare `--`; everything after it is a path, never a flag."""
    return args[:args.index("--")] if "--" in args else args


def short_flags(args: list[str]) -> set[str]:
    return {c for a in options(args) if re.fullmatch(r"-[A-Za-z]+", a) for c in a[1:]}


def has(args: list[str], *long_flags: str) -> bool:
    opts = options(args)
    return any(f in opts for f in long_flags)


def current_branch(cwd: str) -> str:
    try:
        return subprocess.run(
            ["git", "-C", cwd, "branch", "--show-current"],
            capture_output=True, text=True, timeout=5,
        ).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ""


def check_push(args: list[str], cwd: str) -> None:
    flags = short_flags(args)
    if has(args, "--force") or "f" in flags:
        raise Blocked("force push (use --force-with-lease on a feature branch)")
    if has(args, "--mirror"):
        raise Blocked("mirror push can overwrite and delete remote refs")
    if has(args, "--all", "--branches"):
        raise Blocked("pushing every branch includes main; push one feature branch")

    positional, skip = [], False
    explicit_repo = any(a == "--repo" or a.startswith("--repo=") for a in options(args))
    for a in args:
        if skip:
            skip = False
        elif a in PUSH_VALUE_OPTS:
            skip = True
        elif a != "--" and not a.startswith("-"):
            positional.append(a)
    refspecs = positional if explicit_repo else positional[1:]

    branch = current_branch(cwd)
    for spec in refspecs:
        if spec.startswith("+"):
            raise Blocked(f"'+' refspec force-pushes ({spec})")
        dst = spec.split(":", 1)[1] if ":" in spec else spec
        dst = dst.removeprefix("refs/heads/")
        if dst in PROTECTED or (dst == "HEAD" and branch in PROTECTED):
            raise Blocked("pushing to main; land changes through a PR")
    tags_only = has(args, "--tags")
    if not refspecs and not tags_only and branch in PROTECTED:
        raise Blocked(f"bare push while on {branch}; land changes through a PR")


def check_git(argv: list[str], cwd: str) -> None:
    i = 1
    while i < len(argv) and argv[i].startswith("-"):
        if argv[i] == "-C" and i + 1 < len(argv):
            cwd = argv[i + 1]  # scoped to this invocation only
        i += 2 if argv[i] in GIT_VALUE_OPTS else 1
    if i >= len(argv):
        return
    sub, args = argv[i], argv[i + 1:]
    flags = short_flags(args)
    paths_all = any(a in ALL_PATHS for a in args)

    if sub == "push":
        check_push(args, cwd)
    elif sub == "reset" and has(args, "--hard"):
        raise Blocked("git reset --hard discards work")
    elif sub == "clean" and (has(args, "--force") or "f" in flags) \
            and not (has(args, "--dry-run") or "n" in flags):
        raise Blocked("git clean --force deletes untracked files")
    elif sub == "branch" and ("D" in flags or (
            (has(args, "--delete") or "d" in flags) and (has(args, "--force") or "f" in flags))):
        raise Blocked("force-deleting a branch drops unmerged commits")
    elif sub == "checkout" and (paths_all or has(args, "--force") or "f" in flags):
        raise Blocked("checkout that discards working-tree changes")
    elif sub == "switch" and (has(args, "--discard-changes", "--force") or "f" in flags):
        raise Blocked("switch that discards working-tree changes")
    elif sub == "restore" and paths_all:
        staged_only = (has(args, "--staged") or "S" in flags) \
            and not (has(args, "--worktree") or "W" in flags)
        if not staged_only:
            raise Blocked("restore that discards all working-tree changes")
    elif sub == "stash" and args[:1] == ["clear"]:
        raise Blocked("git stash clear drops every stash")


def shell_script_arg(argv: list[str]) -> str | None:
    """The script passed to `bash -c` / `bash -lc` / `sh -ec` etc., if any."""
    for idx, a in enumerate(argv[1:], start=1):
        if re.fullmatch(r"-[A-Za-z]*c[A-Za-z]*", a):
            return argv[idx + 1] if idx + 1 < len(argv) else None
        if not a.startswith("-"):
            return None
    return None


def check(cmd: str, cwd: str, depth: int = 0) -> None:
    if depth > MAX_DEPTH:
        raise Blocked("command nesting too deep to inspect")
    text, nested = scan(cmd)
    for script in nested:
        check(script, cwd, depth + 1)
    for argv in split_commands(tokenize(text)):
        while argv and (argv[0] in PREFIXES or re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*=.*", argv[0])):
            argv = argv[1:]
        if not argv:
            continue
        prog = argv[0].rsplit("/", 1)[-1]
        if prog == "cd" and len(argv) > 1:
            cwd = argv[1]
        elif prog in SHELLS:
            script = shell_script_arg(argv)
            if script:
                check(script, cwd, depth + 1)
        elif prog == "eval":
            check(" ".join(argv[1:]), cwd, depth + 1)
        elif prog == "git":
            check_git(argv, cwd)
        elif prog == "gh" and argv[1:3] == ["repo", "delete"]:
            raise Blocked("deleting the repository")


def main() -> int:
    raw = sys.stdin.read()
    try:
        data = json.loads(raw)
        cmd = (data.get("tool_input") or {}).get("command") or ""
        check(cmd, data.get("cwd") or ".")
    except Blocked as reason:
        print(
            f"BLOCKED by .claude/hooks/block-dangerous-git.py: {reason}. "
            "Ask Scott to run it, or find a non-destructive route.",
            file=sys.stderr,
        )
        return 2
    except Exception as err:  # noqa: BLE001 - a crashing tripwire fails closed for git/gh
        if not re.search(r"\b(git|gh)\b", raw):
            return 0
        print(
            f"BLOCKED: block-dangerous-git.py could not inspect this git/gh command ({err!r}). "
            "Simplify the command (e.g. pass long text by file), or fix the hook.",
            file=sys.stderr,
        )
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
