# ERF - Earth Reconstruction Framework

Interactive 3D visualization of Earth's evolution over hundreds of thousands of years.

## Vision

ERF renders a 3D globe showing how Earth's surface, climate, and geography have changed through geological time scales. Users can scrub through time to see:

- Ice age cycles and glacial coverage
- Sea level changes
- Vegetation and biome shifts
- Temperature variations

## Tech Stack

- **Frontend**: WebGL (Three.js/Globe.gl) for 3D visualization
- **Backend**: Python (FastAPI) for data processing and serving
- **Data**: Paleoclimate and paleogeography datasets

## Project Structure

```
ERF/
├── frontend/          # WebGL visualization
│   ├── src/
│   │   ├── components/  # UI components
│   │   ├── shaders/     # GLSL shaders
│   │   ├── utils/       # Helper functions
│   │   └── data/        # Static data files
├── backend/           # Python API
│   ├── api/           # FastAPI routes
│   ├── data/          # Data processing
│   └── processing/    # Data transformation
├── scripts/           # Build and data scripts
├── docs/              # Documentation
└── assets/            # Textures, heightmaps
```

## Development

```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn api.main:app --reload

# Frontend
cd frontend
npm install
npm run dev
```

## Data Sources

- NOAA Paleoclimatology
- Natural Earth
- PMIP (Paleoclimate Modelling Intercomparison Project)
- Scotese PALEOMAP Project

## License

MIT
