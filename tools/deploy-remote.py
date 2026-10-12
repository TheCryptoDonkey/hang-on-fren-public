#!/usr/bin/env python3
"""Forced SSH command for Hang On Fren static releases; installed root-owned."""
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys

ROOT = Path('/opt/hang-on-fren')
RELEASE = re.compile(r'arcade-([0-9a-f]{40})-([0-9]+)-([0-9]+)')


def parse_command(command):
    words = shlex.split(command)
    if len(words) == 3 and words[0] == 'hof-deploy' and words[1] in ('prepare', 'verify-api', 'activate') and RELEASE.fullmatch(words[2]):
        return words[1], words[2]
    if len(words) >= 4 and words[:2] == ['rsync', '--server'] and '--sender' not in words:
        # rrsync independently checks options and confines all destinations.
        return 'upload', None
    raise ValueError('Only scoped Hang On Fren deployment commands are permitted')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def checked_file(release, item):
    relative = Path(item['path'])
    if relative.is_absolute() or '..' in relative.parts:
        raise ValueError('Invalid manifest path')
    path = release / relative
    if not path.is_file() or path.is_symlink() or not path.resolve().is_relative_to(release.resolve()):
        raise ValueError('Release file escapes its directory')
    if digest(path) != item['sha256']:
        raise ValueError('Checked release hash mismatch: ' + item['path'])
    return path


def verify_api(release, revision):
    manifest = json.loads((release / 'api/api-manifest.json').read_text())
    if manifest['sourceRevision'] != revision:
        raise ValueError('Checked API revision mismatch')
    entry = next(item for item in manifest['files'] if item['path'] == 'index.js')
    staged = checked_file(release / 'api', entry)
    if digest(staged) != digest(ROOT / 'api/index.js'):
        raise ValueError('API differs from live service: complete a separate checked API rollout before activating this client')
    print('Checked API is unchanged; configuration, process and score history preserved')


def main():
    action, name = parse_command(os.environ.get('SSH_ORIGINAL_COMMAND', ''))
    if action == 'upload':
        os.execv('/usr/bin/rrsync', ['rrsync', '-wo', '-no-del', str(ROOT / 'releases')])
    release = ROOT / 'releases' / name
    revision = RELEASE.fullmatch(name).group(1)
    if action == 'prepare':
        release.mkdir(mode=0o755)  # Never reuse or overwrite a prior release.
        return
    if not release.is_dir() or release.is_symlink():
        raise ValueError('Expected an existing release directory')
    if action == 'verify-api':
        verify_api(release, revision)
        return
    manifest = json.loads((release / 'client-manifest.json').read_text())
    if manifest['sourceRevision'] != revision or not manifest['files']:
        raise ValueError('Checked client revision mismatch')
    for item in manifest['files']:
        checked_file(release, item)
    if json.loads((release / 'version.json').read_text()).get('revision') != revision:
        raise ValueError('Published version revision mismatch')
    verify_api(release, revision)
    health = json.loads(subprocess.check_output(['curl', '-fsS', 'http://127.0.0.1:3191/healthz']))
    if not health.get('ok') or not health.get('signer_configured'):
        raise ValueError('Live API health failed')
    temporary = ROOT / ('current-' + name)
    temporary.symlink_to(release)
    os.replace(temporary, ROOT / 'current')
    print('Activated checked client ' + revision)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, OSError, StopIteration, subprocess.CalledProcessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
