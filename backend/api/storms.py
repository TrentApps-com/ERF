"""
Historical Storm Data Module
Fetches and serves IBTrACS historical tropical cyclone data

Data Source: NOAA IBTrACS (International Best Track Archive for Climate Stewardship)
https://www.ncei.noaa.gov/products/international-best-track-archive
"""

import os
import csv
import json
import asyncio
import aiohttp
import re
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, asdict
from pathlib import Path
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def sanitize_csv_value(value: str, max_length: int = 500) -> str:
    """
    Sanitize a CSV value to prevent formula injection and other attacks.

    Args:
        value: The raw string value from CSV
        max_length: Maximum allowed length

    Returns:
        Sanitized string safe for use
    """
    if not value:
        return ""

    # Convert to string and strip whitespace
    value = str(value).strip()

    # Truncate to max length
    if len(value) > max_length:
        value = value[:max_length]

    # Remove formula injection characters at start
    # These can trigger code execution in spreadsheet applications
    formula_chars = ('=', '+', '-', '@', '\t', '\r', '\n')
    while value and value[0] in formula_chars:
        value = value[1:]

    # Remove null bytes and other control characters
    value = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', value)

    return value


def sanitize_numeric(value: str, default: float = 0.0, min_val: float = None, max_val: float = None) -> float:
    """
    Safely parse a numeric value from CSV with bounds checking.

    Args:
        value: The raw string value
        default: Default value if parsing fails
        min_val: Minimum allowed value (optional)
        max_val: Maximum allowed value (optional)

    Returns:
        Parsed and bounded float value
    """
    try:
        result = float(str(value).strip())
        if min_val is not None and result < min_val:
            return min_val
        if max_val is not None and result > max_val:
            return max_val
        return result
    except (ValueError, TypeError):
        return default

# IBTrACS data URLs
IBTRACS_BASE = "https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/csv"
IBTRACS_URLS = {
    "last3years": f"{IBTRACS_BASE}/ibtracs.last3years.list.v04r01.csv",
    "since1980": f"{IBTRACS_BASE}/ibtracs.since1980.list.v04r01.csv",
    "atlantic": f"{IBTRACS_BASE}/ibtracs.NA.list.v04r01.csv",
    "pacific_west": f"{IBTRACS_BASE}/ibtracs.WP.list.v04r01.csv",
    "pacific_east": f"{IBTRACS_BASE}/ibtracs.EP.list.v04r01.csv",
}

# Local data directory
DATA_DIR = Path(__file__).parent.parent / "data" / "storms"


@dataclass
class StormTrackPoint:
    """A single point in a storm's track"""
    timestamp: str
    lat: float
    lon: float
    wind_kts: Optional[float]
    pressure_mb: Optional[float]
    category: int
    storm_type: str
    # Enhanced fields
    dist2land_km: Optional[float] = None
    is_landfall: bool = False
    storm_speed_kts: Optional[float] = None
    storm_dir: Optional[float] = None
    r34_ne: Optional[float] = None  # 34kt wind radius NE quadrant (nm)
    r34_se: Optional[float] = None
    r34_sw: Optional[float] = None
    r34_nw: Optional[float] = None
    rmw: Optional[float] = None  # Radius of max wind (nm)
    eye_diameter: Optional[float] = None


@dataclass
class LandfallEvent:
    """A landfall event during storm lifecycle"""
    timestamp: str
    lat: float
    lon: float
    wind_kts: float
    pressure_mb: Optional[float]
    category: int
    location_name: Optional[str] = None


@dataclass
class HistoricalStorm:
    """A complete historical storm record"""
    id: str
    name: str
    basin: str
    year: int
    start_date: str
    end_date: str
    peak_wind_kts: float
    min_pressure_mb: Optional[float]
    peak_category: int
    track: List[StormTrackPoint]
    deaths: Optional[int] = None
    damage_usd: Optional[float] = None
    is_notable: bool = False
    # Enhanced fields
    genesis_lat: Optional[float] = None
    genesis_lon: Optional[float] = None
    genesis_type: Optional[str] = None  # How storm formed
    peak_lat: Optional[float] = None
    peak_lon: Optional[float] = None
    landfalls: List[LandfallEvent] = None
    duration_hours: Optional[float] = None
    ace: Optional[float] = None  # Accumulated Cyclone Energy
    max_size_r34: Optional[float] = None  # Maximum extent of 34kt winds
    rapid_intensification: bool = False  # Had RI event (30kt+ in 24h)
    affected_areas: List[str] = None

    def __post_init__(self):
        if self.landfalls is None:
            self.landfalls = []
        if self.affected_areas is None:
            self.affected_areas = []


# Notable historical storms with metadata
# IDs are IBTrACS SID format: YYYYDDDNxxYYY (Year, Day of year, hemisphere, position)
NOTABLE_STORMS = {
    # Recent notable storms (in last3years dataset) - IDs verified against actual data
    "2024279N21265": {  # Milton 2024
        "display_name": "Hurricane Milton",
        "deaths": 24,
        "damage_usd": 50e9,
        "description": "Rapidly intensified Category 5, struck Florida's Gulf Coast",
    },
    "2024268N17278": {  # Helene 2024 - CORRECTED ID
        "display_name": "Hurricane Helene",
        "deaths": 232,
        "damage_usd": 53e9,
        "description": "Deadliest mainland US hurricane since Katrina",
    },
    "2024181N09320": {  # Beryl 2024 - CORRECTED ID
        "display_name": "Hurricane Beryl",
        "deaths": 62,
        "damage_usd": 6e9,
        "description": "Earliest Category 5 Atlantic hurricane on record",
    },
    "2023239N21274": {  # Idalia 2023 - CORRECTED ID
        "display_name": "Hurricane Idalia",
        "deaths": 7,
        "damage_usd": 3.6e9,
        "description": "Major hurricane that struck Florida's Big Bend region",
    },
    "2023249N12320": {  # Lee 2023 - CORRECTED ID
        "display_name": "Hurricane Lee",
        "deaths": 5,
        "damage_usd": 80e6,
        "description": "Large and powerful Category 5 hurricane in open Atlantic",
    },
    "2022266N12294": {  # Ian 2022 - CORRECTED ID
        "display_name": "Hurricane Ian",
        "deaths": 161,
        "damage_usd": 113e9,
        "description": "Category 5 hurricane, one of the costliest US disasters",
    },
    "2022257N16312": {  # Fiona 2022 - CORRECTED ID
        "display_name": "Hurricane Fiona",
        "deaths": 41,
        "damage_usd": 3.7e9,
        "description": "Strongest storm on record to hit Atlantic Canada",
    },
    # Classic notable storms (would need since1980 dataset to be loaded)
    # Keep for reference - these would work if since1980 data is loaded
    # "2005236N23285": {  # Katrina
    #     "display_name": "Hurricane Katrina",
    #     "deaths": 1836,
    #     "damage_usd": 125e9,
    #     "description": "One of the deadliest and costliest hurricanes in US history",
    # },
}


class StormDataManager:
    """Manages historical storm data from IBTrACS"""

    def __init__(self):
        self.storms: Dict[str, HistoricalStorm] = {}
        self.storms_by_year: Dict[int, List[str]] = {}
        self.storms_by_basin: Dict[str, List[str]] = {}
        self._loaded = False
        DATA_DIR.mkdir(parents=True, exist_ok=True)

    async def download_data(self, dataset: str = "last3years") -> bool:
        """Download IBTrACS CSV data"""
        url = IBTRACS_URLS.get(dataset, IBTRACS_URLS["last3years"])
        filepath = DATA_DIR / f"ibtracs_{dataset}.csv"

        logger.info(f"Downloading IBTrACS data from {url}")

        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=120)) as response:
                    if response.status == 200:
                        content = await response.text()
                        with open(filepath, 'w') as f:
                            f.write(content)
                        logger.info(f"Downloaded {len(content)} bytes to {filepath}")
                        return True
                    else:
                        logger.error(f"Failed to download: HTTP {response.status}")
                        return False
        except Exception as e:
            logger.error(f"Download error: {e}")
            return False

    def load_csv_data(self, dataset: str = "last3years") -> bool:
        """Load storm data from CSV file"""
        filepath = DATA_DIR / f"ibtracs_{dataset}.csv"

        if not filepath.exists():
            logger.warning(f"Data file not found: {filepath}")
            return False

        logger.info(f"Loading storm data from {filepath}")

        storms_data: Dict[str, Dict] = {}

        try:
            with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
                # Skip header rows (IBTrACS has 2 header rows)
                reader = csv.DictReader(f)

                for row in reader:
                    try:
                        storm_id = sanitize_csv_value(row.get('SID', ''), max_length=50)
                        if not storm_id or storm_id == 'SID':
                            continue

                        # Parse track point with bounds checking
                        lat_raw = row.get('LAT', '')
                        lon_raw = row.get('LON', '')

                        # Validate lat/lon are present and within valid ranges
                        try:
                            lat = sanitize_numeric(lat_raw, default=None, min_val=-90, max_val=90)
                            lon = sanitize_numeric(lon_raw, default=None, min_val=-180, max_val=180)
                        except:
                            lat = None
                            lon = None

                        if lat is None or lon is None:
                            continue

                        # Parse wind and pressure with reasonable bounds
                        wind_raw = row.get('USA_WIND', row.get('WMO_WIND', ''))
                        pressure_raw = row.get('USA_PRES', row.get('WMO_PRES', ''))

                        wind = self._parse_float(wind_raw)
                        if wind is not None:
                            wind = max(0, min(wind, 300))  # Reasonable wind bounds (0-300 kts)

                        pressure = self._parse_float(pressure_raw)
                        if pressure is not None:
                            pressure = max(800, min(pressure, 1100))  # Reasonable pressure bounds (800-1100 mb)

                        # Determine category from wind speed
                        category = self._wind_to_category(wind)

                        # Parse enhanced fields
                        dist2land = self._parse_float(row.get('DIST2LAND', ''))
                        landfall_dist = self._parse_float(row.get('LANDFALL', ''))
                        storm_speed = self._parse_float(row.get('STORM_SPEED', ''))
                        storm_dir = self._parse_float(row.get('STORM_DIR', ''))
                        r34_ne = self._parse_float(row.get('USA_R34_NE', ''))
                        r34_se = self._parse_float(row.get('USA_R34_SE', ''))
                        r34_sw = self._parse_float(row.get('USA_R34_SW', ''))
                        r34_nw = self._parse_float(row.get('USA_R34_NW', ''))
                        rmw = self._parse_float(row.get('USA_RMW', ''))
                        eye = self._parse_float(row.get('USA_EYE', ''))

                        # Detect landfall (distance <= 0 or record type 'L')
                        usa_record = sanitize_csv_value(row.get('USA_RECORD', ''), max_length=20)
                        is_landfall = (landfall_dist is not None and landfall_dist <= 0) or 'L' in usa_record

                        # Sanitize timestamp and storm type
                        timestamp = sanitize_csv_value(row.get('ISO_TIME', ''), max_length=30)
                        storm_type = sanitize_csv_value(
                            row.get('USA_STATUS', row.get('NATURE', 'TS')),
                            max_length=20
                        )

                        track_point = StormTrackPoint(
                            timestamp=timestamp,
                            lat=lat,
                            lon=lon,
                            wind_kts=wind,
                            pressure_mb=pressure,
                            category=category,
                            storm_type=storm_type,
                            dist2land_km=dist2land,
                            is_landfall=is_landfall,
                            storm_speed_kts=storm_speed,
                            storm_dir=storm_dir,
                            r34_ne=r34_ne,
                            r34_se=r34_se,
                            r34_sw=r34_sw,
                            r34_nw=r34_nw,
                            rmw=rmw,
                            eye_diameter=eye
                        )

                        # Initialize or update storm record
                        if storm_id not in storms_data:
                            # Sanitize text fields
                            storm_name = sanitize_csv_value(
                                row.get('NAME', 'UNNAMED'),
                                max_length=100
                            ) or 'UNNAMED'
                            basin = sanitize_csv_value(
                                row.get('BASIN', 'NA'),
                                max_length=10
                            ) or 'NA'
                            genesis_type = sanitize_csv_value(
                                row.get('NATURE', 'TS'),
                                max_length=20
                            ) or 'TS'

                            # Sanitize year with bounds
                            try:
                                year = int(sanitize_numeric(
                                    row.get('SEASON', '2000'),
                                    default=2000,
                                    min_val=1800,
                                    max_val=2100
                                ))
                            except:
                                year = 2000

                            storms_data[storm_id] = {
                                'id': storm_id,
                                'name': storm_name,
                                'basin': basin,
                                'year': year,
                                'start_date': timestamp,
                                'end_date': timestamp,
                                'peak_wind_kts': wind or 0,
                                'min_pressure_mb': pressure,
                                'peak_category': category,
                                'track': [],
                                'genesis_lat': lat,
                                'genesis_lon': lon,
                                'genesis_type': genesis_type,
                                'peak_lat': lat,
                                'peak_lon': lon,
                                'landfalls': [],
                                'max_size_r34': 0,
                                'ace_sum': 0,
                                'prev_wind': None,
                                'prev_time': None,
                                'max_intensification': 0
                            }
                        else:
                            # Update peak values and location
                            if wind and wind > storms_data[storm_id]['peak_wind_kts']:
                                storms_data[storm_id]['peak_wind_kts'] = wind
                                storms_data[storm_id]['peak_category'] = category
                                storms_data[storm_id]['peak_lat'] = lat
                                storms_data[storm_id]['peak_lon'] = lon
                            if pressure and (storms_data[storm_id]['min_pressure_mb'] is None or
                                           pressure < storms_data[storm_id]['min_pressure_mb']):
                                storms_data[storm_id]['min_pressure_mb'] = pressure
                            storms_data[storm_id]['end_date'] = timestamp

                        # Track max storm size (average of 34kt radii)
                        if r34_ne and r34_se and r34_sw and r34_nw:
                            avg_r34 = (r34_ne + r34_se + r34_sw + r34_nw) / 4
                            if avg_r34 > storms_data[storm_id].get('max_size_r34', 0):
                                storms_data[storm_id]['max_size_r34'] = avg_r34

                        # Calculate ACE contribution (only for TS+ intensity, every 6 hours)
                        if wind and wind >= 34:
                            # ACE = sum of (V^2 / 10000) for 6-hourly points
                            storms_data[storm_id]['ace_sum'] = storms_data[storm_id].get('ace_sum', 0) + (wind ** 2) / 10000

                        # Track rapid intensification (30kt+ gain in ~24h window)
                        prev_wind = storms_data[storm_id].get('prev_wind')
                        if wind and prev_wind:
                            intensification = wind - prev_wind
                            if intensification > storms_data[storm_id].get('max_intensification', 0):
                                storms_data[storm_id]['max_intensification'] = intensification
                        storms_data[storm_id]['prev_wind'] = wind

                        # Record landfall events
                        if is_landfall and wind and wind >= 34:
                            landfall_event = {
                                'timestamp': timestamp,  # Already sanitized
                                'lat': lat,
                                'lon': lon,
                                'wind_kts': wind,
                                'pressure_mb': pressure,
                                'category': category,
                                'location_name': self._get_landfall_location(lat, lon)
                            }
                            storms_data[storm_id]['landfalls'].append(landfall_event)

                        storms_data[storm_id]['track'].append(track_point)

                    except Exception as e:
                        continue  # Skip malformed rows

            # Convert to HistoricalStorm objects and index
            for storm_id, data in storms_data.items():
                # Add notable storm metadata
                if storm_id in NOTABLE_STORMS:
                    notable = NOTABLE_STORMS[storm_id]
                    data['name'] = notable.get('display_name', data['name'])
                    data['deaths'] = notable.get('deaths')
                    data['damage_usd'] = notable.get('damage_usd')
                    data['is_notable'] = True

                # Calculate duration
                try:
                    start = datetime.fromisoformat(data['start_date'].replace(' ', 'T'))
                    end = datetime.fromisoformat(data['end_date'].replace(' ', 'T'))
                    data['duration_hours'] = (end - start).total_seconds() / 3600
                except:
                    data['duration_hours'] = None

                # Set ACE and rapid intensification
                data['ace'] = round(data.get('ace_sum', 0), 1)
                data['rapid_intensification'] = data.get('max_intensification', 0) >= 30

                # Convert landfalls to LandfallEvent objects
                landfall_events = []
                for lf in data.get('landfalls', []):
                    try:
                        landfall_events.append(LandfallEvent(**lf))
                    except:
                        pass
                data['landfalls'] = landfall_events

                # Get affected areas from landfalls
                data['affected_areas'] = list(set(
                    lf.location_name for lf in landfall_events
                    if lf.location_name
                ))

                # Clean up temporary fields
                for key in ['ace_sum', 'prev_wind', 'prev_time', 'max_intensification']:
                    data.pop(key, None)

                storm = HistoricalStorm(**data)
                self.storms[storm_id] = storm

                # Index by year
                if storm.year not in self.storms_by_year:
                    self.storms_by_year[storm.year] = []
                self.storms_by_year[storm.year].append(storm_id)

                # Index by basin
                if storm.basin not in self.storms_by_basin:
                    self.storms_by_basin[storm.basin] = []
                self.storms_by_basin[storm.basin].append(storm_id)

            self._loaded = True
            logger.info(f"Loaded {len(self.storms)} storms")
            return True

        except Exception as e:
            logger.error(f"Error loading CSV: {e}")
            return False

    def _parse_float(self, value: str) -> Optional[float]:
        """Safely parse float from string"""
        if not value or value.strip() == '' or value.strip() == ' ':
            return None
        try:
            return float(value.strip())
        except (ValueError, TypeError):
            return None

    def _wind_to_category(self, wind_kts: Optional[float]) -> int:
        """Convert wind speed to Saffir-Simpson category"""
        if wind_kts is None:
            return 0
        if wind_kts < 34:
            return -1  # Tropical depression
        if wind_kts < 64:
            return 0  # Tropical storm
        if wind_kts < 83:
            return 1
        if wind_kts < 96:
            return 2
        if wind_kts < 113:
            return 3
        if wind_kts < 137:
            return 4
        return 5

    def _get_landfall_location(self, lat: float, lon: float) -> Optional[str]:
        """Get approximate landfall location name based on coordinates"""
        # Simplified location lookup based on lat/lon regions
        # This provides approximate locations - a full implementation would use reverse geocoding

        # North Atlantic / US East Coast
        if 24 <= lat <= 35 and -82 <= lon <= -75:
            if lat < 27:
                return "Florida"
            elif lat < 32:
                return "Georgia/South Carolina"
            else:
                return "North Carolina"

        # Gulf Coast
        if 25 <= lat <= 31 and -98 <= lon <= -82:
            if lon > -85:
                return "Florida Gulf Coast"
            elif lon > -90:
                return "Alabama/Mississippi"
            elif lon > -94:
                return "Louisiana"
            else:
                return "Texas"

        # Mexico
        if 15 <= lat <= 28 and -100 <= lon <= -85:
            if lat > 23:
                return "Northern Mexico"
            else:
                return "Yucatan Peninsula"

        # Caribbean
        if 10 <= lat <= 25 and -85 <= lon <= -60:
            if lon > -65:
                return "Puerto Rico/Virgin Islands"
            elif lon > -75:
                return "Hispaniola"
            elif lon > -80:
                return "Jamaica/Cuba"
            else:
                return "Central America"

        # Western Pacific
        if 10 <= lat <= 35 and 120 <= lon <= 145:
            if lat > 30:
                return "Japan"
            elif lon < 125:
                return "Philippines"
            elif lat > 20:
                return "Taiwan"
            else:
                return "Western Pacific Islands"

        # Indian Ocean
        if -25 <= lat <= 25 and 50 <= lon <= 100:
            if lat > 10:
                return "India/Bangladesh"
            elif lon > 80:
                return "Bay of Bengal"
            else:
                return "Arabian Sea"

        # Australia
        if -30 <= lat <= -10 and 110 <= lon <= 160:
            return "Australia"

        return None

    def get_storm(self, storm_id: str) -> Optional[Dict]:
        """Get a single storm by ID"""
        storm = self.storms.get(storm_id)
        if storm:
            return self._storm_to_dict(storm)
        return None

    def get_storms_by_year(self, year: int) -> List[Dict]:
        """Get all storms for a given year"""
        storm_ids = self.storms_by_year.get(year, [])
        return [self._storm_to_dict(self.storms[sid]) for sid in storm_ids]

    def get_storms_by_basin(self, basin: str) -> List[Dict]:
        """Get all storms for a given basin"""
        storm_ids = self.storms_by_basin.get(basin.upper(), [])
        return [self._storm_to_dict(self.storms[sid]) for sid in storm_ids]

    def get_storms_at_time(self, timestamp: datetime, hours_window: int = 6) -> List[Dict]:
        """Get all storms active at a specific time"""
        active_storms = []

        for storm in self.storms.values():
            for point in storm.track:
                try:
                    point_time = datetime.fromisoformat(point.timestamp.replace(' ', 'T'))
                    time_diff = abs((point_time - timestamp).total_seconds() / 3600)

                    if time_diff <= hours_window:
                        # Return storm with interpolated position
                        storm_dict = self._storm_to_dict(storm)
                        storm_dict['current_position'] = {
                            'lat': point.lat,
                            'lon': point.lon,
                            'wind_kts': point.wind_kts,
                            'pressure_mb': point.pressure_mb,
                            'category': point.category
                        }
                        active_storms.append(storm_dict)
                        break
                except:
                    continue

        return active_storms

    def get_notable_storms(self) -> List[Dict]:
        """Get all notable/famous storms"""
        notable = []
        for storm_id in NOTABLE_STORMS.keys():
            if storm_id in self.storms:
                notable.append(self._storm_to_dict(self.storms[storm_id]))
        return notable

    def search_storms(self, name: str) -> List[Dict]:
        """Search storms by name"""
        name_lower = name.lower()
        results = []
        for storm in self.storms.values():
            if name_lower in storm.name.lower():
                results.append(self._storm_to_dict(storm))
        return results[:50]  # Limit results

    def get_available_years(self) -> List[int]:
        """Get list of years with storm data"""
        return sorted(self.storms_by_year.keys(), reverse=True)

    def _storm_to_dict(self, storm: HistoricalStorm) -> Dict:
        """Convert storm to dictionary for JSON response"""
        # Get genesis location name
        genesis_location = None
        if storm.genesis_lat and storm.genesis_lon:
            genesis_location = self._get_genesis_description(
                storm.genesis_lat, storm.genesis_lon, storm.basin
            )

        # Get peak location name
        peak_location = None
        if storm.peak_lat and storm.peak_lon:
            peak_location = self._get_peak_description(
                storm.peak_lat, storm.peak_lon, storm.basin
            )

        return {
            'id': storm.id,
            'name': storm.name,
            'basin': storm.basin,
            'basin_name': self._get_basin_name(storm.basin),
            'year': storm.year,
            'start_date': storm.start_date,
            'end_date': storm.end_date,
            'duration_hours': storm.duration_hours,
            'duration_days': round(storm.duration_hours / 24, 1) if storm.duration_hours else None,
            'peak_wind_kts': storm.peak_wind_kts,
            'peak_wind_mph': round(storm.peak_wind_kts * 1.151) if storm.peak_wind_kts else None,
            'peak_wind_kmh': round(storm.peak_wind_kts * 1.852) if storm.peak_wind_kts else None,
            'min_pressure_mb': storm.min_pressure_mb,
            'peak_category': storm.peak_category,
            'category_name': self._get_category_name(storm.peak_category),
            # Genesis info
            'genesis_lat': storm.genesis_lat,
            'genesis_lon': storm.genesis_lon,
            'genesis_type': storm.genesis_type,
            'genesis_location': genesis_location,
            # Peak info
            'peak_lat': storm.peak_lat,
            'peak_lon': storm.peak_lon,
            'peak_location': peak_location,
            # Landfalls
            'landfalls': [asdict(lf) for lf in storm.landfalls] if storm.landfalls else [],
            'landfall_count': len(storm.landfalls) if storm.landfalls else 0,
            'affected_areas': storm.affected_areas or [],
            # Storm metrics
            'ace': storm.ace,
            'max_size_r34_nm': storm.max_size_r34,
            'max_size_r34_km': round(storm.max_size_r34 * 1.852) if storm.max_size_r34 else None,
            'rapid_intensification': storm.rapid_intensification,
            # Impact data
            'deaths': storm.deaths,
            'damage_usd': storm.damage_usd,
            'is_notable': storm.is_notable,
            # Track data
            'track_points': len(storm.track),
            'track': [asdict(p) for p in storm.track]
        }

    def _get_basin_name(self, basin: str) -> str:
        """Get full basin name"""
        basins = {
            'NA': 'North Atlantic',
            'EP': 'Eastern Pacific',
            'WP': 'Western Pacific',
            'NI': 'North Indian Ocean',
            'SI': 'South Indian Ocean',
            'SP': 'South Pacific',
            'SA': 'South Atlantic'
        }
        return basins.get(basin, basin)

    def _get_category_name(self, category: int) -> str:
        """Get storm category name"""
        names = {
            -1: 'Tropical Depression',
            0: 'Tropical Storm',
            1: 'Category 1 Hurricane',
            2: 'Category 2 Hurricane',
            3: 'Category 3 Major Hurricane',
            4: 'Category 4 Major Hurricane',
            5: 'Category 5 Major Hurricane'
        }
        return names.get(category, 'Unknown')

    def _get_genesis_description(self, lat: float, lon: float, basin: str) -> str:
        """Get description of where storm formed"""
        if basin == 'NA':
            if lon < -60:
                return "Western Atlantic"
            elif lon < -40:
                return "Central Atlantic"
            elif lon < -20:
                return "Eastern Atlantic / Cape Verde"
            else:
                return "Far Eastern Atlantic"
        elif basin == 'EP':
            return "Eastern Pacific off Mexico"
        elif basin == 'WP':
            if lon < 130:
                return "South China Sea"
            elif lon < 145:
                return "Philippine Sea"
            else:
                return "Western Pacific Ocean"
        elif basin in ['NI', 'SI']:
            if lon < 80:
                return "Arabian Sea"
            else:
                return "Bay of Bengal"
        elif basin == 'SP':
            return "South Pacific Ocean"
        return f"Ocean ({lat:.1f}°, {lon:.1f}°)"

    def _get_peak_description(self, lat: float, lon: float, basin: str) -> str:
        """Get description of where storm reached peak intensity"""
        # Check if over land (very rough approximation)
        if self._get_landfall_location(lat, lon):
            return f"Near {self._get_landfall_location(lat, lon)}"

        # Otherwise describe ocean location
        if basin == 'NA':
            if lat < 20:
                return "Caribbean Sea"
            elif lon > -70:
                return "Western Atlantic"
            else:
                return "Gulf of Mexico" if lon > -90 else "Central Atlantic"
        elif basin == 'WP':
            return "Western Pacific Ocean"
        elif basin == 'EP':
            return "Eastern Pacific Ocean"

        return f"Open Ocean ({lat:.1f}°, {lon:.1f}°)"


# Global instance
storm_manager = StormDataManager()


async def initialize_storm_data():
    """Initialize storm data on startup"""
    # Try to load from cache first
    if storm_manager.load_csv_data("last3years"):
        return True

    # Download if not available
    if await storm_manager.download_data("last3years"):
        return storm_manager.load_csv_data("last3years")

    return False
