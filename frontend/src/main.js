import Globe from 'globe.gl';
import * as THREE from 'three';
import { getEarthState, getTimePeriods, checkApiHealth } from './utils/api.js';

// Earth configuration
const EARTH_RADIUS_KM = 6371;
const TIME_RANGE = { min: -500000, max: 0 }; // years (500k years ago to present)

// Key time periods for timeline markers
const KEY_PERIODS = [
  { year: 0, label: 'Present', shortLabel: 'Now' },
  { year: -12000, label: 'Ice Age End', shortLabel: '12k' },
  { year: -20000, label: 'Last Glacial Maximum', shortLabel: 'LGM' },
  { year: -130000, label: 'Eemian Interglacial', shortLabel: '130k' },
  { year: -400000, label: 'MIS 11', shortLabel: '400k' },
];

// Current state
let currentYear = 0;
let currentState = null;
let isTransitioning = false;
let apiAvailable = false;

// Initialize globe
const globe = Globe()
  .globeImageUrl('//unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
  .bumpImageUrl('//unpkg.com/three-globe/example/img/earth-topology.png')
  .backgroundImageUrl('//unpkg.com/three-globe/example/img/night-sky.png')
  .showAtmosphere(true)
  .atmosphereColor('#3a7bd5')
  .atmosphereAltitude(0.25);

// Mount to container
const container = document.getElementById('globe-container');
globe(container);

// Add enhanced atmosphere glow effect
function addAtmosphereGlow() {
  const scene = globe.scene();
  if (!scene) return;

  // Create outer glow sphere
  const glowGeometry = new THREE.SphereGeometry(105, 64, 64);
  const glowMaterial = new THREE.ShaderMaterial({
    uniforms: {
      glowColor: { value: new THREE.Color(0x3a7bd5) },
      viewVector: { value: new THREE.Vector3(0, 0, 1) },
      c: { value: 0.4 },
      p: { value: 4.0 }
    },
    vertexShader: `
      uniform vec3 viewVector;
      varying float intensity;
      void main() {
        vec3 vNormal = normalize(normalMatrix * normal);
        vec3 vNormel = normalize(normalMatrix * viewVector);
        intensity = pow(0.7 - dot(vNormal, vNormel), 2.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 glowColor;
      uniform float c;
      uniform float p;
      varying float intensity;
      void main() {
        vec3 glow = glowColor * c * pow(intensity, p);
        gl_FragColor = vec4(glow, intensity * 0.6);
      }
    `,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false
  });

  const glowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
  glowMesh.name = 'atmosphereGlow';
  scene.add(glowMesh);

  // Store reference to update glow color
  window.erfGlowMesh = glowMesh;
}

// Update atmosphere glow color
function updateAtmosphereGlowColor(color) {
  if (window.erfGlowMesh) {
    window.erfGlowMesh.material.uniforms.glowColor.value = new THREE.Color(color);
  }
}

// Handle window resize
window.addEventListener('resize', () => {
  globe.width(window.innerWidth);
  globe.height(window.innerHeight);
});

// Initial sizing
globe.width(window.innerWidth);
globe.height(window.innerHeight);

// Create enhanced UI using DOM methods (safe approach)
function createEnhancedUI() {
  const controls = document.getElementById('controls');

  // Clear existing content
  while (controls.firstChild) {
    controls.removeChild(controls.firstChild);
  }

  // Create climate info section
  const climateInfo = document.createElement('div');
  climateInfo.id = 'climate-info';

  const infoItems = [
    { label: 'Sea Level:', id: 'sea-level', value: '0m' },
    { label: 'Temperature:', id: 'temperature', value: '+0.0C' },
    { label: 'Ice Coverage:', id: 'ice-coverage', value: '10%' }
  ];

  infoItems.forEach(item => {
    const row = document.createElement('div');
    row.className = 'info-row';

    const label = document.createElement('span');
    label.className = 'info-label';
    label.textContent = item.label;

    const value = document.createElement('span');
    value.id = item.id;
    value.className = 'info-value';
    value.textContent = item.value;

    row.appendChild(label);
    row.appendChild(value);
    climateInfo.appendChild(row);
  });

  controls.appendChild(climateInfo);

  // Create timeline container
  const timelineContainer = document.createElement('div');
  timelineContainer.id = 'timeline-container';

  const timelineMarkers = document.createElement('div');
  timelineMarkers.id = 'timeline-markers';
  timelineContainer.appendChild(timelineMarkers);

  const timeline = document.createElement('input');
  timeline.type = 'range';
  timeline.id = 'timeline';
  timeline.min = '-500000';
  timeline.max = '0';
  timeline.value = '0';
  timeline.step = '100';
  timelineContainer.appendChild(timeline);

  const timelineLabels = document.createElement('div');
  timelineLabels.id = 'timeline-labels';
  timelineContainer.appendChild(timelineLabels);

  controls.appendChild(timelineContainer);

  // Create year display
  const yearDisplay = document.createElement('div');
  yearDisplay.id = 'year-display';
  yearDisplay.textContent = 'Present Day';
  controls.appendChild(yearDisplay);

  // Create API status
  const apiStatus = document.createElement('div');
  apiStatus.id = 'api-status';
  controls.appendChild(apiStatus);

  // Add enhanced styles
  const style = document.createElement('style');
  style.textContent = `
    #controls {
      width: auto;
      min-width: 500px;
      max-width: 90vw;
    }
    #climate-info {
      display: flex;
      justify-content: space-around;
      margin-bottom: 15px;
      padding-bottom: 15px;
      border-bottom: 1px solid rgba(255,255,255,0.2);
    }
    .info-row {
      text-align: center;
    }
    .info-label {
      display: block;
      font-size: 0.75em;
      opacity: 0.7;
      margin-bottom: 4px;
    }
    .info-value {
      font-size: 1.1em;
      font-weight: bold;
      font-family: 'Courier New', monospace;
      transition: all 0.3s ease;
    }
    .info-value.cold {
      color: #88ccff;
    }
    .info-value.warm {
      color: #ffaa66;
    }
    #timeline-container {
      position: relative;
      padding: 20px 0 10px;
    }
    #timeline {
      width: 100%;
      -webkit-appearance: none;
      appearance: none;
      height: 8px;
      background: linear-gradient(to right, #1a4a7a, #3a7bd5, #7ab5e8);
      border-radius: 4px;
      outline: none;
      cursor: pointer;
    }
    #timeline::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: #fff;
      cursor: pointer;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
      transition: transform 0.2s ease;
    }
    #timeline::-webkit-slider-thumb:hover {
      transform: scale(1.2);
    }
    #timeline::-moz-range-thumb {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: #fff;
      cursor: pointer;
      border: none;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    }
    #timeline-markers {
      position: absolute;
      top: 8px;
      left: 0;
      right: 0;
      height: 12px;
      pointer-events: none;
    }
    .timeline-marker {
      position: absolute;
      width: 2px;
      height: 12px;
      background: rgba(255,255,255,0.5);
      transform: translateX(-50%);
    }
    #timeline-labels {
      display: flex;
      justify-content: space-between;
      margin-top: 8px;
      font-size: 0.7em;
      opacity: 0.7;
    }
    .timeline-label {
      cursor: pointer;
      padding: 2px 4px;
      border-radius: 3px;
      transition: all 0.2s ease;
    }
    .timeline-label:hover {
      background: rgba(255,255,255,0.2);
      opacity: 1;
    }
    .timeline-label.active {
      color: #7ab5e8;
      font-weight: bold;
    }
    #year-display {
      text-align: center;
      font-size: 1.4em;
      font-weight: bold;
      margin-top: 10px;
      transition: all 0.3s ease;
    }
    #api-status {
      text-align: center;
      font-size: 0.7em;
      margin-top: 8px;
      opacity: 0.5;
    }
    #api-status.online {
      color: #4ade80;
    }
    #api-status.offline {
      color: #f87171;
    }
  `;
  document.head.appendChild(style);

  // Create timeline markers and labels
  createTimelineMarkers();
}

// Create timeline markers for key periods
function createTimelineMarkers() {
  const markersContainer = document.getElementById('timeline-markers');
  const labelsContainer = document.getElementById('timeline-labels');

  KEY_PERIODS.forEach((period) => {
    // Calculate position percentage
    const position = ((period.year - TIME_RANGE.min) / (TIME_RANGE.max - TIME_RANGE.min)) * 100;

    // Create marker
    const marker = document.createElement('div');
    marker.className = 'timeline-marker';
    marker.style.left = `${position}%`;
    markersContainer.appendChild(marker);

    // Create label
    const label = document.createElement('span');
    label.className = 'timeline-label';
    label.textContent = period.shortLabel;
    label.title = period.label;
    label.dataset.year = period.year;
    label.addEventListener('click', () => {
      jumpToYear(period.year);
    });
    labelsContainer.appendChild(label);
  });
}

// Format year for display
function formatYear(year) {
  if (year === 0) return 'Present Day';
  const absYear = Math.abs(year);
  if (absYear >= 1000) {
    return `${(absYear / 1000).toFixed(absYear >= 100000 ? 0 : 1)}k years ago`;
  }
  return `${absYear} years ago`;
}

// Update climate info display with smooth transitions
function updateClimateDisplay(state) {
  if (!state) return;

  const seaLevelEl = document.getElementById('sea-level');
  const tempEl = document.getElementById('temperature');
  const iceEl = document.getElementById('ice-coverage');

  // Sea level with sign
  const seaLevelSign = state.sea_level_m >= 0 ? '+' : '';
  seaLevelEl.textContent = `${seaLevelSign}${state.sea_level_m.toFixed(0)}m`;
  seaLevelEl.className = `info-value ${state.sea_level_m > 0 ? 'warm' : state.sea_level_m < -50 ? 'cold' : ''}`;

  // Temperature with sign
  const tempSign = state.global_temp_c >= 0 ? '+' : '';
  tempEl.textContent = `${tempSign}${state.global_temp_c.toFixed(1)}C`;
  tempEl.className = `info-value ${state.global_temp_c > 0 ? 'warm' : state.global_temp_c < -2 ? 'cold' : ''}`;

  // Ice coverage
  iceEl.textContent = `${state.ice_coverage_pct.toFixed(1)}%`;
  iceEl.className = `info-value ${state.ice_coverage_pct > 20 ? 'cold' : state.ice_coverage_pct < 9 ? 'warm' : ''}`;
}

// Update active timeline label
function updateActiveLabel(year) {
  const labels = document.querySelectorAll('.timeline-label');
  labels.forEach(label => {
    const labelYear = parseInt(label.dataset.year);
    // Mark as active if within 5000 years of a key period
    const isNear = Math.abs(year - labelYear) < 5000;
    label.classList.toggle('active', isNear);
  });
}

// Calculate atmosphere color based on climate state
function calculateAtmosphereColor(state) {
  if (!state) return '#3a7bd5';

  // Base color (modern Earth)
  const baseColor = { r: 58, g: 123, b: 213 };
  // Ice age color (cooler, whiter)
  const iceColor = { r: 180, g: 210, b: 255 };
  // Warm period color (slightly warmer tone)
  const warmColor = { r: 70, g: 140, b: 200 };

  let targetColor;
  if (state.global_temp_c < -2) {
    // Ice age: blend toward ice color based on temperature
    const t = Math.min(1, Math.abs(state.global_temp_c) / 6);
    targetColor = {
      r: baseColor.r + (iceColor.r - baseColor.r) * t,
      g: baseColor.g + (iceColor.g - baseColor.g) * t,
      b: baseColor.b + (iceColor.b - baseColor.b) * t
    };
  } else if (state.global_temp_c > 1) {
    // Warm period: blend toward warm color
    const t = Math.min(1, state.global_temp_c / 3);
    targetColor = {
      r: baseColor.r + (warmColor.r - baseColor.r) * t,
      g: baseColor.g + (warmColor.g - baseColor.g) * t,
      b: baseColor.b + (warmColor.b - baseColor.b) * t
    };
  } else {
    targetColor = baseColor;
  }

  return `rgb(${Math.round(targetColor.r)}, ${Math.round(targetColor.g)}, ${Math.round(targetColor.b)})`;
}

// Smooth transition to a new year
async function transitionToYear(year, duration = 300) {
  if (isTransitioning) return;

  isTransitioning = true;
  const startYear = currentYear;
  const startTime = performance.now();

  return new Promise((resolve) => {
    function animate(time) {
      const elapsed = time - startTime;
      const progress = Math.min(1, elapsed / duration);

      // Easing function (ease-out cubic)
      const eased = 1 - Math.pow(1 - progress, 3);

      const intermediateYear = Math.round(startYear + (year - startYear) * eased);
      updateGlobeForYear(intermediateYear, false);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        isTransitioning = false;
        resolve();
      }
    }

    requestAnimationFrame(animate);
  });
}

// Jump to a specific year with animation
async function jumpToYear(year) {
  const timeline = document.getElementById('timeline');
  timeline.value = year;
  await transitionToYear(year, 500);
}

// Update globe visualization for a given year
async function updateGlobeForYear(year, fetchData = true) {
  currentYear = year;

  // Update year display
  const yearDisplay = document.getElementById('year-display');
  yearDisplay.textContent = formatYear(year);

  // Update active timeline label
  updateActiveLabel(year);

  // Fetch or calculate state
  let state;
  if (fetchData && apiAvailable) {
    state = await getEarthState(year);
  } else if (currentState) {
    // Use interpolated local state for smooth transitions
    state = interpolateLocalState(year);
  } else {
    state = await getEarthState(year);
  }

  currentState = state;

  // Update climate display
  updateClimateDisplay(state);

  // Update atmosphere color
  const atmosphereColor = calculateAtmosphereColor(state);
  globe.atmosphereColor(atmosphereColor);
  updateAtmosphereGlowColor(atmosphereColor);

  // Adjust atmosphere altitude based on ice coverage
  // More ice = slightly denser atmosphere visual
  const baseAltitude = 0.25;
  const altitudeAdjust = (state.ice_coverage_pct - 10) / 100 * 0.1;
  globe.atmosphereAltitude(baseAltitude + altitudeAdjust);
}

// Local interpolation for smooth transitions
function interpolateLocalState(year) {
  const periods = [
    { year: 0, sea_level_m: 0, global_temp_c: 0, ice_coverage_pct: 10.0 },
    { year: -12000, sea_level_m: -60, global_temp_c: -4, ice_coverage_pct: 25.0 },
    { year: -20000, sea_level_m: -120, global_temp_c: -6, ice_coverage_pct: 30.0 },
    { year: -130000, sea_level_m: 6, global_temp_c: 2, ice_coverage_pct: 8.0 },
    { year: -400000, sea_level_m: 10, global_temp_c: 2.5, ice_coverage_pct: 7.0 },
  ];

  const sorted = periods.sort((a, b) => b.year - a.year);
  let upper = sorted[0];
  let lower = sorted[sorted.length - 1];

  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].year <= year) {
      upper = sorted[i];
      lower = i > 0 ? sorted[i - 1] : sorted[i];
      break;
    }
  }

  if (upper.year === lower.year) return { ...upper, year };

  const t = (year - lower.year) / (upper.year - lower.year);

  return {
    year,
    sea_level_m: lower.sea_level_m + t * (upper.sea_level_m - lower.sea_level_m),
    global_temp_c: lower.global_temp_c + t * (upper.global_temp_c - lower.global_temp_c),
    ice_coverage_pct: lower.ice_coverage_pct + t * (upper.ice_coverage_pct - lower.ice_coverage_pct),
  };
}

// Update API status indicator
function updateApiStatus(online) {
  const statusEl = document.getElementById('api-status');
  if (statusEl) {
    statusEl.textContent = online ? 'API Connected' : 'Offline Mode';
    statusEl.className = online ? 'online' : 'offline';
  }
}

// Initialize the application
async function init() {
  // Create enhanced UI
  createEnhancedUI();

  // Check API health
  apiAvailable = await checkApiHealth();
  updateApiStatus(apiAvailable);

  // Add atmosphere glow after a short delay to ensure scene is ready
  setTimeout(addAtmosphereGlow, 100);

  // Setup timeline control
  const timeline = document.getElementById('timeline');

  // Debounce for timeline sliding
  let slideTimeout;
  timeline.addEventListener('input', (e) => {
    const year = parseInt(e.target.value, 10);

    // Immediate visual feedback (local interpolation)
    updateGlobeForYear(year, false);

    // Debounced API call
    clearTimeout(slideTimeout);
    slideTimeout = setTimeout(() => {
      if (apiAvailable) {
        updateGlobeForYear(year, true);
      }
    }, 150);
  });

  // Initial state
  await updateGlobeForYear(0, true);

  // Hide loading screen
  document.getElementById('loading').style.display = 'none';

  // Auto-rotate
  globe.controls().autoRotate = true;
  globe.controls().autoRotateSpeed = 0.5;

  // Set initial camera position
  globe.pointOfView({ lat: 30, lng: 0, altitude: 2.5 });

  console.log('ERF Globe initialized with enhanced features');
}

// Start the application
init().catch(console.error);
