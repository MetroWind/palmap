#!/usr/bin/env python3
"""Download a Pal portrait and turn it into a circular map pin."""

import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from urllib.parse import urlparse


PIN_SIZE = 32
OUTLINE_WIDTH = 1
LEVEL_FONT_SIZE = 10
LEVEL_FONT = "DejaVu-Sans-Bold"
LEVEL_FILL = "#4a4a4a"
LEVEL_OFFSET = "+0-1"


class PinError(Exception):
    """Indicate that a Pal pin could not be generated."""


def _run(arguments):
    try:
        subprocess.run(
            arguments, check=True, capture_output=True, text=True, shell=False
        )
    except subprocess.CalledProcessError as error:
        detail = (
            error.stderr or error.stdout or "no diagnostic output"
        ).strip()
        raise PinError(f"{arguments[0]} failed: {detail}") from error


def downloadImage(url, output_path, curl=None):
    """Download an HTTP or HTTPS image to the requested local path."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise PinError("image URL must use HTTP or HTTPS")
    program = curl or shutil.which("curl")
    if not program:
        raise PinError("curl was not found on PATH")
    _run([
        program,
        "--fail",
        "--location",
        "--silent",
        "--show-error",
        "--user-agent",
        "Palmap asset preparation",
        "--output",
        str(output_path),
        url,
    ])


def createPin(input_path, output_path, magick=None, level=None):
    """Create one circular portrait pin with ImageMagick."""
    program = magick or shutil.which("magick")
    if not program:
        raise PinError("ImageMagick 7 'magick' was not found on PATH")
    center = (PIN_SIZE - 1) / 2
    outline_edge = OUTLINE_WIDTH / 2
    mask_geometry = f"circle {center},{center} {center},0"
    outline_geometry = (
        f"circle {center},{center} {center},{outline_edge}"
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
                dir=output_path.parent, suffix=".png", delete=False) as file:
            temporary = Path(file.name)
        arguments = [
            program,
            str(input_path),
            "-auto-orient",
            "-resize",
            f"{PIN_SIZE}x{PIN_SIZE}!",
            "-background",
            "black",
            "-alpha",
            "remove",
            "-alpha",
            "off",
            "-alpha",
            "set",
            "(",
            "-size",
            f"{PIN_SIZE}x{PIN_SIZE}",
            "xc:none",
            "-fill",
            "white",
            "-draw",
            mask_geometry,
            ")",
            "-compose",
            "DstIn",
            "-composite",
            "-fill",
            "none",
            "-stroke",
            "white",
            "-strokewidth",
            str(OUTLINE_WIDTH),
            "-draw",
            outline_geometry,
        ]
        if level is not None:
            if (not isinstance(level, int) or isinstance(level, bool)
                    or level < 0):
                raise PinError("level must be a non-negative integer")
            arguments += [
                "-font",
                LEVEL_FONT,
                "-pointsize",
                str(LEVEL_FONT_SIZE),
                "-gravity",
                "southeast",
                "-fill",
                "white",
                "-stroke",
                "white",
                "-strokewidth",
                "2",
                "-annotate",
                LEVEL_OFFSET,
                str(level),
                "-fill",
                LEVEL_FILL,
                "-stroke",
                "none",
                "-annotate",
                LEVEL_OFFSET,
                str(level),
            ]
        arguments.append(f"PNG32:{temporary}")
        _run(arguments)
        os.replace(temporary, output_path)
        temporary = None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def generatePin(url, output_path, curl=None, magick=None, level=None):
    """Download a portrait and atomically publish its processed pin."""
    with tempfile.TemporaryDirectory(prefix="palmap-pal-pin-") as directory:
        downloaded = Path(directory) / "portrait"
        downloadImage(url, downloaded, curl)
        createPin(downloaded, output_path, magick, level)


def _arguments():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--level", type=int)
    return parser.parse_args()


def main():
    """Run the Pal-pin generator command-line interface."""
    arguments = _arguments()
    try:
        generatePin(arguments.url, arguments.output, level=arguments.level)
        print(f"wrote {arguments.output}", file=sys.stderr)
        return 0
    except (OSError, PinError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
