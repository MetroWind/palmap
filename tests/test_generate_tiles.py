from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import generate_tiles


class GenerateTilesTest(unittest.TestCase):
    """Verify dependency and destructive-target guards."""

    def test_missing_magick_is_actionable(self):
        with mock.patch.object(
                generate_tiles.shutil, "which", return_value=None):
            with self.assertRaisesRegex(generate_tiles.TileError,
                                        "was not found"):
                generate_tiles.generateTiles(Path("map.webp"), Path("out"))

    def test_rejects_unsupported_configuration(self):
        with self.assertRaisesRegex(generate_tiles.TileError, "tile size"):
            generate_tiles.generateTiles(
                Path("map.webp"), Path("out"), tile_size=128
            )

    def test_rejects_workspace_as_output(self):
        with tempfile.TemporaryDirectory() as directory:
            previous = Path.cwd()
            try:
                generate_tiles.os.chdir(directory)
                with self.assertRaisesRegex(generate_tiles.TileError,
                                            "workspace root"):
                    generate_tiles._validateTarget(Path(directory))
            finally:
                generate_tiles.os.chdir(previous)


if __name__ == "__main__":
    unittest.main()
