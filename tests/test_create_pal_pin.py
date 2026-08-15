from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import create_pal_pin


class CreatePalPinTest(unittest.TestCase):
    """Verify safe downloading and single-command pin processing."""

    def test_rejects_non_http_url(self):
        with self.assertRaisesRegex(create_pal_pin.PinError, "HTTP"):
            create_pal_pin.downloadImage(
                "file:///etc/passwd", Path("portrait"), curl="curl"
            )

    def test_processing_uses_one_magick_command(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "pin.png"
            with mock.patch.object(
                    create_pal_pin.subprocess, "run") as run:
                create_pal_pin.createPin(
                    Path("portrait.png"), output, magick="magick", level=11
                )
            self.assertEqual(1, run.call_count)
            arguments = run.call_args.args[0]
            self.assertIn("32x32!", arguments)
            self.assertIn("set", arguments)
            self.assertIn("DstIn", arguments)
            self.assertIn("black", arguments)
            self.assertIn("white", arguments)
            stroke_index = arguments.index("-strokewidth")
            self.assertEqual("1", arguments[stroke_index + 1])
            self.assertIn("DejaVu-Sans-Bold", arguments)
            self.assertIn("10", arguments)
            self.assertIn("southeast", arguments)
            self.assertIn("11", arguments)
            self.assertEqual(2, arguments.count("-annotate"))
            self.assertIn("none", arguments)
            self.assertIn("#4a4a4a", arguments)
            self.assertEqual(2, arguments.count("+0-1"))

    def test_command_failure_is_actionable(self):
        error = subprocess.CalledProcessError(
            1, ["curl"], stderr="download rejected"
        )
        with mock.patch.object(
                create_pal_pin.subprocess, "run", side_effect=error):
            with self.assertRaisesRegex(
                    create_pal_pin.PinError, "download rejected"):
                create_pal_pin.downloadImage(
                    "https://example.test/pal.png",
                    Path("portrait"),
                    curl="curl",
                )


if __name__ == "__main__":
    unittest.main()
