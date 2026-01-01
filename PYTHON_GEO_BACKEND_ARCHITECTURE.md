# Python Backend Architecture for 3D Globe Geological/Geographical Data Visualization

## Executive Summary

This document provides comprehensive architecture recommendations for a Python backend serving time-varying Earth surface data (paleoclimate, paleography, elevation, etc.) to a WebGL frontend for 3D globe visualization. The architecture emphasizes scalability, performance, and efficient handling of large multidimensional datasets.

---

## 1. Data Processing Layer

### 1.1 Geospatial Data Processing Libraries

#### **GDAL (Geospatial Data Abstraction Library)** - Foundation Layer
- **Purpose**: Unified interface for reading/writing 150+ raster and 100+ vector geospatial formats
- **Key Capabilities**:
  - Raster formats: GeoTIFF, JPEG2000, HDF4/5, NetCDF, Cloud Optimized GeoTIFF (COG)
  - Vector formats: Shapefile, GeoJSON, GeoPackage, PostGIS
  - Coordinate projection and SRS operations
  - Multidimensional raster handling
  - Geographic network data processing
- **Use Cases**:
  - Ingesting paleoclimate NetCDF files
  - Converting between coordinate reference systems
  - Handling elevation/bathymetry datasets
  - Processing scientific gridded data

#### **Rasterio** - Python Raster Interface
- **Purpose**: Pythonic interface to GDAL for raster data with NumPy integration
- **Key Capabilities**:
  - Read/write gridded raster datasets
  - Windowed reading (crucial for large datasets)
  - Coordinate transformation
  - Spatial indexing
  - Efficient memory management
- **Performance Benefits**:
  - Windowed reading loads only required portions into memory
  - Lazy loading of remote data (S3, HTTP)
  - Support for Cloud Optimized GeoTIFF (COG)
- **Recommended Usage**:
  - Loading elevation data for heightmap generation
  - Reading satellite imagery
  - Processing time-series raster data
  - Streaming data to frontend without full dataset loading

#### **Shapely** - Geometry Operations
- **Purpose**: Geometric manipulation and analysis on planar features
- **Key Capabilities**:
  - Geometry properties and creation
  - Spatial predicates (intersects, contains, within)
  - Set operations (union, intersection, difference)
  - Buffering and simplification
  - STRtree spatial indexing
  - WKT/WKB serialization
- **Use Cases**:
  - Processing continental boundaries for paleography
  - Polygon simplification for faster rendering
  - Spatial queries on geological features

#### **GeoPandas** - Tabular Geospatial Analysis
- **Purpose**: Pandas-like interface for vector geospatial data
- **Key Capabilities**:
  - Spatial data types with geometry columns
  - Geometric operations and spatial joins
  - File I/O for multiple formats (via pyogrio)
  - Integration with Shapely
  - Matplotlib/folium visualization
- **Use Cases**:
  - Processing paleographic feature datasets
  - Analyzing geological boundary distributions
  - Exporting processed features to GeoJSON for frontend

#### **xarray** - Multidimensional Array Handling
- **Purpose**: Labeled, multidimensional array structures (ideal for climate data)
- **Key Capabilities**:
  - Named dimensions and coordinates
  - Efficient lazy loading
  - Time dimension support (perfect for temporal data)
  - Dataset/DataArray structures for complex data
  - Dask integration for large-scale parallel processing
- **Recommended Usage**:
  - Loading paleoclimate NetCDF files with time dimensions
  - Handling temperature/pressure/humidity time-series
  - Managing multi-variable datasets efficiently

#### **NetCDF / HDF5 Support**
- **Purpose**: Access to scientific data formats (paleoclimate archives)
- **Key Characteristics**:
  - NetCDF: Standard for atmospheric/oceanographic data
  - Self-describing, portable, scalable
  - Hierarchical data structure
  - Support for appending without restructuring
  - Python libraries: `netCDF4`, `h5py`
- **Use Cases**:
  - Reading paleoclimate models (PMIP, PAGES)
  - Accessing Earth System Model outputs
  - Time-varying multi-parameter datasets

### 1.2 Recommended Data Processing Stack

```python
# Core pipeline imports
import rasterio
from rasterio.io import MemoryFile
from rasterio.windows import Window
import xarray as xr
import numpy as np
import geopandas as gpd
from shapely.geometry import mapping
import rio_cogeo  # Cloud Optimized GeoTIFF

# Coordinate transformations
import pyproj
from pyproj import CRS, Transformer

# Data handling
import netCDF4
import h5py
```

---

## 2. Data Pipeline Architecture

### 2.1 Data Ingestion & Preprocessing

#### **Step 1: Data Source Integration**
```
Raw Sources:
├── NetCDF Files (paleoclimate: PMIP, PAGES, GCMs)
├── GeoTIFF / HDF5 (elevation, bathymetry, satellite data)
├── Shapefile (geological boundaries, continental features)
└── Vector Data (coastlines, fault lines, geological provinces)
```

#### **Step 2: Format Conversion Pipeline**

**For Elevation/Heightmap Data:**
1. Load elevation data with `rasterio` + `xarray.rioxarray`
2. Reproject to desired spatial reference system (e.g., WGS84)
3. Generate Cloud Optimized GeoTIFF using `rio-cogeo`:
   ```python
   from rio_cogeo.cogeo import cog_translate
   from rio_cogeo.profiles import cog_profiles

   cog_translate(
       source_path,
       output_path,
       dst_profile=cog_profiles['lzw'],  # or 'webp' for RGB
       overview_level=5,  # Create internal overviews
       overview_resampling='average'
   )
   ```

**For Paleoclimate NetCDF Data:**
1. Load time-series with `xarray`:
   ```python
   ds = xr.open_dataset('paleoclimate.nc')
   # Has dimensions: (time, lat, lon)
   ```
2. Optionally convert to Zarr for faster access:
   ```python
   ds.to_zarr('paleoclimate.zarr', mode='w')
   ```

**For Vector Features (Continents, Geology):**
1. Load with `geopandas`:
   ```python
   gdf = gpd.read_file('continents.shp')
   ```
2. Simplify geometries for frontend performance:
   ```python
   gdf['geometry'] = gdf.geometry.simplify(tolerance=0.5)  # degrees
   ```
3. Convert to GeoJSON for frontend:
   ```python
   geojson = gdf.to_geo_json()
   ```

#### **Step 3: Heightmap Generation for 3D**

For 3D globe visualization, convert elevation data to heightmap format:

```python
import rasterio
import numpy as np
from PIL import Image

def elevation_to_heightmap(dem_path, output_path):
    """Convert DEM to WebGL-compatible heightmap (16-bit PNG/TIF)"""
    with rasterio.open(dem_path) as src:
        elevation = src.read(1).astype(np.float32)

        # Normalize to 0-65535 (16-bit unsigned integer)
        min_elev = elevation.min()
        max_elev = elevation.max()
        normalized = ((elevation - min_elev) / (max_elev - min_elev)) * 65535

        # Convert to 16-bit
        heightmap_16bit = normalized.astype(np.uint16)

        # Save as GeoTIFF with same geospatial info
        profile = src.profile
        profile.update(dtype=rasterio.uint16, count=1, compression='lzw')

        with rasterio.open(output_path, 'w', **profile) as dst:
            dst.write(heightmap_16bit, 1)

        # Also save as PNG for web (lossy but compact)
        # Note: WebGL libraries can use equirectangular projection PNGs
        heightmap_8bit = (normalized / 256).astype(np.uint8)
        Image.fromarray(heightmap_8bit).save(output_path.replace('.tif', '.png'))
```

### 2.2 Tile Pyramid Generation

Generate tile pyramids for efficient multi-resolution serving using **TileCloud** or **GDAL utilities**:

```python
from tilecloud import Tile, TileStore
from tilecloud.ext.pyramid import BottomUpPyramid
from rio_cogeo import cog_translate

def generate_tile_pyramid(source_cog, output_dir, max_zoom=14):
    """
    Generate tile pyramid from Cloud Optimized GeoTIFF.

    Tile pyramid allows clients to:
    - Request only needed zoom level
    - Load low-resolution overviews first
    - Progressively refine as user zooms
    """
    # COGs already have internal overviews
    # Use GDAL's gdaladdo for additional pyramid levels
    import subprocess

    for zoom in range(max_zoom + 1):
        subprocess.run([
            'gdal_translate',
            '-co', 'COMPRESS=WEBP',
            '-co', 'TILED=YES',
            '-co', 'BLOCKXSIZE=256',
            '-co', 'BLOCKYSIZE=256',
            source_cog,
            f'{output_dir}/z{zoom}.tif'
        ])
```

**Alternative: Using TileCloud Python library:**
```python
from tilecloud import Tile
from tilecloud.ext.pyramid import BottomUpPyramid
import rasterio

def create_tiles_from_raster(raster_path, tile_dir, tile_size=256):
    """Create Web Mercator tiles from raster data"""
    with rasterio.open(raster_path) as src:
        # TileCloud handles projection to Web Mercator
        # and tile generation
        pyramid = BottomUpPyramid(tile_size)
        # Implementation details in TileCloud documentation
```

### 2.3 Time-Series Data Management

For animations over geologic time (paleoclimate):

```python
import xarray as xr
import numpy as np
from pathlib import Path

class PaleoclimateTimeSeries:
    def __init__(self, netcdf_path):
        self.ds = xr.open_dataset(netcdf_path)
        # Dimensions: (time, lat, lon)
        self.times = self.ds.time.values

    def get_frame(self, time_index):
        """Get single time slice (efficient)"""
        return self.ds.isel(time=time_index)

    def get_time_window(self, start_idx, end_idx):
        """Get range of time steps for animation"""
        return self.ds.isel(time=slice(start_idx, end_idx))

    def create_animation_frames(self, output_dir, decimation=1):
        """
        Pre-compute animation frames at lower resolution
        - decimation: factor to reduce resolution (speed vs quality)
        """
        for t_idx, time in enumerate(self.ds.time.values[::decimation]):
            frame = self.ds.isel(time=t_idx).coarsen(
                lat=decimation, lon=decimation
            ).mean()

            # Save as NetCDF or HDF5 for fast streaming
            frame.to_netcdf(f'{output_dir}/frame_{t_idx:04d}.nc')
```

---

## 3. Web Framework Architecture

### 3.1 Framework Selection

#### **Recommended: FastAPI**

**Rationale:**
- Native async/await support crucial for streaming large datasets
- Automatic OpenAPI documentation
- Type hints enable validation and serialization
- Performance on par with Node.js/Go
- Perfect for scientific data APIs

**Key Advantages for Geospatial Data:**
- StreamingResponse for large raster/vector data
- Efficient memory usage with generators
- Multiple concurrent client support
- Built-in gzip compression
- WebSocket support for real-time updates

#### **Alternative: Flask with async extensions**

**When to use:**
- Existing Flask codebase
- Simpler requirements
- Use with `quart` (async Flask equivalent)
- GeoAlchemy2 integration for PostGIS databases

### 3.2 FastAPI Architecture for Geological Data

```python
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import StreamingResponse, FileResponse
import xarray as xr
import rasterio
import geopandas as gpd
import numpy as np
from typing import Optional
import asyncio

app = FastAPI(
    title="Geological Data API",
    description="Serve time-varying Earth surface data for 3D globe visualization",
    version="1.0.0"
)

# Data sources (loaded once at startup)
elevation_data = None
paleoclimate_ts = None
continental_features = None

@app.on_event("startup")
async def load_data():
    """Load large datasets once at startup"""
    global elevation_data, paleoclimate_ts, continental_features

    elevation_data = rasterio.open('data/elevation.tif')
    paleoclimate_ts = xr.open_dataset('data/paleoclimate.nc')
    continental_features = gpd.read_file('data/continents.geojson')

@app.on_event("shutdown")
async def close_data():
    """Cleanup resources"""
    if elevation_data:
        elevation_data.close()

# ============================================================================
# ELEVATION / HEIGHTMAP ENDPOINTS
# ============================================================================

@app.get("/api/elevation/tile/{z}/{x}/{y}")
async def get_elevation_tile(z: int, x: int, y: int):
    """
    Get elevation tile at Web Mercator coordinates (z/x/y).
    Returns raster data as PNG or binary heightmap.

    Supports:
    - Progressive loading (low res first, then high res)
    - Efficient windowed reading from COG
    - Caching through HTTP headers
    """
    try:
        # Convert tile coordinates to bounding box
        from mercantile import Bbox
        bbox = mercantile.bounds(x, y, z)

        # Transform to raster's CRS (usually WGS84)
        from rasterio.windows import from_bounds
        window = from_bounds(bbox.west, bbox.south, bbox.east, bbox.north,
                             elevation_data.transform)

        # Read only required window (key to performance)
        elevation = elevation_data.read(1, window=window)

        # Normalize to 16-bit for heightmap
        min_val, max_val = elevation.min(), elevation.max()
        normalized = ((elevation - min_val) / (max_val - min_val)) * 65535
        heightmap = normalized.astype(np.uint16)

        # Return as binary PNG (or GeoTIFF)
        import io
        from PIL import Image

        img_array = (heightmap / 256).astype(np.uint8)
        img = Image.fromarray(img_array)

        img_bytes = io.BytesIO()
        img.save(img_bytes, format='PNG')
        img_bytes.seek(0)

        return StreamingResponse(
            iter([img_bytes.getvalue()]),
            media_type="image/png",
            headers={"Cache-Control": "public, max-age=86400"}
        )

    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/elevation/bounds")
async def get_elevation_bounds():
    """Get elevation dataset bounds and metadata"""
    return {
        "bounds": {
            "west": elevation_data.bounds.left,
            "south": elevation_data.bounds.bottom,
            "east": elevation_data.bounds.right,
            "north": elevation_data.bounds.top
        },
        "resolution": elevation_data.res,
        "crs": elevation_data.crs.to_string(),
        "shape": elevation_data.shape
    }

# ============================================================================
# PALEOCLIMATE / TIME-SERIES ENDPOINTS
# ============================================================================

@app.get("/api/paleoclimate/times")
async def get_available_times():
    """Get list of available time slices"""
    return {
        "times": paleoclimate_ts.time.values.tolist(),
        "count": len(paleoclimate_ts.time),
        "unit": "years before present"
    }

@app.get("/api/paleoclimate/slice/{time_index}")
async def get_paleoclimate_slice(
    time_index: int,
    variable: str = Query(..., description="Variable name (e.g., 'temperature')"),
    reduce: Optional[int] = Query(None, description="Reduce resolution by factor")
):
    """
    Get single time slice from paleoclimate dataset.

    Parameters:
    - time_index: Index into time dimension
    - variable: Which climate variable (temperature, precip, etc)
    - reduce: Optional decimation factor for faster transfer

    Returns: NetCDF or JSON representation
    """
    try:
        # Validate inputs
        if time_index < 0 or time_index >= len(paleoclimate_ts.time):
            raise HTTPException(status_code=400, detail="Invalid time_index")

        if variable not in paleoclimate_ts.data_vars:
            raise HTTPException(status_code=400, detail=f"Variable {variable} not found")

        # Get data
        data = paleoclimate_ts[variable].isel(time=time_index)

        # Apply decimation if requested
        if reduce and reduce > 1:
            data = data.coarsen(lat=reduce, lon=reduce).mean()

        # Convert to dict for JSON response
        response_data = {
            "time": str(paleoclimate_ts.time.values[time_index]),
            "variable": variable,
            "values": data.values.tolist(),
            "lat": data.lat.values.tolist(),
            "lon": data.lon.values.tolist(),
            "units": str(data.attrs.get('units', 'unknown')),
            "min": float(data.min()),
            "max": float(data.max())
        }

        return response_data

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/paleoclimate/animation")
async def stream_paleoclimate_animation(
    start_index: int,
    end_index: int,
    variable: str,
    decimation: int = 1
):
    """
    Stream animation frames (time-series).
    Efficient streaming using async generators.
    """
    async def generate():
        for t_idx in range(start_index, end_index + 1):
            data = paleoclimate_ts[variable].isel(time=t_idx)
            if decimation > 1:
                data = data.coarsen(lat=decimation, lon=decimation).mean()

            frame = {
                "frame": t_idx - start_index,
                "time": str(paleoclimate_ts.time.values[t_idx]),
                "values": data.values.tolist()
            }

            import json
            yield json.dumps(frame).encode() + b'\n'
            await asyncio.sleep(0)  # Yield control

    return StreamingResponse(generate(), media_type="application/x-ndjson")

# ============================================================================
# VECTOR FEATURES ENDPOINTS
# ============================================================================

@app.get("/api/features/continents")
async def get_continents_geojson():
    """Get continental boundaries as simplified GeoJSON"""
    # Simplify for frontend performance
    simplified = continental_features.copy()
    simplified['geometry'] = simplified.geometry.simplify(tolerance=0.5)

    return simplified.to_geo_json()

@app.get("/api/features/continents/by-time/{time_index}")
async def get_paleocontinents(time_index: int):
    """
    Get continental positions at specific geologic time.
    Assumes 'time' column in features dataset.
    """
    if 'time' not in continental_features.columns:
        raise HTTPException(status_code=400,
                           detail="Time data not available for features")

    time_features = continental_features[
        continental_features['time'] == time_index
    ]

    return time_features.to_geo_json()

# ============================================================================
# METADATA / DISCOVERY ENDPOINTS
# ============================================================================

@app.get("/api/metadata")
async def get_dataset_metadata():
    """Comprehensive dataset information for frontend"""
    return {
        "elevation": {
            "available": True,
            "bounds": elevation_data.bounds,
            "resolution": elevation_data.res[0],
            "max_zoom": 14
        },
        "paleoclimate": {
            "available": True,
            "variables": list(paleoclimate_ts.data_vars),
            "times": paleoclimate_ts.time.values.tolist(),
            "temporal_resolution": "years",
            "spatial_resolution": f"{paleoclimate_ts.lat.size} x {paleoclimate_ts.lon.size}"
        },
        "features": {
            "available": True,
            "feature_types": list(continental_features['type'].unique()),
            "count": len(continental_features)
        }
    }
```

---

## 4. Database Layer (Optional but Recommended)

### 4.1 PostGIS for Vector Data

For complex geological databases, use PostGIS + GeoAlchemy2:

```python
from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from geoalchemy2 import Geometry
from sqlalchemy import Column, Integer, String, Float

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = \
    'postgresql://user:password@localhost/geology_db'
db = SQLAlchemy(app)

class ContinentalPlate(db.Model):
    __tablename__ = 'continental_plates'

    id = Column(Integer, primary_key=True)
    name = Column(String)
    time_ma = Column(Float)  # Million years ago
    geometry = Column(Geometry('POLYGON', srid=4326))

# Or with FastAPI:
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

DATABASE_URL = "postgresql://user:password@localhost/geology_db"
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@app.get("/api/plates/{time_ma}")
async def get_plates_at_time(time_ma: float, db: Session = Depends(get_db)):
    plates = db.query(ContinentalPlate).filter(
        ContinentalPlate.time_ma == time_ma
    ).all()

    return [
        {
            "name": p.name,
            "geometry": db.session.scalar(
                func.ST_AsGeoJSON(p.geometry)
            )
        }
        for p in plates
    ]
```

### 4.2 Data Caching Strategy

For frequently accessed data:

```python
from functools import lru_cache
import redis
import json

# In-memory cache for small datasets
@lru_cache(maxsize=128)
def get_cached_geojson(feature_id: int):
    return continental_features[continental_features.id == feature_id].to_geo_json()

# Redis for larger/longer-lived cache
redis_client = redis.Redis(host='localhost', port=6379, db=0)

@app.get("/api/paleoclimate/cached/{time_index}")
async def get_cached_slice(time_index: int, variable: str):
    cache_key = f"paleoclimate:{variable}:{time_index}"

    # Check cache
    cached = redis_client.get(cache_key)
    if cached:
        return json.loads(cached)

    # Compute if not cached
    data = paleoclimate_ts[variable].isel(time=time_index)
    result = {
        "values": data.values.tolist(),
        "lat": data.lat.values.tolist(),
        "lon": data.lon.values.tolist()
    }

    # Cache for 1 hour
    redis_client.setex(cache_key, 3600, json.dumps(result))

    return result
```

---

## 5. Performance Optimization

### 5.1 Key Optimization Strategies

1. **Windowed Reading** (Rasterio)
   - Only load required data portions
   - Reduces memory footprint dramatically
   - Enables efficient serving of massive datasets

2. **Cloud Optimized GeoTIFF (COG)**
   - Internal tiling and overviews
   - HTTP range requests (ideal for cloud storage)
   - Efficient remote access

3. **Async Streaming** (FastAPI)
   - StreamingResponse for large data
   - Doesn't block on I/O
   - Multiple concurrent clients

4. **Tile Pyramids**
   - Progressive loading from coarse to fine
   - Frontend zooms directly to appropriate resolution
   - Reduces data transfer

5. **Compression**
   - WEBP for visual raster data (RGB/RGBA)
   - LZW/Deflate for scientific data
   - gzip in HTTP response headers

6. **Caching**
   - In-memory for metadata
   - Redis for computed slices
   - HTTP cache headers for tile server

### 5.2 Benchmarking Example

```python
import time
import rasterio

def benchmark_access_methods(cog_path):
    """Compare different data access patterns"""

    with rasterio.open(cog_path) as src:
        # Method 1: Full dataset load (SLOW)
        start = time.time()
        full_data = src.read(1)
        method1_time = time.time() - start
        print(f"Full load: {method1_time:.2f}s, Size: {full_data.nbytes / 1e9:.2f} GB")

        # Method 2: Windowed read from COG (FAST)
        from rasterio.windows import from_bounds

        start = time.time()
        window = from_bounds(0, 0, 10, 10, src.transform)  # Small region
        tile_data = src.read(1, window=window)
        method2_time = time.time() - start
        print(f"Windowed read: {method2_time:.6f}s, Size: {tile_data.nbytes / 1e6:.2f} MB")

        # Method 3: Remote COG on S3/HTTP (with range requests)
        # COGs are designed for this
        print("COGs enable efficient remote access via HTTP range requests")
        print("AWS S3, Google Cloud Storage, etc. all support range requests")
```

---

## 6. Data Format Recommendations

### 6.1 For Different Data Types

| Data Type | Recommended Format | Storage Tier | Protocol |
|-----------|-------------------|--------------|----------|
| **Elevation/DEM** | Cloud Optimized GeoTIFF (COG) | Object Storage (S3, GCS) | HTTP range requests |
| **Paleoclimate (time-series)** | NetCDF4/Zarr | Object Storage | Zarr HTTP or streaming |
| **Continental Features** | GeoJSON / GeoPackage | File or PostGIS | HTTP/SQL |
| **Satellite Imagery** | COG with WEBP compression | Object Storage | HTTP range requests |
| **Geological Polygons** | GeoPackage or PostGIS | PostGIS Database | SQL queries |

### 6.2 Format Conversion Guide

```python
# Shapefile → GeoJSON
gdf = gpd.read_file('data.shp')
gdf.to_file('data.geojson', driver='GeoJSON')

# NetCDF → Zarr (faster for time-series)
ds = xr.open_dataset('climate.nc')
ds.to_zarr('climate.zarr', mode='w')

# GeoTIFF → Cloud Optimized GeoTIFF
from rio_cogeo.cogeo import cog_translate
cog_translate('data.tif', 'data_cog.tif',
              dst_profile=cog_profiles['webp'],
              overview_level=5)

# Shapefile → GeoPackage (single file format)
gdf = gpd.read_file('data.shp')
gdf.to_file('data.gpkg', driver='GPKG')
```

---

## 7. Existing Paleogeography Tools to Leverage

### 7.1 Pyleoclim
- **Purpose**: Paleoclimate timeseries analysis and visualization
- **Key Features**:
  - Spectral analysis, wavelet analysis
  - Time-series preprocessing (detrending, binning, filtering)
  - Model-data comparison
  - New mapping capabilities with GeoSeries
  - Supports LiPD (Linked Paleo Data) standard
- **Integration**: Use for upstream analysis pipeline, export results to API
- **Repository**: https://github.com/LinkedEarth/Pyleoclim_util

### 7.2 Climate Model Outputs
- **PMIP** (Paleoclimate Modelling Intercomparison Project)
  - Time-varying paleoclimate simulations
  - Available as NetCDF (xarray-ready)
  - Multiple variables per file
- **PAGES** (Past Global Changes)
  - Paleoclimate data compilations
  - Various formats (NetCDF, HDF5)
- **Integration Strategy**: Download, preprocess with xarray, serve via API

### 7.3 Plate Tectonic Models
- **GPlates** outputs (plate reconstruction)
  - Shapefile/GeoJSON continental positions
  - Time-varying geometries
  - Available for many time periods
- **Integration**: Load as GeoDataFrame, serve as time-indexed GeoJSON

---

## 8. Complete Example: Production Architecture

### 8.1 Directory Structure

```
project/
├── backend/
│   ├── app.py                      # FastAPI application
│   ├── config.py                   # Configuration
│   ├── models.py                   # Pydantic models
│   ├── routes/
│   │   ├── elevation.py            # Elevation endpoints
│   │   ├── paleoclimate.py         # Climate data endpoints
│   │   ├── features.py             # Vector features
│   │   └── metadata.py             # Dataset info
│   ├── services/
│   │   ├── raster_service.py       # Raster data handling
│   │   ├── timeseries_service.py   # Climate time-series
│   │   └── cache.py                # Caching logic
│   └── requirements.txt            # Python dependencies
│
├── data/
│   ├── raw/                        # Original data
│   │   ├── paleoclimate.nc
│   │   ├── elevation.tif
│   │   └── continents.shp
│   ├── processed/                  # COGs, Zarr, etc.
│   │   ├── elevation_cog.tif
│   │   ├── paleoclimate.zarr/
│   │   └── continents.geojson
│   └── cache/                      # Redis cache store
│
├── docker/
│   ├── Dockerfile                  # Container build
│   ├── docker-compose.yml          # Services (FastAPI, Redis, PostGIS)
│   └── startup.sh                  # Entry point
│
└── tests/
    ├── test_elevation.py
    ├── test_paleoclimate.py
    └── test_features.py
```

### 8.2 docker-compose.yml Example

```yaml
version: '3.8'

services:
  # FastAPI backend
  api:
    build: ./docker
    ports:
      - "8000:8000"
    volumes:
      - ./backend:/app/backend
      - ./data/processed:/data
    environment:
      - REDIS_URL=redis://redis:6379/0
      - DATABASE_URL=postgresql://user:pass@postgres:5432/geology
    depends_on:
      - redis
      - postgres
    command: uvicorn backend.app:app --host 0.0.0.0 --reload

  # Cache layer
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

  # Spatial database
  postgres:
    image: postgis/postgis:15-3.3
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
      POSTGRES_DB: geology
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  redis_data:
  postgres_data:
```

### 8.3 requirements.txt

```
fastapi==0.104.1
uvicorn[standard]==0.24.0
pydantic==2.5.0
numpy==1.24.3
xarray==2023.12.0
rasterio==1.3.8
shapely==2.0.2
geopandas==0.14.0
rio-cogeo==5.0.1
pyproj==3.6.1
netCDF4==1.6.4
h5py==3.10.0
redis==5.0.1
sqlalchemy==2.0.23
geoalchemy2==0.14.5
psycopg2-binary==2.9.9
pillow==10.1.0
mercantile==1.2.1
```

---

## 9. Performance Benchmarks & Scalability

### 9.1 Expected Performance

| Operation | Dataset Size | Latency | Memory | Notes |
|-----------|-------------|---------|--------|-------|
| Get elevation tile (256x256) | 1 TB DEM | < 100ms | < 50MB | COG windowed read |
| Get paleoclimate slice (360x180) | 100 GB NetCDF | < 500ms | < 200MB | xarray with Dask |
| Stream animation (100 frames) | 100 GB | 1-2s | < 500MB | Async generator |
| Query vector features | 10,000 polygons | < 100ms | < 100MB | Simplified geometries |

### 9.2 Scaling Strategies

**For Higher Concurrency:**
1. Load balance with Nginx/HAProxy
2. Run multiple FastAPI workers with Gunicorn
3. Use Dask for parallel raster processing
4. Implement read replicas for PostGIS

**For Larger Data:**
1. Use Zarr with Dask for >100 GB time-series
2. Store COGs on S3/GCS with CloudFront CDN
3. Implement geohashing for spatial indexing
4. Use Parquet for columnar feature data

---

## 10. Security & Deployment Considerations

### 10.1 Security Best Practices

```python
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZIPMiddleware

app.add_middleware(GZIPMiddleware, minimum_size=1000)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://yourdomain.com"],
    allow_credentials=True,
    allow_methods=["GET"],
    allow_headers=["*"],
)

# Rate limiting
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
app = limiter.limit("100/minute")(app)

@app.get("/api/elevation/tile/{z}/{x}/{y}")
@limiter.limit("1000/minute")
async def get_elevation_tile(...):
    pass
```

### 10.2 Deployment on Cloud

**AWS:**
```bash
# Store COGs on S3 with public read access
# Use CloudFront distribution for caching
# Deploy FastAPI on ECS/Lambda
# Use RDS for PostGIS
# Use ElastiCache for Redis
```

**Google Cloud:**
```bash
# Store COGs on Cloud Storage
# Use Cloud CDN
# Deploy on Cloud Run
# Use Cloud SQL for PostGIS
# Use Memorystore for Redis
```

---

## 11. Implementation Roadmap

### Phase 1: Foundation (Weeks 1-2)
- [ ] Set up FastAPI project structure
- [ ] Implement elevation tile serving (windowed rasterio)
- [ ] Create COG conversion pipeline
- [ ] Deploy to Docker container

### Phase 2: Temporal Data (Weeks 3-4)
- [ ] Implement paleoclimate time-series loading (xarray)
- [ ] Create animation streaming endpoints
- [ ] Add Zarr support for large datasets
- [ ] Implement Redis caching

### Phase 3: Vector Features (Weeks 5-6)
- [ ] Integrate GeoDataFrame/PostGIS for features
- [ ] Implement GeoJSON serving with simplification
- [ ] Add time-indexed feature queries
- [ ] Optimize spatial indexing

### Phase 4: Production (Weeks 7-8)
- [ ] Performance testing and optimization
- [ ] Security hardening
- [ ] Documentation and API specs
- [ ] Load testing and scaling validation

---

## 12. Key Resources & References

### Documentation
- GDAL: https://gdal.org/
- Rasterio: https://rasterio.readthedocs.io/
- GeoPandas: https://geopandas.org/
- xarray: https://docs.xarray.dev/
- FastAPI: https://fastapi.tiangolo.com/
- Cloud Optimized GeoTIFF: https://cogeo.org/

### Libraries & Tools
- **Data Processing**: GDAL, rasterio, shapely, geopandas, xarray
- **Web Framework**: FastAPI, Uvicorn
- **Database**: PostGIS, GeoAlchemy2
- **Tiling**: rio-cogeo, TileCloud, GDAL utilities
- **Visualization**: Pyleoclim, Cartopy
- **Caching**: Redis

### Sample Paleodata
- PMIP (Paleoclimate Modelling): https://pmip.lsce.ipsl.fr/
- PAGES (Past Global Changes): https://www.pastglobalchanges.org/
- GEBCO (Bathymetry/Elevation): https://www.gebco.net/
- Natural Earth (Cultural/Physical Data): https://www.naturalearthdata.com/

---

## Conclusion

A production-grade Python backend for 3D globe visualization of geological/paleoclimate data should:

1. **Use FastAPI** for high-performance async APIs
2. **Leverage rasterio** with Cloud Optimized GeoTIFF for efficient elevation/raster serving
3. **Use xarray/NetCDF** for paleoclimate time-series data
4. **Implement GeoPandas** for vector features with PostGIS as optional spatial database
5. **Generate tile pyramids** for progressive multi-resolution loading
6. **Cache aggressively** with Redis for computed slices
7. **Stream large data** using FastAPI's StreamingResponse
8. **Pre-compute** heightmaps and animation frames offline

This architecture provides the scalability, performance, and flexibility needed for serving time-varying Earth surface data to WebGL frontends while leveraging the mature Python geospatial ecosystem.
