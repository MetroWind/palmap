#!/usr/bin/env python3
"""Generate every Alpha Pal portrait pin from the source URL manifest."""

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import unicodedata
import uuid

import create_pal_pin


class BatchPinError(Exception):
    """Indicate that a complete Alpha Pal pin set could not be generated."""


def pinSlug(name):
    """Convert a Pal name to its stable snake-case asset name."""
    normalized = unicodedata.normalize("NFKD", name)
    ascii_name = "".join(
        character for character in normalized
        if not unicodedata.combining(character) and ord(character) < 128
    ).lower()
    slug = re.sub(r"[^a-z0-9]+", "_", ascii_name).strip("_")
    if not slug:
        raise BatchPinError(f"Pal name {name!r} has no usable asset name")
    return slug


def loadManifest(path):
    """Load and validate the Alpha Pal portrait source manifest."""
    try:
        manifest = json.loads(path.read_text())
        portraits = manifest["portraits"]
        expected_count = manifest["alpha_pal_count"]
    except (KeyError, json.JSONDecodeError, OSError) as error:
        raise BatchPinError(f"invalid portrait manifest: {error}") from error
    if (not isinstance(portraits, dict)
            or not isinstance(expected_count, int)
            or isinstance(expected_count, bool)
            or expected_count != len(portraits)):
        raise BatchPinError("portrait manifest has an invalid count or map")
    result = {}
    slugs = set()
    for name, url in portraits.items():
        if not isinstance(name, str) or not isinstance(url, str):
            raise BatchPinError("portrait names and URLs must be strings")
        slug = pinSlug(name)
        if slug in slugs:
            raise BatchPinError(f"duplicate asset name {slug!r}")
        slugs.add(slug)
        result[name] = {"url": url, "slug": slug}
    return result


def loadLevels(path, names):
    """Load one unambiguous level for every configured Alpha Pal."""
    try:
        data = json.loads(path.read_text())
        pois = data["pois"]
    except (KeyError, json.JSONDecodeError, OSError) as error:
        raise BatchPinError(f"invalid POI data: {error}") from error
    levels = {name: set() for name in names}
    for poi in pois:
        if poi.get("type_name") == "Alpha Pal" and poi.get("name") in levels:
            levels[poi["name"]].add(poi.get("details", {}).get("level"))
    invalid = {
        name: values for name, values in levels.items()
        if len(values) != 1
        or not all(isinstance(value, int) and not isinstance(value, bool)
                   for value in values)
    }
    if invalid:
        names_text = ", ".join(sorted(invalid))
        raise BatchPinError(
            f"missing or ambiguous Alpha Pal levels: {names_text}"
        )
    return {name: next(iter(values)) for name, values in levels.items()}


def _generateOne(name, record, staging):
    output = staging / f"{record['slug']}.png"
    create_pal_pin.generatePin(
        record["url"], output, level=record["level"]
    )
    return name


def _runtimeManifest(records, url_prefix):
    prefix = url_prefix.rstrip("/")
    return {
        "schema_version": 1,
        "pins": {
            name: f"{prefix}/{record['slug']}.png"
            for name, record in sorted(
                records.items(), key=lambda item: (
                    item[0].casefold(), item[0]
                )
            )
        },
    }


def generatePins(manifest_path, output_path, runtime_manifest_path,
                 poi_data_path=None, url_prefix="images/pal_pins", workers=4):
    """Generate and atomically publish every configured Alpha Pal pin."""
    if workers < 1 or workers > 16:
        raise BatchPinError("workers must be from 1 through 16")
    records = loadManifest(manifest_path)
    if poi_data_path is None:
        raise BatchPinError("POI data is required")
    levels = loadLevels(poi_data_path, records)
    for name, level in levels.items():
        records[name]["level"] = level
    resolved_output = output_path.resolve()
    if resolved_output in (Path("/"), Path.cwd().resolve()):
        raise BatchPinError("output directory is too broad")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    runtime_manifest_path.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(
        prefix=f".{output_path.name}.staging-", dir=output_path.parent
    ))
    backup = output_path.parent / (
        f"{output_path.name}.backup-{uuid.uuid4().hex}"
    )
    runtime_temporary = None
    published = False
    try:
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {
                executor.submit(_generateOne, name, record, staging): name
                for name, record in records.items()
            }
            for future in as_completed(futures):
                name = futures[future]
                try:
                    future.result()
                except Exception as error:
                    raise BatchPinError(
                        f"failed to generate {name}: {error}"
                    ) from error
        with tempfile.NamedTemporaryFile(
                "w", encoding="utf-8", dir=runtime_manifest_path.parent,
                delete=False) as output:
            runtime_temporary = Path(output.name)
            json.dump(
                _runtimeManifest(records, url_prefix), output,
                ensure_ascii=False, indent=2
            )
            output.write("\n")
        if output_path.exists():
            output_path.rename(backup)
        try:
            staging.rename(output_path)
            os.replace(runtime_temporary, runtime_manifest_path)
            runtime_temporary = None
            published = True
        except OSError:
            if output_path.exists():
                shutil.rmtree(output_path)
            if backup.exists():
                backup.rename(output_path)
            raise
        if backup.exists():
            shutil.rmtree(backup)
        return len(records)
    finally:
        if staging.exists():
            shutil.rmtree(staging)
        if runtime_temporary is not None:
            runtime_temporary.unlink(missing_ok=True)
        if not published and backup.exists() and not output_path.exists():
            backup.rename(output_path)


def _arguments():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--poi-data", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--runtime-manifest", required=True, type=Path)
    parser.add_argument("--url-prefix", default="images/pal_pins")
    parser.add_argument("--workers", default=4, type=int)
    return parser.parse_args()


def main():
    """Run the Alpha Pal pin batch-generator command-line interface."""
    arguments = _arguments()
    try:
        count = generatePins(
            arguments.manifest,
            arguments.output_dir,
            arguments.runtime_manifest,
            arguments.poi_data,
            arguments.url_prefix,
            arguments.workers,
        )
        print(f"wrote {count} Alpha Pal pins", file=sys.stderr)
        return 0
    except (BatchPinError, OSError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
