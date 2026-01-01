"""
ERF Processing Module

Contains interpolation and data processing utilities for paleoclimate data.
"""

from .interpolation import (
    CubicSplineInterpolator,
    ClimateInterpolator,
    interpolate_climate_state,
    get_interpolation_method,
)

__all__ = [
    "CubicSplineInterpolator",
    "ClimateInterpolator",
    "interpolate_climate_state",
    "get_interpolation_method",
]
