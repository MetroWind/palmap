import hashlib
import json
import math
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class ArtifactTest(unittest.TestCase):
    """Validate checked-in deployable data and tile artifacts when present."""

    def test_real_poi_artifact(self):
        data_path = ROOT / "data" / "poi_data.json"
        source_path = ROOT / "source" / "map_data_en.js"
        if not data_path.exists() or not source_path.exists():
            self.skipTest("real POI artifact or retained source is absent")
        data = json.loads(data_path.read_text())
        self.assertEqual(1, data["schema_version"])
        digest = hashlib.sha256(source_path.read_bytes()).hexdigest()
        self.assertEqual(digest, data["source"]["sha256"])
        type_ids = [item["id"] for item in data["types"]]
        self.assertEqual(len(type_ids), len(set(type_ids)))
        self.assertEqual(
            data["types"],
            sorted(data["types"], key=lambda item: (
                item["name"].casefold(), item["name"]
            ))
        )
        poi_ids = [item["id"] for item in data["pois"]]
        self.assertEqual(sorted(poi_ids), poi_ids)
        self.assertEqual(len(poi_ids), len(set(poi_ids)))
        self.assertEqual(
            len(poi_ids),
            data["generation"]["statistics"]["output_records"]
        )
        known_types = set(type_ids)
        for poi in data["pois"]:
            self.assertIn(poi["type_id"], known_types)
            for value in poi["map_position"].values():
                self.assertTrue(math.isfinite(value))
                self.assertGreaterEqual(value, 0)
                self.assertLessEqual(value, 256)

    def test_tile_artifact(self):
        tiles = ROOT / "tiles"
        if not (tiles / "manifest.json").exists():
            self.skipTest("generated tile artifact is absent")
        manifest = json.loads((tiles / "manifest.json").read_text())
        self.assertEqual(256, manifest["tile_size"])
        self.assertEqual(0, manifest["min_zoom"])
        self.assertEqual(5, manifest["max_zoom"])
        self.assertEqual(1365, manifest["total_tile_count"])
        actual = list(tiles.glob("*/*/*.webp"))
        self.assertEqual(1365, len(actual))
        for zoom in range(6):
            limit = 2 ** zoom
            expected = {
                tiles / str(zoom) / str(x) / f"{y}.webp"
                for x in range(limit) for y in range(limit)
            }
            self.assertTrue(all(path.is_file() for path in expected))


if __name__ == "__main__":
    unittest.main()
