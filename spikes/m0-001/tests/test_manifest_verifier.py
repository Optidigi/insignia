"""Reject evidence manifests that could escape their evidence directory."""

import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "verify_evidence_manifest.py"


class ManifestVerifierTests(unittest.TestCase):
    def test_verifies_exact_file_set_and_rejects_parent_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            evidence = root / "evidence"
            evidence.mkdir()
            data = b"direct receipt\n"
            (evidence / "receipt.json").write_bytes(data)
            manifest = evidence / "manifest.json"
            manifest.write_text(json.dumps({"receiptFiles": {"receipt.json": {
                "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)
            }}}))
            okay = subprocess.run([sys.executable, str(SCRIPT), str(manifest)], capture_output=True, text=True)
            self.assertEqual(okay.returncode, 0, okay.stderr)
            hidden = evidence / "unlisted"
            hidden.mkdir()
            (hidden / "trace.txt").write_text("unlisted")
            with_unlisted_directory = subprocess.run([sys.executable, str(SCRIPT), str(manifest)], capture_output=True, text=True)
            self.assertNotEqual(with_unlisted_directory.returncode, 0)
            (hidden / "trace.txt").unlink()
            hidden.rmdir()
            manifest.write_text(json.dumps({"receiptFiles": {"../outside.json": {
                "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)
            }}}))
            rejected = subprocess.run([sys.executable, str(SCRIPT), str(manifest)], capture_output=True, text=True)
            self.assertNotEqual(rejected.returncode, 0)


if __name__ == "__main__":
    unittest.main()
