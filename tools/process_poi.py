#!/usr/bin/env python3
"""Convert a PalDB map JavaScript snapshot to Palmap JSON."""

import argparse
import base64
import hashlib
from html.parser import HTMLParser
import json
import math
import os
from pathlib import Path
import re
import sys
import tempfile
import unicodedata


PALDEX_SCALE = 459
RAW_WORLD_MIDPOINT_X = -123888
RAW_WORLD_MIDPOINT_Y = 158000
MAP_SIZE = 256
SOURCE_IMAGE_SIZE = 8192
# Fine registration correction for the extracted game texture. Positive
# values move pins right or down.
MAP_IMAGE_OFFSET_NATIVE_PIXELS_X = 0
MAP_IMAGE_OFFSET_NATIVE_PIXELS_Y = 0
EXPECTED_VARIABLES = {
    "iconLookup": dict,
    "extrasIngame": list,
    "config": dict,
    "fixedDungeon": list,
    "regionData": list,
}
PALETTE = (
    "#2563eb", "#7c3aed", "#be123c", "#047857", "#b45309",
    "#0e7490", "#a21caf", "#4d7c0f", "#c2410c", "#4338ca",
)
ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{8}$")


class ConversionError(Exception):
    """Indicate that conversion cannot produce a trustworthy artifact."""


class FatalConversionError(ConversionError):
    """Indicate a dataset-wide ambiguity that non-strict mode cannot skip."""


class _TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)


def _rejectJsonConstant(value):
    raise ValueError(f"non-standard JSON constant {value}")


def plainText(value):
    """Return normalized text from an upstream HTML-like scalar."""
    if value is None:
        return None
    if not isinstance(value, (str, int, float)) or isinstance(value, bool):
        return None
    parser = _TextExtractor()
    parser.feed(str(value))
    parser.close()
    text = " ".join("".join(parser.parts).split())
    return text or None


def extractAssignment(source, name, expected_type):
    """Extract one allowlisted JSON-compatible variable assignment."""
    pattern = re.compile(r"\bvar\s+" + re.escape(name) + r"\s*=")
    matches = list(pattern.finditer(source))
    if len(matches) != 1:
        raise ConversionError(
            f"expected exactly one assignment for {name}, found {len(matches)}"
        )
    start = matches[0].end()
    while start < len(source) and source[start].isspace():
        start += 1
    if start == len(source) or source[start] not in "[{":
        raise ConversionError(f"{name} must be assigned an object or array")

    stack = []
    in_string = False
    escaped = False
    end = None
    pairs = {"}": "{", "]": "["}
    for index in range(start, len(source)):
        character = source[index]
        if in_string:
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == '"':
                in_string = False
            continue
        if character == '"':
            in_string = True
        elif character in "[{":
            stack.append(character)
        elif character in "}]":
            if not stack or stack.pop() != pairs[character]:
                raise ConversionError(f"unbalanced container in {name}")
            if not stack:
                end = index + 1
                break
    if end is None or in_string:
        raise ConversionError(f"unterminated assignment for {name}")
    trailer = end
    while trailer < len(source) and source[trailer].isspace():
        trailer += 1
    if trailer == len(source) or source[trailer] != ";":
        raise ConversionError(
            f"assignment for {name} must end with a semicolon"
        )
    try:
        value = json.loads(
            source[start:end], parse_constant=_rejectJsonConstant
        )
    except (json.JSONDecodeError, ValueError) as error:
        raise ConversionError(
            f"{name} is not JSON-compatible: {error}"
        ) from error
    if not isinstance(value, expected_type):
        raise ConversionError(f"{name} has the wrong top-level type")
    return value


def parseSource(source):
    """Parse all required variables without executing source JavaScript."""
    return {
        name: extractAssignment(source, name, expected_type)
        for name, expected_type in EXPECTED_VARIABLES.items()
    }


def _number(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ConversionError(f"{label} must be numeric")
    result = float(value)
    if not math.isfinite(result):
        raise ConversionError(f"{label} must be finite")
    return result


def paldexToRaw(x, y):
    """Convert crossed Paldex axes to raw-world coordinates."""
    paldex_x = _number(x, "paldex.x")
    paldex_y = _number(y, "paldex.y")
    return {
        "x": paldex_y * PALDEX_SCALE + RAW_WORLD_MIDPOINT_X,
        "y": paldex_x * PALDEX_SCALE + RAW_WORLD_MIDPOINT_Y,
    }


def rawToMap(x, y, bounds):
    """Project raw-world axes into top-down map-image coordinates."""
    raw_x = _number(x, "raw_world.x")
    raw_y = _number(y, "raw_world.y")
    pixels_per_map_unit = SOURCE_IMAGE_SIZE / MAP_SIZE
    return {
        "x": MAP_SIZE * (raw_y - bounds["min_y"])
        / (bounds["max_y"] - bounds["min_y"])
        + MAP_IMAGE_OFFSET_NATIVE_PIXELS_X / pixels_per_map_unit,
        "y": MAP_SIZE * (bounds["max_x"] - raw_x)
        / (bounds["max_x"] - bounds["min_x"])
        + MAP_IMAGE_OFFSET_NATIVE_PIXELS_Y / pixels_per_map_unit,
    }


def typeSlug(value):
    """Create the canonical ASCII identifier for a POI type."""
    normalized = unicodedata.normalize("NFKD", value)
    ascii_value = "".join(
        character for character in normalized
        if not unicodedata.combining(character) and ord(character) < 128
    ).lower()
    slug = re.sub(r"[^a-z0-9]+", "_", ascii_value).strip("_")
    if not slug:
        raise ConversionError("POI type has no usable ASCII identifier")
    return slug


def _canonicalNumber(value):
    number = _number(value, "identity coordinate")
    if number == 0:
        return "0"
    if number.is_integer():
        return str(int(number))
    return format(number, ".15g")


def compactId(identity, hash_function=hashlib.sha256):
    """Hash a canonical identity into an eight-character stable ID."""
    encoded = json.dumps(
        identity, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    digest = hash_function(encoded).digest()[:6]
    result = base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")
    if not ID_PATTERN.fullmatch(result):
        raise ConversionError("internal error: invalid compact ID")
    return result


def _sourceBounds(config):
    try:
        dimensions = config["minMapTextureBlockSize"]
        width = _number(dimensions["X"], "config map width")
        height = _number(dimensions["Y"], "config map height")
        minimum = config["landScapeRealPositionMin"]
        maximum = config["landScapeRealPositionMax"]
        bounds = {
            "min_x": _number(minimum["X"], "config minimum X"),
            "min_y": _number(minimum["Y"], "config minimum Y"),
            "max_x": _number(maximum["X"], "config maximum X"),
            "max_y": _number(maximum["Y"], "config maximum Y"),
        }
    except (KeyError, TypeError) as error:
        raise ConversionError(
            "config is missing dimensions or required raw-world bounds"
        ) from error
    if width != SOURCE_IMAGE_SIZE or height != SOURCE_IMAGE_SIZE:
        raise ConversionError(
            f"config map dimensions must be {SOURCE_IMAGE_SIZE} square"
        )
    if bounds["min_x"] >= bounds["max_x"] or bounds["min_y"] >= bounds["max_y"]:
        raise ConversionError("config raw-world bounds are not ordered")
    return {key: int(value) if value.is_integer() else value
            for key, value in bounds.items()}


def _coordinate(record, bounds):
    def read(position, system):
        if not isinstance(position, dict):
            raise ConversionError(f"{system} position must be an object")
        return _number(position.get("X", position.get("x")),
                       f"{system}.x"), _number(
            position.get("Y", position.get("y")), f"{system}.y"
        )

    has_pos = "pos" in record
    has_ipos = "ipos" in record
    if not has_pos and not has_ipos:
        raise ConversionError("record has neither pos nor ipos")
    if has_pos:
        source_x, source_y = read(record["pos"], "raw_world")
        raw = {"x": source_x, "y": source_y}
        system = "raw_world"
        if has_ipos:
            ipos_x, ipos_y = read(record["ipos"], "paldex")
            alternate = paldexToRaw(ipos_x, ipos_y)
            pixel_x = (bounds["max_x"] - bounds["min_x"])
            pixel_x /= SOURCE_IMAGE_SIZE
            pixel_y = (bounds["max_y"] - bounds["min_y"])
            pixel_y /= SOURCE_IMAGE_SIZE
            if (abs(raw["x"] - alternate["x"]) > pixel_x
                    or abs(raw["y"] - alternate["y"]) > pixel_y):
                raise ConversionError("pos and ipos disagree by over one pixel")
    else:
        source_x, source_y = read(record["ipos"], "paldex")
        raw = paldexToRaw(source_x, source_y)
        system = "paldex"
    source = {
        "system": system,
        "x": int(source_x) if source_x.is_integer() else source_x,
        "y": int(source_y) if source_y.is_integer() else source_y,
    }
    return source, raw, rawToMap(raw["x"], raw["y"], bounds)


def _scalar(value):
    if (isinstance(value, bool) or value is None
            or isinstance(value, (dict, list))):
        return None
    if isinstance(value, str) and not value:
        return None
    return value


def _derivedIdentity(record, type_name, source_position):
    unique_name = record.get("UniqueName")
    if isinstance(unique_name, dict):
        unique_name = _scalar(unique_name.get("Key"))
    else:
        unique_name = None
    return {
        "kind": "derived",
        "type": type_name,
        "coordinate_system": source_position["system"],
        "x": _canonicalNumber(source_position["x"]),
        "y": _canonicalNumber(source_position["y"]),
        "href": _scalar(record.get("href")),
        "unique_name": unique_name,
    }


def _category(icon_lookup, type_name):
    metadata = icon_lookup.get(type_name)
    if not isinstance(metadata, dict):
        return "Other"
    for key in ("category", "group", "type"):
        value = plainText(metadata.get(key))
        if value:
            return value
    return "Other"


def _pinColor(type_id):
    digest = hashlib.sha256(type_id.encode("ascii")).digest()
    return PALETTE[int.from_bytes(digest[:2], "big") % len(PALETTE)]


def buildDataset(parsed, source_bytes, metadata, strict=False, warn=None):
    """Validate parsed PalDB values and build the normalized dataset."""
    warning = warn or (
        lambda message: print(f"warning: {message}", file=sys.stderr)
    )
    source_bounds = _sourceBounds(parsed["config"])
    entries = []
    upstream_counts = {}
    arrays = ("fixedDungeon", "extrasIngame", "regionData")
    for array_name in arrays:
        for index, record in enumerate(parsed[array_name]):
            if isinstance(record, dict):
                key = (_scalar(record.get("type")), _scalar(record.get("id")))
                if key[0] is not None and key[1] is not None:
                    upstream_counts[key] = upstream_counts.get(key, 0) + 1
            entries.append((array_name, index, record))

    statistics = {
        "source_records": len(entries),
        "output_records": 0,
        "deduplicated": 0,
        "excluded_out_of_bounds": 0,
    }
    types = {}
    pois = {}
    identities = {}
    had_warning = False
    for array_name, index, record in entries:
        label = f"{array_name}[{index}]"
        try:
            if not isinstance(record, dict):
                raise ConversionError("record must be an object")
            name = plainText(record.get("item"))
            type_name = plainText(record.get("type"))
            if not name or not type_name:
                raise ConversionError("record requires non-empty item and type")
            type_id = typeSlug(type_name)
            category = _category(parsed["iconLookup"], type_name)
            source_position, unused_raw, map_position = _coordinate(
                record, source_bounds
            )
            if not all(
                    0 <= map_position[axis] <= MAP_SIZE
                    for axis in ("x", "y")):
                statistics["excluded_out_of_bounds"] += 1
                raise ConversionError(
                    f"out of bounds: source={source_position}, "
                    f"map={map_position}"
                )

            upstream_id = _scalar(record.get("id"))
            if upstream_id is not None and upstream_counts[(record.get("type"),
                                                            upstream_id)] == 1:
                identity = {
                    "kind": "upstream",
                    "type": record.get("type"),
                    "upstream_id": upstream_id,
                }
            else:
                if upstream_id is not None:
                    had_warning = True
                    warning(
                        f"{label}: duplicate upstream ID; "
                        "using derived identity"
                    )
                identity = _derivedIdentity(record, type_name, source_position)
            poi_id = compactId(identity)
            details = {
                "level": record.get("lv")
                if isinstance(record.get("lv"), int)
                and not isinstance(record.get("lv"), bool) else None,
                "comment": plainText(record.get("comment")),
                "availability": plainText(record.get("onlyTime")),
            }
            poi = {
                "id": poi_id,
                "name": name,
                "type_id": type_id,
                "type_name": type_name,
                "category": category,
                "map_position": map_position,
                "source_position": source_position,
                "details": details,
            }
            identity_json = json.dumps(
                identity, sort_keys=True, separators=(",", ":")
            )
            if poi_id in identities and identities[poi_id] != identity_json:
                raise FatalConversionError(f"stable ID collision for {poi_id}")
            if poi_id in pois:
                if pois[poi_id] != poi:
                    raise FatalConversionError(
                        f"ambiguous duplicate stable ID {poi_id}"
                    )
                statistics["deduplicated"] += 1
                had_warning = True
                warning(f"{label}: deduplicated identical record {poi_id}")
                continue
            identities[poi_id] = identity_json
            pois[poi_id] = poi
            existing_type = types.get(type_id)
            type_record = {
                "id": type_id,
                "name": type_name,
                "category": category,
                "pin_color": _pinColor(type_id),
            }
            if existing_type is not None and existing_type != type_record:
                raise FatalConversionError(
                    f"type slug collision for {type_name}"
                )
            types[type_id] = type_record
        except FatalConversionError:
            raise
        except ConversionError as error:
            if "out of bounds" not in str(error):
                had_warning = True
            warning(f"{label}: {error}")
            if strict:
                raise ConversionError(
                    f"strict conversion rejected {label}: {error}"
                ) from error

    if strict and had_warning:
        raise ConversionError("strict conversion rejected warnings")
    statistics["output_records"] = len(pois)
    digest = hashlib.sha256(source_bytes).hexdigest()
    retrieved_at = metadata["retrieved_at"]
    match = re.fullmatch(
        r"(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}Z", retrieved_at
    )
    if not match:
        raise ConversionError(
            "retrieved-at must be UTC RFC 3339 without fractions"
        )
    return {
        "schema_version": 1,
        "data_version": f"{match.group(1)}-{digest[:8]}",
        "game_version": metadata.get("game_version"),
        "source": {
            "url": metadata["source_url"],
            "retrieved_at": retrieved_at,
            "last_modified": metadata.get("last_modified"),
            "etag": metadata.get("etag"),
            "sha256": digest,
        },
        "map": {
            "source_width": SOURCE_IMAGE_SIZE,
            "source_height": SOURCE_IMAGE_SIZE,
            "tile_size": 256,
            "min_zoom": 0,
            "max_zoom": 5,
            "raw_world_bounds": source_bounds,
        },
        "generation": {"statistics": statistics},
        "types": sorted(types.values(), key=lambda item: (
            item["name"].casefold(), item["name"]
        )),
        "pois": sorted(pois.values(), key=lambda item: item["id"]),
    }


def writeAtomic(path, dataset):
    """Serialize a dataset atomically without exposing partial JSON."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
                "w", encoding="utf-8", dir=path.parent, delete=False) as output:
            temporary = Path(output.name)
            json.dump(dataset, output, ensure_ascii=False, indent=2,
                      allow_nan=False)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def _arguments():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--source-url", required=True)
    parser.add_argument("--retrieved-at", required=True)
    parser.add_argument("--last-modified")
    parser.add_argument("--etag")
    parser.add_argument("--game-version")
    parser.add_argument("--strict", action="store_true")
    return parser.parse_args()


def main():
    """Run the converter command-line interface."""
    arguments = _arguments()
    try:
        source_bytes = arguments.input.read_bytes()
        source = source_bytes.decode("utf-8")
        metadata = {
            "source_url": arguments.source_url,
            "retrieved_at": arguments.retrieved_at,
            "last_modified": arguments.last_modified,
            "etag": arguments.etag,
            "game_version": arguments.game_version,
        }
        dataset = buildDataset(
            parseSource(source), source_bytes, metadata, arguments.strict
        )
        writeAtomic(arguments.output, dataset)
        count = dataset["generation"]["statistics"]["output_records"]
        print(f"wrote {count} POIs to {arguments.output}", file=sys.stderr)
        return 0
    except (
            ConversionError, OSError, TypeError, UnicodeError,
            ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
