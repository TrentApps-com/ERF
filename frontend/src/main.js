import Globe from 'globe.gl';

// Earth configuration
const EARTH_RADIUS_KM = 6371;
const TIME_RANGE = { min: -500000, max: 0 }; // years (500k years ago to present)

// Initialize globe
const globe = Globe()
  .globeImageUrl('//unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
  .bumpImageUrl('//unpkg.com/three-globe/example/img/earth-topology.png')
  .backgroundImageUrl('//unpkg.com/three-globe/example/img/night-sky.png')
  .showAtmosphere(true)
  .atmosphereColor('#3a7bd5')
  .atmosphereAltitude(0.15);

// Mount to container
const container = document.getElementById('globe-container');
globe(container);

// Handle window resize
window.addEventListener('resize', () => {
  globe.width(window.innerWidth);
  globe.height(window.innerHeight);
});

// Initial sizing
globe.width(window.innerWidth);
globe.height(window.innerHeight);

// Timeline control
const timeline = document.getElementById('timeline');
const yearDisplay = document.getElementById('year-display');

function formatYear(year) {
  if (year === 0) return 'Present Day';
  const absYear = Math.abs(year);
  if (absYear >= 1000) {
    return `${(absYear / 1000).toFixed(0)}k years ago`;
  }
  return `${absYear} years ago`;
}

function updateGlobeForYear(year) {
  // Update display
  yearDisplay.textContent = formatYear(year);

  // TODO: Load appropriate texture/data for the given year
  // This will interpolate between known time snapshots
  // For now, we'll implement visual feedback

  // Adjust atmosphere color based on ice age periods
  // Last Glacial Maximum was ~20,000 years ago
  const iceAgeFactor = Math.max(0, 1 - Math.abs(year + 20000) / 100000);
  const baseColor = { r: 58, g: 123, b: 213 };
  const iceColor = { r: 200, g: 230, b: 255 };

  const r = Math.round(baseColor.r + (iceColor.r - baseColor.r) * iceAgeFactor);
  const g = Math.round(baseColor.g + (iceColor.g - baseColor.g) * iceAgeFactor);
  const b = Math.round(baseColor.b + (iceColor.b - baseColor.b) * iceAgeFactor);

  globe.atmosphereColor(`rgb(${r}, ${g}, ${b})`);
}

timeline.addEventListener('input', (e) => {
  const year = parseInt(e.target.value, 10);
  updateGlobeForYear(year);
});

// Hide loading screen
document.getElementById('loading').style.display = 'none';

// Auto-rotate
globe.controls().autoRotate = true;
globe.controls().autoRotateSpeed = 0.5;

// Set initial camera position
globe.pointOfView({ lat: 30, lng: 0, altitude: 2.5 });

console.log('ERF Globe initialized');
