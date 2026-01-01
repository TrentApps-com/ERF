"""
Climate Interpolation Module

Provides various interpolation methods for paleoclimate data including
linear, cubic spline, and monotonic interpolation for accurate climate
state reconstruction between known data points.
"""

from typing import List, Dict, Tuple, Optional, Callable
from dataclasses import dataclass
from enum import Enum
import numpy as np


class InterpolationMethod(Enum):
    """Available interpolation methods"""
    LINEAR = "linear"
    CUBIC_SPLINE = "cubic_spline"
    PCHIP = "pchip"  # Piecewise Cubic Hermite Interpolating Polynomial
    AKIMA = "akima"  # Akima spline (reduces oscillation)


@dataclass
class ClimateState:
    """Represents Earth's climate state at a point in time"""
    year: int
    sea_level_m: float
    global_temp_c: float
    ice_coverage_pct: float
    co2_ppm: Optional[float] = None

    def to_dict(self) -> Dict:
        """Convert to dictionary"""
        result = {
            "year": self.year,
            "sea_level_m": self.sea_level_m,
            "global_temp_c": self.global_temp_c,
            "ice_coverage_pct": self.ice_coverage_pct,
        }
        if self.co2_ppm is not None:
            result["co2_ppm"] = self.co2_ppm
        return result


class CubicSplineInterpolator:
    """
    Natural cubic spline interpolator for smooth climate data interpolation.

    Uses tridiagonal matrix algorithm for efficient O(n) computation.
    Ensures C2 continuity (continuous first and second derivatives).
    """

    def __init__(self, x: List[float], y: List[float]):
        """
        Initialize cubic spline interpolator.

        Args:
            x: Sorted x values (e.g., years)
            y: Corresponding y values (e.g., temperatures)
        """
        if len(x) != len(y):
            raise ValueError("x and y must have the same length")
        if len(x) < 2:
            raise ValueError("Need at least 2 points for interpolation")

        # Sort by x if not already sorted
        sorted_indices = np.argsort(x)
        self.x = np.array([x[i] for i in sorted_indices])
        self.y = np.array([y[i] for i in sorted_indices])
        self.n = len(self.x)

        # Compute spline coefficients
        self._compute_coefficients()

    def _compute_coefficients(self):
        """
        Compute cubic spline coefficients using natural spline boundary conditions.

        For each interval [x_i, x_{i+1}], the spline is:
        S_i(x) = a_i + b_i(x-x_i) + c_i(x-x_i)^2 + d_i(x-x_i)^3
        """
        n = self.n
        h = np.diff(self.x)  # Interval widths

        # Set up tridiagonal system for second derivatives
        # Natural spline: S''(x_0) = S''(x_n) = 0

        if n == 2:
            # Linear interpolation for 2 points
            self.a = self.y.copy()
            self.b = np.array([(self.y[1] - self.y[0]) / h[0]])
            self.c = np.array([0.0])
            self.d = np.array([0.0])
            return

        # Build tridiagonal matrix coefficients
        # Ax = rhs where x contains the second derivatives

        # Diagonal
        diag = np.zeros(n)
        diag[0] = 1.0
        diag[-1] = 1.0
        for i in range(1, n - 1):
            diag[i] = 2.0 * (h[i-1] + h[i])

        # Off-diagonals
        lower = np.zeros(n - 1)
        upper = np.zeros(n - 1)
        for i in range(1, n - 1):
            lower[i-1] = h[i-1]
            upper[i] = h[i]

        # Right-hand side
        rhs = np.zeros(n)
        for i in range(1, n - 1):
            rhs[i] = 3.0 * ((self.y[i+1] - self.y[i]) / h[i] -
                           (self.y[i] - self.y[i-1]) / h[i-1])

        # Solve tridiagonal system using Thomas algorithm
        c_prime = np.zeros(n)
        d_prime = np.zeros(n)

        # Forward sweep
        c_prime[0] = upper[0] / diag[0] if n > 1 else 0
        d_prime[0] = rhs[0] / diag[0]

        for i in range(1, n):
            denom = diag[i] - lower[i-1] * c_prime[i-1]
            if i < n - 1:
                c_prime[i] = upper[i] / denom
            d_prime[i] = (rhs[i] - lower[i-1] * d_prime[i-1]) / denom

        # Back substitution - these are the second derivatives at each point
        M = np.zeros(n)
        M[-1] = d_prime[-1]
        for i in range(n - 2, -1, -1):
            M[i] = d_prime[i] - c_prime[i] * M[i + 1]

        # Compute polynomial coefficients for each interval
        self.a = self.y[:-1].copy()
        self.b = np.zeros(n - 1)
        self.c = np.zeros(n - 1)
        self.d = np.zeros(n - 1)

        for i in range(n - 1):
            self.b[i] = (self.y[i+1] - self.y[i]) / h[i] - h[i] * (2*M[i] + M[i+1]) / 3
            self.c[i] = M[i]
            self.d[i] = (M[i+1] - M[i]) / (3 * h[i])

    def __call__(self, x: float) -> float:
        """
        Evaluate the spline at point x.

        Args:
            x: Point to evaluate

        Returns:
            Interpolated value at x
        """
        # Handle extrapolation by clamping
        if x <= self.x[0]:
            return float(self.y[0])
        if x >= self.x[-1]:
            return float(self.y[-1])

        # Find interval containing x using binary search
        i = np.searchsorted(self.x, x) - 1
        i = max(0, min(i, self.n - 2))

        # Evaluate polynomial
        dx = x - self.x[i]
        return float(self.a[i] + self.b[i]*dx + self.c[i]*dx**2 + self.d[i]*dx**3)

    def derivative(self, x: float, order: int = 1) -> float:
        """
        Evaluate spline derivative at point x.

        Args:
            x: Point to evaluate
            order: Derivative order (1 or 2)

        Returns:
            Derivative value at x
        """
        if x <= self.x[0] or x >= self.x[-1]:
            return 0.0

        i = np.searchsorted(self.x, x) - 1
        i = max(0, min(i, self.n - 2))
        dx = x - self.x[i]

        if order == 1:
            return float(self.b[i] + 2*self.c[i]*dx + 3*self.d[i]*dx**2)
        elif order == 2:
            return float(2*self.c[i] + 6*self.d[i]*dx)
        else:
            raise ValueError("Only derivatives of order 1 and 2 are supported")


class MonotonicInterpolator:
    """
    Monotonic cubic interpolator (PCHIP-like) that preserves monotonicity.

    Useful for variables that should not overshoot, like ice coverage percentage.
    """

    def __init__(self, x: List[float], y: List[float]):
        """
        Initialize monotonic interpolator.

        Args:
            x: Sorted x values
            y: Corresponding y values
        """
        sorted_indices = np.argsort(x)
        self.x = np.array([x[i] for i in sorted_indices])
        self.y = np.array([y[i] for i in sorted_indices])
        self.n = len(self.x)

        self._compute_derivatives()

    def _compute_derivatives(self):
        """Compute derivatives that preserve monotonicity."""
        n = self.n
        h = np.diff(self.x)
        delta = np.diff(self.y) / h

        self.m = np.zeros(n)

        for i in range(1, n - 1):
            if delta[i-1] * delta[i] > 0:
                # Same sign - use harmonic mean
                w1 = 2*h[i] + h[i-1]
                w2 = h[i] + 2*h[i-1]
                self.m[i] = (w1 + w2) / (w1/delta[i-1] + w2/delta[i])
            else:
                self.m[i] = 0.0

        # Boundary derivatives
        self.m[0] = delta[0] if n > 1 else 0.0
        self.m[-1] = delta[-1] if n > 1 else 0.0

    def __call__(self, x: float) -> float:
        """Evaluate at point x."""
        if x <= self.x[0]:
            return float(self.y[0])
        if x >= self.x[-1]:
            return float(self.y[-1])

        i = np.searchsorted(self.x, x) - 1
        i = max(0, min(i, self.n - 2))

        h = self.x[i+1] - self.x[i]
        t = (x - self.x[i]) / h

        # Hermite basis functions
        h00 = 2*t**3 - 3*t**2 + 1
        h10 = t**3 - 2*t**2 + t
        h01 = -2*t**3 + 3*t**2
        h11 = t**3 - t**2

        return float(h00*self.y[i] + h10*h*self.m[i] + h01*self.y[i+1] + h11*h*self.m[i+1])


class ClimateInterpolator:
    """
    Multi-variable climate state interpolator.

    Uses appropriate interpolation methods for different climate variables:
    - Sea level: Cubic spline (smooth transitions)
    - Temperature: Cubic spline (smooth transitions)
    - Ice coverage: Monotonic (bounded percentage)
    - CO2: Cubic spline
    """

    def __init__(self, time_periods: List[Dict], method: InterpolationMethod = InterpolationMethod.CUBIC_SPLINE):
        """
        Initialize climate interpolator from time period data.

        Args:
            time_periods: List of time period dictionaries with climate data
            method: Interpolation method to use
        """
        self.method = method
        self.time_periods = sorted(time_periods, key=lambda x: x["year"])

        # Extract data arrays
        years = [p["year"] for p in self.time_periods]
        sea_levels = [p["sea_level_m"] for p in self.time_periods]
        temps = [p["global_temp_c"] for p in self.time_periods]
        ice = [p["ice_coverage_pct"] for p in self.time_periods]

        # Create interpolators
        if method == InterpolationMethod.LINEAR:
            self._interp_sea_level = self._create_linear_interpolator(years, sea_levels)
            self._interp_temp = self._create_linear_interpolator(years, temps)
            self._interp_ice = self._create_linear_interpolator(years, ice)
        elif method == InterpolationMethod.PCHIP:
            self._interp_sea_level = MonotonicInterpolator(years, sea_levels)
            self._interp_temp = MonotonicInterpolator(years, temps)
            self._interp_ice = MonotonicInterpolator(years, ice)
        else:  # CUBIC_SPLINE or AKIMA (fallback to cubic)
            self._interp_sea_level = CubicSplineInterpolator(years, sea_levels)
            self._interp_temp = CubicSplineInterpolator(years, temps)
            # Use monotonic for ice coverage to prevent overshoot beyond 0-100%
            self._interp_ice = MonotonicInterpolator(years, ice)

        # CO2 interpolator if data available
        if all("co2_ppm" in p for p in self.time_periods):
            co2 = [p["co2_ppm"] for p in self.time_periods]
            if method == InterpolationMethod.PCHIP:
                self._interp_co2 = MonotonicInterpolator(years, co2)
            else:
                self._interp_co2 = CubicSplineInterpolator(years, co2)
        else:
            self._interp_co2 = None

        self.min_year = min(years)
        self.max_year = max(years)

    def _create_linear_interpolator(self, x: List[float], y: List[float]) -> Callable[[float], float]:
        """Create a simple linear interpolator function."""
        x_arr = np.array(x)
        y_arr = np.array(y)

        def interpolate(val: float) -> float:
            return float(np.interp(val, x_arr, y_arr))

        return interpolate

    def interpolate(self, year: int) -> ClimateState:
        """
        Interpolate climate state for a given year.

        Args:
            year: Year to interpolate (negative for past)

        Returns:
            Interpolated ClimateState
        """
        # Clamp year to valid range
        year = max(self.min_year, min(self.max_year, year))

        sea_level = self._interp_sea_level(year)
        temp = self._interp_temp(year)
        ice = self._interp_ice(year)

        # Clamp ice coverage to valid range
        ice = max(0.0, min(100.0, ice))

        co2 = None
        if self._interp_co2 is not None:
            co2 = max(0.0, self._interp_co2(year))

        return ClimateState(
            year=year,
            sea_level_m=round(sea_level, 2),
            global_temp_c=round(temp, 2),
            ice_coverage_pct=round(ice, 2),
            co2_ppm=round(co2, 1) if co2 is not None else None
        )

    def get_rate_of_change(self, year: int) -> Dict[str, float]:
        """
        Get rate of change of climate variables at a given year.

        Args:
            year: Year to evaluate

        Returns:
            Dictionary with rates of change per year
        """
        if not isinstance(self._interp_sea_level, CubicSplineInterpolator):
            # Fall back to numerical differentiation
            epsilon = 100  # 100 years
            state1 = self.interpolate(year - epsilon)
            state2 = self.interpolate(year + epsilon)
            return {
                "sea_level_m_per_year": (state2.sea_level_m - state1.sea_level_m) / (2 * epsilon),
                "temp_c_per_year": (state2.global_temp_c - state1.global_temp_c) / (2 * epsilon),
                "ice_pct_per_year": (state2.ice_coverage_pct - state1.ice_coverage_pct) / (2 * epsilon),
            }

        return {
            "sea_level_m_per_year": self._interp_sea_level.derivative(year),
            "temp_c_per_year": self._interp_temp.derivative(year),
            "ice_pct_per_year": 0.0,  # Monotonic doesn't support derivatives easily
        }


def interpolate_climate_state(
    year: int,
    time_periods: List[Dict],
    method: str = "cubic_spline"
) -> ClimateState:
    """
    Convenience function to interpolate climate state.

    Args:
        year: Target year (negative for past)
        time_periods: List of known time period data
        method: Interpolation method name

    Returns:
        Interpolated ClimateState
    """
    method_enum = InterpolationMethod(method)
    interpolator = ClimateInterpolator(time_periods, method_enum)
    return interpolator.interpolate(year)


def get_interpolation_method(name: str) -> InterpolationMethod:
    """
    Get interpolation method enum from string name.

    Args:
        name: Method name (linear, cubic_spline, pchip, akima)

    Returns:
        InterpolationMethod enum value
    """
    try:
        return InterpolationMethod(name)
    except ValueError:
        return InterpolationMethod.CUBIC_SPLINE
