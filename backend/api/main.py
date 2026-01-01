"""
ERF - Earth Reconstruction Framework
FastAPI Backend for serving paleoclimate and paleogeography data
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional
import os

app = FastAPI(
    title="ERF API",
    description="Earth Reconstruction Framework - Paleoclimate Data API",
    version="0.1.0"
)

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Data directory
DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")


class TimeQuery(BaseModel):
    """Query parameters for time-based data"""
    year: int  # Negative for past (e.g., -20000 = 20,000 years ago)
    resolution: Optional[str] = "medium"  # low, medium, high


class EarthState(BaseModel):
    """Earth state at a given time"""
    year: int
    sea_level_m: float  # Relative to present
    global_temp_c: float  # Relative to present
    ice_coverage_pct: float
    texture_url: Optional[str] = None
    heightmap_url: Optional[str] = None


# Key time periods with estimated data
# Sources: NOAA, PMIP, various paleoclimate reconstructions
TIME_PERIODS = {
    0: EarthState(
        year=0,
        sea_level_m=0,
        global_temp_c=0,
        ice_coverage_pct=10.0
    ),
    -12000: EarthState(  # End of last ice age
        year=-12000,
        sea_level_m=-60,
        global_temp_c=-4,
        ice_coverage_pct=25.0
    ),
    -20000: EarthState(  # Last Glacial Maximum
        year=-20000,
        sea_level_m=-120,
        global_temp_c=-6,
        ice_coverage_pct=30.0
    ),
    -130000: EarthState(  # Eemian interglacial (warmer than present)
        year=-130000,
        sea_level_m=6,
        global_temp_c=2,
        ice_coverage_pct=8.0
    ),
    -400000: EarthState(  # Marine Isotope Stage 11 (very warm)
        year=-400000,
        sea_level_m=10,
        global_temp_c=2.5,
        ice_coverage_pct=7.0
    ),
}


def interpolate_state(year: int) -> EarthState:
    """Interpolate Earth state between known time periods"""
    sorted_years = sorted(TIME_PERIODS.keys(), reverse=True)

    # Find bracketing years
    lower_year = sorted_years[-1]
    upper_year = sorted_years[0]

    for i, y in enumerate(sorted_years):
        if y <= year:
            upper_year = y
            if i > 0:
                lower_year = sorted_years[i - 1]
            else:
                lower_year = y
            break

    if upper_year == lower_year:
        return TIME_PERIODS[upper_year]

    # Linear interpolation
    t = (year - lower_year) / (upper_year - lower_year)
    lower = TIME_PERIODS[lower_year]
    upper = TIME_PERIODS[upper_year]

    return EarthState(
        year=year,
        sea_level_m=lower.sea_level_m + t * (upper.sea_level_m - lower.sea_level_m),
        global_temp_c=lower.global_temp_c + t * (upper.global_temp_c - lower.global_temp_c),
        ice_coverage_pct=lower.ice_coverage_pct + t * (upper.ice_coverage_pct - lower.ice_coverage_pct),
    )


@app.get("/")
async def root():
    return {"message": "ERF API - Earth Reconstruction Framework"}


@app.get("/api/health")
async def health():
    return {"status": "healthy"}


@app.get("/api/earth/state/{year}", response_model=EarthState)
async def get_earth_state(year: int):
    """
    Get Earth's climate state for a given year.

    Year should be negative for past dates (e.g., -20000 for 20,000 years ago)
    Supports range from -500,000 to 0 (present)
    """
    if year > 0 or year < -500000:
        raise HTTPException(
            status_code=400,
            detail="Year must be between -500000 and 0"
        )

    return interpolate_state(year)


@app.get("/api/earth/texture/{year}")
async def get_earth_texture(year: int, resolution: str = "medium"):
    """
    Get Earth texture for a given time period.
    Returns URL or file path to the appropriate texture.
    """
    # TODO: Implement texture serving based on time period
    # For now, return placeholder info
    return {
        "year": year,
        "resolution": resolution,
        "texture_url": None,
        "heightmap_url": None,
        "message": "Texture generation not yet implemented"
    }


@app.get("/api/periods")
async def get_time_periods():
    """Get all defined time periods with their climate data"""
    return {
        "periods": [
            {
                "year": year,
                "name": get_period_name(year),
                **state.model_dump()
            }
            for year, state in sorted(TIME_PERIODS.items(), reverse=True)
        ]
    }


def get_period_name(year: int) -> str:
    """Get human-readable name for a time period"""
    names = {
        0: "Present Day",
        -12000: "End of Last Ice Age",
        -20000: "Last Glacial Maximum",
        -130000: "Eemian Interglacial",
        -400000: "Marine Isotope Stage 11",
    }
    return names.get(year, f"{abs(year):,} years ago")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
