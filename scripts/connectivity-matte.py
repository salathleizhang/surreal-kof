#!/usr/bin/env python3
"""Remove a solid background only when it is connected to the image edge.

This is useful for logos with black outlines: unlike a global color key, it keeps
black artwork inside the logo and removes only the surrounding black canvas.
"""

from __future__ import annotations

import argparse
from collections import deque
from pathlib import Path

from PIL import Image, ImageFilter


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Connectivity-based background matting for logo PNGs."
    )
    parser.add_argument("input", help="Input image path")
    parser.add_argument("output", help="Output transparent PNG path")
    parser.add_argument(
        "--threshold",
        type=int,
        default=18,
        help="Max RGB channel value considered background black (default: 18)",
    )
    parser.add_argument(
        "--protect-radius",
        type=int,
        default=4,
        help="Pixels around colored artwork to protect from removal (default: 4)",
    )
    parser.add_argument(
        "--feather",
        type=float,
        default=0.9,
        help="Soft edge blur radius in pixels (default: 0.9)",
    )
    return parser.parse_args()


def matte(input_path: Path, output_path: Path, threshold: int, protect_radius: int, feather: float) -> None:
    img = Image.open(input_path).convert("RGBA")
    width, height = img.size
    pixels = img.load()
    pixel_count = width * height

    def is_black_core(x: int, y: int) -> bool:
        r, g, b, a = pixels[x, y]
        return a == 0 or max(r, g, b) <= threshold

    def is_artwork_seed(x: int, y: int) -> bool:
        r, g, b, a = pixels[x, y]
        if a == 0:
            return False
        mx = max(r, g, b)
        mn = min(r, g, b)
        return mx >= 38 and (mx - mn >= 18 or mx >= 70)

    artwork = bytearray(pixel_count)
    for y in range(height):
        row = y * width
        for x in range(width):
            if is_artwork_seed(x, y):
                artwork[row + x] = 1

    # Protect black strokes attached to visible colored artwork, so internal ink
    # and outlines are not mistaken for the outer black background.
    protected = bytearray(artwork)
    frontier = [index for index, value in enumerate(artwork) if value]
    for _ in range(protect_radius):
        next_frontier = []
        for point in frontier:
            x = point % width
            y = point // width
            for nx, ny in (
                (x + 1, y),
                (x - 1, y),
                (x, y + 1),
                (x, y - 1),
                (x + 1, y + 1),
                (x - 1, y - 1),
                (x + 1, y - 1),
                (x - 1, y + 1),
            ):
                if 0 <= nx < width and 0 <= ny < height:
                    q = ny * width + nx
                    if not protected[q]:
                        protected[q] = 1
                        next_frontier.append(q)
        frontier = next_frontier

    cut = bytearray(pixel_count)
    queue: deque[int] = deque()

    def seed(x: int, y: int) -> None:
        if x < 0 or y < 0 or x >= width or y >= height:
            return
        point = y * width + x
        if cut[point] or protected[point] or not is_black_core(x, y):
            return
        cut[point] = 1
        queue.append(point)

    for x in range(width):
        seed(x, 0)
        seed(x, height - 1)
    for y in range(height):
        seed(0, y)
        seed(width - 1, y)

    while queue:
        point = queue.popleft()
        x = point % width
        y = point // width
        seed(x + 1, y)
        seed(x - 1, y)
        seed(x, y + 1)
        seed(x, y - 1)

    mask = Image.new("L", (width, height), 0)
    mask_pixels = mask.load()
    for y in range(height):
        row = y * width
        for x in range(width):
            if cut[row + x]:
                mask_pixels[x, y] = 255

    soft_mask = mask.filter(ImageFilter.GaussianBlur(feather))
    soft_pixels = soft_mask.load()
    output = Image.new("RGBA", (width, height))
    output_pixels = output.load()

    for y in range(height):
        row = y * width
        for x in range(width):
            r, g, b, a = pixels[x, y]
            point = row + x
            if cut[point]:
                output_pixels[x, y] = (0, 0, 0, 0)
                continue

            bg = soft_pixels[x, y]
            if bg and not protected[point] and max(r, g, b) <= 45:
                a = max(0, min(255, a - bg))
            output_pixels[x, y] = (r, g, b, a)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output.save(output_path)


def main() -> None:
    args = parse_args()
    matte(
        Path(args.input),
        Path(args.output),
        threshold=args.threshold,
        protect_radius=args.protect_radius,
        feather=args.feather,
    )


if __name__ == "__main__":
    main()
