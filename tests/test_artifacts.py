import hashlib
import json
import math
from pathlib import Path
import struct
import unittest


ROOT = Path(__file__).resolve().parents[1]


class ArtifactTest(unittest.TestCase):
    """Validate checked-in deployable data and tile artifacts when present."""

    def test_real_poi_artifact(self):
        data_path = ROOT / "web" / "data" / "poi_data.json"
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
        self.assertFalse(any(
            poi["type_name"] == "Yakumo Effigy"
            for poi in data["pois"]
        ))
        known_types = set(type_ids)
        for poi in data["pois"]:
            self.assertIn(poi["type_id"], known_types)
            for value in poi["map_position"].values():
                self.assertTrue(math.isfinite(value))
                self.assertGreaterEqual(value, 0)
                self.assertLessEqual(value, 256)

    def test_alpha_pal_portrait_manifest(self):
        data = json.loads((
            ROOT / "web" / "data" / "poi_data.json"
        ).read_text())
        manifest = json.loads((
            ROOT / "source" / "alpha_pal_portrait_urls.json"
        ).read_text())
        expected = {
            poi["name"] for poi in data["pois"]
            if poi["type_name"] == "Alpha Pal"
        }
        portraits = manifest["portraits"]
        self.assertEqual(expected, set(portraits))
        self.assertEqual(len(expected), manifest["alpha_pal_count"])
        self.assertEqual(len(portraits), len(set(portraits.values())))
        for url in portraits.values():
            self.assertTrue(
                url.startswith("https://palworld.wiki.gg/images/")
            )

        runtime = json.loads((
            ROOT / "web" / "data" / "alpha_pal_pin_urls.json"
        ).read_text())
        self.assertEqual(1, runtime["schema_version"])
        pins = runtime["pins"]
        self.assertEqual(expected, set(pins))
        self.assertEqual(len(pins), len(set(pins.values())))
        for relative_path in pins.values():
            self.assertRegex(
                relative_path, r"^images/pal_pins/[a-z0-9_]+\.png$"
            )
            path = ROOT / "web" / relative_path
            header = path.read_bytes()[:24]
            self.assertEqual(b"\x89PNG\r\n\x1a\n", header[:8])
            self.assertEqual((32, 32), struct.unpack(">II", header[16:24]))

    def test_tile_artifact(self):
        tiles = ROOT / "web" / "tiles"
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

    def test_type_pin_artifacts(self):
        expected = {
            "ancient_ruin.png": (20, 19),
            "bounty.png": (40, 40),
            "depresso_effigy.png": (17, 24),
            "desert_egg.png": (18, 20),
            "dungeon.png": (24, 18),
            "enemy_camp.png": (20, 20),
            "fast_travel.png": (40, 40),
            "feybreak_egg.png": (18, 20),
            "frozen_egg.png": (18, 20),
            "grass_egg.png": (18, 20),
            "herbil_effigy.png": (16, 20),
            "journals.png": (15, 16),
            "lamball_effigy.png": (20, 20),
            "lifmunk_effigy.png": (20, 18),
            "lunaris_effigy.png": (20, 19),
            "munchill_effigy.png": (16, 20),
            "pengullet_effigy.png": (17, 20),
            "relaxaurus_effigy.png": (20, 20),
            "rooby_effigy.png": (18, 24),
            "sakura_egg.png": (18, 20),
            "sunreach_egg.png": (18, 20),
            "tanzee_effigy.png": (18, 20),
            "tower.png": (32, 32),
            "treasure_map.png": (20, 20),
            "volcano_egg.png": (18, 20),
            "watchtower.png": (17, 20),
        }
        directory = ROOT / "web" / "images" / "type_pins"
        for name, size in expected.items():
            with self.subTest(name=name):
                header = (directory / name).read_bytes()[:24]
                self.assertEqual(b"\x89PNG\r\n\x1a\n", header[:8])
                self.assertEqual(
                    size, struct.unpack(">II", header[16:24])
                )


if __name__ == "__main__":
    unittest.main()
