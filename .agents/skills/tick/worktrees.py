"""Conservative worktree and branch housekeeping. Thread liveness belongs to callers.

Output is tab-separated: kind, path/branch, class, action, reason.
"""
import datetime
import json
from pathlib import Path
import re
import subprocess
import sys
import time


def run(*args):
    return subprocess.check_output(args, text=True, stderr=subprocess.PIPE, timeout=60).strip()


def git(*args):
    return run('git', *args)


def gh(*args):
    try:
        return json.loads(run('gh', *args))
    except subprocess.CalledProcessError as error:
        raise ValueError('gh query failed: ' + error.stderr.strip()) from error


def worktrees():
    result = []
    for record in git('worktree', 'list', '--porcelain').split('\n\n'):
        row = {}
        for line in record.splitlines():
            key, _, value = line.partition(' ')
            row[key] = value
        if 'worktree' in row:
            result.append(row)
    return result


def old(timestamp, seconds):
    return time.time() - datetime.datetime.fromisoformat(timestamp.replace('Z', '+00:00')).timestamp() > seconds


def prs(branch):
    result = gh('pr', 'list', '--repo', 'Scott-Poole/card-game', '--head', branch,
              '--state', 'all', '--limit', '1000', '--json',
              'number,state,closedAt,mergedAt,headRefOid,baseRefName')
    if len(result) >= 1000:
        raise ValueError('PR history may be truncated; refusing cleanup')
    return result


def classify(row, primary):
    path = Path(row['worktree']).resolve()
    branch = row.get('branch', '').removeprefix('refs/heads/')
    if path == primary or path.name == 'main-view' or path == Path.cwd() or path in Path.cwd().parents:
        return 'protected', 'keep', 'protected checkout'
    git_dir = Path(git('-C', str(path), 'rev-parse', '--absolute-git-dir'))
    if (git_dir / 'read-main-view').exists():
        return 'protected', 'keep', 'read-main view marker'
    if (Path.home() / '.t3' / 'worktrees' / 'card-game').resolve() not in path.parents:
        return 'unmanaged', 'keep', 'outside T3 worktree root'
    match = re.fullmatch(r'(ticket|plan)/(\d+)-.+|pr-(\d+)', branch)
    # land names a worktree pr-N even when its branch has a different name.
    if not match and re.fullmatch(r'pr-\d+', path.name):
        match = re.fullmatch(r'pr-(\d+)', path.name)
        kind, number = 'pr', match[1]
    elif match:
        kind = match[1] or 'pr'
        number = match[2] or match[3]
    else:
        return 'interactive', 'keep', 'interactive or unmanaged branch'
    if git('-C', str(path), 'status', '--porcelain'):
        return kind, 'report', 'dirty'
    if not branch:
        return kind, 'report', 'detached checkout; no branch proof'
    history = prs(branch)
    if any(pr['state'] == 'OPEN' for pr in history):
        return kind, 'keep', 'open PR'
    if not history and kind != 'plan':
        age = time.time() - int(git('-C', str(path), 'show', '-s', '--format=%ct', 'HEAD'))
        return kind, 'report' if age > 3 * 86400 else 'keep', 'abandoned: no PR' if age > 3 * 86400 else 'no PR, recent commit'
    if any(pr['state'] == 'CLOSED' for pr in history) and not any(pr['state'] == 'MERGED' for pr in history):
        return kind, 'report', 'PR closed without merging'
    if kind == 'pr':
        issue = gh('pr', 'view', number, '--repo', 'Scott-Poole/card-game', '--json', 'state,closedAt')
    else:
        issue = gh('issue', 'view', number, '--repo', 'Scott-Poole/card-game', '--json', 'state,closedAt')
    owner_closed = (issue['state'] in ('CLOSED', 'MERGED') and issue['closedAt']
                    and old(issue['closedAt'], 3600))
    if kind == 'plan':
        if owner_closed:
            return kind, 'remove', 'clean, issue closed over one hour, no open PR'
        if not history and time.time() - int(git('-C', str(path), 'show', '-s', '--format=%ct', 'HEAD')) > 3 * 86400:
            return kind, 'report', 'abandoned: no PR'
        return kind, 'keep', 'owner open or closed less than one hour ago'
    proof = [pr for pr in history if pr['state'] == 'MERGED'
             and pr['baseRefName'] == 'main' and pr['headRefOid'] == row['HEAD']]
    if proof and (owner_closed or any(pr['closedAt'] and old(pr['closedAt'], 3600) for pr in proof)):
        return kind, 'remove', 'clean, issue/PR closed over one hour, main merged head equals tip'
    return kind, 'report', 'no aged closure with matching merged main head'


def safe_classify(row, primary):
    try:
        return classify(row, primary)
    except (subprocess.SubprocessError, ValueError, KeyError, OSError) as error:
        return 'unknown', 'report', str(error)


def emit(kind, name, classification, action, reason):
    print('\t'.join(str(value).replace('\n', ' ').replace('\t', ' ') for value in
                    (kind, name, classification, action, reason)), flush=True)


def checked_branches(rows):
    checked = {row.get('branch') for row in rows}
    for row in rows:
        directory = Path(git('-C', row['worktree'], 'rev-parse', '--absolute-git-dir'))
        for marker in ('rebase-merge/head-name', 'rebase-apply/head-name', 'BISECT_START'):
            file = directory / marker
            if file.exists():
                name = file.read_text().strip()
                checked.add(name if name.startswith('refs/heads/') else 'refs/heads/' + name)
                # BISECT_START can also contain an object id.
                for line in git('for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/').splitlines():
                    ref, tip = line.split()
                    if tip == name:
                        checked.add(ref)
    return checked


def branches(rows, prune):
    checked = checked_branches(rows)
    failed = False
    # Query actual remote heads, not potentially stale tracking refs.
    remote_heads = {}
    remote_error = None
    try:
        for remote in git('remote').splitlines():
            remote_heads[remote] = {line.split()[1].removeprefix('refs/heads/')
                                    for line in git('ls-remote', '--heads', remote).splitlines()}
    except (subprocess.SubprocessError, OSError) as error:
        remote_error = str(error)
    for line in git('for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/').splitlines():
        ref, tip = line.split()
        branch = ref.removeprefix('refs/heads/')
        if ref in checked or branch in ('main', 'master'):
            emit('branch', branch, 'protected', 'keep', 'checked out or protected branch')
            continue
        try:
            history = prs(branch)
            if any(pr['state'] == 'OPEN' for pr in history):
                emit('branch', branch, 'open', 'keep', 'open PR')
            elif any(pr['state'] == 'MERGED' and pr['baseRefName'] == 'main' and pr['headRefOid'] == tip for pr in history):
                if remote_error:
                    raise ValueError('remote query failed: ' + remote_error)
                remote = ', '.join(name + '/' + branch for name, heads in remote_heads.items() if branch in heads)
                if prune:
                    # Recheck checked-out state and compare-and-swap the proven tip.
                    # update-ref is atomic; branch -D could delete a concurrently advanced tip.
                    if ref in checked_branches(worktrees()):
                        raise ValueError('branch became checked out')
                    git('update-ref', '-d', ref, tip)
                    # Match branch -D's config cleanup after the atomic ref deletion.
                    config = subprocess.run(['git', 'config', '--remove-section', 'branch.' + branch],
                                            capture_output=True, text=True)
                    if config.returncode not in (0, 128):
                        raise ValueError('branch deleted, config cleanup failed: ' + config.stderr)
                emit('branch', branch, 'merged', 'remove', ('deleted; ' if prune else '') +
                     'merged head equals tip' + ('; remote retained: ' + remote if remote else ''))
            else:
                emit('branch', branch, 'unproven', 'report', 'no merged PR at local tip')
        except (subprocess.SubprocessError, ValueError, KeyError, OSError) as error:
            failed = True
            emit('branch', branch, 'unknown', 'report', str(error))
    return failed


def main():
    mode, *paths = sys.argv[1:] or ['report']
    if mode not in ('report', 'remove', 'prune-branches') or (mode != 'remove' and paths) or (mode == 'remove' and not paths):
        sys.exit('usage: worktrees.sh [report | remove <path>... | prune-branches]')
    rows = worktrees()
    primary = Path(rows[0]['worktree']).resolve()
    failed = False
    if mode == 'remove':
        for requested in paths:
            row = next((r for r in worktrees() if Path(r['worktree']).resolve() == Path(requested).resolve()), None)
            classification, action, reason = safe_classify(row, primary) if row else ('unknown', 'report', 'not a registered worktree')
            if action == 'remove':
                try:
                    git('worktree', 'remove', row['worktree'])
                    reason = 'removed: ' + reason
                except subprocess.SubprocessError as error:
                    action, reason = 'report', str(error)
            if action != 'remove':
                failed = True
            emit('worktree', requested, classification, action, reason)
    elif mode == 'report':
        for row in rows:
            result = safe_classify(row, primary)
            emit('worktree', row['worktree'], *result)
            failed = failed or result[0] == 'unknown'
        failed = branches(rows, False) or failed
    else:
        failed = branches(rows, True)
    return int(failed)


if __name__ == '__main__':
    sys.exit(main())
