import json
from pathlib import Path
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import create_alpha_pal_pins


class CreateAlphaPalPinsTest(unittest.TestCase):
    """Verify Alpha Pal manifest validation and asset naming."""

    def test_pin_slug_uses_snake_case(self):
        self.assertEqual(
            "frostallion_noct",
            create_alpha_pal_pins.pinSlug("Frostallion Noct"),
        )

    def test_manifest_rejects_slug_collision(self):
        manifest = {
            "alpha_pal_count": 2,
            "portraits": {
                "Pal One": "https://example.test/one.png",
                "Pal-One": "https://example.test/two.png",
            },
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "manifest.json"
            path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(
                    create_alpha_pal_pins.BatchPinError,
                    "duplicate asset"):
                create_alpha_pal_pins.loadManifest(path)

    def test_rejects_unsafe_worker_count(self):
        with self.assertRaisesRegex(
                create_alpha_pal_pins.BatchPinError, "workers"):
            create_alpha_pal_pins.generatePins(
                Path("manifest"), Path("pins"), Path("runtime"),
                Path("poi_data"), workers=0
            )


if __name__ == "__main__":
    unittest.main()
