#!/usr/bin/env python3
"""Generate a lossless WebP tile pyramid from the Palmap source image."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import uuid


EXPECTED_SIZE = 8192


class TileError(Exception):
    """Indicate that a complete tile pyramid could not be generated."""


def _run(arguments):
    try:
        return subprocess.run(
            arguments, check=True, capture_output=True, text=True, shell=False
        )
    except subprocess.CalledProcessError as error:
        detail = (
            error.stderr or error.stdout or "no diagnostic output"
        ).strip()
        options = " ".join(arguments[1:])
        raise TileError(
            f"{arguments[0]} failed for options {options}: {detail}"
        ) from error


def inspectMagick(program, input_path):
    """Validate ImageMagick and the source image, returning version text."""
    version_output = _run([program, "-version"]).stdout.splitlines()
    if (not version_output
            or not re.search(r"ImageMagick\s+7\.", version_output[0])):
        raise TileError("ImageMagick 7 is required")
    formats = _run([program, "-list", "format"]).stdout
    webp = next((line for line in formats.splitlines()
                 if re.match(
                     r"\s*WEBP\*?\s+WEBP\s+rw", line, re.IGNORECASE
                 )), None)
    if webp is None:
        raise TileError("ImageMagick requires WebP read/write support")
    dimensions = _run([
        program, "identify", "-format", "%w %h", str(input_path)
    ]).stdout.strip()
    if dimensions != f"{EXPECTED_SIZE} {EXPECTED_SIZE}":
        raise TileError(
            f"input must be {EXPECTED_SIZE} by {EXPECTED_SIZE}, "
            f"got {dimensions}"
        )
    return version_output[0]


def _validateTarget(output_path):
    resolved = output_path.resolve()
    if resolved == Path("/") or resolved == Path.cwd().resolve():
        raise TileError("output directory must not be / or the workspace root")
    leftovers = list(resolved.parent.glob(f".{resolved.name}.staging-*"))
    leftovers += list(resolved.parent.glob(f"{resolved.name}.backup-*"))
    if leftovers:
        names = ", ".join(str(path) for path in leftovers)
        raise TileError(f"recovery required; inspect leftover paths: {names}")
    return resolved


def _generateLevel(program, input_path, staging, zoom, tile_size, method):
    level = staging / str(zoom)
    level.mkdir()
    sequence_pattern = level / "sequence_%04d.webp"
    arguments = [program, str(input_path)]
    if zoom < 5:
        size = tile_size * 2 ** zoom
        arguments += ["-filter", "Lanczos", "-resize", f"{size}x{size}!"]
    arguments += [
        "-crop", f"{tile_size}x{tile_size}", "+repage", "+adjoin",
        "-quality", "100", "-define", f"webp:method={method}",
        str(sequence_pattern),
    ]
    _run(arguments)
    files = sorted(level.glob("sequence_*.webp"))
    tiles_per_axis = 2 ** zoom
    expected = tiles_per_axis ** 2
    if len(files) != expected:
        raise TileError(
            f"zoom {zoom} produced {len(files)} tiles; expected {expected}"
        )
    for sequence, source in enumerate(files):
        expected_name = f"sequence_{sequence:04d}.webp"
        if source.name != expected_name:
            raise TileError(f"zoom {zoom} has a non-contiguous tile sequence")
        tile_x = sequence % tiles_per_axis
        tile_y = sequence // tiles_per_axis
        destination_dir = level / str(tile_x)
        destination_dir.mkdir(exist_ok=True)
        source.rename(destination_dir / f"{tile_y}.webp")


def generateTiles(input_path, output_path, tile_size=256, max_zoom=5, method=6,
                  magick=None):
    """Generate and atomically publish a complete tile pyramid."""
    if tile_size != 256 or max_zoom != 5:
        raise TileError("the prototype requires tile size 256 and max zoom 5")
    if not 0 <= method <= 6:
        raise TileError("WebP method must be from 0 through 6")
    program = magick or shutil.which("magick")
    if not program:
        raise TileError("ImageMagick 7 'magick' was not found on PATH")
    output_path = _validateTarget(output_path)
    version = inspectMagick(program, input_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(
        prefix=f".{output_path.name}.staging-", dir=output_path.parent
    ))
    backup = output_path.parent / (
        f"{output_path.name}.backup-{uuid.uuid4().hex}"
    )
    published = False
    try:
        for zoom in range(max_zoom + 1):
            _generateLevel(
                program, input_path, staging, zoom, tile_size, method
            )
        manifest = {
            "source_sha256": hashlib.sha256(
                input_path.read_bytes()
            ).hexdigest(),
            "source_width": EXPECTED_SIZE,
            "source_height": EXPECTED_SIZE,
            "tile_size": tile_size,
            "min_zoom": 0,
            "max_zoom": max_zoom,
            "total_tile_count": sum((2 ** zoom) ** 2
                                    for zoom in range(max_zoom + 1)),
            "generator": {"program": "ImageMagick", "version": version},
            "encoding": {
                "format": "webp",
                "lossless": True,
                "quality": 100,
                "method": method,
                "resize_filter": "Lanczos",
            },
        }
        (staging / "manifest.json").write_text(
            json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
        )
        if output_path.exists():
            output_path.rename(backup)
        try:
            staging.rename(output_path)
            published = True
        except OSError:
            if backup.exists():
                backup.rename(output_path)
            raise
        if backup.exists():
            shutil.rmtree(backup)
        return manifest
    finally:
        if not published and staging.exists():
            shutil.rmtree(staging)


def _arguments():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--tile-size", type=int, default=256)
    parser.add_argument("--max-zoom", type=int, default=5)
    parser.add_argument("--method", type=int, default=6)
    return parser.parse_args()


def main():
    """Run the tile-generator command-line interface."""
    arguments = _arguments()
    try:
        manifest = generateTiles(
            arguments.input, arguments.output_dir, arguments.tile_size,
            arguments.max_zoom, arguments.method
        )
        print(
            f"wrote {manifest['total_tile_count']} tiles to "
            f"{arguments.output_dir}", file=sys.stderr
        )
        return 0
    except (TileError, OSError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
