#!/usr/bin/env python3
"""Validate and pack Game 2 art into deterministic 1x/2x WebP atlases.

The pipeline works in two modes:

1. With ``--spec`` it reads an explicit JSON inventory. This is the strict CI
   path because missing required sources can be reported.
2. Without a spec it scans ``assets/game2/art/source`` and infers stable IDs
   from the repository naming convention. This is convenient while GPT Image
   outputs are still arriving as independent files.

Backgrounds remain independent resources by default. Portraits, icons and
combat sprites are validated as independent resources and also packed into
``ui``, ``combat`` and ``boss`` atlases. The generated metadata lets the
runtime choose either representation without changing gameplay IDs.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import math
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Sequence
from urllib.parse import unquote, urlsplit

try:
    from PIL import Image
except ImportError as exc:  # pragma: no cover - environment-specific failure
    raise SystemExit("Pillow is required: python3 -m pip install Pillow") from exc


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE_ROOT = Path("assets/game2/art/source")
DEFAULT_OUTPUT_ROOT = Path("assets/game2/art/atlases")
DEFAULT_METADATA = Path("assets/game2/art/atlas-metadata.json")
DEFAULT_ENTRY_PAGE = Path("index.html")
SUPPORTED_EXTENSIONS = {".png", ".webp"}
GROUPS = ("ui", "combat", "boss")
ATLAS_TIERS = ("oneX", "twoX")
DEFAULT_MOBILE_DECODED_BUDGET_MIB = 24.0
DEFAULT_DESKTOP_DECODED_BUDGET_MIB = 48.0
# Keep this in the same order as ArsenalArtManifest.loading. The art runtime
# retains decoded images in loadedAtlases and never evicts the earlier tier, so
# the peak is the union of eager, idle and beforeWave5 resources rather than a
# choice between oneX and twoX.
RUNTIME_RESIDENT_ATLASES = (
    ("ui", "oneX"),
    ("combat", "oneX"),
    ("ui", "twoX"),
    ("combat", "twoX"),
    ("boss", "oneX"),
    ("boss", "twoX"),
)
ENTRY_IMAGE_ATTRIBUTE = re.compile(r"(?:src|poster)\s*=\s*([\"'])(.*?)\1", re.IGNORECASE)
CHARACTER_LOGICAL_SIZE = {
    "gunsmith": 48,
    "blade": 48,
    "engineer": 48,
    "elementalist": 48,
    "gambler": 48,
    "tank": 52,
}
ENEMY_LOGICAL_SIZE = {
    "grub": 34,
    "runner": 34,
    "brute": 48,
    "spitter": 38,
    "bomber": 40,
    "shield": 46,
    "healer": 38,
    "sniper": 38,
    "charger": 50,
    "burrower": 40,
    "linker": 44,
    "mortar": 48,
    "splitter": 44,
    "prismwarden": 56,
    "elite": 62,
}
BOSS_LOGICAL_SIZE = {"hive": 112, "siege": 118, "prism": 116, "singularity": 120}
ENTITY_LOGICAL_SIZE = {
    "sawblade": 40,
    "drone": 38,
    "grenade": 30,
    "rocket": 36,
    "turret": 52,
    "gravity-core": 48,
}


@dataclass(frozen=True)
class AssetEntry:
    asset_id: str
    source: Path
    group: str
    logical_width: int
    logical_height: int
    pivot_x: float
    pivot_y: float
    pack: bool
    require_alpha: bool
    trim: bool


@dataclass(frozen=True)
class PreparedAsset:
    entry: AssetEntry
    image: Image.Image
    source_width: int
    source_height: int
    trim_box: tuple[int, int, int, int]


@dataclass(frozen=True)
class PackedFrame:
    prepared: PreparedAsset
    x: int
    y: int
    width: int
    height: int


@dataclass(frozen=True)
class ResidentImage:
    resource_id: str
    source: Path
    width: int
    height: int
    duplicate_of: str | None = None

    @property
    def decoded_bytes(self) -> int:
        return self.width * self.height * 4


class PipelineError(RuntimeError):
    pass


def parse_size(value: Any, field: str) -> tuple[int, int]:
    if isinstance(value, dict):
        width, height = value.get("width"), value.get("height")
    elif isinstance(value, (list, tuple)) and len(value) == 2:
        width, height = value
    else:
        raise PipelineError(f"{field} must be {{width,height}} or [width,height]")
    if not isinstance(width, int) or not isinstance(height, int) or width <= 0 or height <= 0:
        raise PipelineError(f"{field} dimensions must be positive integers")
    return width, height


def parse_pivot(value: Any, field: str) -> tuple[float, float]:
    if value is None:
        return 0.5, 0.5
    if isinstance(value, dict):
        x, y = value.get("x"), value.get("y")
    elif isinstance(value, (list, tuple)) and len(value) == 2:
        x, y = value
    else:
        raise PipelineError(f"{field} must be {{x,y}} or [x,y]")
    if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
        raise PipelineError(f"{field} values must be numbers")
    if not 0 <= float(x) <= 1 or not 0 <= float(y) <= 1:
        raise PipelineError(f"{field} values must be between 0 and 1")
    return float(x), float(y)


def repo_path(value: str | Path, repo_root: Path) -> Path:
    path = Path(value)
    return path if path.is_absolute() else repo_root / path


def load_spec(spec_path: Path, repo_root: Path) -> tuple[list[AssetEntry], list[str]]:
    try:
        payload = json.loads(spec_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise PipelineError(f"cannot read spec {spec_path}: {exc}") from exc
    if payload.get("schemaVersion") != 1 or not isinstance(payload.get("assets"), list):
        raise PipelineError("spec must use schemaVersion 1 and contain an assets array")

    entries: list[AssetEntry] = []
    seen: set[str] = set()
    for index, raw in enumerate(payload["assets"]):
        label = f"assets[{index}]"
        asset_id = raw.get("id")
        if not isinstance(asset_id, str) or not asset_id:
            raise PipelineError(f"{label}.id must be a non-empty string")
        if asset_id in seen:
            raise PipelineError(f"duplicate asset id: {asset_id}")
        seen.add(asset_id)
        group = raw.get("group", "ui")
        if group not in GROUPS:
            raise PipelineError(f"{asset_id} has unsupported group {group!r}")
        logical_width, logical_height = parse_size(raw.get("logicalSize"), f"{asset_id}.logicalSize")
        pivot_x, pivot_y = parse_pivot(raw.get("pivot"), f"{asset_id}.pivot")
        source_value = raw.get("source")
        if not isinstance(source_value, str) or not source_value:
            raise PipelineError(f"{asset_id}.source must be a non-empty path")
        source = repo_path(source_value, repo_root)
        required = raw.get("required", True)
        if not source.exists():
            if required:
                raise PipelineError(f"required source is missing: {source}")
            continue
        entries.append(
            AssetEntry(
                asset_id=asset_id,
                source=source,
                group=group,
                logical_width=logical_width,
                logical_height=logical_height,
                pivot_x=pivot_x,
                pivot_y=pivot_y,
                pack=bool(raw.get("pack", True)),
                require_alpha=bool(raw.get("requireAlpha", True)),
                trim=bool(raw.get("trim", True)),
            )
        )
    key_colors = payload.get("keyColors", [])
    if not isinstance(key_colors, list) or not all(isinstance(color, str) for color in key_colors):
        raise PipelineError("keyColors must be an array of CSS hex colors")
    return entries, key_colors


def infer_asset(path: Path) -> AssetEntry | None:
    """Infer manifest-compatible metadata from the agreed source filenames."""
    stem = path.stem
    parent = path.parent.name
    asset_id = ""
    group = "ui"
    logical = (64, 64)
    pivot = (0.5, 0.5)
    pack = True
    require_alpha = True

    if parent == "portraits" and stem.startswith("character-"):
        asset_id = "portrait:" + stem.removeprefix("character-")
        logical = (112, 112)
        require_alpha = False
    elif parent == "icons":
        match = re.match(r"^(weapon|tactical|fusion|family|module)-(.+)$", stem)
        if not match:
            return None
        asset_id = f"icon:{match.group(1)}:{match.group(2)}"
    elif parent == "sprites":
        match = re.match(r"^(character|enemy|boss|entity)-(.+)$", stem)
        if not match:
            return None
        category, item_id = match.groups()
        asset_id = f"sprite:{category}:{item_id}"
        group = "boss" if category == "boss" else "combat"
        size_maps = {
            "character": CHARACTER_LOGICAL_SIZE,
            "enemy": ENEMY_LOGICAL_SIZE,
            "boss": BOSS_LOGICAL_SIZE,
            "entity": ENTITY_LOGICAL_SIZE,
        }
        logical_size = size_maps[category].get(item_id, 64 if category == "enemy" else 48)
        logical = (logical_size, logical_size)
        pivot = (0.5, 0.54) if category in {"character", "enemy", "boss"} else (0.5, 0.5)
        if category == "boss":
            pivot = {"hive": (0.5, 0.56), "siege": (0.5, 0.55), "prism": (0.5, 0.52)}.get(
                item_id, (0.5, 0.54)
            )
        elif category == "entity" and item_id == "rocket":
            pivot = (0.72, 0.5)
        elif category == "entity" and item_id == "turret":
            pivot = (0.5, 0.62)
    elif parent == "backgrounds":
        aliases = {
            "home-cover": ("background:home-cover", (1600, 900)),
            "alien-ground": ("background:alien-ground", (512, 512)),
            "biomech-frame": ("background:biomech-frame", (256, 256)),
        }
        if stem not in aliases:
            return None
        asset_id, logical = aliases[stem]
        group = "combat" if stem == "alien-ground" else "ui"
        pack = False
        require_alpha = stem == "biomech-frame"
    else:
        return None

    return AssetEntry(
        asset_id=asset_id,
        source=path,
        group=group,
        logical_width=logical[0],
        logical_height=logical[1],
        pivot_x=pivot[0],
        pivot_y=pivot[1],
        pack=pack,
        require_alpha=require_alpha,
        trim=require_alpha,
    )


def scan_sources(source_root: Path) -> list[AssetEntry]:
    if not source_root.is_dir():
        raise PipelineError(f"source directory does not exist: {source_root}")
    entries = []
    ignored = []
    for path in sorted(source_root.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in SUPPORTED_EXTENSIONS:
            continue
        entry = infer_asset(path)
        if entry is None:
            ignored.append(path)
        else:
            entries.append(entry)
    if not entries:
        raise PipelineError(f"no convention-matching PNG/WebP files found under {source_root}")
    if ignored:
        print("warning: ignored files without a known naming convention:", file=sys.stderr)
        for path in ignored:
            print(f"  {path}", file=sys.stderr)
    by_id: dict[str, AssetEntry] = {}
    for entry in entries:
        previous = by_id.get(entry.asset_id)
        if previous is None:
            by_id[entry.asset_id] = entry
            continue
        wants_png = entry.asset_id.startswith("sprite:")
        preferred_suffix = ".png" if wants_png else ".webp"
        candidates = [previous, entry]
        preferred = [candidate for candidate in candidates if candidate.source.suffix.lower() == preferred_suffix]
        if len(preferred) != 1:
            raise PipelineError(f"ambiguous duplicate inferred ID {entry.asset_id}: {previous.source}, {entry.source}")
        by_id[entry.asset_id] = preferred[0]
        ignored_path = entry.source if preferred[0] is previous else previous.source
        print(f"warning: ignored alternate source for {entry.asset_id}: {ignored_path}", file=sys.stderr)
    return [by_id[asset_id] for asset_id in sorted(by_id)]


def file_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def discover_entry_page_images(
    entry_page: Path,
    repo_root: Path,
    prepared: Sequence[PreparedAsset],
) -> list[ResidentImage]:
    """Find directly referenced Game 2 images that can coexist with manifest art.

    The homepage cover is outside the manifest inventory. A different URL for
    byte-identical art still creates a distinct browser image resource, so it
    must be included in the decoded-texture peak and reported as a duplicate.
    Direct references to the exact same manifest source path are de-duplicated.
    """
    if not entry_page.is_file():
        return []
    try:
        markup = entry_page.read_text(encoding="utf-8")
    except OSError as exc:
        raise PipelineError(f"cannot read entry page {entry_page}: {exc}") from exc

    art_root = (repo_root / "assets/game2/art").resolve()
    independent_by_path = {
        item.entry.source.resolve(): item.entry.asset_id for item in prepared if not item.entry.pack
    }
    digest_to_independent: dict[str, str] = {}
    for source, asset_id in independent_by_path.items():
        try:
            digest_to_independent.setdefault(file_digest(source), asset_id)
        except OSError as exc:
            raise PipelineError(f"cannot hash independent image {source}: {exc}") from exc

    found: list[ResidentImage] = []
    seen_paths: set[Path] = set()
    for match in ENTRY_IMAGE_ATTRIBUTE.finditer(markup):
        raw_url = html.unescape(match.group(2).strip())
        parsed = urlsplit(raw_url)
        if parsed.scheme or parsed.netloc or not parsed.path:
            continue
        relative_path = Path(unquote(parsed.path).lstrip("/"))
        if relative_path.suffix.lower() not in SUPPORTED_EXTENSIONS:
            continue
        source = (repo_root / relative_path).resolve()
        try:
            source.relative_to(art_root)
        except ValueError:
            continue
        if source in seen_paths or source in independent_by_path or not source.is_file():
            continue
        seen_paths.add(source)
        try:
            with Image.open(source) as opened:
                opened.load()
                width, height = opened.size
        except (OSError, ValueError) as exc:
            raise PipelineError(f"cannot decode entry-page image {source}: {exc}") from exc
        duplicate_of = digest_to_independent.get(file_digest(source))
        found.append(
            ResidentImage(
                resource_id=f"entry:{relative_to_repo(entry_page, repo_root)}:{relative_path.as_posix()}",
                source=source,
                width=width,
                height=height,
                duplicate_of=duplicate_of,
            )
        )
    return found


def parse_hex_color(value: str) -> tuple[int, int, int]:
    match = re.fullmatch(r"#?([0-9a-fA-F]{6})", value.strip())
    if not match:
        raise PipelineError(f"invalid key color {value!r}; expected #RRGGBB")
    raw = match.group(1)
    return tuple(int(raw[index : index + 2], 16) for index in (0, 2, 4))


def has_alpha_channel(image: Image.Image) -> bool:
    return "A" in image.getbands() or "transparency" in image.info


def find_key_residue(
    image: Image.Image,
    key_colors: Sequence[tuple[int, int, int]],
    tolerance: int,
) -> tuple[int, tuple[int, int, int] | None]:
    if not key_colors:
        return 0, None
    rgba = image.convert("RGBA")
    count = 0
    first: tuple[int, int, int] | None = None
    threshold = tolerance * tolerance
    for red, green, blue, alpha in rgba.getdata():
        if alpha <= 16:
            continue
        for key in key_colors:
            distance = (red - key[0]) ** 2 + (green - key[1]) ** 2 + (blue - key[2]) ** 2
            if distance <= threshold:
                count += 1
                first = first or key
                break
    return count, first


def prepare_asset(
    entry: AssetEntry,
    key_colors: Sequence[tuple[int, int, int]],
    key_tolerance: int,
    max_source_size: int,
) -> PreparedAsset:
    try:
        with Image.open(entry.source) as opened:
            opened.load()
            source_width, source_height = opened.size
            original_has_alpha = has_alpha_channel(opened)
            image = opened.convert("RGBA")
    except (OSError, ValueError) as exc:
        raise PipelineError(f"cannot decode {entry.source}: {exc}") from exc

    if source_width < 16 or source_height < 16:
        raise PipelineError(f"{entry.asset_id} is too small: {source_width}x{source_height}")
    if source_width > max_source_size or source_height > max_source_size:
        raise PipelineError(
            f"{entry.asset_id} exceeds {max_source_size}px source limit: {source_width}x{source_height}"
        )
    alpha = image.getchannel("A")
    alpha_min, alpha_max = alpha.getextrema()
    if entry.require_alpha and (not original_has_alpha or alpha_min == 255):
        raise PipelineError(f"{entry.asset_id} requires usable transparency but is fully opaque")
    if alpha_max == 0:
        raise PipelineError(f"{entry.asset_id} is fully transparent")

    residue_count, residue_color = find_key_residue(image, key_colors, key_tolerance)
    residue_limit = max(2, math.ceil(source_width * source_height * 0.00002))
    if residue_count > residue_limit:
        color_label = "#%02x%02x%02x" % residue_color if residue_color else "key color"
        raise PipelineError(
            f"{entry.asset_id} retains {residue_count} opaque pixels near {color_label}; "
            "run chroma-key removal before packing"
        )

    if entry.trim:
        trim_box = alpha.point(lambda value: 255 if value > 8 else 0).getbbox()
        if trim_box is None:
            raise PipelineError(f"{entry.asset_id} has no visible pixels after alpha thresholding")
    else:
        trim_box = (0, 0, source_width, source_height)
    return PreparedAsset(entry, image.crop(trim_box), source_width, source_height, trim_box)


def next_power_of_two(value: int) -> int:
    return 1 << max(0, value - 1).bit_length()


def pack_for_width(
    prepared: Sequence[PreparedAsset],
    scale: int,
    atlas_width: int,
    max_size: int,
    padding: int,
) -> tuple[list[PackedFrame], int] | None:
    ordered = sorted(
        prepared,
        key=lambda item: (-item.entry.logical_height, -item.entry.logical_width, item.entry.asset_id),
    )
    x = padding
    y = padding
    row_height = 0
    packed: list[PackedFrame] = []
    for item in ordered:
        width = item.entry.logical_width * scale
        height = item.entry.logical_height * scale
        if width + padding * 2 > atlas_width or height + padding * 2 > max_size:
            return None
        if x + width + padding > atlas_width:
            x = padding
            y += row_height + padding
            row_height = 0
        if y + height + padding > max_size:
            return None
        packed.append(PackedFrame(item, x, y, width, height))
        x += width + padding
        row_height = max(row_height, height)
    used_height = next_power_of_two(y + row_height + padding)
    if used_height > max_size:
        return None
    return packed, max(64, used_height)


def choose_layout(
    prepared: Sequence[PreparedAsset], scale: int, max_size: int, padding: int
) -> tuple[list[PackedFrame], int, int]:
    largest = max(max(item.entry.logical_width, item.entry.logical_height) * scale for item in prepared)
    minimum_width = max(64, next_power_of_two(largest + padding * 2))
    candidates = []
    width = minimum_width
    while width <= max_size:
        result = pack_for_width(prepared, scale, width, max_size, padding)
        if result is not None:
            frames, height = result
            candidates.append((width * height, max(width, height), width, height, frames))
        width *= 2
    if not candidates:
        raise PipelineError(f"assets do not fit a single {max_size}x{max_size} atlas at {scale}x")
    _, _, width, height, frames = min(candidates, key=lambda candidate: candidate[:2])
    return frames, width, height


def fit_image(image: Image.Image, width: int, height: int) -> tuple[Image.Image, int, int]:
    ratio = min(width / image.width, height / image.height)
    resized_width = max(1, round(image.width * ratio))
    resized_height = max(1, round(image.height * ratio))
    # Resize in premultiplied-alpha space. Chroma-keyed sources can retain
    # arbitrary RGB in fully transparent pixels; resizing straight RGBA would
    # interpolate that hidden key color into visible edge pixels and create
    # colored seams inside an otherwise clean atlas.
    premultiplied = image.convert("RGBa")
    resized = premultiplied.resize((resized_width, resized_height), Image.Resampling.LANCZOS).convert("RGBA")
    return resized, (width - resized_width) // 2, (height - resized_height) // 2


def relative_to_repo(path: Path, repo_root: Path) -> str:
    try:
        return path.resolve().relative_to(repo_root.resolve()).as_posix()
    except ValueError:
        return path.resolve().as_posix()


def frame_metadata(frame: PackedFrame, scale: int) -> dict[str, Any]:
    entry = frame.prepared.entry
    trim = frame.prepared.trim_box
    return {
        "x": frame.x,
        "y": frame.y,
        "width": frame.width,
        "height": frame.height,
        "logicalSize": {"width": entry.logical_width, "height": entry.logical_height},
        "pivot": {"x": entry.pivot_x, "y": entry.pivot_y},
        "sourceSize": {
            "width": frame.prepared.source_width,
            "height": frame.prepared.source_height,
        },
        "trim": {
            "x": trim[0],
            "y": trim[1],
            "width": trim[2] - trim[0],
            "height": trim[3] - trim[1],
        },
        "scale": scale,
    }


def atlas_metadata(
    group: str,
    frames: Sequence[PackedFrame],
    width: int,
    height: int,
    scale: int,
    output_root: Path,
    repo_root: Path,
) -> dict[str, Any]:
    output_path = output_root / f"{group}@{scale}x.webp"
    return {
        "src": relative_to_repo(output_path, repo_root),
        "width": width,
        "height": height,
        "scale": scale,
        "format": "webp",
        "frames": {
            frame.prepared.entry.asset_id: frame_metadata(frame, scale)
            for frame in sorted(frames, key=lambda item: item.prepared.entry.asset_id)
        },
    }


def plan_atlas(
    group: str,
    prepared: Sequence[PreparedAsset],
    scale: int,
    output_root: Path,
    repo_root: Path,
    max_size: int,
    padding: int,
) -> dict[str, Any]:
    frames, width, height = choose_layout(prepared, scale, max_size, padding)
    return atlas_metadata(group, frames, width, height, scale, output_root, repo_root)


def build_atlas(
    group: str,
    prepared: Sequence[PreparedAsset],
    scale: int,
    output_root: Path,
    repo_root: Path,
    max_size: int,
    padding: int,
) -> dict[str, Any]:
    frames, width, height = choose_layout(prepared, scale, max_size, padding)
    atlas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    for frame in frames:
        fitted, offset_x, offset_y = fit_image(frame.prepared.image, frame.width, frame.height)
        atlas.alpha_composite(fitted, (frame.x + offset_x, frame.y + offset_y))
    output_path = output_root / f"{group}@{scale}x.webp"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(output_path, format="WEBP", lossless=True, quality=95, method=6)
    return atlas_metadata(group, frames, width, height, scale, output_root, repo_root)


def independent_metadata(prepared: PreparedAsset, repo_root: Path) -> dict[str, Any]:
    entry = prepared.entry
    return {
        "src": relative_to_repo(entry.source, repo_root),
        "width": prepared.source_width,
        "height": prepared.source_height,
        "logicalSize": {"width": entry.logical_width, "height": entry.logical_height},
        "pivot": {"x": entry.pivot_x, "y": entry.pivot_y},
        "hasAlpha": prepared.image.getchannel("A").getextrema()[0] < 255,
    }


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(serialized, encoding="utf-8")
    temporary.replace(path)


def decoded_texture_report(
    payload: dict[str, Any],
    prepared: Sequence[PreparedAsset],
    entry_images: Sequence[ResidentImage],
    repo_root: Path,
) -> dict[str, Any]:
    generated_atlases = {
        (group_id, tier_id)
        for group_id, tiers in payload["atlases"].items()
        for tier_id in tiers
    }
    configured_atlases = set(RUNTIME_RESIDENT_ATLASES)
    unconfigured = sorted(generated_atlases - configured_atlases)
    if unconfigured:
        labels = ", ".join(f"{group}.{tier}" for group, tier in unconfigured)
        raise PipelineError(f"generated atlases are missing from the runtime residency model: {labels}")

    resident_atlas_records = []
    for group_id, tier_id in RUNTIME_RESIDENT_ATLASES:
        atlas = payload["atlases"].get(group_id, {}).get(tier_id)
        if atlas is None:
            continue
        resident_atlas_records.append(
            {
                "key": f"{group_id}.{tier_id}",
                "bytes": atlas["width"] * atlas["height"] * 4,
            }
        )

    independent_records = [
        {
            "id": item.entry.asset_id,
            "src": relative_to_repo(item.entry.source, repo_root),
            "bytes": item.source_width * item.source_height * 4,
        }
        for item in prepared
        if not item.entry.pack
    ]
    entry_records = [
        {
            "id": item.resource_id,
            "src": relative_to_repo(item.source, repo_root),
            "width": item.width,
            "height": item.height,
            "bytes": item.decoded_bytes,
            **({"duplicateOf": item.duplicate_of} if item.duplicate_of else {}),
        }
        for item in entry_images
    ]

    atlas_bytes = sum(item["bytes"] for item in resident_atlas_records)
    independent_bytes = sum(item["bytes"] for item in independent_records)
    entry_bytes = sum(item["bytes"] for item in entry_records)

    def tier_bytes(tier_id: str) -> int:
        return sum(
            atlas[tier_id]["width"] * atlas[tier_id]["height"] * 4
            for atlas in payload["atlases"].values()
            if tier_id in atlas
        )

    return {
        # Retain the old scenario fields for metadata consumers, but do not use
        # either one as the peak: the runtime can keep both tiers simultaneously.
        "oneX": tier_bytes("oneX") + independent_bytes + entry_bytes,
        "twoX": tier_bytes("twoX") + independent_bytes + entry_bytes,
        "residentAtlases": atlas_bytes,
        "independentBackgrounds": independent_bytes,
        "entryPageImages": entry_bytes,
        "peakResident": atlas_bytes + independent_bytes + entry_bytes,
        "residentAtlasKeys": [item["key"] for item in resident_atlas_records],
        "independentBackgroundIds": [item["id"] for item in independent_records],
        "entryImageResources": entry_records,
    }


def validate_decoded_texture_budget(
    report: dict[str, Any],
    mobile_budget: int,
    desktop_budget: int,
) -> None:
    peak = report["peakResident"]
    exceeded = []
    if peak > mobile_budget:
        exceeded.append(f"mobile {mobile_budget / 1024 / 1024:.1f} MiB")
    if peak > desktop_budget:
        exceeded.append(f"desktop {desktop_budget / 1024 / 1024:.1f} MiB")
    if not exceeded:
        return

    atlas_keys = ", ".join(report["residentAtlasKeys"]) or "none"
    background_ids = ", ".join(report["independentBackgroundIds"]) or "none"
    entry_resources = report["entryImageResources"]
    entry_labels = ", ".join(item["src"] for item in entry_resources) or "none"
    duplicate_labels = [
        f"{item['src']} duplicates {item['duplicateOf']}"
        for item in entry_resources
        if item.get("duplicateOf")
    ]
    duplicate_hint = ""
    if duplicate_labels:
        duplicate_hint = (
            "; duplicate entry image: "
            + ", ".join(duplicate_labels)
            + "; reuse the manifest background URL in the entry page (with the same cache version) "
            "or remove the duplicate resource"
        )
    raise PipelineError(
        f"peak decoded textures use {peak / 1024 / 1024:.1f} MiB, above {' and '.join(exceeded)}; "
        f"resident atlases use {report['residentAtlases'] / 1024 / 1024:.1f} MiB "
        f"[{atlas_keys}], independent backgrounds use "
        f"{report['independentBackgrounds'] / 1024 / 1024:.1f} MiB [{background_ids}], "
        f"and entry-page images use {report['entryPageImages'] / 1024 / 1024:.1f} MiB "
        f"[{entry_labels}]{duplicate_hint}"
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=REPO_ROOT)
    parser.add_argument("--source-root", type=Path, default=DEFAULT_SOURCE_ROOT)
    parser.add_argument("--spec", type=Path, help="optional schemaVersion-1 JSON inventory")
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument("--metadata", type=Path, default=DEFAULT_METADATA)
    parser.add_argument(
        "--entry-page",
        type=Path,
        default=DEFAULT_ENTRY_PAGE,
        help="HTML entry page whose directly referenced Game 2 images may remain decoded",
    )
    parser.add_argument("--max-atlas-size", type=int, default=2048)
    parser.add_argument("--max-source-size", type=int, default=4096)
    parser.add_argument("--padding", type=int, default=4)
    parser.add_argument("--key-color", action="append", default=[], help="chroma key to reject (#RRGGBB)")
    parser.add_argument("--key-tolerance", type=int, default=12)
    parser.add_argument(
        "--mobile-decoded-budget-mib", type=float, default=DEFAULT_MOBILE_DECODED_BUDGET_MIB
    )
    parser.add_argument(
        "--desktop-decoded-budget-mib", type=float, default=DEFAULT_DESKTOP_DECODED_BUDGET_MIB
    )
    parser.add_argument("--validate-only", action="store_true", help="validate inputs without writing atlases")
    return parser


def validate_args(args: argparse.Namespace) -> None:
    if args.max_atlas_size < 64 or args.max_atlas_size > 8192:
        raise PipelineError("--max-atlas-size must be between 64 and 8192")
    if args.max_source_size < 16:
        raise PipelineError("--max-source-size must be at least 16")
    if args.padding < 0 or args.padding > 64:
        raise PipelineError("--padding must be between 0 and 64")
    if args.key_tolerance < 0 or args.key_tolerance > 128:
        raise PipelineError("--key-tolerance must be between 0 and 128")
    if args.mobile_decoded_budget_mib <= 0 or args.desktop_decoded_budget_mib <= 0:
        raise PipelineError("decoded texture budgets must be positive")
    if args.mobile_decoded_budget_mib > args.desktop_decoded_budget_mib:
        raise PipelineError("mobile decoded texture budget cannot exceed desktop budget")


def run(args: argparse.Namespace) -> dict[str, Any]:
    validate_args(args)
    repo_root = args.repo_root.resolve()
    spec_colors: list[str] = []
    if args.spec:
        spec_path = repo_path(args.spec, repo_root)
        entries, spec_colors = load_spec(spec_path, repo_root)
    else:
        entries = scan_sources(repo_path(args.source_root, repo_root))
    if not entries:
        raise PipelineError("asset inventory is empty")

    key_colors = [parse_hex_color(value) for value in [*spec_colors, *args.key_color]]
    prepared = [
        prepare_asset(entry, key_colors, args.key_tolerance, args.max_source_size)
        for entry in sorted(entries, key=lambda item: item.asset_id)
    ]
    ids = [item.entry.asset_id for item in prepared]
    if len(ids) != len(set(ids)):
        raise PipelineError("asset IDs must be globally unique")

    payload: dict[str, Any] = {
        "schemaVersion": 1,
        "generator": "scripts/game2_art_pipeline.py",
        "independent": {
            item.entry.asset_id: independent_metadata(item, repo_root) for item in prepared
        },
        "atlases": {},
    }
    output_root = repo_path(args.output_root, repo_root)
    atlas_builder = plan_atlas if args.validate_only else build_atlas
    for group in GROUPS:
        group_assets = [item for item in prepared if item.entry.pack and item.entry.group == group]
        if not group_assets:
            continue
        payload["atlases"][group] = {
            "oneX": atlas_builder(
                group, group_assets, 1, output_root, repo_root, args.max_atlas_size, args.padding
            ),
            "twoX": atlas_builder(
                group, group_assets, 2, output_root, repo_root, args.max_atlas_size, args.padding
            ),
        }

    entry_images = discover_entry_page_images(
        repo_path(args.entry_page, repo_root), repo_root, prepared
    )
    mobile_budget = round(args.mobile_decoded_budget_mib * 1024 * 1024)
    desktop_budget = round(args.desktop_decoded_budget_mib * 1024 * 1024)
    report = decoded_texture_report(payload, prepared, entry_images, repo_root)
    report["mobileBudget"] = mobile_budget
    report["desktopBudget"] = desktop_budget
    payload["decodedTextureBytes"] = report
    validate_decoded_texture_budget(report, mobile_budget, desktop_budget)
    if not args.validate_only:
        write_json(repo_path(args.metadata, repo_root), payload)
    return payload


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        payload = run(args)
    except PipelineError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    mode = "validated" if args.validate_only else "packed"
    print(
        f"{mode} {len(payload['independent'])} assets; "
        f"atlas groups: {', '.join(payload['atlases']) or 'none'}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
