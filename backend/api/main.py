"""
ERF - Earth Reconstruction Framework
FastAPI Backend for serving paleoclimate and paleogeography data

Features:
- Cubic spline interpolation for smooth climate transitions
- Detailed time period data with geological events
- Static texture serving for 3D visualization
- Comprehensive error handling and validation
"""

from fastapi import FastAPI, HTTPException, Query, Path
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field, field_validator
from typing import Optional, List, Dict, Any, Literal
from enum import Enum
import os
import json
import httpx
import logging
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

# Import processing module
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from processing.interpolation import (
    ClimateInterpolator,
    InterpolationMethod,
    ClimateState,
)

app = FastAPI(
    title="ERF API",
    description="Earth Reconstruction Framework - Paleoclimate Data API providing historical Earth state data with cubic spline interpolation",
    version="0.2.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# Get allowed origins from environment, with safe defaults for development
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "").split(",") if os.getenv("ALLOWED_ORIGINS") else [
    "http://localhost:3000",
    "http://localhost:3333",
    "http://localhost:5173",
    "http://localhost:8080",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3333",
    "http://127.0.0.1:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

# Directories
BASE_DIR = os.path.dirname(os.path.dirname(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
STATIC_DIR = os.path.join(BASE_DIR, "static")
TEXTURES_DIR = os.path.join(STATIC_DIR, "textures")

# Mount static files for textures
if os.path.exists(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# Constants
MIN_YEAR = -5000000
MAX_YEAR = 0
VALID_RESOLUTIONS = ["low", "medium", "high", "ultra"]


# ============================================================================
# Pydantic Models
# ============================================================================

class InterpolationMethodEnum(str, Enum):
    """Available interpolation methods"""
    LINEAR = "linear"
    CUBIC_SPLINE = "cubic_spline"
    PCHIP = "pchip"


class EarthState(BaseModel):
    """Earth state at a given time"""
    year: int = Field(..., description="Year (negative for past)")
    sea_level_m: float = Field(..., description="Sea level relative to present in meters")
    global_temp_c: float = Field(..., description="Global temperature anomaly relative to present in Celsius")
    ice_coverage_pct: float = Field(..., description="Percentage of Earth covered by ice")
    co2_ppm: Optional[float] = Field(None, description="Atmospheric CO2 in parts per million")
    texture_url: Optional[str] = Field(None, description="URL to Earth texture for this period")
    heightmap_url: Optional[str] = Field(None, description="URL to heightmap for this period")


class TimePeriod(BaseModel):
    """Detailed time period information"""
    year: int
    name: str
    description: Optional[str] = None
    epoch: Optional[str] = None
    era: Optional[str] = None
    sea_level_m: float
    global_temp_c: float
    ice_coverage_pct: float
    co2_ppm: Optional[float] = None
    texture_key: Optional[str] = None
    notable_features: Optional[List[str]] = None


class GeologicalEvent(BaseModel):
    """Notable geological or climate event"""
    year: int
    name: str
    type: str = Field(..., description="Event type: volcanic, climate, geological")
    description: str
    impact: Optional[str] = None
    magnitude: Optional[str] = None
    coordinates: Optional[Dict[str, float]] = None


class LandBridge(BaseModel):
    """Historical land bridge information"""
    name: str
    description: str
    exposed_years: List[int] = Field(..., description="[start_year, end_year] when exposed")
    coordinates: Dict[str, float]
    max_width_km: float
    significance: str


class IceSheet(BaseModel):
    """Historical ice sheet information"""
    name: str
    description: str
    peak_year: int
    peak_area_km2: int
    peak_thickness_m: int
    center_coordinates: Dict[str, float]


class TextureInfo(BaseModel):
    """Texture information for a time period"""
    year: int
    resolution: str
    texture_url: Optional[str] = None
    heightmap_url: Optional[str] = None
    normal_map_url: Optional[str] = None
    available: bool = False
    texture_key: Optional[str] = None


class RateOfChange(BaseModel):
    """Rate of change of climate variables"""
    year: int
    sea_level_m_per_century: float
    temp_c_per_century: float
    ice_pct_per_century: float


class ErrorResponse(BaseModel):
    """Standard error response"""
    error: str
    detail: str
    status_code: int


# ============================================================================
# Data Loading
# ============================================================================

def load_time_periods_data() -> Dict[str, Any]:
    """Load time periods data from JSON file"""
    json_path = os.path.join(DATA_DIR, "time_periods.json")
    if os.path.exists(json_path):
        with open(json_path, "r") as f:
            return json.load(f)
    return {"time_periods": [], "geological_events": [], "land_bridges": [], "ice_sheets": []}


# Load data on startup
_data_cache: Optional[Dict[str, Any]] = None
_climate_interpolator: Optional[ClimateInterpolator] = None


def get_data() -> Dict[str, Any]:
    """Get cached time periods data"""
    global _data_cache
    if _data_cache is None:
        _data_cache = load_time_periods_data()
    return _data_cache


def get_interpolator(method: InterpolationMethod = InterpolationMethod.CUBIC_SPLINE) -> ClimateInterpolator:
    """Get climate interpolator instance"""
    global _climate_interpolator
    data = get_data()
    if _climate_interpolator is None or True:  # Always create with specified method
        _climate_interpolator = ClimateInterpolator(
            data.get("time_periods", []),
            method
        )
    return _climate_interpolator


def validate_year(year: int) -> None:
    """Validate year is within acceptable range"""
    if year > MAX_YEAR:
        raise HTTPException(
            status_code=400,
            detail=f"Year cannot be in the future. Maximum year is {MAX_YEAR}."
        )
    if year < MIN_YEAR:
        raise HTTPException(
            status_code=400,
            detail=f"Year {year} is too far in the past. Minimum supported year is {MIN_YEAR}."
        )


def validate_resolution(resolution: str) -> None:
    """Validate resolution parameter"""
    if resolution not in VALID_RESOLUTIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid resolution '{resolution}'. Valid options: {', '.join(VALID_RESOLUTIONS)}"
        )


# ============================================================================
# Exception Handlers
# ============================================================================

@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc: HTTPException):
    """Custom HTTP exception handler with consistent format"""
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": "HTTPException",
            "detail": exc.detail,
            "status_code": exc.status_code
        }
    )


@app.exception_handler(ValueError)
async def value_error_handler(request, exc: ValueError):
    """Handle value errors"""
    logger.warning(f"Value error: {str(exc)}")
    return JSONResponse(
        status_code=400,
        content={
            "error": "ValueError",
            "detail": "Invalid input provided",
            "status_code": 400
        }
    )


@app.exception_handler(Exception)
async def general_exception_handler(request, exc: Exception):
    """Handle unexpected errors"""
    return JSONResponse(
        status_code=500,
        content={
            "error": "InternalServerError",
            "detail": "An unexpected error occurred. Please try again later.",
            "status_code": 500
        }
    )


# ============================================================================
# API Endpoints
# ============================================================================

@app.get("/", tags=["General"])
async def root():
    """API root endpoint"""
    return {
        "message": "ERF API - Earth Reconstruction Framework",
        "version": "0.2.0",
        "documentation": "/docs",
        "endpoints": {
            "health": "/api/health",
            "earth_state": "/api/earth/state/{year}",
            "periods": "/api/periods",
            "events": "/api/events",
            "textures": "/api/earth/texture/{year}",
        }
    }


@app.get("/api/health", tags=["General"])
async def health():
    """Health check endpoint"""
    data = get_data()
    return {
        "status": "healthy",
        "version": "0.2.0",
        "data_loaded": len(data.get("time_periods", [])) > 0,
        "time_periods_count": len(data.get("time_periods", [])),
        "events_count": len(data.get("geological_events", [])),
        "interpolation_methods": [m.value for m in InterpolationMethodEnum],
    }


@app.get("/api/earth/state/{year}", response_model=EarthState, tags=["Earth State"])
async def get_earth_state(
    year: int = Path(..., description="Year (negative for past, e.g., -20000 for 20,000 years ago)"),
    method: InterpolationMethodEnum = Query(
        InterpolationMethodEnum.CUBIC_SPLINE,
        description="Interpolation method to use"
    ),
    include_texture: bool = Query(True, description="Include texture URLs in response"),
):
    """
    Get Earth's climate state for a given year.

    Uses cubic spline interpolation by default for smooth transitions between
    known data points. Supports range from -5,000,000 to 0 (present).

    **Interpolation Methods:**
    - `cubic_spline`: Smooth C2 continuous interpolation (default)
    - `linear`: Simple linear interpolation between points
    - `pchip`: Monotonic interpolation, prevents overshoot

    **Examples:**
    - `/api/earth/state/0` - Present day
    - `/api/earth/state/-20000` - Last Glacial Maximum
    - `/api/earth/state/-130000` - Eemian Interglacial
    - `/api/earth/state/-2600000` - Onset of Ice Ages (Pleistocene)
    - `/api/earth/state/-3500000` - Mid-Pliocene Warm Period
    - `/api/earth/state/-5000000` - Early Pliocene
    """
    validate_year(year)

    try:
        interp_method = InterpolationMethod(method.value)
        interpolator = get_interpolator(interp_method)
        state = interpolator.interpolate(year)

        # Get texture info if requested
        texture_url = None
        heightmap_url = None
        if include_texture:
            texture_info = get_texture_info_for_year(year, "medium")
            texture_url = texture_info.get("texture_url")
            heightmap_url = texture_info.get("heightmap_url")

        return EarthState(
            year=state.year,
            sea_level_m=state.sea_level_m,
            global_temp_c=state.global_temp_c,
            ice_coverage_pct=state.ice_coverage_pct,
            co2_ppm=state.co2_ppm,
            texture_url=texture_url,
            heightmap_url=heightmap_url,
        )
    except Exception as e:
        logger.error(f"Error interpolating climate state: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail="Failed to process climate data"
        )


@app.get("/api/earth/state/{year}/rate", response_model=RateOfChange, tags=["Earth State"])
async def get_rate_of_change(
    year: int = Path(..., description="Year to calculate rate of change"),
):
    """
    Get rate of change of climate variables at a given year.

    Returns rates per century (100 years) for easier interpretation.
    Useful for understanding the speed of climate transitions.
    """
    validate_year(year)

    try:
        interpolator = get_interpolator(InterpolationMethod.CUBIC_SPLINE)
        rates = interpolator.get_rate_of_change(year)

        # Convert per-year to per-century
        return RateOfChange(
            year=year,
            sea_level_m_per_century=round(rates["sea_level_m_per_year"] * 100, 4),
            temp_c_per_century=round(rates["temp_c_per_year"] * 100, 4),
            ice_pct_per_century=round(rates["ice_pct_per_year"] * 100, 4),
        )
    except Exception as e:
        logger.error(f"Error calculating rate of change: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail="Failed to calculate rate of change"
        )


@app.get("/api/earth/texture/{year}", response_model=TextureInfo, tags=["Textures"])
async def get_earth_texture(
    year: int = Path(..., description="Year for texture lookup"),
    resolution: str = Query("medium", description="Texture resolution: low, medium, high, ultra"),
):
    """
    Get Earth texture URLs for a given time period.

    Returns URLs to appropriate textures based on the closest defined time period.
    If textures are not available for the exact year, returns info about the
    closest available texture.

    **Resolution Options:**
    - `low`: 1K textures (1024x512)
    - `medium`: 2K textures (2048x1024)
    - `high`: 4K textures (4096x2048)
    - `ultra`: 8K textures (8192x4096)
    """
    validate_year(year)
    validate_resolution(resolution)

    texture_info = get_texture_info_for_year(year, resolution)

    return TextureInfo(
        year=year,
        resolution=resolution,
        texture_url=texture_info.get("texture_url"),
        heightmap_url=texture_info.get("heightmap_url"),
        normal_map_url=texture_info.get("normal_map_url"),
        available=texture_info.get("available", False),
        texture_key=texture_info.get("texture_key"),
    )


def get_texture_info_for_year(year: int, resolution: str) -> Dict[str, Any]:
    """Get texture information for a specific year"""
    data = get_data()
    time_periods = data.get("time_periods", [])

    if not time_periods:
        return {"available": False}

    # Find closest time period
    sorted_periods = sorted(time_periods, key=lambda x: abs(x["year"] - year))
    closest_period = sorted_periods[0] if sorted_periods else None

    if not closest_period:
        return {"available": False}

    texture_key = closest_period.get("texture_key", "default")

    # Check if texture files exist
    resolution_suffix = {"low": "1k", "medium": "2k", "high": "4k", "ultra": "8k"}
    suffix = resolution_suffix.get(resolution, "2k")

    texture_filename = f"{texture_key}_{suffix}.jpg"
    heightmap_filename = f"{texture_key}_heightmap_{suffix}.png"
    normalmap_filename = f"{texture_key}_normal_{suffix}.png"

    texture_path = os.path.join(TEXTURES_DIR, texture_filename)
    heightmap_path = os.path.join(TEXTURES_DIR, heightmap_filename)
    normalmap_path = os.path.join(TEXTURES_DIR, normalmap_filename)

    base_url = "/static/textures"

    result = {
        "texture_key": texture_key,
        "available": os.path.exists(texture_path),
    }

    if os.path.exists(texture_path):
        result["texture_url"] = f"{base_url}/{texture_filename}"
    if os.path.exists(heightmap_path):
        result["heightmap_url"] = f"{base_url}/{heightmap_filename}"
    if os.path.exists(normalmap_path):
        result["normal_map_url"] = f"{base_url}/{normalmap_filename}"

    return result


@app.get("/api/periods", response_model=Dict[str, List[TimePeriod]], tags=["Time Periods"])
async def get_time_periods():
    """
    Get all defined time periods with their climate data.

    Returns detailed information about each known time period including
    notable features and geological context.
    """
    data = get_data()
    periods = data.get("time_periods", [])

    return {
        "periods": [
            TimePeriod(**period) for period in sorted(periods, key=lambda x: x["year"], reverse=True)
        ]
    }


@app.get("/api/periods/{year}", response_model=TimePeriod, tags=["Time Periods"])
async def get_time_period(
    year: int = Path(..., description="Year of the time period"),
):
    """
    Get detailed information about a specific time period.

    Returns the time period that matches the given year exactly,
    or raises 404 if no matching period is found.
    """
    data = get_data()
    periods = data.get("time_periods", [])

    for period in periods:
        if period["year"] == year:
            return TimePeriod(**period)

    raise HTTPException(
        status_code=404,
        detail=f"No time period defined for year {year}. Use /api/periods to see available periods."
    )


@app.get("/api/events", response_model=Dict[str, List[GeologicalEvent]], tags=["Geological Events"])
async def get_geological_events(
    type: Optional[str] = Query(None, description="Filter by event type: volcanic, climate, geological"),
    start_year: Optional[int] = Query(None, description="Filter events after this year (inclusive)"),
    end_year: Optional[int] = Query(None, description="Filter events before this year (inclusive)"),
):
    """
    Get notable geological and climate events.

    Returns list of significant events that shaped Earth's history,
    including volcanic eruptions, climate shifts, and geological processes.

    **Event Types:**
    - `volcanic`: Major volcanic eruptions
    - `climate`: Rapid climate change events
    - `geological`: Geological processes (landslides, floods, etc.)
    """
    data = get_data()
    events = data.get("geological_events", [])

    # Apply filters
    if type:
        events = [e for e in events if e.get("type") == type]
    if start_year is not None:
        events = [e for e in events if e.get("year", 0) >= start_year]
    if end_year is not None:
        events = [e for e in events if e.get("year", 0) <= end_year]

    return {
        "events": [
            GeologicalEvent(**event) for event in sorted(events, key=lambda x: x["year"], reverse=True)
        ]
    }


@app.get("/api/events/{year}", response_model=GeologicalEvent, tags=["Geological Events"])
async def get_geological_event(
    year: int = Path(..., description="Year of the event"),
):
    """
    Get information about a specific geological event by year.
    """
    data = get_data()
    events = data.get("geological_events", [])

    for event in events:
        if event["year"] == year:
            return GeologicalEvent(**event)

    raise HTTPException(
        status_code=404,
        detail=f"No geological event found for year {year}. Use /api/events to see available events."
    )


@app.get("/api/land-bridges", response_model=Dict[str, List[LandBridge]], tags=["Geography"])
async def get_land_bridges(
    year: Optional[int] = Query(None, description="Show only land bridges exposed at this year"),
):
    """
    Get historical land bridge information.

    Land bridges are areas of land exposed during glacial periods due to
    lower sea levels. Many were crucial for human migration.
    """
    data = get_data()
    bridges = data.get("land_bridges", [])

    if year is not None:
        # Filter to bridges exposed at the given year
        bridges = [
            b for b in bridges
            if len(b.get("exposed_years", [])) >= 2 and
               b["exposed_years"][0] <= year <= b["exposed_years"][1]
        ]

    return {
        "land_bridges": [LandBridge(**bridge) for bridge in bridges]
    }


@app.get("/api/ice-sheets", response_model=Dict[str, List[IceSheet]], tags=["Geography"])
async def get_ice_sheets():
    """
    Get historical ice sheet information.

    Returns data about major ice sheets during the last glacial period,
    including their peak extent, thickness, and location.
    """
    data = get_data()
    sheets = data.get("ice_sheets", [])

    return {
        "ice_sheets": [IceSheet(**sheet) for sheet in sheets]
    }


@app.get("/api/timeline", tags=["Time Periods"])
async def get_timeline(
    start_year: int = Query(-5000000, description="Start year for timeline"),
    end_year: int = Query(0, description="End year for timeline"),
    step: int = Query(50000, description="Year step for timeline points"),
    method: InterpolationMethodEnum = Query(
        InterpolationMethodEnum.CUBIC_SPLINE,
        description="Interpolation method"
    ),
):
    """
    Get interpolated climate data across a time range.

    Useful for generating charts and visualizations of climate change over time.
    Returns an array of climate states at regular intervals.

    **Example:**
    `/api/timeline?start_year=-100000&end_year=0&step=5000`
    Returns climate states every 5,000 years from 100,000 years ago to present.
    """
    validate_year(start_year)
    validate_year(end_year)

    if start_year >= end_year:
        raise HTTPException(
            status_code=400,
            detail="start_year must be less than end_year"
        )

    if step <= 0:
        raise HTTPException(
            status_code=400,
            detail="step must be positive"
        )

    if step < 100:
        raise HTTPException(
            status_code=400,
            detail="step must be at least 100 years to prevent excessive data"
        )

    max_points = 1000
    expected_points = (end_year - start_year) // step
    if expected_points > max_points:
        raise HTTPException(
            status_code=400,
            detail=f"Request would generate {expected_points} points. Maximum is {max_points}. Increase step size."
        )

    try:
        interp_method = InterpolationMethod(method.value)
        interpolator = get_interpolator(interp_method)

        timeline = []
        year = start_year
        while year <= end_year:
            state = interpolator.interpolate(year)
            timeline.append(state.to_dict())
            year += step

        return {
            "start_year": start_year,
            "end_year": end_year,
            "step": step,
            "method": method.value,
            "points": len(timeline),
            "timeline": timeline,
        }
    except Exception as e:
        logger.error(f"Error generating timeline: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail="Failed to generate timeline"
        )


@app.get("/api/compare", tags=["Earth State"])
async def compare_periods(
    years: str = Query(..., description="Comma-separated list of years to compare (e.g., '0,-20000,-130000')"),
):
    """
    Compare climate states across multiple time periods.

    Useful for visualizing the differences between key time periods.

    **Example:**
    `/api/compare?years=0,-20000,-130000`
    Compares present day, Last Glacial Maximum, and Eemian Interglacial.
    """
    try:
        year_list = [int(y.strip()) for y in years.split(",")]
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="Invalid year format. Use comma-separated integers."
        )

    if len(year_list) > 10:
        raise HTTPException(
            status_code=400,
            detail="Maximum 10 years can be compared at once."
        )

    for year in year_list:
        validate_year(year)

    interpolator = get_interpolator(InterpolationMethod.CUBIC_SPLINE)

    comparisons = []
    for year in year_list:
        state = interpolator.interpolate(year)
        comparisons.append({
            **state.to_dict(),
            "name": get_period_name(year),
        })

    return {
        "years": year_list,
        "comparison": comparisons,
    }


def get_period_name(year: int) -> str:
    """Get human-readable name for a time period"""
    data = get_data()
    for period in data.get("time_periods", []):
        if period["year"] == year:
            return period.get("name", f"{abs(year):,} years ago")

    # Generate name based on year
    if year == 0:
        return "Present Day"
    elif year >= -12000:
        return f"Early Holocene ({abs(year):,} years ago)"
    elif year >= -130000:
        return f"Late Pleistocene ({abs(year):,} years ago)"
    elif year >= -800000:
        return f"Middle Pleistocene ({abs(year):,} years ago)"
    elif year >= -2600000:
        return f"Early Pleistocene ({abs(year):,} years ago)"
    elif year >= -5300000:
        return f"Pliocene ({abs(year):,} years ago)"
    else:
        return f"Late Miocene ({abs(year):,} years ago)"


# ============================================================================
# Storm Data Endpoints
# ============================================================================

from .storms import storm_manager, initialize_storm_data

@app.on_event("startup")
async def load_storm_data():
    """Load storm data on startup"""
    await initialize_storm_data()


@app.get("/api/storms/notable", tags=["Storms"])
async def get_notable_storms():
    """
    Get list of notable/famous historical storms.

    Returns storms like Hurricane Katrina, Sandy, Maria, Typhoon Haiyan, etc.
    """
    storms = storm_manager.get_notable_storms()
    return {"notable_storms": storms, "count": len(storms)}


@app.get("/api/storms/years", tags=["Storms"])
async def get_available_storm_years():
    """
    Get list of years with available storm data.
    """
    years = storm_manager.get_available_years()
    return {"years": years, "count": len(years)}


@app.get("/api/storms/year/{year}", tags=["Storms"])
async def get_storms_by_year(
    year: int = Path(..., description="Year to get storms for (e.g., 2005, 2017)")
):
    """
    Get all storms for a specific year.

    Returns all tropical cyclones that occurred in the given year across all basins.
    """
    storms = storm_manager.get_storms_by_year(year)
    return {"year": year, "storms": storms, "count": len(storms)}


@app.get("/api/storms/basin/{basin}", tags=["Storms"])
async def get_storms_by_basin(
    basin: str = Path(..., description="Basin code: NA (Atlantic), EP (East Pacific), WP (West Pacific), NI (North Indian), SI (South Indian), SP (South Pacific)")
):
    """
    Get all storms for a specific ocean basin.

    Basin codes:
    - NA: North Atlantic
    - EP: Eastern Pacific
    - WP: Western Pacific
    - NI: North Indian Ocean
    - SI: South Indian Ocean
    - SP: South Pacific
    """
    storms = storm_manager.get_storms_by_basin(basin)
    return {"basin": basin.upper(), "storms": storms, "count": len(storms)}


@app.get("/api/storms/at-time", tags=["Storms"])
async def get_storms_at_time(
    datetime_str: str = Query(..., description="ISO datetime string (e.g., '2005-08-29T12:00:00')"),
    hours_window: int = Query(6, description="Hours before/after to search")
):
    """
    Get all storms active at a specific date/time.

    Useful for the timeline playback feature to show storms at any point in history.
    """
    from datetime import datetime
    try:
        dt = datetime.fromisoformat(datetime_str.replace('Z', '+00:00'))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid datetime format. Use ISO format.")

    storms = storm_manager.get_storms_at_time(dt, hours_window)
    return {"datetime": datetime_str, "storms": storms, "count": len(storms)}


@app.get("/api/storms/search", tags=["Storms"])
async def search_storms(
    name: str = Query(..., min_length=2, description="Storm name to search for")
):
    """
    Search storms by name.

    Example: `/api/storms/search?name=katrina`
    """
    storms = storm_manager.search_storms(name)
    return {"query": name, "storms": storms, "count": len(storms)}


@app.get("/api/storms/{storm_id}", tags=["Storms"])
async def get_storm_details(
    storm_id: str = Path(..., description="IBTrACS storm ID (e.g., '2005236N23285' for Katrina)")
):
    """
    Get detailed information about a specific storm including full track data.

    Track data includes position, wind speed, pressure, and category at each time point.
    """
    storm = storm_manager.get_storm(storm_id)
    if not storm:
        raise HTTPException(status_code=404, detail=f"Storm {storm_id} not found")
    return storm


# ============================================================================
# Weather Data Proxy Endpoints (bypass CORS)
# ============================================================================

# Cache for weather data
_weather_cache = {
    "rainviewer": {"data": None, "timestamp": None},
    "radar_images": {}
}
CACHE_DURATION = timedelta(minutes=5)


@app.get("/api/weather/rainviewer", tags=["Weather"])
async def get_rainviewer_data():
    """
    Proxy for RainViewer API - provides global radar and satellite data.

    Returns radar and satellite timestamps for tile fetching.
    """
    cache = _weather_cache["rainviewer"]

    # Check cache
    if cache["data"] and cache["timestamp"]:
        if datetime.now() - cache["timestamp"] < CACHE_DURATION:
            return cache["data"]

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://api.rainviewer.com/public/weather-maps.json",
                timeout=10.0
            )
            response.raise_for_status()
            data = response.json()

            # Cache the result
            _weather_cache["rainviewer"] = {
                "data": data,
                "timestamp": datetime.now()
            }

            return data
    except Exception as e:
        logger.error(f"Failed to fetch RainViewer data: {str(e)}")
        raise HTTPException(status_code=502, detail="Failed to fetch weather data")


@app.get("/api/weather/radar/image", tags=["Weather"])
async def proxy_radar_image(
    url: str = Query(..., description="Full URL of the radar/satellite image to proxy")
):
    """Proxy radar/satellite images from RainViewer to avoid CORS issues"""
    from urllib.parse import urlparse

    # Strict URL validation
    allowed_hosts = ["tilecache.rainviewer.com", "api.rainviewer.com"]

    try:
        parsed = urlparse(url)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid URL format")

    # Validate scheme
    if parsed.scheme not in ["http", "https"]:
        raise HTTPException(status_code=400, detail="Only HTTP/HTTPS URLs are allowed")

    # Validate hostname exactly (case-insensitive)
    if parsed.hostname and parsed.hostname.lower() not in allowed_hosts:
        raise HTTPException(status_code=400, detail="Only RainViewer URLs are allowed")

    # Reject URLs with credentials
    if parsed.username or parsed.password:
        raise HTTPException(status_code=400, detail="URLs with credentials are not allowed")

    # Reject unusual ports
    if parsed.port and parsed.port not in [80, 443, None]:
        raise HTTPException(status_code=400, detail="Non-standard ports are not allowed")

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(url, timeout=10.0, follow_redirects=False)
            response.raise_for_status()

            # Validate content type
            content_type = response.headers.get("content-type", "")
            if not content_type.startswith("image/"):
                raise HTTPException(status_code=400, detail="Response is not an image")

            # Limit response size (10MB max)
            content_length = response.headers.get("content-length")
            if content_length and int(content_length) > 10 * 1024 * 1024:
                raise HTTPException(status_code=413, detail="Image too large")

            return Response(
                content=response.content,
                media_type=content_type,
                headers={"Cache-Control": "public, max-age=300"}
            )
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Request timed out")
    except httpx.HTTPStatusError:
        raise HTTPException(status_code=502, detail="Failed to fetch image")
    except Exception:
        raise HTTPException(status_code=500, detail="An error occurred while fetching the image")


@app.get("/api/weather/satellite/gibs", tags=["Weather"])
async def get_gibs_cloud_url():
    """
    Get NASA GIBS satellite imagery URL for today/yesterday.

    Returns URLs for VIIRS and MODIS cloud imagery.
    """
    today = datetime.now()
    yesterday = today - timedelta(days=1)
    two_days_ago = today - timedelta(days=2)

    def format_date(d):
        return d.strftime("%Y-%m-%d")

    return {
        "viirs_today": f"https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&FORMAT=image/png&TRANSPARENT=true&LAYERS=VIIRS_SNPP_CorrectedReflectance_TrueColor&CRS=EPSG:4326&STYLES=&WIDTH=2048&HEIGHT=1024&BBOX=-90,-180,90,180&TIME={format_date(yesterday)}",
        "viirs_yesterday": f"https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&FORMAT=image/png&TRANSPARENT=true&LAYERS=VIIRS_SNPP_CorrectedReflectance_TrueColor&CRS=EPSG:4326&STYLES=&WIDTH=2048&HEIGHT=1024&BBOX=-90,-180,90,180&TIME={format_date(two_days_ago)}",
        "modis_terra": f"https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&FORMAT=image/png&TRANSPARENT=true&LAYERS=MODIS_Terra_CorrectedReflectance_TrueColor&CRS=EPSG:4326&STYLES=&WIDTH=2048&HEIGHT=1024&BBOX=-90,-180,90,180&TIME={format_date(yesterday)}",
        "dates": {
            "today": format_date(today),
            "yesterday": format_date(yesterday),
            "two_days_ago": format_date(two_days_ago)
        }
    }


@app.get("/api/weather/earthquakes", tags=["Weather"])
async def get_earthquakes(
    min_magnitude: str = Query("2.5", description="Minimum magnitude: all, 1.0, 2.5, 4.5, significant"),
    timeframe: str = Query("day", description="Timeframe: hour, day, week, month")
):
    """
    Proxy for USGS earthquake data.

    Returns earthquakes from USGS with full details.
    """
    valid_magnitudes = ["all", "1.0", "2.5", "4.5", "significant"]
    valid_timeframes = ["hour", "day", "week", "month"]

    if min_magnitude not in valid_magnitudes:
        raise HTTPException(status_code=400, detail=f"Invalid magnitude. Use: {valid_magnitudes}")
    if timeframe not in valid_timeframes:
        raise HTTPException(status_code=400, detail=f"Invalid timeframe. Use: {valid_timeframes}")

    feed = f"{min_magnitude}_{timeframe}"
    url = f"https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/{feed}.geojson"

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(url, timeout=15.0)
            response.raise_for_status()
            return response.json()
    except Exception as e:
        logger.error(f"Failed to fetch earthquake data: {str(e)}")
        raise HTTPException(status_code=502, detail="Failed to fetch earthquake data")


@app.get("/api/weather/fires", tags=["Weather"])
async def get_active_fires():
    """
    Get active fire data from NASA FIRMS.

    Returns recent fire detections globally.
    """
    # NASA FIRMS provides fire data - this returns a summary
    # Full API requires an API key, but we can return the public feed URL
    return {
        "source": "NASA FIRMS",
        "feed_url": "https://firms.modaps.eosdis.nasa.gov/active_fire/",
        "kml_url": "https://firms.modaps.eosdis.nasa.gov/active_fire/kml/Global_24h.kml",
        "note": "For full API access, register at https://firms.modaps.eosdis.nasa.gov/api/",
        "description": "Active fire detections from MODIS and VIIRS satellites"
    }


@app.get("/api/weather/ocean/sst", tags=["Weather"])
async def get_sea_surface_temperature():
    """
    Get sea surface temperature data URLs.

    Returns URLs for SST imagery from NOAA.
    """
    return {
        "source": "NOAA Coral Reef Watch",
        "global_sst": "https://coralreefwatch.noaa.gov/data/5km/v3.1/current/daily/sst/night/",
        "anomaly": "https://coralreefwatch.noaa.gov/data/5km/v3.1/current/daily/ssta/",
        "gibs_sst": "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&FORMAT=image/png&TRANSPARENT=true&LAYERS=GHRSST_L4_MUR_Sea_Surface_Temperature&CRS=EPSG:4326&STYLES=&WIDTH=2048&HEIGHT=1024&BBOX=-90,-180,90,180",
        "description": "Global sea surface temperature data"
    }


# ============================================================================
# Main Entry Point
# ============================================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
