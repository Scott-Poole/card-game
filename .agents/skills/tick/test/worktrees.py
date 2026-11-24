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
    print(json.dumps(dict(state='CLOSED', closedAt='2020-01-01T00:00:00Z')))
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
            git('branch', 'unproven', tip)
            git('branch', 'mismatch', git('-C', str(paths['ticket/6-none']), 'rev-parse', 'HEAD'))
            # No-PR branch is retained, merged head mismatch is retained.
            git('branch', 'none', tip)
            cli('prune-branches')
            names = git('branch', '--format=%(refname:short)').splitlines()
            self.assertNotIn('proven', names)
            self.assertIn('none', names)
            self.assertIn('mismatch', names)
            self.assertIn('main', names)

if __name__ == '__main__':
    unittest.main()
