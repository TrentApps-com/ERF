/**
 * ERF API Client
 * Handles all API calls to the backend for climate and paleogeography data
 */

const API_BASE = '/api';

/**
 * Fetch Earth state for a given year
 * @param {number} year - Year (negative for past, e.g., -20000)
 * @returns {Promise<Object>} Earth state with sea_level_m, global_temp_c, ice_coverage_pct
 */
export async function getEarthState(year) {
  try {
    const response = await fetch(`${API_BASE}/earth/state/${year}`);
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to fetch Earth state:', error);
    // Return estimated fallback data based on year
    return getFallbackState(year);
  }
}

/**
 * Fetch all defined time periods with climate data
 * @returns {Promise<Object>} Object containing periods array
 */
export async function getTimePeriods() {
  try {
    const response = await fetch(`${API_BASE}/periods`);
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to fetch time periods:', error);
    return { periods: getFallbackPeriods() };
  }
}

/**
 * Health check for API
 * @returns {Promise<boolean>} True if API is healthy
 */
export async function checkApiHealth() {
  try {
    const response = await fetch(`${API_BASE}/health`);
    return response.ok;
  } catch (error) {
    console.warn('API health check failed:', error);
    return false;
  }
}

/**
 * Fetch Earth texture information for a given year
 * @param {number} year - Year
 * @param {string} resolution - Resolution level (low, medium, high)
 * @returns {Promise<Object>} Texture information
 */
export async function getEarthTexture(year, resolution = 'medium') {
  try {
    const response = await fetch(`${API_BASE}/earth/texture/${year}?resolution=${resolution}`);
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to fetch Earth texture:', error);
    return null;
  }
}

/**
 * Fallback Earth state when API is unavailable
 * Uses interpolation based on known climate data
 */
function getFallbackState(year) {
  const knownStates = getFallbackPeriods();

  // Sort by year descending
  const sorted = knownStates.sort((a, b) => b.year - a.year);

  // Find bracketing periods
  let upper = sorted[0];
  let lower = sorted[sorted.length - 1];

  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].year <= year) {
      upper = sorted[i];
      lower = i > 0 ? sorted[i - 1] : sorted[i];
      break;
    }
  }

  if (upper.year === lower.year) {
    return { ...upper };
  }

  // Linear interpolation
  const t = (year - lower.year) / (upper.year - lower.year);

  return {
    year,
    sea_level_m: lower.sea_level_m + t * (upper.sea_level_m - lower.sea_level_m),
    global_temp_c: lower.global_temp_c + t * (upper.global_temp_c - lower.global_temp_c),
    ice_coverage_pct: lower.ice_coverage_pct + t * (upper.ice_coverage_pct - lower.ice_coverage_pct),
  };
}

/**
 * Fallback periods data matching backend TIME_PERIODS
 */
function getFallbackPeriods() {
  return [
    {
      year: 0,
      name: 'Present Day',
      sea_level_m: 0,
      global_temp_c: 0,
      ice_coverage_pct: 10.0
    },
    {
      year: -12000,
      name: 'End of Last Ice Age',
      sea_level_m: -60,
      global_temp_c: -4,
      ice_coverage_pct: 25.0
    },
    {
      year: -20000,
      name: 'Last Glacial Maximum',
      sea_level_m: -120,
      global_temp_c: -6,
      ice_coverage_pct: 30.0
    },
    {
      year: -130000,
      name: 'Eemian Interglacial',
      sea_level_m: 6,
      global_temp_c: 2,
      ice_coverage_pct: 8.0
    },
    {
      year: -400000,
      name: 'Marine Isotope Stage 11',
      sea_level_m: 10,
      global_temp_c: 2.5,
      ice_coverage_pct: 7.0
    }
  ];
}

export default {
  getEarthState,
  getTimePeriods,
  checkApiHealth,
  getEarthTexture
};
