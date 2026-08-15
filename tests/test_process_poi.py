import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import process_poi


class ProcessPoiTest(unittest.TestCase):
    """Verify parsing, identity, projection, and artifact behavior."""

    def setUp(self):
        self.source_path = ROOT / "tests" / "fixtures" / "map_data_sample.js"
        self.source_bytes = self.source_path.read_bytes()
        self.source = self.source_bytes.decode()
        self.metadata = {
            "source_url": "https://example.test/map.js",
            "retrieved_at": "2026-08-14T12:00:00Z",
        }

    def test_extracts_nested_assignments(self):
        parsed = process_poi.parseSource(self.source)
        self.assertEqual("A [nested] test",
                         parsed["fixedDungeon"][0]["comment"])

    def test_rejects_duplicate_assignment(self):
        with self.assertRaises(process_poi.ConversionError):
            process_poi.parseSource(self.source + "\nvar config = {};")

    def test_rejects_non_standard_json_number(self):
        source = self.source.replace(
            '"X": 8192, "Y": 8192', '"X": NaN, "Y": 8192'
        )
        with self.assertRaises(process_poi.ConversionError):
            process_poi.parseSource(source)

    def test_plain_text_drops_markup_attributes(self):
        text = process_poi.plainText(
            '<img alt="not a name" title="also no"> Small   Settlement'
        )
        self.assertEqual("Small Settlement", text)

    def test_paldex_axes_are_crossed(self):
        raw = process_poi.paldexToRaw(10, 20)
        self.assertEqual(-123888 + 20 * 459, raw["x"])
        self.assertEqual(158000 + 10 * 459, raw["y"])

    def test_projection_calibration_anchors(self):
        parsed = process_poi.parseSource(self.source)
        bounds = process_poi._sourceBounds(parsed["config"])
        fixture = json.loads((
            ROOT / "tests" / "fixtures" / "calibration_points.json"
        ).read_text())
        for point in fixture:
            with self.subTest(point["source_id"]):
                source = point["source"]
                if point["system"] == "paldex":
                    source = process_poi.paldexToRaw(**source)
                actual = process_poi.rawToMap(**source, bounds=bounds)
                for axis in ("x", "y"):
                    error_pixels = abs(
                        point["expected_map"][axis] - actual[axis]
                    ) * 32
                    self.assertLessEqual(
                        error_pixels, point["tolerance_native_pixels"]
                    )

    def test_projection_is_monotonic_in_the_documented_axes(self):
        parsed = process_poi.parseSource(self.source)
        bounds = process_poi._sourceBounds(parsed["config"])
        center = process_poi.rawToMap(-276020, -15000, bounds)
        raw_y_east = process_poi.rawToMap(-276020, -14000, bounds)
        raw_x_north = process_poi.rawToMap(-275020, -15000, bounds)
        self.assertGreater(raw_y_east["x"], center["x"])
        self.assertLess(raw_x_north["y"], center["y"])

    def test_compact_id_matches_design_vector(self):
        identity = {
            "kind": "upstream",
            "type": "Region",
            "upstream_id": "REGION_Grass_1_Village",
        }
        self.assertEqual("EnZc1kqJ", process_poi.compactId(identity))

    def test_dataset_is_deterministic_and_preserves_coordinates(self):
        first = process_poi.buildDataset(
            process_poi.parseSource(self.source), self.source_bytes,
            self.metadata
        )
        second = process_poi.buildDataset(
            process_poi.parseSource(self.source), self.source_bytes,
            self.metadata
        )
        self.assertEqual(first, second)
        self.assertEqual(2, len(first["pois"]))
        self.assertEqual(
            hashlib.sha256(self.source_bytes).hexdigest(),
            first["source"]["sha256"]
        )
        self.assertIn("source_position", first["pois"][0])

    def test_invalid_coordinate_does_not_emit_a_poi(self):
        parsed = process_poi.parseSource(self.source)
        parsed["fixedDungeon"][0]["pos"]["x"] = True
        warnings = []
        dataset = process_poi.buildDataset(
            parsed, self.source_bytes, self.metadata, warn=warnings.append
        )
        self.assertEqual(1, len(dataset["pois"]))
        self.assertTrue(warnings)

    def test_ignored_poi_type_does_not_emit_a_poi_or_type(self):
        parsed = process_poi.parseSource(self.source)
        parsed["fixedDungeon"][0]["item"] = "Yakumo Effigy"
        parsed["fixedDungeon"][0]["type"] = "Yakumo Effigy"
        dataset = process_poi.buildDataset(
            parsed, self.source_bytes, self.metadata
        )
        self.assertEqual(1, dataset["generation"]["statistics"]["ignored"])
        self.assertFalse(any(
            poi["type_name"] == "Yakumo Effigy"
            for poi in dataset["pois"]
        ))
        self.assertFalse(any(
            item["name"] == "Yakumo Effigy"
            for item in dataset["types"]
        ))

    def test_atomic_write_replaces_complete_json(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "data.json"
            output.write_text("old")
            process_poi.writeAtomic(output, {"finite": 1.0})
            self.assertEqual({"finite": 1.0}, json.loads(output.read_text()))


if __name__ == "__main__":
    unittest.main()
