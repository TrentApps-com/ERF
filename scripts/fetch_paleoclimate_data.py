#!/usr/bin/env python3
"""
Fetch Paleoclimate Data Script for ERF (Earth Reconstruction Framework)

Downloads sample paleoclimate textures from public sources and generates
a data manifest for the time period visualization.

Data Sources:
- NASA Blue Marble: Present-day Earth texture
- Generated variations: Ice age and other paleoclimate representations

Usage:
    python fetch_paleoclimate_data.py [--output-dir PATH] [--resolution RESOLUTION]
"""

import argparse
import hashlib
import json
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx
import numpy as np
from PIL import Image, ImageEnhance, ImageFilter

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Default paths
DEFAULT_OUTPUT_DIR = Path(__file__).parent.parent / "assets" / "textures"
DEFAULT_MANIFEST_PATH = Path(__file__).parent.parent / "assets" / "paleoclimate_manifest.json"

# NASA Blue Marble URLs (public domain imagery)
# Using the monthly composites from NASA Visible Earth
NASA_BLUE_MARBLE_URLS = {
    "2k": "https://eoimages.gsfc.nasa.gov/images/imagerecords/74000/74393/world.200406.3x5400x2700.jpg",
    "4k": "https://eoimages.gsfc.nasa.gov/images/imagerecords/74000/74393/world.200406.3x10800x5400.jpg",
    "8k": "https://eoimages.gsfc.nasa.gov/images/imagerecords/74000/74393/world.200406.3x21600x10800.jpg",
}

# Alternative lower-resolution source that's more reliable
NASA_BLUE_MARBLE_FALLBACK = {
    "2k": "https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57752/land_shallow_topo_2048.jpg",
    "4k": "https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57752/land_shallow_topo_8192.tif",
}

# Time periods to generate (years before present)
TIME_PERIODS = [
    {
        "id": "present",
        "name": "Present Day",
        "years_bp": 0,
        "description": "Modern Earth as observed by NASA satellites",
        "avg_temp_offset": 0.0,  # Celsius relative to present
        "sea_level_offset": 0,   # meters relative to present
        "ice_coverage": 0.10,    # fraction of surface
    },
    {
        "id": "holocene_optimum",
        "name": "Holocene Climatic Optimum",
        "years_bp": 6000,
        "description": "Warm period ~6,000 years ago with slightly higher temperatures",
        "avg_temp_offset": 0.5,
        "sea_level_offset": 2,
        "ice_coverage": 0.08,
    },
    {
        "id": "younger_dryas",
        "name": "Younger Dryas",
        "years_bp": 12000,
        "description": "Cold snap ~12,000 years ago, abrupt return to glacial conditions",
        "avg_temp_offset": -4.0,
        "sea_level_offset": -60,
        "ice_coverage": 0.20,
    },
    {
        "id": "lgm",
        "name": "Last Glacial Maximum",
        "years_bp": 21000,
        "description": "Peak of the last ice age ~21,000 years ago",
        "avg_temp_offset": -6.0,
        "sea_level_offset": -120,
        "ice_coverage": 0.30,
    },
    {
        "id": "mis3",
        "name": "Marine Isotope Stage 3",
        "years_bp": 40000,
        "description": "Interstadial period ~40,000 years ago, milder glacial conditions",
        "avg_temp_offset": -3.0,
        "sea_level_offset": -80,
        "ice_coverage": 0.18,
    },
    {
        "id": "eemian",
        "name": "Eemian Interglacial",
        "years_bp": 125000,
        "description": "Last interglacial ~125,000 years ago, warmer than present",
        "avg_temp_offset": 1.5,
        "sea_level_offset": 6,
        "ice_coverage": 0.05,
    },
    {
        "id": "penultimate_glacial",
        "name": "Penultimate Glacial Maximum",
        "years_bp": 150000,
        "description": "Second-to-last glacial maximum ~150,000 years ago",
        "avg_temp_offset": -5.5,
        "sea_level_offset": -110,
        "ice_coverage": 0.28,
    },
]

# Ice core data sample (Vostok/EPICA composite, simplified)
ICE_CORE_DATA_SAMPLE = [
    {"years_bp": 0, "temp_anomaly": 0.0, "co2_ppm": 280},
    {"years_bp": 10000, "temp_anomaly": -0.5, "co2_ppm": 260},
    {"years_bp": 20000, "temp_anomaly": -6.0, "co2_ppm": 185},
    {"years_bp": 40000, "temp_anomaly": -4.0, "co2_ppm": 210},
    {"years_bp": 60000, "temp_anomaly": -5.5, "co2_ppm": 195},
    {"years_bp": 80000, "temp_anomaly": -4.5, "co2_ppm": 220},
    {"years_bp": 100000, "temp_anomaly": -5.0, "co2_ppm": 230},
    {"years_bp": 125000, "temp_anomaly": 1.5, "co2_ppm": 290},
    {"years_bp": 150000, "temp_anomaly": -5.5, "co2_ppm": 200},
]


def download_file(url: str, output_path: Path, timeout: float = 120.0) -> bool:
    """Download a file from URL to the specified path."""
    try:
        logger.info(f"Downloading: {url}")
        with httpx.Client(timeout=timeout, follow_redirects=True) as client:
            response = client.get(url)
            response.raise_for_status()

            output_path.parent.mkdir(parents=True, exist_ok=True)
            with open(output_path, 'wb') as f:
                f.write(response.content)

            logger.info(f"Downloaded {len(response.content) / 1024 / 1024:.2f} MB to {output_path}")
            return True
    except httpx.HTTPError as e:
        logger.error(f"HTTP error downloading {url}: {e}")
        return False
    except Exception as e:
        logger.error(f"Error downloading {url}: {e}")
        return False


def get_file_hash(filepath: Path) -> str:
    """Calculate MD5 hash of a file."""
    hash_md5 = hashlib.md5()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(4096), b""):
            hash_md5.update(chunk)
    return hash_md5.hexdigest()


def apply_ice_age_transform(image: Image.Image, period: dict) -> Image.Image:
    """
    Transform a present-day Earth texture to represent a paleoclimate period.

    This applies visual transformations based on:
    - Temperature offset (cooler = more blue/white tinting)
    - Ice coverage (adds white to polar regions)
    - Sea level (exposes continental shelves)
    """
    img = image.copy()
    img_array = np.array(img, dtype=np.float32)

    temp_offset = period["avg_temp_offset"]
    ice_coverage = period["ice_coverage"]
    sea_level = period["sea_level_offset"]

    height, width = img_array.shape[:2]

    # Create latitude mask (for polar ice effects)
    y_coords = np.linspace(-90, 90, height)
    lat_mask = np.abs(y_coords)[:, np.newaxis]
    lat_mask = np.broadcast_to(lat_mask, (height, width))

    # Temperature-based color shift
    if temp_offset < 0:
        # Colder periods: shift toward blue, desaturate greens
        cold_factor = min(abs(temp_offset) / 8.0, 1.0)

        # Reduce red and green channels, boost blue slightly
        img_array[:, :, 0] *= (1 - cold_factor * 0.15)  # Red
        img_array[:, :, 1] *= (1 - cold_factor * 0.20)  # Green
        img_array[:, :, 2] = np.clip(img_array[:, :, 2] * (1 + cold_factor * 0.1), 0, 255)  # Blue

    elif temp_offset > 0:
        # Warmer periods: enhance greens, reduce ice
        warm_factor = min(temp_offset / 3.0, 1.0)

        # Enhance vegetation (green channel)
        img_array[:, :, 1] = np.clip(img_array[:, :, 1] * (1 + warm_factor * 0.15), 0, 255)

    # Ice coverage: add white to high latitudes
    # Base ice starts at ~60 degrees, extends based on ice_coverage
    ice_threshold = 90 - (ice_coverage * 120)  # More ice = lower latitude threshold
    ice_mask = (lat_mask > ice_threshold).astype(np.float32)

    # Gradual ice transition
    transition_zone = 15
    ice_gradient = np.clip((lat_mask - ice_threshold) / transition_zone, 0, 1)

    # Add white/light blue tint for ice
    ice_color = np.array([240, 248, 255], dtype=np.float32)  # Alice blue
    for c in range(3):
        img_array[:, :, c] = (
            img_array[:, :, c] * (1 - ice_gradient * 0.8) +
            ice_color[c] * ice_gradient * 0.8
        )

    # Sea level effects: darken ocean areas slightly for lower sea levels
    # (simplified - in reality this would expose continental shelves)
    if sea_level < -50:
        # Detect ocean areas (predominantly blue pixels)
        blue_dominance = img_array[:, :, 2] - np.maximum(img_array[:, :, 0], img_array[:, :, 1])
        ocean_mask = (blue_dominance > 20).astype(np.float32)

        # Slightly darken deep ocean
        darkness_factor = min(abs(sea_level) / 200, 0.15)
        for c in range(3):
            img_array[:, :, c] *= (1 - ocean_mask * darkness_factor)

    # Clip values and convert back to uint8
    img_array = np.clip(img_array, 0, 255).astype(np.uint8)

    return Image.fromarray(img_array)


def apply_texture_quality_adjustments(image: Image.Image) -> Image.Image:
    """Apply quality adjustments to make textures look better on a globe."""
    # Slight sharpening
    enhancer = ImageEnhance.Sharpness(image)
    image = enhancer.enhance(1.1)

    # Slight contrast boost
    enhancer = ImageEnhance.Contrast(image)
    image = enhancer.enhance(1.05)

    return image


def generate_paleoclimate_textures(
    base_texture: Path,
    output_dir: Path,
    resolution: str = "2k"
) -> list[dict]:
    """Generate texture variants for each paleoclimate period."""
    logger.info(f"Loading base texture: {base_texture}")

    try:
        base_image = Image.open(base_texture)
        base_image = base_image.convert("RGB")
    except Exception as e:
        logger.error(f"Failed to load base texture: {e}")
        return []

    generated_textures = []

    for period in TIME_PERIODS:
        period_id = period["id"]
        output_filename = f"earth_{period_id}_{resolution}.jpg"
        output_path = output_dir / output_filename

        logger.info(f"Generating texture for: {period['name']} ({period_id})")

        if period_id == "present":
            # Use base texture as-is for present day
            processed = apply_texture_quality_adjustments(base_image.copy())
        else:
            # Apply paleoclimate transformation
            transformed = apply_ice_age_transform(base_image, period)
            processed = apply_texture_quality_adjustments(transformed)

        # Save texture
        processed.save(output_path, "JPEG", quality=92)

        texture_info = {
            "period_id": period_id,
            "filename": output_filename,
            "path": str(output_path.relative_to(output_dir.parent.parent)),
            "resolution": resolution,
            "size_bytes": output_path.stat().st_size,
            "md5": get_file_hash(output_path),
            "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        }
        generated_textures.append(texture_info)

        logger.info(f"  Saved: {output_path} ({texture_info['size_bytes'] / 1024:.1f} KB)")

    return generated_textures


def create_placeholder_texture(output_path: Path, resolution: str = "2k") -> bool:
    """Create a placeholder texture if download fails."""
    sizes = {
        "2k": (2048, 1024),
        "4k": (4096, 2048),
        "8k": (8192, 4096),
    }

    width, height = sizes.get(resolution, (2048, 1024))

    logger.info(f"Creating placeholder texture: {width}x{height}")

    # Create a simple Earth-like gradient
    img_array = np.zeros((height, width, 3), dtype=np.uint8)

    # Create latitude gradient
    y_coords = np.linspace(90, -90, height)

    for y in range(height):
        lat = y_coords[y]

        # Ocean blue base
        r, g, b = 20, 50, 120

        # Add some land-like variation
        if abs(lat) < 60:
            # Midlatitudes: add green/brown
            land_chance = 0.3 + 0.2 * np.sin(np.linspace(0, 10 * np.pi, width))
            for x in range(width):
                if land_chance[x] > 0.4:
                    # Land colors
                    r = int(80 + 60 * land_chance[x])
                    g = int(100 + 80 * land_chance[x])
                    b = int(40 + 30 * land_chance[x])
                else:
                    r, g, b = 20, 50, 120
                img_array[y, x] = [r, g, b]
        elif abs(lat) > 70:
            # Polar regions: white/ice
            ice_factor = (abs(lat) - 70) / 20
            r = int(200 + 55 * ice_factor)
            g = int(210 + 45 * ice_factor)
            b = int(230 + 25 * ice_factor)
            img_array[y, :] = [r, g, b]
        else:
            img_array[y, :] = [r, g, b]

    img = Image.fromarray(img_array)

    # Add some noise for realism
    img = img.filter(ImageFilter.GaussianBlur(radius=2))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(output_path, "JPEG", quality=92)

    return True


def fetch_base_texture(output_dir: Path, resolution: str = "2k") -> Optional[Path]:
    """Download the base texture from NASA Blue Marble."""
    output_path = output_dir / f"earth_base_{resolution}.jpg"

    if output_path.exists():
        logger.info(f"Base texture already exists: {output_path}")
        return output_path

    # Try primary URLs
    urls_to_try = [
        NASA_BLUE_MARBLE_URLS.get(resolution),
        NASA_BLUE_MARBLE_FALLBACK.get(resolution),
        NASA_BLUE_MARBLE_FALLBACK.get("2k"),  # Fallback to 2k
    ]

    for url in urls_to_try:
        if url and download_file(url, output_path):
            return output_path

    # If all downloads fail, create a placeholder
    logger.warning("All download attempts failed, creating placeholder texture")
    if create_placeholder_texture(output_path, resolution):
        return output_path

    return None


def create_manifest(
    output_dir: Path,
    textures: list[dict],
    manifest_path: Path
) -> dict:
    """Create the paleoclimate data manifest."""
    manifest = {
        "version": "1.0.0",
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "description": "Paleoclimate textures for Earth Reconstruction Framework",
        "data_sources": [
            {
                "name": "NASA Blue Marble",
                "url": "https://visibleearth.nasa.gov/collection/1484/blue-marble",
                "license": "Public Domain",
                "usage": "Base texture for present-day Earth",
            },
            {
                "name": "NOAA Paleoclimatology",
                "url": "https://www.ncei.noaa.gov/products/paleoclimatology",
                "license": "Public Domain",
                "usage": "Ice core and paleoclimate data reference",
            },
        ],
        "time_periods": TIME_PERIODS,
        "textures": textures,
        "ice_core_data": ICE_CORE_DATA_SAMPLE,
        "metadata": {
            "texture_format": "JPEG",
            "projection": "equirectangular",
            "coordinate_system": "WGS84",
            "time_range": {
                "min_years_bp": 0,
                "max_years_bp": 150000,
            },
        },
    }

    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    with open(manifest_path, 'w') as f:
        json.dump(manifest, f, indent=2)

    logger.info(f"Created manifest: {manifest_path}")
    return manifest


def main():
    parser = argparse.ArgumentParser(
        description="Fetch paleoclimate data and generate textures for ERF"
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help="Output directory for textures"
    )
    parser.add_argument(
        "--manifest-path",
        type=Path,
        default=DEFAULT_MANIFEST_PATH,
        help="Path for the data manifest JSON"
    )
    parser.add_argument(
        "--resolution",
        choices=["2k", "4k", "8k"],
        default="2k",
        help="Texture resolution (2k, 4k, or 8k)"
    )
    parser.add_argument(
        "--skip-download",
        action="store_true",
        help="Skip downloading and use existing base texture"
    )
    parser.add_argument(
        "--placeholder-only",
        action="store_true",
        help="Only create placeholder textures (no download)"
    )

    args = parser.parse_args()

    logger.info("=" * 60)
    logger.info("ERF Paleoclimate Data Fetcher")
    logger.info("=" * 60)
    logger.info(f"Output directory: {args.output_dir}")
    logger.info(f"Resolution: {args.resolution}")

    # Create output directory
    args.output_dir.mkdir(parents=True, exist_ok=True)

    # Fetch or create base texture
    base_texture_path = args.output_dir / f"earth_base_{args.resolution}.jpg"

    if args.placeholder_only:
        logger.info("Creating placeholder texture (--placeholder-only)")
        create_placeholder_texture(base_texture_path, args.resolution)
    elif args.skip_download:
        if not base_texture_path.exists():
            logger.error(f"Base texture not found: {base_texture_path}")
            logger.error("Run without --skip-download to fetch it")
            sys.exit(1)
    else:
        base_texture_path = fetch_base_texture(args.output_dir, args.resolution)
        if not base_texture_path:
            logger.error("Failed to obtain base texture")
            sys.exit(1)

    # Generate paleoclimate variants
    logger.info("\nGenerating paleoclimate texture variants...")
    textures = generate_paleoclimate_textures(
        base_texture_path,
        args.output_dir,
        args.resolution
    )

    if not textures:
        logger.error("Failed to generate textures")
        sys.exit(1)

    # Create manifest
    logger.info("\nCreating data manifest...")
    manifest = create_manifest(args.output_dir, textures, args.manifest_path)

    # Summary
    logger.info("\n" + "=" * 60)
    logger.info("SUMMARY")
    logger.info("=" * 60)
    logger.info(f"Generated {len(textures)} texture files:")
    for tex in textures:
        logger.info(f"  - {tex['filename']} ({tex['size_bytes'] / 1024:.1f} KB)")
    logger.info(f"\nManifest: {args.manifest_path}")
    logger.info(f"Time periods covered: {len(TIME_PERIODS)}")
    logger.info(f"Ice core data points: {len(ICE_CORE_DATA_SAMPLE)}")
    logger.info("\nDone!")


if __name__ == "__main__":
    main()
