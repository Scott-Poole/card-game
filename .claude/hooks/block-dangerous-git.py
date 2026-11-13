#!/usr/bin/env python3
"""PreToolUse(Bash) git guardrail.

Tailored from mattpocock/skills git-guardrails-claude-code. Feature-branch pushes stay allowed
(agents open PRs); anything that rewrites or discards history, or lands on main without a PR,
is blocked.

The command is tokenised like a shell would, and only real git/gh invocations are inspected, so
a commit message or heredoc that *mentions* a dangerous command passes. Regression cases live in
block-dangerous-git.cases; run test-block-dangerous-git.sh after any edit.
"""

import json
import re
import shlex
import subprocess
import sys

PROTECTED = {"main", "master"}
SEPARATORS = {";", "&&", "||", "|", "&", "(", ")", "|&", ";;"}
PREFIXES = {"sudo", "env", "command", "time", "nohup", "exec", "builtin"}
ALL_PATHS = {".", ":/", "*", ":/*", "./"}
# git global options that consume the following token as their value
GIT_VALUE_OPTS = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"}
PUSH_VALUE_OPTS = {"-o", "--push-option", "--repo", "--receive-pack", "--exec"}


class Blocked(Exception):
    pass


def strip_heredocs(cmd: str) -> str:
    """Drop heredoc bodies: they are data fed to a command, never commands themselves."""
    lines, out, i = cmd.split("\n"), [], 0
    while i < len(lines):
        out.append(lines[i])
        tags = re.findall(r"<<-?\s*(['\"]?)([A-Za-z_][A-Za-z0-9_]*)\1", lines[i])
        for _, tag in tags:
            i += 1
            while i < len(lines) and lines[i].strip() != tag:
                i += 1
        i += 1
    return "\n".join(out)


def tokenize(cmd: str) -> list[str]:
    lexer = shlex.shlex(cmd.replace("\n", " ; "), posix=True, punctuation_chars=True)
    lexer.whitespace_split = True
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


def short_flags(args: list[str]) -> set[str]:
    return {c for a in args if re.fullmatch(r"-[A-Za-z]+", a) for c in a[1:]}


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
    if "--force" in args or "f" in flags:
        raise Blocked("force push (use --force-with-lease on a feature branch)")
    if "--mirror" in args:
        raise Blocked("mirror push can overwrite and delete remote refs")
    if "--all" in args or "--branches" in args:
        raise Blocked("pushing every branch includes main; push one feature branch")

    positional, skip = [], False
    for a in args:
        if skip:
            skip = False
        elif a in PUSH_VALUE_OPTS:
            skip = True
        elif not a.startswith("-"):
            positional.append(a)
    refspecs = positional[1:]

    branch = current_branch(cwd)
    for spec in refspecs:
        if spec.startswith("+"):
            raise Blocked(f"'+' refspec force-pushes ({spec})")
        dst = spec.split(":", 1)[1] if ":" in spec else spec
        dst = dst.removeprefix("refs/heads/")
        if dst in PROTECTED or (dst == "HEAD" and branch in PROTECTED):
            raise Blocked("pushing to main; land changes through a PR")
    if not refspecs and branch in PROTECTED:
        raise Blocked(f"bare push while on {branch}; land changes through a PR")


def check_git(argv: list[str], cwd: str) -> str:
    """Inspect one git invocation; return the cwd it leaves in effect."""
    i = 1
    while i < len(argv) and argv[i].startswith("-"):
        if argv[i] == "-C" and i + 1 < len(argv):
            cwd = argv[i + 1]
        i += 2 if argv[i] in GIT_VALUE_OPTS else 1
    if i >= len(argv):
        return cwd
    sub, args = argv[i], argv[i + 1:]
    flags = short_flags(args)
    paths_all = any(a in ALL_PATHS for a in args)

    if sub == "push":
        check_push(args, cwd)
    elif sub == "reset" and "--hard" in args:
        raise Blocked("git reset --hard discards work")
    elif sub == "clean" and ("--force" in args or "f" in flags) \
            and not ("--dry-run" in args or "n" in flags):
        raise Blocked("git clean --force deletes untracked files")
    elif sub == "branch" and ("D" in flags or (
            ("--delete" in args or "d" in flags) and ("--force" in args or "f" in flags))):
        raise Blocked("force-deleting a branch drops unmerged commits")
    elif sub == "checkout" and (paths_all or "--force" in args or "f" in flags):
        raise Blocked("checkout that discards working-tree changes")
    elif sub == "switch" and ("--discard-changes" in args or "--force" in args or "f" in flags):
        raise Blocked("switch that discards working-tree changes")
    elif sub == "restore" and paths_all:
        staged_only = ("--staged" in args or "S" in flags) \
            and not ("--worktree" in args or "W" in flags)
        if not staged_only:
            raise Blocked("restore that discards all working-tree changes")
    elif sub == "stash" and args[:1] == ["clear"]:
        raise Blocked("git stash clear drops every stash")
    return cwd


def check(cmd: str, cwd: str, depth: int = 0) -> None:
    try:
        tokens = tokenize(strip_heredocs(cmd))
    except ValueError:
        return  # unbalanced quotes: bash will reject the command itself
    for argv in split_commands(tokens):
        while argv and (argv[0] in PREFIXES or re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*=.*", argv[0])):
            argv = argv[1:]
        if not argv:
            continue
        prog = argv[0].rsplit("/", 1)[-1]
        if prog == "cd" and len(argv) > 1:
            cwd = argv[1]
        elif prog in {"bash", "sh", "zsh"} and "-c" in argv and depth < 3:
            idx = argv.index("-c")
            if idx + 1 < len(argv):
                check(argv[idx + 1], cwd, depth + 1)
        elif prog == "git":
            cwd = check_git(argv, cwd)
        elif prog == "gh" and argv[1:3] == ["repo", "delete"]:
            raise Blocked("deleting the repository")


def main() -> int:
    data = json.load(sys.stdin)
    cmd = (data.get("tool_input") or {}).get("command") or ""
    try:
        check(cmd, data.get("cwd") or ".")
    except Blocked as reason:
        print(
            f"BLOCKED by .claude/hooks/block-dangerous-git.py: {reason}. "
            "Ask Scott to run it, or find a non-destructive route.",
            file=sys.stderr,
        )
        return 2
    except Exception as err:  # noqa: BLE001 - a crashing guardrail must fail closed for git
        if not re.search(r"\b(git|gh)\b", cmd):
            return 0
        print(
            f"BLOCKED: block-dangerous-git.py crashed ({err!r}) on a git/gh command. "
            "Fix the hook (run test-block-dangerous-git.sh) before retrying.",
            file=sys.stderr,
        )
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
