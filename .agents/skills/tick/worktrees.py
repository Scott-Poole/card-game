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
    return subprocess.check_output(args, text=True, stderr=subprocess.PIPE).strip()


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
              'number,state,closedAt,mergedAt,headRefOid')
    if len(result) >= 1000:
        raise ValueError('PR history may be truncated; refusing cleanup')
    return result


def classify(row, primary):
    path = Path(row['worktree']).resolve()
    branch = row.get('branch', '').removeprefix('refs/heads/')
    if path == primary or path.name == 'main-view' or path == Path.cwd() or path in Path.cwd().parents:
        return 'protected', 'keep', 'protected checkout'
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
    if issue['state'] not in ('CLOSED', 'MERGED') or not issue['closedAt'] or not old(issue['closedAt'], 3600):
        return kind, 'keep', 'owner open or closed less than one hour ago'
    if kind == 'plan':
        return kind, 'remove', 'clean, issue closed over one hour, no open PR'
    if any(pr['state'] == 'MERGED' and pr['headRefOid'] == row['HEAD'] for pr in history):
        return kind, 'remove', 'clean, closed over one hour, merged head equals tip'
    return kind, 'report', 'closed without merging or merged head differs from tip'


def safe_classify(row, primary):
    try:
        return classify(row, primary)
    except (subprocess.CalledProcessError, ValueError, KeyError, OSError) as error:
        return 'unknown', 'report', str(error)


def emit(kind, name, classification, action, reason):
    print('\t'.join(str(value).replace('\n', ' ').replace('\t', ' ') for value in
                    (kind, name, classification, action, reason)), flush=True)


def branches(rows, prune):
    checked = {row.get('branch') for row in rows}
    failed = False
    # Query actual remote heads, not potentially stale tracking refs.
    remote_heads = {}
    remote_error = None
    try:
        for remote in git('remote').splitlines():
            remote_heads[remote] = {line.split()[1].removeprefix('refs/heads/')
                                    for line in git('ls-remote', '--heads', remote).splitlines()}
    except (subprocess.CalledProcessError, OSError) as error:
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
            elif any(pr['state'] == 'MERGED' and pr['headRefOid'] == tip for pr in history):
                if remote_error:
                    raise ValueError('remote query failed: ' + remote_error)
                remote = ', '.join(name + '/' + branch for name, heads in remote_heads.items() if branch in heads)
                if prune:
                    # Recheck checked-out state and compare-and-swap the proven tip.
                    # update-ref is atomic; branch -D could delete a concurrently advanced tip.
                    if ref in {row.get('branch') for row in worktrees()}:
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
        except (subprocess.CalledProcessError, ValueError, KeyError, OSError) as error:
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
                except subprocess.CalledProcessError as error:
                    action, reason = 'report', str(error)
            if action != 'remove':
                failed = True
            emit('worktree', requested, classification, action, reason)
    elif mode == 'report':
        for row in rows:
            emit('worktree', row['worktree'], *safe_classify(row, primary))
        failed = branches(rows, False)
    else:
        failed = branches(rows, True)
    return int(failed)


if __name__ == '__main__':
    sys.exit(main())
