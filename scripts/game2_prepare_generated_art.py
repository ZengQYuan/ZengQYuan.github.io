#!/usr/bin/env python3
"""Cut GPT Image 2 sprite boards into production Game 2 assets.

The generated boards use a near-magenta key. This script deliberately uses
the installed imagegen chroma helper in hard-key mode: the background varies
by roughly 30 RGB levels, while legitimate purple emissive details sit farther
away. Avoiding the helper's dominance-based soft matte keeps those interior
purple details opaque. A one-pixel contraction and very light feather remove
the remaining antialias fringe before each subject is trimmed and centered on
a fixed transparent canvas.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

from PIL import Image, ImageChops, ImageOps, ImageStat


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT_ROOT = Path("/tmp/imagegen-game2")
DEFAULT_OUTPUT_ROOT = Path("assets/game2/art/source")


@dataclass(frozen=True)
class Board:
    filename: str
    columns: int
    rows: int
    category: str
    names: tuple[str, ...]
    target_size: int
    output_format: str
    padding: int


BOARDS = (
    Board(
        "player-sprites-keyed.png", 3, 2, "character",
        ("gunsmith", "blade", "engineer", "elementalist", "gambler", "tank"),
        512, "png", 24,
    ),
    Board(
        "enemy-sprites-keyed.png", 5, 3, "enemy",
        (
            "grub", "runner", "brute", "spitter", "bomber",
            "shield", "healer", "sniper", "charger", "burrower",
            "linker", "mortar", "splitter", "prismwarden", "elite",
        ),
        512, "png", 28,
    ),
    Board(
        "boss-sprites-keyed.png", 2, 2, "boss",
        ("hive", "siege", "prism", "singularity"),
        768, "png", 36,
    ),
    Board(
        "weapon-icons-keyed.png", 5, 2, "weapon",
        ("needle", "spark", "torch", "saw", "grenade", "drone", "arc", "wrench", "anchor", "rocket"),
        512, "webp", 20,
    ),
    Board(
        "tactical-fusion-icons-keyed.png", 3, 3, "mixed",
        (
            "tactical:orbital", "tactical:phase", "tactical:prism",
            "tactical:antimatter", "fusion:thunderRailNet", "fusion:supernovaScatterMine",
            "fusion:solarSingularity", "fusion:mechaBladeSwarm", "fusion:celestialSiegeArray",
        ),
        512, "webp", 20,
    ),
    Board(
        "family-module-icons-keyed.png", 4, 3, "mixed",
        (
            "family:ballistic", "family:blade", "family:engineering", "family:element",
            "family:explosive", "family:gravity", "module:offense", "module:cadence",
            "module:critical", "module:defense", "module:mobility", "module:utility",
        ),
        512, "webp", 20,
    ),
    Board(
        "entity-sprites-keyed.png", 3, 2, "entity",
        ("sawblade", "drone", "grenade", "rocket", "turret", "gravity-core"),
        512, "png", 24,
    ),
)


class PreparationError(RuntimeError):
    pass


def helper_path() -> Path:
    codex_home = Path(os.environ.get("CODEX_HOME", Path.home() / ".codex"))
    path = codex_home / "skills/.system/imagegen/scripts/remove_chroma_key.py"
    if not path.is_file():
        raise PreparationError(f"installed chroma helper is missing: {path}")
    return path


def run_chroma_helper(source: Path, output: Path) -> None:
    command = [
        sys.executable,
        str(helper_path()),
        "--input", str(source),
        "--out", str(output),
        "--auto-key", "border",
        "--tolerance", "36",
        "--edge-contract", "1",
        "--edge-feather", "0.25",
        "--despill",
        "--force",
    ]
    result = subprocess.run(command, check=False, text=True, capture_output=True)
    if result.returncode != 0:
        raise PreparationError(f"chroma removal failed for {source}:\n{result.stderr or result.stdout}")


def proportional_box(width: int, height: int, columns: int, rows: int, index: int) -> tuple[int, int, int, int]:
    column = index % columns
    row = index // columns
    return (
        round(column * width / columns),
        round(row * height / rows),
        round((column + 1) * width / columns),
        round((row + 1) * height / rows),
    )


def alpha_bbox(image: Image.Image) -> tuple[int, int, int, int]:
    alpha = image.getchannel("A")
    bbox = alpha.point(lambda value: 255 if value > 8 else 0).getbbox()
    if bbox is None:
        raise PreparationError("asset became fully transparent after key removal")
    left, top, right, bottom = bbox
    return max(0, left - 2), max(0, top - 2), min(image.width, right + 2), min(image.height, bottom + 2)


def remove_small_edge_components(image: Image.Image) -> Image.Image:
    """Remove neighboring-cell fragments that enter through a crop boundary.

    Generated grid subjects occasionally overlap a nominal cell boundary.
    Legitimate disconnected glow/details stay untouched because only opaque
    components connected to the crop's outermost pixels are considered. A
    genuinely clipped main subject is retained when it reaches the central
    half of the cell; neighboring fragments remain confined to an outer edge.
    """
    rgba = image.copy()
    alpha = rgba.getchannel("A")
    width, height = rgba.size
    raw = alpha.tobytes()
    total_visible = sum(value > 8 for value in raw)
    if total_visible == 0:
        return rgba

    visited = bytearray(width * height)
    border_indices = []
    border_indices.extend(range(width))
    border_indices.extend(range((height - 1) * width, height * width))
    border_indices.extend(row * width for row in range(1, height - 1))
    border_indices.extend(row * width + width - 1 for row in range(1, height - 1))
    remove = []

    for start in border_indices:
        if visited[start] or raw[start] <= 8:
            continue
        visited[start] = 1
        stack = [start]
        component = []
        while stack:
            index = stack.pop()
            component.append(index)
            x = index % width
            y = index // width
            for neighbor_y in range(max(0, y - 1), min(height, y + 2)):
                row = neighbor_y * width
                for neighbor_x in range(max(0, x - 1), min(width, x + 2)):
                    neighbor = row + neighbor_x
                    if visited[neighbor] or raw[neighbor] <= 8:
                        continue
                    visited[neighbor] = 1
                    stack.append(neighbor)
        min_x = min(index % width for index in component)
        max_x = max(index % width for index in component)
        min_y = min(index // width for index in component)
        max_y = max(index // width for index in component)
        reaches_center = not (
            max_x < width * 0.25 or min_x > width * 0.75 or
            max_y < height * 0.25 or min_y > height * 0.75
        )
        if not reaches_center:
            remove.extend(component)

    if not remove:
        return rgba
    pixels = rgba.load()
    for index in remove:
        pixels[index % width, index // width] = (0, 0, 0, 0)
    return rgba


def resize_rgba(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    # Premultiplied alpha prevents dark/key-colored RGB from bleeding into the
    # silhouette during downsampling.
    premultiplied = image.convert("RGBa")
    resized = premultiplied.resize(size, Image.Resampling.LANCZOS)
    return resized.convert("RGBA")


def remove_outer_chroma_residue(image: Image.Image) -> Image.Image:
    """Remove darkened magenta-key islands confined to the outer padding.

    Despill can turn the original key into opaque dark magenta rather than an
    exact ``#ff00ff`` match. Restricting cleanup to small hue-consistent
    components wholly inside the outer 18% preserves intentional violet cores
    and energy organs that extend into the central artwork.
    """
    rgba = image.copy()
    width, height = rgba.size
    pixels = rgba.load()
    mask = bytearray(width * height)
    for y in range(height):
        row = y * width
        for x in range(width):
            red, green, blue, alpha = pixels[x, y]
            peak = max(red, blue)
            if (
                alpha > 8
                and peak >= 60
                and min(red, blue) >= 45
                and green <= peak * 0.22
                and abs(red - blue) <= peak * 0.32
            ):
                mask[row + x] = 1

    visited = bytearray(width * height)
    outer_x = width * 0.18
    outer_y = height * 0.18
    for start, present in enumerate(mask):
        if not present or visited[start]:
            continue
        visited[start] = 1
        stack = [start]
        component = []
        while stack:
            index = stack.pop()
            component.append(index)
            x = index % width
            y = index // width
            for neighbor_y in range(max(0, y - 1), min(height, y + 2)):
                row = neighbor_y * width
                for neighbor_x in range(max(0, x - 1), min(width, x + 2)):
                    neighbor = row + neighbor_x
                    if mask[neighbor] and not visited[neighbor]:
                        visited[neighbor] = 1
                        stack.append(neighbor)
        if len(component) < 4:
            continue
        min_x = min(index % width for index in component)
        max_x = max(index % width for index in component)
        min_y = min(index // width for index in component)
        max_y = max(index // width for index in component)
        confined_to_outer_padding = (
            max_x < outer_x
            or min_x > width - outer_x
            or max_y < outer_y
            or min_y > height - outer_y
        )
        if not confined_to_outer_padding:
            continue
        for index in component:
            pixels[index % width, index // width] = (0, 0, 0, 0)
    return rgba


def normalize_asset(image: Image.Image, target_size: int, padding: int) -> Image.Image:
    cropped = image.crop(alpha_bbox(image))
    available = target_size - padding * 2
    if available <= 0:
        raise PreparationError("padding consumes the complete target canvas")
    ratio = min(available / cropped.width, available / cropped.height)
    width = max(1, round(cropped.width * ratio))
    height = max(1, round(cropped.height * ratio))
    resized = resize_rgba(cropped, (width, height))
    canvas = Image.new("RGBA", (target_size, target_size), (0, 0, 0, 0))
    canvas.alpha_composite(resized, ((target_size - width) // 2, (target_size - height) // 2))
    pixels = canvas.load()
    for y in range(target_size):
        for x in range(target_size):
            red, green, blue, alpha = pixels[x, y]
            if alpha <= 8:
                pixels[x, y] = (0, 0, 0, 0)
    return remove_outer_chroma_residue(canvas)


def asset_output_path(output_root: Path, category: str, name: str, output_format: str) -> Path:
    if ":" in name:
        category, name = name.split(":", 1)
    if category in {"weapon", "tactical", "fusion", "family", "module"}:
        return output_root / "icons" / f"{category}-{name}.{output_format}"
    return output_root / "sprites" / f"{category}-{name}.{output_format}"


def save_asset(image: Image.Image, path: Path, force: bool) -> None:
    if path.exists() and not force:
        raise PreparationError(f"refusing to overwrite existing asset: {path} (pass --force to replace)")
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.suffix.lower() == ".webp":
        image.save(path, format="WEBP", lossless=True, quality=100, method=6, exact=True)
    else:
        image.save(path, format="PNG", optimize=True, compress_level=9)


def validate_transparent_asset(path: Path) -> tuple[float, int]:
    with Image.open(path) as opened:
        image = opened.convert("RGBA")
    if image.getpixel((0, 0))[3] != 0 or image.getpixel((image.width - 1, image.height - 1))[3] != 0:
        raise PreparationError(f"transparent corners were lost: {path}")
    alpha = image.getchannel("A")
    minimum, maximum = alpha.getextrema()
    if minimum != 0 or maximum == 0:
        raise PreparationError(f"invalid alpha range {minimum}..{maximum}: {path}")
    histogram = alpha.histogram()
    visible = sum(histogram[9:])
    coverage = visible / (image.width * image.height)
    if not 0.04 <= coverage <= 0.9:
        raise PreparationError(f"implausible visible coverage {coverage:.1%}: {path}")
    return coverage, path.stat().st_size


def prepare_board(board: Board, input_root: Path, output_root: Path, temporary_root: Path, force: bool) -> list[Path]:
    source = input_root / board.filename
    if not source.is_file():
        raise PreparationError(f"generated board is missing: {source}")
    keyed = temporary_root / board.filename.replace("-keyed", "-alpha")
    run_chroma_helper(source, keyed)
    with Image.open(keyed) as opened:
        image = opened.convert("RGBA")
    expected = board.columns * board.rows
    if len(board.names) != expected:
        raise PreparationError(f"{board.filename} defines {len(board.names)} names for {expected} cells")

    outputs = []
    for index, name in enumerate(board.names):
        cell = image.crop(proportional_box(image.width, image.height, board.columns, board.rows, index))
        cell = remove_small_edge_components(cell)
        normalized = normalize_asset(cell, board.target_size, board.padding)
        output = asset_output_path(output_root, board.category, name, board.output_format)
        save_asset(normalized, output, force)
        outputs.append(output)
    return outputs


def prepare_frame(input_root: Path, output_root: Path, temporary_root: Path, force: bool) -> Path:
    source = input_root / "biomech-frame-keyed.png"
    if not source.is_file():
        raise PreparationError(f"generated frame is missing: {source}")
    keyed = temporary_root / "biomech-frame-alpha.png"
    run_chroma_helper(source, keyed)
    with Image.open(keyed) as opened:
        normalized = normalize_asset(opened.convert("RGBA"), 1024, 8)
    output = output_root / "backgrounds/biomech-frame.png"
    save_asset(normalized, output, force)
    return output


def make_seamless_ground(source: Path, size: int = 1024) -> Image.Image:
    with Image.open(source) as opened:
        base = ImageOps.fit(opened.convert("RGB"), (size, size), method=Image.Resampling.LANCZOS)
    mosaic = Image.new("RGB", (size * 2, size * 2))
    mosaic.paste(base, (0, 0))
    mosaic.paste(ImageOps.mirror(base), (size, 0))
    mosaic.paste(ImageOps.flip(base), (0, size))
    mosaic.paste(ImageOps.mirror(ImageOps.flip(base)), (size, size))
    half = size // 2
    return mosaic.crop((half, half, half + size, half + size))


def validate_ground_seam(image: Image.Image) -> tuple[float, float]:
    left = image.crop((0, 0, 1, image.height))
    right = image.crop((image.width - 1, 0, image.width, image.height))
    top = image.crop((0, 0, image.width, 1))
    bottom = image.crop((0, image.height - 1, image.width, image.height))
    horizontal = sum(ImageStat.Stat(ImageChops.difference(left, right)).mean) / 3
    vertical = sum(ImageStat.Stat(ImageChops.difference(top, bottom)).mean) / 3
    if horizontal > 1.5 or vertical > 1.5:
        raise PreparationError(f"ground seam mismatch is too high: horizontal={horizontal:.2f}, vertical={vertical:.2f}")
    return horizontal, vertical


def prepare_ground(input_root: Path, output_root: Path, force: bool) -> Path:
    source = input_root / "alien-ground.png"
    if not source.is_file():
        raise PreparationError(f"generated ground is missing: {source}")
    image = make_seamless_ground(source)
    validate_ground_seam(image)
    output = output_root / "backgrounds/alien-ground.webp"
    if output.exists() and not force:
        raise PreparationError(f"refusing to overwrite existing asset: {output} (pass --force to replace)")
    output.parent.mkdir(parents=True, exist_ok=True)
    # Lossless encoding keeps opposite edge pixels identical. Lossy WebP can
    # reintroduce a 2-3 RGB-level seam even when the pre-encode tile is exact.
    image.save(output, format="WEBP", lossless=True, quality=100, method=6)
    return output


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-root", type=Path, default=DEFAULT_INPUT_ROOT)
    parser.add_argument("--repo-root", type=Path, default=REPO_ROOT)
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument("--force", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    repo_root = args.repo_root.resolve()
    output_root = args.output_root if args.output_root.is_absolute() else repo_root / args.output_root
    input_root = args.input_root.resolve()
    try:
        with tempfile.TemporaryDirectory(prefix="game2-art-prep-") as temporary:
            temporary_root = Path(temporary)
            outputs = []
            for board in BOARDS:
                outputs.extend(prepare_board(board, input_root, output_root, temporary_root, args.force))
            outputs.append(prepare_frame(input_root, output_root, temporary_root, args.force))
            outputs.append(prepare_ground(input_root, output_root, args.force))
        total_bytes = 0
        for output in outputs:
            if output.name == "alien-ground.webp":
                total_bytes += output.stat().st_size
                continue
            coverage, byte_size = validate_transparent_asset(output)
            total_bytes += byte_size
            print(f"{output.relative_to(repo_root)}  coverage={coverage:.1%}  bytes={byte_size}")
        print(f"prepared {len(outputs)} assets ({total_bytes / 1024 / 1024:.2f} MiB source transfer)")
        return 0
    except PreparationError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
