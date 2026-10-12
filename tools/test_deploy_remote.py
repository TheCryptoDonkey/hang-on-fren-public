import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('deploy', Path(__file__).with_name('deploy-remote.py'))
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)

class DeploymentBoundary(unittest.TestCase):
    def test_arbitrary_shell_and_traversal_are_rejected(self):
        for command in ['id', 'bash -se', 'hof-deploy activate ../api', 'hof-deploy prepare arcade-' + 'a'*40 + '-1-1; id', 'rsync --server --sender . release/']:
            with self.subTest(command=command), self.assertRaises(ValueError):
                deploy.parse_command(command)
    def test_only_release_upload_and_named_operations_are_allowed(self):
        release = 'arcade-' + 'a'*40 + '-1-1'
        self.assertEqual(deploy.parse_command('hof-deploy activate '+release), ('activate', release))
        self.assertEqual(deploy.parse_command('rsync --server -logDtpre.iLsfxCIvu . '+release+'/'), ('upload', None))
    def test_symlink_escape_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); release=root/'release';release.mkdir()
            (root/'other').write_text('unexpected');(release/'entry').symlink_to(root/'other')
            with self.assertRaises(ValueError):deploy.checked_file(release, {'path':'entry','sha256':deploy.digest(root/'other')})
    def test_changed_api_is_rejected_before_activation(self):
        import json
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'api').mkdir();(root/'api/index.js').write_text('live')
            release=root/'releases/r';(release/'api').mkdir(parents=True)
            (release/'api/index.js').write_text('changed')
            (release/'api/api-manifest.json').write_text(json.dumps({'sourceRevision':'a'*40,'files':[{'path':'index.js','sha256':deploy.digest(release/'api/index.js')}]}))
            with patch.object(deploy,'ROOT',root), self.assertRaisesRegex(ValueError,'separate checked API rollout'):
                deploy.verify_api(release, 'a'*40)

if __name__ == '__main__':unittest.main()
