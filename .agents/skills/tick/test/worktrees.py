"""Exercise the sweep CLI against real disposable git repositories."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'worktrees.sh'

class Sweep(unittest.TestCase):
    def test_protected_checkout(self):
        with tempfile.TemporaryDirectory() as directory:
            def git(*args):
                return subprocess.check_output(['git', '-C', directory, *args], text=True).strip()
            git('init', '-b', 'main')
            git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'initial')
            result = subprocess.check_output(['bash', str(SCRIPT)], cwd=directory, text=True)
            self.assertIn('keep', result)
            self.assertIn('protected', result)


    def test_classification_and_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / 'repo'
            repo.mkdir()
            def git(*args):
                return subprocess.check_output(['git', '-C', str(repo), *args], text=True, stderr=subprocess.PIPE).strip()
            git('init', '-b', 'main')
            git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'initial')
            tip = git('rev-parse', 'HEAD')
            remote = root / 'remote.git'
            git('init', '--bare', str(remote))
            git('remote', 'add', 'origin', str(remote))
            git('push', '-u', 'origin', 'main')
            fake = root / 'bin'
            fake.mkdir()
            (fake / 'gh').write_text("""#!/usr/bin/env python3
import json, os, sys
a=sys.argv
if os.environ.get('FAIL_GH'):
    sys.exit(1)
if a[1:3] in (['issue','view'], ['pr','view']):
    print(json.dumps(dict(state='OPEN' if os.environ.get('ISSUE_OPEN') else 'CLOSED', closedAt='2999-01-01T00:00:00Z' if os.environ.get('RECENT') else '2020-01-01T00:00:00Z')))
else:
    branch=a[a.index('--head')+1]
    state='OPEN' if 'open' in branch else 'CLOSED' if 'closed' in branch else 'MERGED'
    print(json.dumps([] if 'none' in branch else [dict(state=state,headRefOid=os.environ['TIP'],closedAt='2020-01-01T00:00:00Z')]))
""")
            (fake / 'gh').chmod(0o755)
            env = dict(os.environ, PATH=str(fake)+os.pathsep+os.environ['PATH'], TIP=tip)
            def cli(*args, cwd=repo, extra=None, check=True):
                return subprocess.run(['bash', str(SCRIPT), *args], cwd=cwd, env=env | (extra or {}), text=True, capture_output=True, check=check)
            cases = [('ticket/1-merged', 'remove'), ('plan/2-done', 'remove'),
                     ('pr-3', 'remove'), ('ticket/4-closed', 'report'),
                     ('ticket/5-open', 'keep'), ('t3/interactive', 'keep'),
                     ('ticket/6-none', 'keep')]
            paths = {}
            for branch, action in cases:
                path = root / branch.replace('/', '-')
                git('worktree', 'add', '-b', branch, str(path))
                paths[branch] = path
                self.assertIn(str(path)+'\t', cli().stdout)
                row = next(row for row in cli().stdout.splitlines() if str(path)+'\t' in row)
                self.assertIn('\t'+action+'\t', row)
            # main-view is protected even when it has a removable automation branch.
            main_view = root / 'main-view'
            git('worktree', 'add', '-b', 'ticket/8-view', str(main_view))
            self.assertNotEqual(cli('remove', str(main_view), check=False).returncode, 0)
            # PWD protection includes subdirectories, not only the checkout root.
            nested = paths['pr-3'] / 'nested'
            nested.mkdir()
            self.assertNotEqual(cli('remove', str(paths['pr-3']), cwd=nested, check=False).returncode, 0)
            nested.rmdir()
            self.assertNotEqual(cli('remove', str(paths['pr-3']), extra={'RECENT':'1'}, check=False).returncode, 0)
            self.assertNotEqual(cli('remove', str(paths['pr-3']), extra={'FAIL_GH':'1'}, check=False).returncode, 0)
            self.assertTrue(paths['pr-3'].exists())
            dirty = paths['ticket/1-merged'] / 'dirty'
            dirty.write_text('work')
            self.assertIn('dirty', cli().stdout)
            self.assertNotEqual(cli('remove', str(dirty.parent), check=False).returncode, 0)
            dirty.unlink()
            self.assertIn('protected', cli(cwd=paths['pr-3']).stdout)
            self.assertNotEqual(cli('remove', str(paths['pr-3']), cwd=paths['pr-3'], check=False).returncode, 0)
            self.assertIn('unknown\treport', cli(extra={'FAIL_GH':'1'}).stdout)
            subprocess.run(['git', '-C', str(paths['ticket/6-none']), '-c', 'user.name=Test', '-c',
                            'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'old'],
                           env=env | {'GIT_COMMITTER_DATE':'2020-01-01T00:00:00Z','GIT_AUTHOR_DATE':'2020-01-01T00:00:00Z'},
                           check=True, capture_output=True)
            self.assertIn('abandoned', cli().stdout)
            cli('remove', str(paths['ticket/1-merged']))
            self.assertFalse(paths['ticket/1-merged'].exists())
            git('branch', 'proven', tip)
            git('branch', 'mismatch', git('-C', str(paths['ticket/6-none']), 'rev-parse', 'HEAD'))
            # No-PR branch is retained, merged head mismatch is retained.
            git('branch', 'none', tip)
            # Checked-out merged branches, open PR branches, failed queries and mismatched tips survive.
            git('branch', 'open', tip)
            git('config', 'branch.proven.remote', 'origin')
            git('config', 'branch.proven.merge', 'refs/heads/proven')
            before = git('branch', '--format=%(refname:short)')
            self.assertNotEqual(cli('prune-branches', extra={'FAIL_GH':'1'}, check=False).returncode, 0)
            self.assertEqual(before, git('branch', '--format=%(refname:short)'))
            self.assertIn('PR closed without merging', cli(extra={'ISSUE_OPEN':'1'}).stdout)
            advanced = paths['ticket/6-none']
            mismatch = root / 'mismatch-tree'
            git('worktree', 'add', '-b', 'ticket/7-mismatch', str(mismatch), git('-C', str(advanced), 'rev-parse', 'HEAD'))
            row = next(row for row in cli().stdout.splitlines() if str(mismatch)+'\t' in row)
            self.assertIn('\treport\t', row)
            # A live remote is retained and named accurately.
            git('push', 'origin', 'proven')
            output = cli('prune-branches').stdout
            self.assertIn('remote retained: origin/proven', output)
            self.assertEqual(git('ls-remote', '--heads', 'origin', 'proven').split()[0], tip)
            self.assertEqual(subprocess.run(['git', '-C', str(repo), 'config', '--get', 'branch.proven.remote'],
                                           capture_output=True).returncode, 1)
            names = git('branch', '--format=%(refname:short)').splitlines()
            self.assertNotIn('proven', names)
            self.assertIn('none', names)
            self.assertIn('mismatch', names)
            self.assertIn('main', names)
            self.assertIn('open', names)
            self.assertIn('plan/2-done', names)
            self.assertIn('pr-3', names)
            self.assertIn('ticket/4-closed', names)
            self.assertIn('ticket/8-view', names)

if __name__ == '__main__':
    unittest.main()
