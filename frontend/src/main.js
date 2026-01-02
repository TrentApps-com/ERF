import Globe from 'globe.gl';
import * as THREE from 'three';
import { getEarthState, getTimePeriods, checkApiHealth } from './utils/api.js';
import {
  getActiveStorms, getIntensityDescription, convertWindSpeed,
  getNotableStorms, getStormById, convertHistoricalStorm
} from './utils/stormApi.js';
import {
  updateStorms, startStormAnimation, stopStormAnimation, clearStorms,
  createTrackLine, getStormAtPosition
} from './utils/stormVisuals.js';
import {
  getSunPosition, getTerminatorLine, getCurrentWeather,
  getTemperatureColor, getWeatherSystems, getRainViewerData,
  getGlobalCloudTextureUrls, getGlobalRadarUrl,
  getEarthquakes, getEarthquakeColor, getEarthquakeSize,
  generateWindParticles, getClimatologicalWind, windToVelocity,
  WORLD_CITIES
} from './utils/weatherApi.js';

// Debug logging - disabled in production
const DEBUG = import.meta.env?.DEV ?? true;
const log = DEBUG ? console.log.bind(console) : () => {};

/**
 * Escape HTML special characters to prevent XSS attacks
 * @param {string} text - The text to escape
 * @returns {string} - The escaped text safe for innerHTML
 */
function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  const str = String(text);
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;'
  };
  return str.replace(/[&<>"']/g, char => map[char]);
}

// Backend API configuration
const API_BASE = 'http://localhost:8000';

// Earth configuration
const EARTH_RADIUS_KM = 6371;
const TIME_RANGE = { min: -750000000, max: 0 }; // years (750 million years ago to present)

// Available paleogeographic texture ages (in Ma - millions of years)
const PALEOMAP_AGES = [
  0, 1, 4, 6, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 66, 70, 75, 80, 90, 95,
  100, 105, 110, 115, 120, 125, 130, 135, 140, 145, 150, 155, 160, 165, 170, 175,
  180, 185, 190, 195, 200, 210, 220, 230, 240, 245, 250, 255, 260, 270, 275, 280,
  290, 295, 300, 305, 310, 315, 320, 330, 340, 350, 360, 370, 380, 390, 395, 400,
  410, 415, 420, 425, 430, 440, 445, 450, 460, 461, 470, 480, 490, 500, 510, 520,
  530, 540, 600, 690, 750
];

// Key geological time periods for timeline markers
const KEY_PERIODS = [
  { year: 0, label: 'Present Day', shortLabel: 'Now' },
  { year: -66000000, label: 'K-Pg Extinction', shortLabel: '66Ma' },
  { year: -100000000, label: 'Mid-Cretaceous', shortLabel: '100Ma' },
  { year: -150000000, label: 'Late Jurassic', shortLabel: '150Ma' },
  { year: -200000000, label: 'Triassic-Jurassic', shortLabel: '200Ma' },
  { year: -250000000, label: 'Permian Extinction', shortLabel: '250Ma' },
  { year: -300000000, label: 'Carboniferous', shortLabel: '300Ma' },
  { year: -400000000, label: 'Devonian', shortLabel: '400Ma' },
  { year: -500000000, label: 'Cambrian', shortLabel: '500Ma' },
  { year: -750000000, label: 'Cryogenian', shortLabel: '750Ma' },
];

// Current state
let currentYear = 0;
let currentState = null;
let isTransitioning = false;
let apiAvailable = false;
let isAutoPlaying = false;
let autoPlayInterval = null;
let isRotating = false;  // Disabled by default - real-time day/night
let currentPaleomapAge = 0; // Track current loaded paleomap texture
let paleomapTextureCache = {}; // Cache loaded textures

// Layer visibility states
let showClouds = true;
let showIceCaps = true;
let showAtmosphere = true;
let showStars = true;
let showStorms = true;
let showSunCycle = true; // Combined sun position and day/night shading
let showCityLights = true; // City lights on night side
let showWeather = false;
let controlsCollapsed = false;

// Day/Night and Weather state
let sunMesh = null;
let sunLight = null;
let terminatorMesh = null;
let nightOverlay = null;
let weatherMarkers = [];
let weatherData = [];
let weatherSystems = [];
let weatherSystemMarkers = [];
let radarOverlay = null;
let showRadar = false;
let showWeatherSystems = false; // Replaced by wind particle flow
let satelliteOverlay = null;
let showSatellite = true; // Live satellite cloud data enabled by default
let weatherUpdateInterval = null;
const WEATHER_UPDATE_INTERVAL = 10 * 60 * 1000; // 10 minutes

// Storm system state
let activeStorms = [];
let stormUpdateInterval = null;
const STORM_UPDATE_INTERVAL = 15 * 60 * 1000; // 15 minutes

// Historical storms state
let historicalStormsMode = false;
let notableStorms = [];
let selectedHistoricalStorm = null;
let stormTrackLines = []; // Track lines for historical storms

// Live storm interaction state
let selectedLiveStorm = null;
let stormRaycaster = null;
let stormMouse = null;

// Earthquake visualization state
let showEarthquakes = true;
let earthquakeMarkers = [];
let earthquakeData = [];
let earthquakeUpdateInterval = null;
const EARTHQUAKE_UPDATE_INTERVAL = 5 * 60 * 1000; // 5 minutes

// Wind particle visualization state
let showWindParticles = true;
let windParticleSystem = null;
let windParticles = [];
let windAnimationId = null;

// Wildfire visualization state
let showWildfires = true;
let wildfireMarkers = [];
let wildfireData = [];
let wildfireUpdateInterval = null;
const WILDFIRE_UPDATE_INTERVAL = 15 * 60 * 1000; // 15 minutes

// Volcano visualization state
let showVolcanoes = true;
let volcanoMarkers = [];
let volcanoData = [];

// Air quality visualization state
let showAirQuality = false; // Off by default (dense data)
let airQualityMarkers = [];
let airQualityData = [];
let airQualityUpdateInterval = null;
const AIR_QUALITY_UPDATE_INTERVAL = 30 * 60 * 1000; // 30 minutes

// Tectonic plates visualization state
let showTectonicPlates = false; // Off by default
let tectonicPlateLines = [];

// Geological eras data
const GEOLOGICAL_ERAS = {
  0: { name: 'Holocene', period: 'Quaternary', era: 'Cenozoic', description: 'Modern Earth' },
  1: { name: 'Pleistocene', period: 'Quaternary', era: 'Cenozoic', description: 'Ice Ages' },
  10: { name: 'Miocene', period: 'Neogene', era: 'Cenozoic', description: 'Grasslands spread' },
  35: { name: 'Eocene', period: 'Paleogene', era: 'Cenozoic', description: 'Warmest period' },
  66: { name: 'Cretaceous', period: 'Cretaceous', era: 'Mesozoic', description: 'End of dinosaurs' },
  145: { name: 'Jurassic', period: 'Jurassic', era: 'Mesozoic', description: 'Age of dinosaurs' },
  200: { name: 'Triassic', period: 'Triassic', era: 'Mesozoic', description: 'First dinosaurs' },
  250: { name: 'Permian', period: 'Permian', era: 'Paleozoic', description: 'Great Dying' },
  300: { name: 'Carboniferous', period: 'Carboniferous', era: 'Paleozoic', description: 'Coal forests' },
  360: { name: 'Devonian', period: 'Devonian', era: 'Paleozoic', description: 'Age of fish' },
  420: { name: 'Silurian', period: 'Silurian', era: 'Paleozoic', description: 'First land plants' },
  445: { name: 'Ordovician', period: 'Ordovician', era: 'Paleozoic', description: 'Marine life diversifies' },
  485: { name: 'Cambrian', period: 'Cambrian', era: 'Paleozoic', description: 'Cambrian explosion' },
  540: { name: 'Ediacaran', period: 'Ediacaran', era: 'Neoproterozoic', description: 'First complex life' },
  720: { name: 'Cryogenian', period: 'Cryogenian', era: 'Neoproterozoic', description: 'Snowball Earth' },
};

// HD Texture URLs - locally served for best quality and no CORS issues
const TEXTURES = {
  // Solar System Scope 8K Blue Marble (8192x4096) - served from backend
  earth: '/static/textures/earth_day_8k.jpg',
  // 2K bump/normal map for HD terrain relief (locally served for reliability)
  bump: '/static/textures/earth_bump.jpg',
  // Water specular highlights
  water: '//unpkg.com/three-globe/example/img/earth-water.png',
  // Background stars
  background: '//unpkg.com/three-globe/example/img/night-sky.png',
  // 8K night lights
  night: '/static/textures/earth_night_8k.jpg',
  // 8K clouds (static - satellite overlay provides live data)
  clouds: '/static/textures/earth_clouds_8k.jpg',
  // Paleomap texture base path (PALEOMAP PaleoAtlas textures)
  paleomapBase: '/static/textures/paleomap/eras/'
};

// Find the nearest available paleomap age for a given year (in Ma)
function findNearestPaleomapAge(yearInMa) {
  const absYearMa = Math.abs(yearInMa);

  // Find the closest available texture age
  let closest = PALEOMAP_AGES[0];
  let minDiff = Math.abs(absYearMa - closest);

  for (const age of PALEOMAP_AGES) {
    const diff = Math.abs(absYearMa - age);
    if (diff < minDiff) {
      minDiff = diff;
      closest = age;
    }
  }

  return closest;
}

// Get paleomap texture URL for a given age (in Ma)
function getPaleomapTextureUrl(ageMa) {
  // Format age with leading zeros (e.g., 066ma, 750ma)
  const formattedAge = String(ageMa).padStart(3, '0');
  return `${TEXTURES.paleomapBase}earth_${formattedAge}ma.jpg`;
}

// Load and swap to a new paleomap texture
function updatePaleomapTexture(targetAgeMa) {
  // Don't reload if we're already showing this age
  if (targetAgeMa === currentPaleomapAge) return;

  const textureUrl = getPaleomapTextureUrl(targetAgeMa);

  // Use globe.gl's built-in API to change the texture
  // This handles all the Three.js texture loading internally
  globe.globeImageUrl(textureUrl);

  currentPaleomapAge = targetAgeMa;

  // Log texture change for debugging
  log(`Switched to ${targetAgeMa}Ma paleogeography texture`);
}

// Initialize globe with HD 8K textures and enhanced detail
const globe = Globe()
  .globeImageUrl(TEXTURES.earth)
  .bumpImageUrl(TEXTURES.bump)
  .backgroundImageUrl(TEXTURES.background)
  .showAtmosphere(true)
  .atmosphereColor('#3a7bd5')
  .atmosphereAltitude(0.25)
  .onGlobeReady(() => {
    // Enhance globe material for HD quality
    const material = globe.globeMaterial();
    if (material) {
      // Increase bump scale for more dramatic terrain relief
      material.bumpScale = 4.0;
      // Enhance specular for water/ice highlights
      if (material.specular) material.specular.setHex(0x444444);
      material.shininess = 12;

      // Enable anisotropic filtering on globe texture for sharpness
      if (material.map) {
        material.map.anisotropy = 16;  // Max anisotropic filtering
        material.map.minFilter = THREE.LinearMipmapLinearFilter;
        material.map.magFilter = THREE.LinearFilter;
        material.map.generateMipmaps = true;
        material.map.needsUpdate = true;
      }

      // Enhance bump map filtering
      if (material.bumpMap) {
        material.bumpMap.anisotropy = 16;
        material.bumpMap.minFilter = THREE.LinearMipmapLinearFilter;
        material.bumpMap.needsUpdate = true;
      }

      material.needsUpdate = true;
      log('Globe material enhanced with HD filtering and bump scale');
    }

    // Increase globe geometry resolution for smoother sphere
    const globeMesh = globe.scene().children.find(c => c.type === 'Mesh' && c.geometry?.type === 'SphereGeometry');
    if (globeMesh) {
      // Replace geometry with higher resolution sphere
      const newGeometry = new THREE.SphereGeometry(100, 256, 128);
      globeMesh.geometry.dispose();
      globeMesh.geometry = newGeometry;
      log('Globe geometry upgraded to 256x128 segments for HD smoothness');
    }
  });

// Expose globe to window for debugging
window.globe = globe;

// Mount to container
const container = document.getElementById('globe-container');
globe(container);


// Add realistic atmosphere glow effect - thin limb glow, not a bubble
function addAtmosphereGlow() {
  const scene = globe.scene();
  if (!scene) return;

  // Thin atmosphere shell - only visible at the limb (edge)
  const glowGeometry = new THREE.SphereGeometry(102, 96, 48);
  const glowMaterial = new THREE.ShaderMaterial({
    uniforms: {
      glowColor: { value: new THREE.Color(0x6bb3f0) },
      glowPower: { value: 6.0 },  // Higher power = thinner glow at edges only
      glowIntensity: { value: 0.5 }
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vWorldPosition;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPos.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 glowColor;
      uniform float glowPower;
      uniform float glowIntensity;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;

      void main() {
        vec3 viewDir = normalize(cameraPosition - vWorldPosition);

        // Only show glow at the very edge (limb) of the planet
        float rim = 1.0 - max(0.0, dot(viewDir, vNormal));

        // Thin atmosphere - only visible at extreme grazing angles
        float limbGlow = pow(rim, glowPower) * glowIntensity;

        // Even thinner outer edge
        float thinEdge = pow(rim, glowPower * 1.5) * glowIntensity * 0.4;

        // Atmosphere color gradient - bluer at the limb
        vec3 limbColor = glowColor * 1.2;

        // Final alpha falls off quickly away from limb
        float finalAlpha = limbGlow + thinEdge;

        // Discard pixels that aren't at the edge
        if (finalAlpha < 0.02) discard;

        gl_FragColor = vec4(limbColor, clamp(finalAlpha, 0.0, 0.5));
      }
    `,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false
  });

  const glowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
  glowMesh.name = 'atmosphereGlow';
  glowMesh.renderOrder = 0;
  scene.add(glowMesh);

  window.erfGlowMesh = glowMesh;
  log('Atmosphere limb glow added');
}

// Add subtle horizon haze for more realism
function addHorizonHaze() {
  const scene = globe.scene();
  if (!scene) return;

  const hazeGeometry = new THREE.SphereGeometry(101.8, 128, 64);
  const hazeMaterial = new THREE.ShaderMaterial({
    uniforms: {
      hazeColor: { value: new THREE.Color(0x88bbff) },
      sunPosition: { value: new THREE.Vector3(500, 200, 500) }
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vWorldPosition;

      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPos.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 hazeColor;
      uniform vec3 sunPosition;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;

      void main() {
        vec3 viewDir = normalize(cameraPosition - vWorldPosition);
        vec3 sunDir = normalize(sunPosition);

        // Only show haze on the lit side - prevents dark side artifacts
        float sunFacing = dot(vNormal, sunDir);
        if (sunFacing < -0.05) discard;

        // Haze strongest at grazing angles (horizon)
        float viewAngle = 1.0 - abs(dot(vNormal, viewDir));
        float hazeFactor = pow(viewAngle, 4.0);

        // Only on sun-facing side, fade at terminator
        float litFactor = smoothstep(-0.05, 0.3, sunFacing);
        hazeFactor *= litFactor;

        if (hazeFactor < 0.01) discard;

        // Subtle warm tint near sun direction
        vec3 finalColor = mix(hazeColor, vec3(1.0, 0.9, 0.8), max(0.0, sunFacing) * 0.3);

        gl_FragColor = vec4(finalColor, hazeFactor * 0.12);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
    depthWrite: false
  });

  const hazeMesh = new THREE.Mesh(hazeGeometry, hazeMaterial);
  hazeMesh.name = 'horizonHaze';
  scene.add(hazeMesh);
  window.erfHorizonHaze = hazeMesh;
}

// Update atmosphere glow color and intensity based on climate state
function updateAtmosphereGlow(color, intensity = 0.4, power = 4.0) {
  if (window.erfGlowMesh && window.erfGlowMesh.material.uniforms.glowColor) {
    window.erfGlowMesh.material.uniforms.glowColor.value = new THREE.Color(color);
  }

  // Also update horizon haze color if it exists
  if (window.erfHorizonHaze && window.erfHorizonHaze.material.uniforms.hazeColor) {
    window.erfHorizonHaze.material.uniforms.hazeColor.value = new THREE.Color(color);
  }
}

// Legacy function for backwards compatibility
function updateAtmosphereGlowColor(color) {
  updateAtmosphereGlow(color);
}

// Add realistic cloud layer with proper depth handling to avoid Z-fighting
function addCloudLayer() {
  const scene = globe.scene();
  if (!scene) return;

  const textureLoader = new THREE.TextureLoader();
  textureLoader.load(TEXTURES.clouds, (cloudTexture) => {
    // Cloud layer - positioned well above globe surface to avoid Z-fighting
    const cloudGeometry = new THREE.SphereGeometry(103, 64, 32);
    const cloudMaterial = new THREE.MeshBasicMaterial({
      map: cloudTexture,
      transparent: true,
      opacity: 0.35,
      blending: THREE.NormalBlending,
      side: THREE.FrontSide,
      depthWrite: false,
      depthTest: true
    });

    const cloudMesh = new THREE.Mesh(cloudGeometry, cloudMaterial);
    cloudMesh.name = 'cloudLayer';
    cloudMesh.renderOrder = 1; // Render after globe
    // Rotate to align with globe.gl's internal mesh (longitude 0° alignment)
    cloudMesh.rotation.y = -Math.PI / 2;
    scene.add(cloudMesh);

    window.erfCloudMesh = cloudMesh;

    // Clouds now rotate with the globe naturally (no separate animation)
    // Only a very subtle drift to simulate high-altitude wind patterns
    let cloudDrift = 0;
    function animateClouds() {
      if (window.erfCloudMesh && isRotating) {
        cloudDrift += 0.00002; // Extremely slow drift relative to surface
        window.erfCloudMesh.rotation.y = cloudDrift;
      }
      requestAnimationFrame(animateClouds);
    }
    animateClouds();

    log('Cloud layer added');
  });
}

// Add cloud shadow layer for subtle darkening on Earth surface
function addCloudShadows(cloudTexture) {
  const scene = globe.scene();
  if (!scene) return;

  const shadowGeometry = new THREE.SphereGeometry(100.15, 128, 64);
  const shadowMaterial = new THREE.ShaderMaterial({
    uniforms: {
      cloudMap: { value: cloudTexture },
      sunPosition: { value: new THREE.Vector3(500, 200, 500) },
      shadowIntensity: { value: 0.25 }
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec2 vUv;

      void main() {
        vNormal = normalize(normalMatrix * normal);
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D cloudMap;
      uniform vec3 sunPosition;
      uniform float shadowIntensity;

      varying vec3 vNormal;
      varying vec2 vUv;

      void main() {
        vec3 sunDir = normalize(sunPosition);

        // Only show shadows on sun-facing side - discard dark side entirely
        float sunFacing = dot(vNormal, sunDir);
        if (sunFacing < 0.05) discard;

        // Sample cloud texture for shadow density
        float cloudDensity = texture2D(cloudMap, vUv).r;
        if (cloudDensity < 0.1) discard;

        // Shadow is darker where clouds are denser, only on lit side
        float shadowAlpha = cloudDensity * shadowIntensity * sunFacing;

        // Soft edge transition at terminator
        shadowAlpha *= smoothstep(0.05, 0.4, sunFacing);

        if (shadowAlpha < 0.01) discard;

        gl_FragColor = vec4(0.0, 0.0, 0.02, shadowAlpha);
      }
    `,
    transparent: true,
    blending: THREE.NormalBlending,
    side: THREE.FrontSide,
    depthWrite: false
  });

  const shadowMesh = new THREE.Mesh(shadowGeometry, shadowMaterial);
  shadowMesh.name = 'cloudShadow';
  // Rotate to align with globe.gl's internal mesh (longitude 0° alignment)
  shadowMesh.rotation.y = -Math.PI / 2;
  scene.add(shadowMesh);
  window.erfCloudShadow = shadowMesh;
}

// Enhance the globe's material for better visibility and lighting response
function enhanceGlobeMaterial() {
  const scene = globe.scene();
  if (!scene) return;

  // Use globe.gl's API method to modify material safely
  const globeMaterial = globe.globeMaterial();
  if (globeMaterial) {
    // Ensure material shows the texture with proper lighting
    // MeshPhongMaterial settings for optimal texture display
    if (globeMaterial.type === 'MeshPhongMaterial') {
      if (globeMaterial.color) globeMaterial.color.setHex(0xffffff);
      globeMaterial.shininess = 5; // Low shininess for natural look
      if (globeMaterial.specular) globeMaterial.specular.setHex(0x222222);
    }
    // For MeshStandardMaterial (if used)
    if (globeMaterial.roughness !== undefined) {
      globeMaterial.roughness = 0.9;
      globeMaterial.metalness = 0.0;
    }
    globeMaterial.needsUpdate = true;
    log('Globe material enhanced:', globeMaterial.type);
  }
}

// Add sunlight for realistic lighting with enhanced effects
function addSunlight() {
  const scene = globe.scene();
  if (!scene) return;

  // Main directional sunlight - positioned to illuminate front of Earth
  const sunLight = new THREE.DirectionalLight(0xffffff, 3.0);
  sunLight.position.set(200, 100, 300); // More frontal position
  scene.add(sunLight);
  window.erfSunLight = sunLight;

  // Very strong ambient light for overall visibility (critical for dark textures)
  const ambientLight = new THREE.AmbientLight(0xffffff, 2.5);
  scene.add(ambientLight);

  // Fill light from front-left
  const fillLight = new THREE.DirectionalLight(0xffffff, 2.0);
  fillLight.position.set(-200, 50, 300);
  scene.add(fillLight);

  // Additional front fill light
  const frontLight = new THREE.DirectionalLight(0xffffff, 1.5);
  frontLight.position.set(0, 0, 400);
  scene.add(frontLight);

  // Hemisphere light for natural sky/ground lighting gradient
  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x888888, 1.5);
  scene.add(hemiLight);

  log('Lighting setup complete - enhanced for visibility');
}

// Add Fresnel rim lighting effect shader to Earth
function addFresnelRimLight() {
  const scene = globe.scene();
  if (!scene) return;

  // Create rim light sphere slightly larger than Earth
  const rimGeometry = new THREE.SphereGeometry(100.3, 128, 64);
  const rimMaterial = new THREE.ShaderMaterial({
    uniforms: {
      sunPosition: { value: new THREE.Vector3(500, 200, 500) },
      rimColor: { value: new THREE.Color(0x88ccff) },
      rimPower: { value: 2.0 },
      rimIntensity: { value: 0.6 }
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vWorldPosition;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPos.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 sunPosition;
      uniform vec3 rimColor;
      uniform float rimPower;
      uniform float rimIntensity;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;

      void main() {
        vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
        vec3 sunDirection = normalize(sunPosition - vWorldPosition);

        // Only show rim on the lit side - reduces dark side artifacts
        float sunFacing = dot(vNormal, sunDirection);
        if (sunFacing < -0.1) discard;

        // Fresnel effect - stronger at edges
        float fresnel = pow(1.0 - max(0.0, dot(viewDirection, vNormal)), rimPower);

        // Stronger rim on the sun-facing side (terminator line effect)
        float terminatorBoost = smoothstep(0.0, 0.5, sunFacing) * (1.0 - smoothstep(0.5, 1.0, sunFacing));

        // Combine for final rim effect - fade at terminator
        float rim = fresnel * (0.5 + terminatorBoost * 0.8) * rimIntensity;
        rim *= smoothstep(-0.1, 0.2, sunFacing);

        if (rim < 0.01) discard;

        gl_FragColor = vec4(rimColor, rim * 0.5);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
    depthWrite: false
  });

  const rimMesh = new THREE.Mesh(rimGeometry, rimMaterial);
  rimMesh.name = 'fresnelRim';
  scene.add(rimMesh);
  window.erfFresnelRim = rimMesh;
}

// Add ocean specular highlights
function addOceanSpecular() {
  const scene = globe.scene();
  if (!scene) return;

  // Create specular highlight sphere for ocean reflections
  const specGeometry = new THREE.SphereGeometry(100.2, 128, 64);

  const textureLoader = new THREE.TextureLoader();
  const waterTexture = textureLoader.load(TEXTURES.water);

  const specMaterial = new THREE.ShaderMaterial({
    uniforms: {
      sunPosition: { value: new THREE.Vector3(500, 200, 500) },
      waterMap: { value: waterTexture },
      specularColor: { value: new THREE.Color(0xffffff) },
      specularPower: { value: 64.0 },
      specularIntensity: { value: 0.8 }
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vWorldPosition;
      varying vec2 vUv;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vUv = uv;
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPos.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 sunPosition;
      uniform sampler2D waterMap;
      uniform vec3 specularColor;
      uniform float specularPower;
      uniform float specularIntensity;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;
      varying vec2 vUv;

      void main() {
        vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
        vec3 sunDirection = normalize(sunPosition - vWorldPosition);

        // Check if surface faces the sun - skip dark side entirely
        float sunFacing = dot(vNormal, sunDirection);
        if (sunFacing < 0.0) discard;

        // Reflection vector for specular
        vec3 reflectDir = reflect(-sunDirection, vNormal);
        float specular = pow(max(0.0, dot(viewDirection, reflectDir)), specularPower);

        // Only apply specular to water areas (water map is white for water)
        float waterMask = texture2D(waterMap, vUv).r;

        // Stronger specular at grazing angles (Fresnel)
        float fresnel = pow(1.0 - max(0.0, dot(viewDirection, vNormal)), 3.0);

        float finalSpecular = specular * waterMask * specularIntensity * (0.5 + fresnel * 0.5);

        // Fade at terminator for smooth transition
        finalSpecular *= smoothstep(0.0, 0.15, sunFacing);

        if (finalSpecular < 0.01) discard;

        gl_FragColor = vec4(specularColor, finalSpecular * 0.6);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
    depthWrite: false
  });

  const specMesh = new THREE.Mesh(specGeometry, specMaterial);
  specMesh.name = 'oceanSpecular';
  scene.add(specMesh);
  window.erfOceanSpecular = specMesh;
}

// Add night side city lights with smooth day/night transition
// Uses NASA's Earth at Night texture which shows real city lights based on actual light pollution
function addNightLights() {
  const scene = globe.scene();
  if (!scene) return;

  const textureLoader = new THREE.TextureLoader();
  const nightTexture = textureLoader.load(TEXTURES.night, (texture) => {
    // Enable high quality filtering for HD appearance
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = 16;  // Maximum anisotropic filtering
    texture.generateMipmaps = true;
  });

  // Higher resolution geometry for smooth HD appearance
  const nightGeometry = new THREE.SphereGeometry(100.15, 128, 64);
  const nightMaterial = new THREE.ShaderMaterial({
    uniforms: {
      nightMap: { value: nightTexture },
      sunDirection: { value: new THREE.Vector3(0, 0, 1) },
      lightsIntensity: { value: 2.5 },
      glowRadius: { value: 1.8 }
    },
    vertexShader: `
      varying vec3 vWorldNormal;
      varying vec2 vUv;

      void main() {
        vWorldNormal = normalize((modelMatrix * vec4(position, 0.0)).xyz);
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D nightMap;
      uniform vec3 sunDirection;
      uniform float lightsIntensity;
      uniform float glowRadius;

      varying vec3 vWorldNormal;
      varying vec2 vUv;

      void main() {
        vec3 normal = normalize(vWorldNormal);
        vec3 toSun = normalize(sunDirection);

        // Night factor - smooth transition at terminator
        float sunFacing = dot(normal, toSun);
        float nightFactor = smoothstep(0.12, -0.18, sunFacing);

        if (nightFactor < 0.01) discard;

        // HD texture sampling with subtle blur for glow effect
        vec3 cityLights = texture2D(nightMap, vUv).rgb;

        // Sample nearby pixels for soft glow halo
        vec2 texelSize = vec2(1.0 / 4096.0, 1.0 / 2048.0);  // Assuming 8K texture
        vec3 glow = vec3(0.0);
        glow += texture2D(nightMap, vUv + texelSize * vec2(-1.0, 0.0)).rgb;
        glow += texture2D(nightMap, vUv + texelSize * vec2(1.0, 0.0)).rgb;
        glow += texture2D(nightMap, vUv + texelSize * vec2(0.0, -1.0)).rgb;
        glow += texture2D(nightMap, vUv + texelSize * vec2(0.0, 1.0)).rgb;
        glow += texture2D(nightMap, vUv + texelSize * vec2(-1.0, -1.0)).rgb * 0.5;
        glow += texture2D(nightMap, vUv + texelSize * vec2(1.0, 1.0)).rgb * 0.5;
        glow += texture2D(nightMap, vUv + texelSize * vec2(-1.0, 1.0)).rgb * 0.5;
        glow += texture2D(nightMap, vUv + texelSize * vec2(1.0, -1.0)).rgb * 0.5;
        glow /= 6.0;

        // Combine sharp lights with soft glow
        vec3 combined = cityLights + glow * 0.4 * glowRadius;

        float brightness = max(max(combined.r, combined.g), combined.b);
        if (brightness < 0.015) discard;

        // Gamma correction for more natural light falloff
        combined = pow(combined, vec3(0.85)) * lightsIntensity;

        // Warm golden glow color
        vec3 warmGlow = combined * vec3(1.0, 0.88, 0.65);

        // Subtle color variation - brighter areas are whiter
        warmGlow = mix(warmGlow, combined * vec3(1.0, 0.95, 0.85), brightness * 0.3);

        // Smooth alpha with soft edges
        float alpha = nightFactor * pow(brightness, 0.6) * 1.3;
        alpha = clamp(alpha, 0.0, 0.92);

        gl_FragColor = vec4(warmGlow, alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
    depthWrite: false
  });

  const nightMesh = new THREE.Mesh(nightGeometry, nightMaterial);
  nightMesh.name = 'nightLights';
  nightMesh.renderOrder = 15;
  // Rotate to align with globe.gl's internal mesh (longitude 0° alignment)
  nightMesh.rotation.y = -Math.PI / 2;
  scene.add(nightMesh);
  window.erfNightLights = nightMesh;

  updateNightLights();
}

/**
 * Update city lights sun direction to match day/night cycle
 */
function updateNightLights() {
  if (!window.erfNightLights) return;

  const sunPos = getSunPosition();

  // Use same formula as updateDayNightOverlay for consistency
  const phi = (90 - sunPos.lat) * (Math.PI / 180);
  const theta = (sunPos.lon + 90) * (Math.PI / 180);

  const sunDir = new THREE.Vector3(
    -Math.cos(theta) * Math.sin(phi),
    Math.cos(phi),
    Math.sin(theta) * Math.sin(phi)
  ).normalize();

  window.erfNightLights.material.uniforms.sunDirection.value = sunDir;
}

// Add a visible sun object with lens flare effect
function addSunObject() {
  const scene = globe.scene();
  if (!scene) return;

  // Create sun sphere - bright and glowing
  const sunGeometry = new THREE.SphereGeometry(30, 32, 32);
  const sunMaterial = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 }
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec2 vUv;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float time;
      varying vec3 vNormal;
      varying vec2 vUv;

      // Noise function for sun surface
      float noise(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }

      void main() {
        // Base sun color - warm yellow-white
        vec3 sunCore = vec3(1.0, 0.98, 0.9);
        vec3 sunEdge = vec3(1.0, 0.7, 0.3);
        vec3 sunOuter = vec3(1.0, 0.4, 0.1);

        // Fresnel for limb darkening
        vec3 viewDir = normalize(cameraPosition);
        float fresnel = dot(vNormal, viewDir);

        // Limb darkening effect
        float limbDarken = pow(fresnel, 0.4);

        // Add noise for surface texture
        float surfaceNoise = noise(vUv * 50.0 + time * 0.1) * 0.1;

        // Color gradient from edge to center
        vec3 sunColor = mix(sunOuter, mix(sunEdge, sunCore, fresnel), fresnel);
        sunColor = sunColor * (0.9 + surfaceNoise) * limbDarken;

        gl_FragColor = vec4(sunColor, 1.0);
      }
    `,
    blending: THREE.AdditiveBlending
  });

  const sunMesh = new THREE.Mesh(sunGeometry, sunMaterial);
  sunMesh.position.set(500, 200, 500);
  sunMesh.name = 'sun';
  scene.add(sunMesh);
  window.erfSun = sunMesh;

  // Add sun corona/glow
  const coronaGeometry = new THREE.SphereGeometry(60, 32, 32);
  const coronaMaterial = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 }
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vPosition;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float time;
      varying vec3 vNormal;
      varying vec3 vPosition;

      void main() {
        vec3 viewDir = normalize(cameraPosition - vPosition);
        float glow = pow(1.0 - abs(dot(viewDir, vNormal)), 3.0);

        // Animate corona slightly
        float pulse = 0.9 + 0.1 * sin(time * 0.5);

        vec3 coronaColor = vec3(1.0, 0.85, 0.5) * glow * pulse * 0.8;

        gl_FragColor = vec4(coronaColor, glow * 0.6);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    depthWrite: false
  });

  const coronaMesh = new THREE.Mesh(coronaGeometry, coronaMaterial);
  coronaMesh.position.copy(sunMesh.position);
  coronaMesh.name = 'sunCorona';
  scene.add(coronaMesh);
  window.erfSunCorona = coronaMesh;

  // Animate sun
  function animateSun() {
    const time = performance.now() * 0.001;
    if (window.erfSun) {
      window.erfSun.material.uniforms.time.value = time;
    }
    if (window.erfSunCorona) {
      window.erfSunCorona.material.uniforms.time.value = time;
    }
    requestAnimationFrame(animateSun);
  }
  animateSun();
}

// Add twinkling star field with depth and parallax
function addTwinklingStars() {
  const scene = globe.scene();
  if (!scene) return;

  // Create multiple layers of stars for depth effect
  const starLayers = [
    { count: 2000, size: 0.3, distance: 800, twinkleSpeed: 0.5 },
    { count: 1500, size: 0.5, distance: 1200, twinkleSpeed: 0.3 },
    { count: 800, size: 0.8, distance: 2000, twinkleSpeed: 0.2 }
  ];

  starLayers.forEach((layer, idx) => {
    const geometry = new THREE.BufferGeometry();
    const positions = [];
    const colors = [];
    const sizes = [];
    const twinkle = [];

    for (let i = 0; i < layer.count; i++) {
      // Random position on sphere
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = layer.distance;

      positions.push(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi)
      );

      // Star colors - mostly white with some colored stars
      const colorChoice = Math.random();
      if (colorChoice < 0.7) {
        // White/blue-white stars
        colors.push(0.95 + Math.random() * 0.05, 0.95 + Math.random() * 0.05, 1.0);
      } else if (colorChoice < 0.85) {
        // Yellow stars
        colors.push(1.0, 0.95, 0.7);
      } else if (colorChoice < 0.95) {
        // Orange/red stars
        colors.push(1.0, 0.7, 0.5);
      } else {
        // Blue stars
        colors.push(0.7, 0.8, 1.0);
      }

      sizes.push(layer.size * (0.5 + Math.random() * 0.5));
      twinkle.push(Math.random() * Math.PI * 2); // Random phase
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));
    geometry.setAttribute('twinklePhase', new THREE.Float32BufferAttribute(twinkle, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        twinkleSpeed: { value: layer.twinkleSpeed }
      },
      vertexShader: `
        attribute float size;
        attribute float twinklePhase;
        attribute vec3 color;

        varying vec3 vColor;
        varying float vTwinkle;

        uniform float time;
        uniform float twinkleSpeed;

        void main() {
          vColor = color;
          vTwinkle = 0.6 + 0.4 * sin(time * twinkleSpeed + twinklePhase);

          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (300.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vTwinkle;

        void main() {
          // Circular star with soft edges
          float dist = length(gl_PointCoord - vec2(0.5));
          if (dist > 0.5) discard;

          float intensity = 1.0 - smoothstep(0.0, 0.5, dist);
          intensity *= vTwinkle;

          gl_FragColor = vec4(vColor * intensity, intensity);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const starField = new THREE.Points(geometry, material);
    starField.name = `starField_${idx}`;
    scene.add(starField);

    if (!window.erfStarFields) window.erfStarFields = [];
    window.erfStarFields.push(starField);
  });

  // Animate twinkling
  function animateStars() {
    const time = performance.now() * 0.001;
    if (window.erfStarFields) {
      window.erfStarFields.forEach(field => {
        field.material.uniforms.time.value = time;
      });
    }
    requestAnimationFrame(animateStars);
  }
  animateStars();
}

// Add subtle screen-space bloom effect using post-processing layer
function addBloomEffect() {
  const renderer = globe.renderer();
  if (!renderer) return;

  // Enable high dynamic range
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  log('Bloom-ready renderer settings applied');
}

// Add continuous Earth rotation with toggle
function startEarthRotation() {
  const controls = globe.controls();
  if (controls) {
    controls.autoRotate = isRotating;
    controls.autoRotateSpeed = 0.5;
  }
}

function toggleRotation() {
  isRotating = !isRotating;
  const controls = globe.controls();
  if (controls) {
    controls.autoRotate = isRotating;
  }
  const btn = document.getElementById('rotation-btn');
  const textSpan = document.getElementById('rotation-text');
  if (btn) {
    btn.classList.toggle('active', isRotating);
    if (textSpan) textSpan.textContent = isRotating ? 'Rotating' : 'Paused';
  }
}

// Toggle layer visibility functions
function toggleClouds() {
  showClouds = !showClouds;
  if (window.erfCloudMesh) {
    window.erfCloudMesh.visible = showClouds;
  }
  updateToggleButton('clouds-btn', showClouds);
}

function toggleIceCaps() {
  showIceCaps = !showIceCaps;
  if (window.erfIceCaps) {
    window.erfIceCaps.north.visible = showIceCaps;
    window.erfIceCaps.south.visible = showIceCaps;
  }
  updateToggleButton('ice-btn', showIceCaps);
}

function toggleAtmosphere() {
  showAtmosphere = !showAtmosphere;
  if (window.erfGlowMesh) {
    window.erfGlowMesh.visible = showAtmosphere;
  }
  if (window.erfHorizonHaze) {
    window.erfHorizonHaze.visible = showAtmosphere;
  }
  // Also toggle globe.gl's built-in atmosphere
  globe.showAtmosphere(showAtmosphere);
  updateToggleButton('atmosphere-btn', showAtmosphere);
}

function toggleStars() {
  showStars = !showStars;
  if (window.erfStarFields) {
    window.erfStarFields.forEach(field => {
      field.visible = showStars;
    });
  }
  updateToggleButton('stars-btn', showStars);
}

function toggleStorms() {
  showStorms = !showStorms;

  if (showStorms) {
    // Start storm system
    initializeStormSystem();
  } else {
    // Stop storm system
    stopStormSystem();
  }

  updateToggleButton('storms-btn', showStorms);
}

// Initialize the storm visualization system
async function initializeStormSystem() {
  const scene = globe.scene();
  if (!scene) return;

  log('Initializing storm system...');

  // Fetch initial storm data
  await refreshStormData();

  // Start animation
  startStormAnimation();

  // Set up periodic updates
  if (!stormUpdateInterval) {
    stormUpdateInterval = setInterval(refreshStormData, STORM_UPDATE_INTERVAL);
  }

  log('Storm system initialized');
}

// Stop the storm system
function stopStormSystem() {
  const scene = globe.scene();

  // Stop animation
  stopStormAnimation();

  // Clear update interval
  if (stormUpdateInterval) {
    clearInterval(stormUpdateInterval);
    stormUpdateInterval = null;
  }

  // Remove storm meshes
  if (scene) {
    clearStorms(scene);
  }

  activeStorms = [];
  log('Storm system stopped');
}

// Refresh storm data from API
async function refreshStormData() {
  if (!showStorms) return;

  try {
    activeStorms = await getActiveStorms();

    const scene = globe.scene();
    if (scene) {
      const count = updateStorms(activeStorms, scene, 100);
      log(`Updated ${count} active storms`);

      // Update storm info panel if it exists
      updateStormInfoPanel();
    }
  } catch (error) {
    console.warn('Failed to refresh storm data:', error);
  }
}

// Update storm information display
function updateStormInfoPanel() {
  const panel = document.getElementById('storm-info');
  if (!panel) return;

  if (activeStorms.length === 0) {
    panel.innerHTML = '<div class="no-storms">No active storms</div>';
    return;
  }

  const stormList = activeStorms.map(storm => {
    const windMph = convertWindSpeed(storm.windSpeed, 'mph');
    return `
      <div class="storm-item" style="border-left: 3px solid ${storm.color}">
        <div class="storm-name">${storm.name}</div>
        <div class="storm-type">${storm.type} - Cat ${storm.category || 'N/A'}</div>
        <div class="storm-details">
          <span>${windMph} mph</span>
          <span>${storm.pressure} mb</span>
        </div>
      </div>
    `;
  }).join('');

  panel.innerHTML = stormList;
}

// ============================================
// Historical Storms System
// ============================================

// Toggle historical storms mode
function toggleHistoricalStormsMode() {
  historicalStormsMode = !historicalStormsMode;
  const panel = document.getElementById('historical-storms-panel');

  if (historicalStormsMode) {
    // Stop live storms
    if (showStorms) {
      stopStormSystem();
    }
    // Load and show notable storms panel
    loadNotableStorms();
    if (panel) panel.classList.add('visible');
  } else {
    // Hide panel and clear historical storm
    if (panel) panel.classList.remove('visible');
    clearHistoricalStorm();
    // Restart live storms if enabled
    if (showStorms) {
      initializeStormSystem();
    }
  }

  updateToggleButton('history-storms-btn', historicalStormsMode);
}

// Load notable storms from API
async function loadNotableStorms() {
  try {
    log('Loading notable storms...');
    notableStorms = await getNotableStorms();
    log(`Loaded ${notableStorms.length} notable storms`);
    updateHistoricalStormsPanel();
  } catch (error) {
    console.warn('Failed to load notable storms:', error);
    notableStorms = [];
  }
}

// Update the historical storms panel UI
function updateHistoricalStormsPanel() {
  const listContainer = document.getElementById('notable-storms-list');
  if (!listContainer) return;

  if (notableStorms.length === 0) {
    listContainer.innerHTML = '<div class="no-storms-msg">Loading storms...</div>';
    return;
  }

  const stormItems = notableStorms.map(storm => {
    const year = storm.year || new Date(storm.start_date).getFullYear();
    const category = storm.peak_category >= 0 ? `Cat ${storm.peak_category}` : 'TS';
    const windMph = storm.peak_wind_mph || Math.round((storm.peak_wind_kts || 0) * 1.151);
    const deaths = storm.deaths ? `${storm.deaths.toLocaleString()} deaths` : '';
    const damage = storm.damage_usd ? `$${(storm.damage_usd / 1e9).toFixed(1)}B` : '';
    const safeCatClass = Math.max(0, parseInt(storm.peak_category, 10) || 0);

    return `
      <div class="notable-storm-item selectable-storm" data-storm-id="${escapeHtml(storm.id)}">
        <div class="notable-storm-header">
          <span class="notable-storm-name">${escapeHtml(storm.name)}</span>
          <span class="notable-storm-year">${escapeHtml(String(year))}</span>
        </div>
        <div class="notable-storm-stats">
          <span class="notable-storm-cat cat-${safeCatClass}">${escapeHtml(category)}</span>
          <span class="notable-storm-wind">${escapeHtml(String(windMph))} mph</span>
          ${deaths ? `<span class="notable-storm-deaths">${escapeHtml(deaths)}</span>` : ''}
          ${damage ? `<span class="notable-storm-damage">${escapeHtml(damage)}</span>` : ''}
        </div>
      </div>
    `;
  }).join('');

  listContainer.innerHTML = stormItems;
}

// Select and display a historical storm with track
window.selectHistoricalStorm = async function(stormId) {
  log(`Selecting historical storm: ${stormId}`);

  try {
    // Fetch full storm data with track
    const stormData = await getStormById(stormId);
    if (!stormData) {
      console.warn('Storm not found:', stormId);
      return;
    }

    // Clear any previous historical storm
    clearHistoricalStorm();

    // Convert to visualization format
    selectedHistoricalStorm = convertHistoricalStorm(stormData);
    log(`Loaded storm: ${selectedHistoricalStorm.name} with ${stormData.track?.length || 0} track points`);

    // Update selection UI
    document.querySelectorAll('.notable-storm-item').forEach(el => {
      el.classList.remove('selected');
    });
    const selectedEl = document.querySelector(`[data-storm-id="${stormId}"]`);
    if (selectedEl) selectedEl.classList.add('selected');

    // Display storm on globe
    displayHistoricalStorm(selectedHistoricalStorm);

    // Show storm details panel
    updateSelectedStormDetails(selectedHistoricalStorm);

  } catch (error) {
    console.warn('Failed to load storm:', error);
  }
};

// Display historical storm with track on globe
function displayHistoricalStorm(storm) {
  const scene = globe.scene();
  if (!scene) return;

  // Create storm cyclone mesh at peak position
  const stormArray = [storm];
  updateStorms(stormArray, scene, 100);
  startStormAnimation();

  // Create track line from storm track data
  if (storm.track && storm.track.length > 1) {
    const trackPositions = storm.track.map(point => ({
      lat: point.lat,
      lon: point.lon
    }));

    const trackLine = createTrackLine(trackPositions, storm, 100);
    trackLine.renderOrder = 999;
    scene.add(trackLine);
    stormTrackLines.push(trackLine);

    // Add track point markers for key positions
    addTrackMarkers(storm.track, storm, scene);

    log(`Created track line with ${trackPositions.length} points`);
  }

  // Focus camera on storm
  if (storm.lat && storm.lon) {
    globe.pointOfView({ lat: storm.lat, lng: storm.lon, altitude: 2.5 }, 1500);
  }
}

// Add small markers along the track showing intensity changes
function addTrackMarkers(track, storm, scene) {
  if (!track || track.length < 2) return;

  // Add markers every few points
  const step = Math.max(1, Math.floor(track.length / 15));

  for (let i = 0; i < track.length; i += step) {
    const point = track[i];
    const category = point.category || 0;

    // Get color based on category at this point
    const colors = {
      [-1]: 0x5ebaff, // TD
      0: 0x5ebaff,    // TS
      1: 0x00faf4,    // Cat 1
      2: 0xffffcc,    // Cat 2
      3: 0xffe775,    // Cat 3
      4: 0xffc140,    // Cat 4
      5: 0xff6060     // Cat 5
    };
    const color = colors[category] || colors[0];

    // Create small sphere marker
    const size = 0.3 + Math.max(0, category) * 0.15;
    const geometry = new THREE.SphereGeometry(size, 8, 8);
    const material = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.8
    });
    const marker = new THREE.Mesh(geometry, material);

    // Position on globe
    const phi = (90 - point.lat) * (Math.PI / 180);
    const theta = (-point.lon + 180) * (Math.PI / 180);
    const r = 100.5;
    marker.position.set(
      -r * Math.sin(phi) * Math.cos(theta),
      r * Math.cos(phi),
      r * Math.sin(phi) * Math.sin(theta)
    );

    marker.renderOrder = 998;
    scene.add(marker);
    stormTrackLines.push(marker); // Store for cleanup
  }
}

// Clear historical storm visualization
function clearHistoricalStorm() {
  const scene = globe.scene();
  if (!scene) return;

  // Clear storm mesh
  clearStorms(scene);
  stopStormAnimation();

  // Clear track lines and markers
  stormTrackLines.forEach(obj => {
    scene.remove(obj);
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) obj.material.dispose();
  });
  stormTrackLines = [];

  selectedHistoricalStorm = null;
}

// Update the selected storm details panel
function updateSelectedStormDetails(storm) {
  const detailsEl = document.getElementById('selected-storm-details');
  if (!detailsEl) return;

  const windMph = convertWindSpeed(storm.windSpeed, 'mph');
  const startDate = storm.timestamp ? new Date(storm.timestamp).toLocaleDateString() : 'Unknown';
  const categoryDesc = storm.categoryName || getIntensityDescription(storm.windSpeed);

  let html = `
    <div class="selected-storm-name">${escapeHtml(storm.name)}</div>
    <div class="selected-storm-category">${escapeHtml(categoryDesc)}</div>
    <div class="selected-storm-info">
  `;

  // Genesis/Origin information
  if (storm.genesisLocation) {
    html += `
      <div class="storm-detail-section">
        <div class="detail-section-header">Origin</div>
        <div class="storm-detail-row">
          <span class="detail-label">Formed in:</span>
          <span class="detail-value">${escapeHtml(storm.genesisLocation)}</span>
        </div>
      </div>
    `;
  }

  // Peak intensity location
  if (storm.peakLocation) {
    html += `
      <div class="storm-detail-row">
        <span class="detail-label">Peak near:</span>
        <span class="detail-value">${escapeHtml(storm.peakLocation)}</span>
      </div>
    `;
  }

  // Core stats section
  html += `
      <div class="storm-detail-section">
        <div class="detail-section-header">Intensity</div>
        <div class="storm-detail-row">
          <span class="detail-label">Max Winds:</span>
          <span class="detail-value">${escapeHtml(String(windMph))} mph (${escapeHtml(String(storm.windSpeed))} kt)</span>
        </div>
        <div class="storm-detail-row">
          <span class="detail-label">Min Pressure:</span>
          <span class="detail-value">${escapeHtml(String(storm.pressure))} mb</span>
        </div>
  `;

  // ACE (Accumulated Cyclone Energy)
  if (storm.ace) {
    html += `
        <div class="storm-detail-row">
          <span class="detail-label">ACE:</span>
          <span class="detail-value">${escapeHtml(storm.ace.toFixed(1))}</span>
        </div>
    `;
  }

  // Rapid intensification
  if (storm.rapidIntensification) {
    html += `
        <div class="storm-detail-row highlight">
          <span class="detail-value warning">Rapid Intensification</span>
        </div>
    `;
  }

  html += `</div>`;

  // Duration and size
  if (storm.durationDays || storm.maxSizeKm) {
    html += `<div class="storm-detail-section"><div class="detail-section-header">Size & Duration</div>`;
    if (storm.durationDays) {
      html += `
        <div class="storm-detail-row">
          <span class="detail-label">Duration:</span>
          <span class="detail-value">${escapeHtml(String(storm.durationDays))} days</span>
        </div>
      `;
    }
    if (storm.maxSizeKm) {
      html += `
        <div class="storm-detail-row">
          <span class="detail-label">Max Size:</span>
          <span class="detail-value">${escapeHtml(String(storm.maxSizeKm))} km</span>
        </div>
      `;
    }
    html += `</div>`;
  }

  // Landfalls section
  if (storm.landfallCount > 0 && storm.landfalls?.length > 0) {
    const safeCount = parseInt(storm.landfallCount, 10) || 0;
    html += `
      <div class="storm-detail-section">
        <div class="detail-section-header">Landfalls (${escapeHtml(String(safeCount))})</div>
    `;
    // Show unique landfall locations
    const uniqueLocations = [...new Set(storm.landfalls.map(lf => lf.location_name).filter(Boolean))];
    for (const loc of uniqueLocations.slice(0, 3)) {
      const landfall = storm.landfalls.find(lf => lf.location_name === loc);
      const catName = landfall.category >= 3 ? 'Major' : landfall.category >= 1 ? `Cat ${landfall.category}` : 'TS';
      const windMphLandfall = Math.round(landfall.wind_kts * 1.151);
      html += `
        <div class="storm-detail-row landfall">
          <span class="detail-label">${escapeHtml(loc)}:</span>
          <span class="detail-value">${escapeHtml(catName)} (${escapeHtml(String(windMphLandfall))} mph)</span>
        </div>
      `;
    }
    html += `</div>`;
  }

  // Affected areas
  if (storm.affectedAreas?.length > 0) {
    html += `
      <div class="storm-detail-section">
        <div class="detail-section-header">Affected Areas</div>
        <div class="storm-affected-areas">
          ${storm.affectedAreas.map(area => `<span class="affected-area-tag">${escapeHtml(area)}</span>`).join('')}
        </div>
      </div>
    `;
  }

  // Impact section
  if (storm.deaths || storm.damage_usd) {
    html += `<div class="storm-detail-section"><div class="detail-section-header">Impact</div>`;
    if (storm.deaths) {
      const deathsStr = typeof storm.deaths === 'number' ? storm.deaths.toLocaleString() : String(storm.deaths);
      html += `
        <div class="storm-detail-row deaths">
          <span class="detail-label">Fatalities:</span>
          <span class="detail-value">${escapeHtml(deathsStr)}</span>
        </div>
      `;
    }
    if (storm.damage_usd) {
      const damageStr = storm.damage_usd >= 1e9
        ? `$${(storm.damage_usd / 1e9).toFixed(1)} billion`
        : `$${(storm.damage_usd / 1e6).toFixed(0)} million`;
      html += `
        <div class="storm-detail-row damage">
          <span class="detail-label">Damage:</span>
          <span class="detail-value">${escapeHtml(damageStr)}</span>
        </div>
      `;
    }
    html += `</div>`;
  }

  html += `</div>`;
  detailsEl.innerHTML = html;
  detailsEl.classList.add('visible');
}

// Get readable basin name
function getBasinName(code) {
  const basins = {
    'NA': 'North Atlantic',
    'EP': 'Eastern Pacific',
    'WP': 'Western Pacific',
    'NI': 'North Indian',
    'SI': 'South Indian',
    'SP': 'South Pacific',
    'SA': 'South Atlantic'
  };
  return basins[code] || code || 'Unknown';
}

// Create the historical storms panel UI
function createHistoricalStormsPanel() {
  const panel = document.createElement('div');
  panel.id = 'historical-storms-panel';

  panel.innerHTML = `
    <div class="panel-header">
      <span>Notable Storms</span>
      <button class="panel-close-btn toggle-historical-btn">
        <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
      </button>
    </div>
    <div class="panel-subtitle">Historic hurricanes, typhoons & cyclones</div>
    <div id="notable-storms-list" class="notable-storms-list">
      <div class="no-storms-msg">Loading storms...</div>
    </div>
    <div id="selected-storm-details" class="selected-storm-details"></div>
  `;

  document.body.appendChild(panel);
}

// Make toggle function globally available
window.toggleHistoricalStormsMode = toggleHistoricalStormsMode;

// ============================================
// Live Storm Click Handling
// ============================================

// Create the live storm info popup panel
function createLiveStormInfoPanel() {
  const panel = document.createElement('div');
  panel.id = 'live-storm-info';
  panel.className = 'live-storm-info';
  panel.innerHTML = `
    <button class="live-storm-close close-storm-info-btn">
      <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
    </button>
    <div id="live-storm-content"></div>
  `;
  document.body.appendChild(panel);
}

// Show live storm info when clicked
function showLiveStormInfo(storm) {
  selectedLiveStorm = storm;
  const panel = document.getElementById('live-storm-info');
  const content = document.getElementById('live-storm-content');
  if (!panel || !content) return;

  const windMph = convertWindSpeed(storm.windSpeed, 'mph');
  const safeCategory = parseInt(storm.category, 10) || 0;

  // Determine badge type
  let badge = '';
  if (storm.isDemo) {
    badge = '<span class="demo-badge">Demo</span>';
  } else if (storm.isRecent) {
    badge = `<span class="recent-badge">${escapeHtml(String(storm.year))}</span>`;
  } else {
    badge = '<span class="live-badge">Live</span>';
  }

  // Show impact data for recent storms
  let impactHtml = '';
  if (storm.isRecent && (storm.deaths || storm.damage_usd)) {
    const damageStr = storm.damage_usd ? (storm.damage_usd >= 1e9 ? `$${(storm.damage_usd / 1e9).toFixed(0)}B` : `$${(storm.damage_usd / 1e6).toFixed(0)}M`) : '';
    impactHtml = `
      <div class="live-storm-impact">
        ${storm.deaths ? `<span class="impact-deaths">${escapeHtml(String(storm.deaths))} deaths</span>` : ''}
        ${damageStr ? `<span class="impact-damage">${escapeHtml(damageStr)} damage</span>` : ''}
      </div>
    `;
  }

  const directionName = getDirectionName(storm.direction);
  const basinName = getBasinName(storm.basin);
  const categoryDisplay = storm.category >= 0 ? escapeHtml(String(storm.category)) : 'TD';

  content.innerHTML = `
    <div class="live-storm-header">
      <span class="live-storm-name">${escapeHtml(storm.name)}</span>
      ${badge}
    </div>
    <div class="live-storm-type">${escapeHtml(storm.type)}</div>
    <div class="live-storm-stats">
      <div class="live-stat">
        <span class="live-stat-label">Category</span>
        <span class="live-stat-value cat-${safeCategory}">${categoryDisplay}</span>
      </div>
      <div class="live-stat">
        <span class="live-stat-label">Max Winds</span>
        <span class="live-stat-value">${escapeHtml(String(windMph))} mph</span>
      </div>
      <div class="live-stat">
        <span class="live-stat-label">Pressure</span>
        <span class="live-stat-value">${escapeHtml(String(storm.pressure))} mb</span>
      </div>
      <div class="live-stat">
        <span class="live-stat-label">Movement</span>
        <span class="live-stat-value">${escapeHtml(String(storm.speed))} kt ${escapeHtml(directionName)}</span>
      </div>
    </div>
    ${impactHtml}
    <div class="live-storm-coords">
      <span>${escapeHtml(Math.abs(storm.lat).toFixed(1))}°${storm.lat >= 0 ? 'N' : 'S'}</span>
      <span>${escapeHtml(Math.abs(storm.lon).toFixed(1))}°${storm.lon >= 0 ? 'E' : 'W'}</span>
    </div>
    <div class="live-storm-basin">${escapeHtml(basinName)}</div>
  `;

  panel.classList.add('visible');
}

// Close live storm info panel
window.closeLiveStormInfo = function() {
  selectedLiveStorm = null;
  const panel = document.getElementById('live-storm-info');
  if (panel) {
    panel.classList.remove('visible');
  }
};

// Get compass direction name from degrees
function getDirectionName(degrees) {
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const index = Math.round(((degrees % 360) / 22.5)) % 16;
  return directions[index] || '';
}

// ============================================
// EARTHQUAKE INFO PANEL
// ============================================

// Create earthquake info panel
function createEarthquakeInfoPanel() {
  const panel = document.createElement('div');
  panel.id = 'earthquake-info';
  panel.className = 'event-info-panel earthquake-info';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'event-info-close';
  closeBtn.onclick = () => closeEarthquakeInfo();
  closeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';

  const content = document.createElement('div');
  content.id = 'earthquake-content';

  panel.appendChild(closeBtn);
  panel.appendChild(content);
  document.body.appendChild(panel);
}

// Show earthquake info when clicked
function showEarthquakeInfo(quake) {
  const panel = document.getElementById('earthquake-info');
  const content = document.getElementById('earthquake-content');
  if (!panel || !content) return;

  const timeAgo = getTimeAgo(quake.time);
  const localTime = quake.time.toLocaleString();
  const depthMiles = (quake.depth * 0.621371).toFixed(1);

  // Magnitude classification
  let magClass = 'minor';
  let magLabel = 'Minor';
  if (quake.magnitude >= 7) { magClass = 'major'; magLabel = 'Major'; }
  else if (quake.magnitude >= 6) { magClass = 'strong'; magLabel = 'Strong'; }
  else if (quake.magnitude >= 5) { magClass = 'moderate'; magLabel = 'Moderate'; }
  else if (quake.magnitude >= 4) { magClass = 'light'; magLabel = 'Light'; }

  // Build content safely - data comes from trusted USGS API
  content.textContent = ''; // Clear previous

  // Header
  const header = document.createElement('div');
  header.className = 'event-header earthquake';

  const icon = document.createElement('div');
  icon.className = 'event-icon';
  icon.textContent = '🌍';

  const title = document.createElement('div');
  title.className = 'event-title';

  const typeSpan = document.createElement('span');
  typeSpan.className = 'event-type';
  typeSpan.textContent = 'Earthquake';

  const magBadge = document.createElement('span');
  magBadge.className = 'magnitude-badge mag-' + magClass;
  magBadge.textContent = 'M' + quake.magnitude.toFixed(1);

  title.appendChild(typeSpan);
  title.appendChild(magBadge);

  if (quake.alert) {
    const alertBadge = document.createElement('span');
    alertBadge.className = 'alert-badge alert-' + quake.alert;
    alertBadge.textContent = quake.alert.toUpperCase() + ' ALERT';
    title.appendChild(alertBadge);
  }

  header.appendChild(icon);
  header.appendChild(title);
  content.appendChild(header);

  // Tsunami warning
  if (quake.tsunami) {
    const tsunamiDiv = document.createElement('div');
    tsunamiDiv.className = 'tsunami-warning';
    tsunamiDiv.textContent = '⚠️ TSUNAMI WARNING ISSUED';
    content.appendChild(tsunamiDiv);
  }

  // Location
  const location = document.createElement('div');
  location.className = 'event-location';
  location.textContent = quake.place || 'Unknown location';
  content.appendChild(location);

  // Time
  const timeDiv = document.createElement('div');
  timeDiv.className = 'event-time';
  const timeAgoSpan = document.createElement('span');
  timeAgoSpan.className = 'time-ago';
  timeAgoSpan.textContent = timeAgo;
  const timeLocalSpan = document.createElement('span');
  timeLocalSpan.className = 'time-local';
  timeLocalSpan.textContent = localTime;
  timeDiv.appendChild(timeAgoSpan);
  timeDiv.appendChild(timeLocalSpan);
  content.appendChild(timeDiv);

  // Stats
  const stats = document.createElement('div');
  stats.className = 'event-stats';

  const statData = [
    { label: 'Magnitude', value: quake.magnitude.toFixed(1) + ' ' + magLabel, cls: 'mag-' + magClass },
    { label: 'Depth', value: quake.depth.toFixed(1) + ' km (' + depthMiles + ' mi)' },
    { label: 'Coordinates', value: Math.abs(quake.lat).toFixed(3) + '°' + (quake.lat >= 0 ? 'N' : 'S') + ', ' + Math.abs(quake.lon).toFixed(3) + '°' + (quake.lon >= 0 ? 'E' : 'W') },
    { label: 'Significance', value: quake.significance + '/1000' }
  ];

  if (quake.felt) {
    statData.splice(3, 0, { label: 'Felt Reports', value: quake.felt.toLocaleString() + ' reports' });
  }

  statData.forEach(stat => {
    const statDiv = document.createElement('div');
    statDiv.className = 'event-stat';
    const labelSpan = document.createElement('span');
    labelSpan.className = 'stat-label';
    labelSpan.textContent = stat.label;
    const valueSpan = document.createElement('span');
    valueSpan.className = 'stat-value' + (stat.cls ? ' ' + stat.cls : '');
    valueSpan.textContent = stat.value;
    statDiv.appendChild(labelSpan);
    statDiv.appendChild(valueSpan);
    stats.appendChild(statDiv);
  });
  content.appendChild(stats);

  // Source
  const source = document.createElement('div');
  source.className = 'event-source';
  const sourceText = document.createElement('span');
  sourceText.textContent = 'Source: USGS Earthquake Hazards Program';
  const sourceLink = document.createElement('a');
  sourceLink.href = 'https://earthquake.usgs.gov/earthquakes/eventpage/' + quake.id;
  sourceLink.target = '_blank';
  sourceLink.rel = 'noopener';
  sourceLink.textContent = 'View Details →';
  source.appendChild(sourceText);
  source.appendChild(sourceLink);
  content.appendChild(source);

  panel.classList.add('visible');
}

// Close earthquake info panel
function closeEarthquakeInfo() {
  const panel = document.getElementById('earthquake-info');
  if (panel) {
    panel.classList.remove('visible');
  }
}
window.closeEarthquakeInfo = closeEarthquakeInfo;

// ============================================
// WIND INFO PANEL
// ============================================

// Create wind info panel
function createWindInfoPanel() {
  const panel = document.createElement('div');
  panel.id = 'wind-info';
  panel.className = 'event-info-panel wind-info';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'event-info-close';
  closeBtn.onclick = () => closeWindInfo();
  closeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';

  const contentDiv = document.createElement('div');
  contentDiv.id = 'wind-content';

  panel.appendChild(closeBtn);
  panel.appendChild(contentDiv);
  document.body.appendChild(panel);
}

// Show wind info at clicked location
function showWindInfo(lat, lon) {
  const panel = document.getElementById('wind-info');
  const content = document.getElementById('wind-content');
  if (!panel || !content) return;

  // Get wind data at this location
  const wind = getClimatologicalWind(lat, lon);
  const windMph = (wind.speed * 0.621371).toFixed(0);
  const windKph = wind.speed.toFixed(0);
  const windKnots = (wind.speed * 0.539957).toFixed(0);

  // Wind classification
  let windClass = 'calm';
  let windLabel = 'Calm';
  let beaufort = 0;
  if (wind.speed >= 32) { windClass = 'gale'; windLabel = 'Gale Force'; beaufort = 8; }
  else if (wind.speed >= 25) { windClass = 'strong'; windLabel = 'Strong Wind'; beaufort = 7; }
  else if (wind.speed >= 19) { windClass = 'fresh'; windLabel = 'Fresh Breeze'; beaufort = 5; }
  else if (wind.speed >= 12) { windClass = 'moderate'; windLabel = 'Moderate Breeze'; beaufort = 4; }
  else if (wind.speed >= 6) { windClass = 'light'; windLabel = 'Light Breeze'; beaufort = 2; }
  else { beaufort = 1; }

  // Get wind direction name
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const dirIndex = Math.round(((wind.direction % 360) / 22.5)) % 16;
  const dirName = directions[dirIndex];

  // Wind zone description
  const absLat = Math.abs(lat);
  let windZone = '';
  let windDesc = '';
  if (absLat < 30) {
    windZone = lat >= 0 ? 'Northeast Trade Winds' : 'Southeast Trade Winds';
    windDesc = 'Trade winds flow toward the equator, deflected west by the Coriolis effect.';
  } else if (absLat < 60) {
    windZone = 'Prevailing Westerlies';
    windDesc = 'Westerlies dominate mid-latitudes, carrying weather systems from west to east.';
  } else {
    windZone = 'Polar Easterlies';
    windDesc = 'Cold polar air flows toward lower latitudes, deflected by Earth\'s rotation.';
  }

  // Build content using DOM methods
  content.textContent = '';

  // Header
  const header = document.createElement('div');
  header.className = 'event-header wind';
  const icon = document.createElement('div');
  icon.className = 'event-icon';
  icon.textContent = '💨';
  const title = document.createElement('div');
  title.className = 'event-title';
  const typeSpan = document.createElement('span');
  typeSpan.className = 'event-type';
  typeSpan.textContent = 'Wind Conditions';
  const windBadge = document.createElement('span');
  windBadge.className = 'wind-badge wind-' + windClass;
  windBadge.textContent = windLabel;
  title.appendChild(typeSpan);
  title.appendChild(windBadge);
  header.appendChild(icon);
  header.appendChild(title);
  content.appendChild(header);

  // Location
  const locationDiv = document.createElement('div');
  locationDiv.className = 'event-location';
  locationDiv.textContent = Math.abs(lat).toFixed(1) + '°' + (lat >= 0 ? 'N' : 'S') + ', ' + Math.abs(lon).toFixed(1) + '°' + (lon >= 0 ? 'E' : 'W');
  content.appendChild(locationDiv);

  // Wind direction display
  const dirDisplay = document.createElement('div');
  dirDisplay.className = 'wind-direction-display';
  const arrow = document.createElement('div');
  arrow.className = 'wind-arrow';
  arrow.style.transform = 'rotate(' + wind.direction + 'deg)';
  arrow.textContent = '➤';
  const fromText = document.createElement('span');
  fromText.className = 'wind-from';
  fromText.textContent = 'From ' + dirName + ' (' + wind.direction.toFixed(0) + '°)';
  dirDisplay.appendChild(arrow);
  dirDisplay.appendChild(fromText);
  content.appendChild(dirDisplay);

  // Stats
  const stats = document.createElement('div');
  stats.className = 'event-stats';
  const statData = [
    { label: 'Wind Speed', value: windKph + ' km/h', cls: 'wind-' + windClass },
    { label: 'Speed (mph)', value: windMph + ' mph' },
    { label: 'Speed (knots)', value: windKnots + ' kt' },
    { label: 'Beaufort Scale', value: 'Force ' + beaufort },
    { label: 'Wind Zone', value: windZone }
  ];
  statData.forEach(stat => {
    const statDiv = document.createElement('div');
    statDiv.className = 'event-stat';
    const labelSpan = document.createElement('span');
    labelSpan.className = 'stat-label';
    labelSpan.textContent = stat.label;
    const valueSpan = document.createElement('span');
    valueSpan.className = 'stat-value' + (stat.cls ? ' ' + stat.cls : '');
    valueSpan.textContent = stat.value;
    statDiv.appendChild(labelSpan);
    statDiv.appendChild(valueSpan);
    stats.appendChild(statDiv);
  });
  content.appendChild(stats);

  // Pattern info
  const patternInfo = document.createElement('div');
  patternInfo.className = 'wind-pattern-info';
  const patternTitle = document.createElement('div');
  patternTitle.className = 'pattern-title';
  patternTitle.textContent = 'Global Circulation Pattern';
  const patternDescDiv = document.createElement('div');
  patternDescDiv.className = 'pattern-desc';
  patternDescDiv.textContent = windDesc;
  patternInfo.appendChild(patternTitle);
  patternInfo.appendChild(patternDescDiv);
  content.appendChild(patternInfo);

  // Source
  const source = document.createElement('div');
  source.className = 'event-source';
  const sourceText = document.createElement('span');
  sourceText.textContent = 'Based on climatological wind patterns';
  source.appendChild(sourceText);
  content.appendChild(source);

  panel.classList.add('visible');
}

// Close wind info panel
function closeWindInfo() {
  const panel = document.getElementById('wind-info');
  if (panel) {
    panel.classList.remove('visible');
  }
}
window.closeWindInfo = closeWindInfo;

// Helper: Get time ago string
function getTimeAgo(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return Math.floor(seconds / 60) + ' minutes ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + ' hours ago';
  return Math.floor(seconds / 86400) + ' days ago';
}

// ============================================
// UNIFIED CLICK HANDLER
// ============================================

// Unified raycaster for all clickable objects
let unifiedRaycaster = null;
let unifiedMouse = null;

// Drag detection - prevent clicks during globe rotation
let mouseDownPos = { x: 0, y: 0 };
let isDragging = false;
const DRAG_THRESHOLD = 5; // pixels

// Initialize unified click detection
function initUnifiedClickHandler() {
  unifiedRaycaster = new THREE.Raycaster();
  unifiedMouse = new THREE.Vector2();

  const container = document.getElementById('globe-container');
  if (!container) return;

  // Track mousedown to detect drags
  container.addEventListener('mousedown', (e) => {
    mouseDownPos = { x: e.clientX, y: e.clientY };
    isDragging = false;
  });

  container.addEventListener('mousemove', (e) => {
    // Check if mouse moved significantly since mousedown
    const dx = Math.abs(e.clientX - mouseDownPos.x);
    const dy = Math.abs(e.clientY - mouseDownPos.y);
    if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
      isDragging = true;
    }
    onUnifiedHover(e);
  });

  container.addEventListener('mouseup', (e) => {
    // Only trigger click if not dragging
    if (!isDragging) {
      onUnifiedClick(e);
    }
    isDragging = false;
  });
}

/**
 * Check if a 3D position is on the visible (front) side of the globe
 * @param {THREE.Vector3} position - World position to check
 * @param {THREE.Camera} camera - Camera to check visibility from
 * @returns {boolean} True if position is on the front side facing the camera
 */
function isOnFrontSideOfGlobe(position, camera) {
  // Vector from camera to position
  const cameraToPos = position.clone().sub(camera.position);

  // Surface normal (vector from globe center to position)
  const surfaceNormal = position.clone().normalize();

  // Dot product: negative = facing camera (front side), positive = facing away (back side)
  return cameraToPos.dot(surfaceNormal) < 0;
}

// Handle unified click
function onUnifiedClick(event) {
  const container = document.getElementById('globe-container');
  const rect = container.getBoundingClientRect();

  unifiedMouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  unifiedMouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  const camera = globe.camera();
  const scene = globe.scene();
  if (!camera || !scene) return;

  unifiedRaycaster.setFromCamera(unifiedMouse, camera);

  // Check earthquakes first - entire circle is clickable
  // But only if on the visible (front) side of the globe
  if (showEarthquakes && earthquakeMarkers.length > 0) {
    const earthquakeIntersects = unifiedRaycaster.intersectObjects(earthquakeMarkers);
    for (const intersect of earthquakeIntersects) {
      const marker = intersect.object;
      if (marker.userData.quake) {
        const markerWorldPos = new THREE.Vector3();
        marker.getWorldPosition(markerWorldPos);

        // Only respond to clicks on the front side of the globe
        if (isOnFrontSideOfGlobe(markerWorldPos, camera)) {
          showEarthquakeInfo(marker.userData.quake);
          return;
        }
      }
    }
  }

  // Check storms
  if (showStorms) {
    const storm = getStormAtPosition(unifiedRaycaster, camera);
    if (storm) {
      showLiveStormInfo(storm);
      return;
    }
  }

  // Check wind particles - show wind info at clicked location on globe
  if (showWindParticles) {
    // Cast ray to globe surface to get lat/lon
    const globeObjects = scene.children.filter(c =>
      c.type === 'Mesh' &&
      c.geometry &&
      c.geometry.type === 'SphereGeometry' &&
      c.geometry.parameters &&
      c.geometry.parameters.radius === 100
    );
    if (globeObjects.length > 0) {
      const globeIntersects = unifiedRaycaster.intersectObjects(globeObjects);
      if (globeIntersects.length > 0) {
        const point = globeIntersects[0].point;
        const radius = 100;
        const lat = 90 - Math.acos(point.y / radius) * (180 / Math.PI);
        const lon = Math.atan2(point.z, -point.x) * (180 / Math.PI);
        showWindInfo(lat, lon);
        return;
      }
    }
  }
}

// Handle unified hover for cursor changes
function onUnifiedHover(event) {
  const container = document.getElementById('globe-container');
  const rect = container.getBoundingClientRect();

  unifiedMouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  unifiedMouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  const camera = globe.camera();
  if (!camera) return;

  unifiedRaycaster.setFromCamera(unifiedMouse, camera);

  let isHovering = false;

  // Check earthquakes - only on visible side of globe
  if (showEarthquakes && earthquakeMarkers.length > 0) {
    const earthquakeIntersects = unifiedRaycaster.intersectObjects(earthquakeMarkers);
    for (const intersect of earthquakeIntersects) {
      const marker = intersect.object;
      if (marker.userData.quake) {
        const markerWorldPos = new THREE.Vector3();
        marker.getWorldPosition(markerWorldPos);
        if (isOnFrontSideOfGlobe(markerWorldPos, camera)) {
          isHovering = true;
          break;
        }
      }
    }
  }

  // Check storms
  if (!isHovering && showStorms) {
    const storm = getStormAtPosition(unifiedRaycaster, camera);
    if (storm) {
      isHovering = true;
    }
  }

  container.style.cursor = isHovering ? 'pointer' : '';
}

// Initialize storm click detection (legacy, now handled by unified handler)
function initStormClickHandler() {
  // Now handled by unified click handler
  stormRaycaster = new THREE.Raycaster();
  stormMouse = new THREE.Vector2();
}

// Handle click on storm
function onStormClick(event) {
  if (!showStorms) return;

  const container = document.getElementById('globe-container');
  const rect = container.getBoundingClientRect();

  stormMouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  stormMouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  const camera = globe.camera();
  stormRaycaster.setFromCamera(stormMouse, camera);

  const storm = getStormAtPosition(stormRaycaster, camera);
  if (storm) {
    showLiveStormInfo(storm);
  }
}

// Handle hover over storm (for cursor change)
function onStormHover(event) {
  if (!showStorms) return;

  const container = document.getElementById('globe-container');
  const rect = container.getBoundingClientRect();

  stormMouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  stormMouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  const camera = globe.camera();
  stormRaycaster.setFromCamera(stormMouse, camera);

  const storm = getStormAtPosition(stormRaycaster, camera);
  container.style.cursor = storm ? 'pointer' : '';
}

// ============================================

function updateToggleButton(btnId, isActive) {
  const btn = document.getElementById(btnId);
  if (btn) {
    btn.classList.toggle('active', isActive);
  }
}

// ============================================
// DAY/NIGHT AND SUN VISUALIZATION
// ============================================

/**
 * Create a visual sun in the scene
 * Sun is ~109x Earth's diameter and ~150M km away
 * Using ACTUAL astronomical proportions:
 * - Earth globe radius = 100 units
 * - Sun radius = 109 × Earth = 10,900 units
 * - Sun distance = 23,481 × Earth radius = 2,348,100 units
 */
function addSun() {
  const scene = globe.scene();
  if (!scene || sunMesh) return;

  // Extend camera far plane to see the distant sun
  const camera = globe.camera();
  if (camera) {
    camera.far = 5000000; // 5 million units to comfortably see sun
    camera.updateProjectionMatrix();
  }

  // ACTUAL astronomical scale relative to Earth globe (radius 100)
  // Sun is 109× Earth's diameter
  const EARTH_GLOBE_RADIUS = 100;
  const SUN_RADIUS = EARTH_GLOBE_RADIUS * 109; // 10,900 units

  // Create sun sphere with realistic corona shader
  const sunGeometry = new THREE.SphereGeometry(SUN_RADIUS, 64, 64);
  const sunMaterial = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 }
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec2 vUv;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float time;
      varying vec3 vNormal;
      varying vec2 vUv;

      void main() {
        // Bright yellow-white core
        vec3 sunCore = vec3(1.0, 0.98, 0.9);
        vec3 sunEdge = vec3(1.0, 0.7, 0.3);

        // Limb darkening effect (edges slightly darker/redder)
        float limb = dot(vNormal, vec3(0.0, 0.0, 1.0));
        limb = clamp(limb, 0.0, 1.0);
        float limbDarkening = pow(limb, 0.4);

        vec3 color = mix(sunEdge, sunCore, limbDarkening);

        // Subtle surface variation
        float noise = sin(vUv.x * 30.0 + time) * sin(vUv.y * 30.0 + time * 0.7) * 0.02;
        color += noise;

        gl_FragColor = vec4(color, 1.0);
      }
    `
  });

  sunMesh = new THREE.Mesh(sunGeometry, sunMaterial);
  sunMesh.name = 'sun';

  // Inner corona glow
  const coronaGeometry = new THREE.SphereGeometry(SUN_RADIUS * 1.3, 32, 32);
  const coronaMaterial = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 }
    },
    vertexShader: `
      varying vec3 vNormal;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float time;
      varying vec3 vNormal;
      void main() {
        float intensity = pow(0.7 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 1.5);
        vec3 corona = vec3(1.0, 0.9, 0.6) * intensity * 1.5;
        float alpha = intensity * 0.8;
        gl_FragColor = vec4(corona, alpha);
      }
    `,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false
  });
  const innerCorona = new THREE.Mesh(coronaGeometry, coronaMaterial);
  sunMesh.add(innerCorona);

  // Outer glow (visible from far away)
  const outerGlowGeometry = new THREE.SphereGeometry(SUN_RADIUS * 4, 32, 32);
  const outerGlowMaterial = new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: `
      varying vec3 vNormal;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vNormal;
      void main() {
        float intensity = pow(0.6 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.0);
        vec3 glow = vec3(1.0, 0.85, 0.5) * intensity;
        float alpha = intensity * 0.4;
        gl_FragColor = vec4(glow, alpha);
      }
    `,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false
  });
  const outerGlow = new THREE.Mesh(outerGlowGeometry, outerGlowMaterial);
  sunMesh.add(outerGlow);

  // Add directional light from sun
  sunLight = new THREE.DirectionalLight(0xfffaf0, 1.2);
  sunLight.name = 'sunLight';
  scene.add(sunLight);

  scene.add(sunMesh);
  updateSunPosition();
}

/**
 * Update sun position based on current time
 * Uses ACTUAL astronomical distance: 1 AU = 23,481 × Earth radius
 */
function updateSunPosition() {
  if (!sunMesh) return;

  const sunPos = getSunPosition();
  // ACTUAL astronomical scale: Sun is 23,481 Earth radii away (1 AU)
  // Earth globe radius = 100, so sun distance = 100 × 23,481 = 2,348,100
  const EARTH_GLOBE_RADIUS = 100;
  const sunDistance = EARTH_GLOBE_RADIUS * 23481; // 2,348,100 units (actual 1 AU scale)

  // Convert lat/lon to 3D position - match globe.gl's coordinate system
  const phi = (90 - sunPos.lat) * (Math.PI / 180);
  const theta = sunPos.lon * (Math.PI / 180);

  const x = sunDistance * Math.sin(phi) * Math.sin(theta);
  const y = sunDistance * Math.cos(phi);
  const z = sunDistance * Math.sin(phi) * Math.cos(theta);

  sunMesh.position.set(x, y, z);
  sunMesh.lookAt(0, 0, 0);

  // Update directional light
  if (sunLight) {
    sunLight.position.set(x, y, z);
    sunLight.target.position.set(0, 0, 0);
  }

  // Update sun shader time
  if (sunMesh.material.uniforms) {
    sunMesh.material.uniforms.time.value = Date.now() * 0.001;
  }
}

/**
 * Add day/night terminator overlay
 */
function addDayNightOverlay() {
  const scene = globe.scene();
  if (!scene || nightOverlay) return;

  const globeRadius = 100;

  // Create a semi-transparent sphere for night side
  // Use slightly larger radius to avoid z-fighting
  const nightGeometry = new THREE.SphereGeometry(globeRadius + 1.5, 128, 64);
  const nightMaterial = new THREE.ShaderMaterial({
    uniforms: {
      sunDirection: { value: new THREE.Vector3(1, 0, 0) }
    },
    vertexShader: `
      varying vec3 vWorldNormal;

      void main() {
        // Transform normal to world space for sun comparison
        vWorldNormal = normalize((modelMatrix * vec4(position, 0.0)).xyz);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 sunDirection;
      varying vec3 vWorldNormal;

      void main() {
        vec3 normal = normalize(vWorldNormal);
        vec3 toSun = normalize(sunDirection);

        // Calculate illumination: positive = facing sun (day), negative = facing away (night)
        float illumination = dot(normal, toSun);

        // Multi-stage twilight transition for realism
        float darkness = 1.0 - smoothstep(-0.15, 0.08, illumination);

        // Twilight zone detection (golden hour/blue hour)
        float twilightZone = smoothstep(-0.2, -0.05, illumination) * smoothstep(0.1, -0.05, illumination);

        // Rich night color gradient - deep blue at core, lighter at edges
        vec3 deepNight = vec3(0.0, 0.0, 0.08);
        vec3 twilightNight = vec3(0.0, 0.02, 0.15);

        // Twilight colors - warm orange to cool purple
        vec3 twilightWarm = vec3(0.15, 0.06, 0.02);
        vec3 twilightCool = vec3(0.04, 0.02, 0.08);

        // Blend night colors based on depth into night
        vec3 nightColor = mix(twilightNight, deepNight, darkness * 0.8);

        // Add twilight coloring at the terminator
        vec3 twilightColor = mix(twilightCool, twilightWarm, 0.5);
        nightColor = mix(nightColor, twilightColor, twilightZone * 0.4);

        // Skip fully lit areas
        if (darkness < 0.01) discard;

        // Smooth alpha with darker nights - increased for visibility
        float alpha = clamp(darkness * 0.85, 0.0, 0.85);

        gl_FragColor = vec4(nightColor, alpha);
      }
    `,
    transparent: true,
    side: THREE.FrontSide,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending
  });

  nightOverlay = new THREE.Mesh(nightGeometry, nightMaterial);
  nightOverlay.name = 'nightOverlay';
  nightOverlay.renderOrder = 10;
  // Rotate to align with globe.gl's internal mesh (longitude 0° alignment)
  nightOverlay.rotation.y = -Math.PI / 2;
  scene.add(nightOverlay);

  updateDayNightOverlay();
}

/**
 * Update day/night overlay based on sun position
 */
function updateDayNightOverlay() {
  if (!nightOverlay) return;

  const sunPos = getSunPosition();

  // Convert sun lat/lon to direction vector matching THREE.js SphereGeometry coordinate system
  // SphereGeometry uses: +Z = lon 0°, +X = lon 90°E, -Z = lon 180°, -X = lon 90°W
  const phi = (90 - sunPos.lat) * (Math.PI / 180);  // Polar angle (0 at north pole)
  const theta = (sunPos.lon + 90) * (Math.PI / 180); // Azimuth adjusted for SphereGeometry

  // Match THREE.js SphereGeometry vertex formula
  const sunDir = new THREE.Vector3(
    -Math.cos(theta) * Math.sin(phi),  // X
    Math.cos(phi),                       // Y (up = north pole)
    Math.sin(theta) * Math.sin(phi)    // Z
  ).normalize();

  nightOverlay.material.uniforms.sunDirection.value = sunDir;

  // Log sun position occasionally for debugging
  if (!window._lastSunLog || Date.now() - window._lastSunLog > 10000) {
    const now = new Date();
    log(`Sun position: lat=${sunPos.lat.toFixed(1)}°, lon=${sunPos.lon.toFixed(1)}° (UTC: ${now.toUTCString()})`);
    log(`Sun direction: (${sunDir.x.toFixed(2)}, ${sunDir.y.toFixed(2)}, ${sunDir.z.toFixed(2)})`);
    window._lastSunLog = Date.now();
  }
}

/**
 * Toggle sun cycle (sun position + day/night shading)
 */
function toggleSunCycle(visible) {
  showSunCycle = visible;
  if (sunMesh) {
    sunMesh.visible = visible;
  }
  if (sunLight) {
    sunLight.visible = visible;
  }
  if (nightOverlay) {
    nightOverlay.visible = visible;
  }
  // City lights should only show when sun cycle is enabled
  if (window.erfNightLights) {
    window.erfNightLights.visible = visible && showCityLights;
  }
}

/**
 * Toggle city lights visibility
 */
function toggleCityLights(visible) {
  showCityLights = visible;
  if (window.erfNightLights) {
    // Only show if both city lights AND sun cycle are enabled
    window.erfNightLights.visible = visible && showSunCycle;
  }
}

// ============================================
// WEATHER VISUALIZATION
// ============================================

/**
 * Add weather markers for major cities
 */
async function addWeatherMarkers() {
  if (!globe || weatherMarkers.length > 0) return;

  try {
    weatherData = await getCurrentWeather(WORLD_CITIES);
    updateWeatherDisplay();
  } catch (error) {
    console.warn('Failed to fetch weather data:', error);
  }
}

/**
 * Update weather markers on the globe
 */
function updateWeatherDisplay() {
  if (!showWeather || weatherData.length === 0) return;

  // Use Globe.gl's HTML elements layer for weather markers
  globe
    .htmlElementsData(weatherData)
    .htmlLat(d => d.lat)
    .htmlLng(d => d.lon)
    .htmlAltitude(0.02)
    .htmlElement(d => {
      const div = document.createElement('div');
      div.className = 'weather-marker';
      div.innerHTML = `
        <div class="weather-icon">${d.icon}</div>
        <div class="weather-temp" style="color: ${getTemperatureColor(d.temperature)}">${Math.round(d.temperature)}°</div>
      `;
      div.title = `${d.name}: ${d.condition}, ${Math.round(d.temperature)}°C, Wind: ${Math.round(d.windSpeed)} km/h`;
      return div;
    });
}

/**
 * Clear weather markers
 */
function clearWeatherMarkers() {
  globe.htmlElementsData([]);
  weatherMarkers = [];
}

/**
 * Toggle weather visibility
 */
function toggleWeather(visible) {
  showWeather = visible;
  if (visible) {
    addWeatherMarkers();
  } else {
    clearWeatherMarkers();
  }
}

/**
 * Start weather updates
 */
function startWeatherUpdates() {
  if (weatherUpdateInterval) return;

  // Initial fetch
  fetchWeatherSystems();

  weatherUpdateInterval = setInterval(async () => {
    if (showWeather) {
      weatherData = await getCurrentWeather(WORLD_CITIES);
      updateWeatherDisplay();
    }
    if (showWeatherSystems) {
      fetchWeatherSystems();
    }
    // Refresh live satellite cloud data
    if (showSatellite) {
      log('Refreshing satellite cloud data...');
      addSatelliteOverlay();
    }
    // Refresh radar data
    if (showRadar) {
      log('Refreshing precipitation radar data...');
      addRadarOverlay();
    }
  }, WEATHER_UPDATE_INTERVAL);
}

/**
 * Fetch and display active weather systems
 */
async function fetchWeatherSystems() {
  try {
    weatherSystems = await getWeatherSystems();
    updateWeatherSystemsDisplay();
    log(`Found ${weatherSystems.length} active weather systems`);
  } catch (error) {
    console.warn('Failed to fetch weather systems:', error);
  }
}

/**
 * Update weather system markers on globe
 */
function updateWeatherSystemsDisplay() {
  if (!showWeatherSystems || weatherSystems.length === 0) {
    clearWeatherSystemMarkers();
    return;
  }

  const scene = globe.scene();
  if (!scene) return;

  // Clear existing markers
  clearWeatherSystemMarkers();

  const globeRadius = 100;

  // Create markers for each weather system
  weatherSystems.forEach(system => {
    // Create a pulsing ring for storm systems
    const ringGeometry = new THREE.RingGeometry(
      3 + system.intensity * 5,
      5 + system.intensity * 8,
      32
    );

    // Color based on type
    let color;
    if (system.type === 'intense_low') {
      color = new THREE.Color(0xff4444); // Red for intense lows
    } else if (system.type === 'low_pressure') {
      color = new THREE.Color(0xff8800); // Orange for lows
    } else if (system.type === 'thunderstorm') {
      color = new THREE.Color(0xffff00); // Yellow for thunderstorms
    } else {
      color = new THREE.Color(0x00aaff); // Blue for precipitation
    }

    const ringMaterial = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.6 + system.intensity * 0.3,
      side: THREE.DoubleSide
    });

    const ring = new THREE.Mesh(ringGeometry, ringMaterial);

    // Position on globe
    const phi = (90 - system.lat) * (Math.PI / 180);
    const theta = (-system.lon + 180) * (Math.PI / 180);

    const x = -(globeRadius + 2) * Math.sin(phi) * Math.cos(theta);
    const y = (globeRadius + 2) * Math.cos(phi);
    const z = (globeRadius + 2) * Math.sin(phi) * Math.sin(theta);

    ring.position.set(x, y, z);
    ring.lookAt(0, 0, 0);
    ring.rotateX(Math.PI);

    ring.userData = { system, type: 'weatherSystem' };
    scene.add(ring);
    weatherSystemMarkers.push(ring);

    // Add inner pulsing circle for intense systems
    if (system.intensity > 0.5) {
      const innerGeometry = new THREE.CircleGeometry(2 + system.intensity * 3, 32);
      const innerMaterial = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide
      });

      const inner = new THREE.Mesh(innerGeometry, innerMaterial);
      inner.position.set(x, y, z);
      inner.lookAt(0, 0, 0);
      inner.rotateX(Math.PI);
      inner.userData = { type: 'weatherSystemInner' };
      scene.add(inner);
      weatherSystemMarkers.push(inner);
    }

    // Add "L" label for low pressure
    if (system.type === 'low_pressure' || system.type === 'intense_low') {
      const labelDiv = document.createElement('div');
      labelDiv.className = 'weather-system-label';
      labelDiv.innerHTML = `<span class="system-type">L</span><span class="system-pressure">${escapeHtml(String(Math.round(system.pressure)))}</span>`;
      labelDiv.style.color = system.type === 'intense_low' ? '#ff4444' : '#ff8800';
    }
  });

  // Animate the weather system markers
  animateWeatherSystems();
}

/**
 * Animate weather system markers (pulsing effect)
 */
let weatherAnimationId = null;
function animateWeatherSystems() {
  if (weatherAnimationId) cancelAnimationFrame(weatherAnimationId);

  const animate = () => {
    const time = Date.now() * 0.002;

    weatherSystemMarkers.forEach((marker, i) => {
      if (marker.userData.type === 'weatherSystem') {
        const scale = 1 + 0.1 * Math.sin(time + i);
        marker.scale.set(scale, scale, 1);
        marker.material.opacity = 0.5 + 0.2 * Math.sin(time + i);
      } else if (marker.userData.type === 'weatherSystemInner') {
        const scale = 0.8 + 0.3 * Math.sin(time * 2 + i);
        marker.scale.set(scale, scale, 1);
      }
    });

    if (showWeatherSystems && weatherSystemMarkers.length > 0) {
      weatherAnimationId = requestAnimationFrame(animate);
    }
  };

  animate();
}

/**
 * Clear weather system markers
 */
function clearWeatherSystemMarkers() {
  const scene = globe.scene();
  if (!scene) return;

  weatherSystemMarkers.forEach(marker => {
    scene.remove(marker);
    if (marker.geometry) marker.geometry.dispose();
    if (marker.material) marker.material.dispose();
  });
  weatherSystemMarkers = [];

  if (weatherAnimationId) {
    cancelAnimationFrame(weatherAnimationId);
    weatherAnimationId = null;
  }
}

/**
 * Toggle weather systems visibility
 */
function toggleWeatherSystems(visible) {
  showWeatherSystems = visible;
  if (visible) {
    fetchWeatherSystems();
  } else {
    clearWeatherSystemMarkers();
  }
}

// ============================================
// EARTHQUAKE VISUALIZATION
// ============================================

/**
 * Initialize earthquake data and visualization
 */
async function initializeEarthquakes() {
  if (!showEarthquakes) return;

  await fetchEarthquakeData();

  // Set up periodic updates
  if (earthquakeUpdateInterval) clearInterval(earthquakeUpdateInterval);
  earthquakeUpdateInterval = setInterval(fetchEarthquakeData, EARTHQUAKE_UPDATE_INTERVAL);
}

/**
 * Fetch earthquake data from USGS
 */
async function fetchEarthquakeData() {
  try {
    // Get earthquakes magnitude 2.5+ in last 24 hours
    earthquakeData = await getEarthquakes('2.5');
    log(`Fetched ${earthquakeData.length} earthquakes`);
    updateEarthquakeMarkers();
  } catch (error) {
    console.warn('Failed to fetch earthquake data:', error);
  }
}

/**
 * Update earthquake markers on globe
 * Creates realistic seismic wave ripple effects
 */
function updateEarthquakeMarkers() {
  const scene = globe.scene();
  if (!scene) return;

  // Clear existing markers
  clearEarthquakeMarkers();

  if (!showEarthquakes || earthquakeData.length === 0) return;

  const globeRadius = 100;

  earthquakeData.forEach((quake, index) => {
    if (quake.magnitude < 2.5) return; // Skip tiny quakes

    const baseSize = getEarthquakeSize(quake.magnitude);
    const color = new THREE.Color(getEarthquakeColor(quake.magnitude));

    // Position on globe - use globe.gl's coordinate system
    const phi = (90 - quake.lat) * (Math.PI / 180);
    const theta = quake.lon * (Math.PI / 180);
    const r = globeRadius + 0.5;
    // Match globe.gl's coordinate system (X and Z swapped from standard spherical)
    const x = r * Math.sin(phi) * Math.sin(theta);
    const y = r * Math.cos(phi);
    const z = r * Math.sin(phi) * Math.cos(theta);

    // Create clickable epicenter with realistic seismic wave ripples
    const epicenterSize = baseSize * 3.0; // Larger area for concentric rings
    const epicenterGeometry = new THREE.CircleGeometry(epicenterSize, 64);
    const epicenterMaterial = new THREE.ShaderMaterial({
      uniforms: {
        color: { value: color },
        time: { value: 0 },
        magnitude: { value: quake.magnitude },
        quakeAge: { value: (Date.now() - quake.time.getTime()) / 1000 }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 color;
        uniform float time;
        uniform float magnitude;
        uniform float quakeAge;
        varying vec2 vUv;

        void main() {
          vec2 center = vec2(0.5, 0.5);
          float dist = length(vUv - center) * 2.0;

          // Skip pixels outside circle
          if (dist > 1.0) discard;

          // Age factor - recent quakes pulse more intensely
          float ageFactor = exp(-quakeAge / 21600.0); // Decay over 6 hours
          ageFactor = max(0.25, ageFactor);

          // === CONCENTRIC EXPANDING RINGS from epicenter ===
          // Wave speed based on magnitude - larger quakes have faster P-waves
          float waveSpeed = 0.8 + magnitude * 0.15;

          // Multiple concentric rings expanding outward at different phases
          // Ring 1 - Primary wave (fastest)
          float ring1Phase = fract(time * waveSpeed * 0.4);
          float ring1 = smoothstep(ring1Phase - 0.08, ring1Phase, dist) *
                        smoothstep(ring1Phase + 0.08, ring1Phase, dist);
          ring1 *= (1.0 - ring1Phase); // Fade as it expands

          // Ring 2 - Secondary wave (slower)
          float ring2Phase = fract(time * waveSpeed * 0.4 - 0.33);
          float ring2 = smoothstep(ring2Phase - 0.06, ring2Phase, dist) *
                        smoothstep(ring2Phase + 0.06, ring2Phase, dist);
          ring2 *= (1.0 - ring2Phase);

          // Ring 3 - Surface wave (slowest)
          float ring3Phase = fract(time * waveSpeed * 0.4 - 0.66);
          float ring3 = smoothstep(ring3Phase - 0.05, ring3Phase, dist) *
                        smoothstep(ring3Phase + 0.05, ring3Phase, dist);
          ring3 *= (1.0 - ring3Phase);

          // Combine rings with different weights
          float rings = ring1 * 1.0 + ring2 * 0.7 + ring3 * 0.5;

          // === EPICENTER ===
          // Glowing epicenter that pulses
          float epicenter = exp(-dist * 6.0);
          float epicenterPulse = 0.7 + sin(time * 3.0) * 0.3;
          epicenter *= epicenterPulse;

          // Subtle ground shake effect at epicenter
          float shake = sin(time * 15.0) * exp(-dist * 8.0) * 0.15;

          // === MAGNITUDE INTENSITY ===
          float magIntensity = 0.5 + (magnitude - 2.5) / 6.0; // Scale 2.5-8.5 to 0.5-1.5

          // === SOFT EDGE ===
          float edgeFade = 1.0 - smoothstep(0.75, 1.0, dist);

          // === COMBINE EFFECTS ===
          float intensity = (rings * 0.6 + epicenter * 0.5 + shake) * magIntensity * ageFactor;

          // === COLOR GRADIENT ===
          // Warmer color at epicenter, cooler at edges
          vec3 warmColor = color + vec3(0.2, 0.1, 0.0);
          vec3 coolColor = color * 0.8;
          vec3 finalColor = mix(coolColor, warmColor, epicenter);

          // Brighter rings
          finalColor = mix(finalColor, color * 1.3, rings * 0.5);

          // === ALPHA ===
          float alpha = intensity * edgeFade;

          // Ensure clickability with minimum alpha near center
          float clickableAlpha = smoothstep(1.0, 0.0, dist) * 0.12;
          alpha = max(alpha, clickableAlpha);

          gl_FragColor = vec4(finalColor, alpha * 0.85);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor  // Softer blending than pure Additive
    });

    const epicenter = new THREE.Mesh(epicenterGeometry, epicenterMaterial);
    epicenter.position.set(x, y, z);
    epicenter.lookAt(0, 0, 0);
    epicenter.rotateX(Math.PI);
    epicenter.userData = { quake, type: 'earthquake', index, isClickable: true };
    epicenter.renderOrder = 100;
    scene.add(epicenter);
    earthquakeMarkers.push(epicenter);

    // Add outer expanding shockwave for major earthquakes (M5+)
    if (quake.magnitude >= 5.0) {
      const shockwaveSize = baseSize * 5;
      const shockwaveGeometry = new THREE.CircleGeometry(shockwaveSize, 64);
      const shockwaveMaterial = new THREE.ShaderMaterial({
        uniforms: {
          color: { value: color },
          time: { value: 0 },
          magnitude: { value: quake.magnitude }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 color;
          uniform float time;
          uniform float magnitude;
          varying vec2 vUv;

          void main() {
            vec2 center = vec2(0.5, 0.5);
            float dist = length(vUv - center) * 2.0;

            if (dist > 1.0) discard;

            // Slow outer shockwave - like seismic surface waves spreading far
            float waveSpeed = 0.3 + (magnitude - 5.0) * 0.05;

            // Single expanding ring
            float expansion = fract(time * waveSpeed);
            float ringWidth = 0.08 + (1.0 - expansion) * 0.04; // Ring gets thinner as it expands
            float ring = smoothstep(expansion - ringWidth, expansion, dist) *
                        smoothstep(expansion + ringWidth, expansion, dist);

            // Fade as it expands outward
            float fade = pow(1.0 - expansion, 1.5);

            // Soft edge fade
            float edgeFade = 1.0 - smoothstep(0.85, 1.0, dist);

            float alpha = ring * fade * edgeFade * 0.4;

            // Slightly desaturated color for distant waves
            vec3 waveColor = mix(color, vec3(0.8), 0.2);

            gl_FragColor = vec4(waveColor, alpha);
          }
        `,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.SrcAlphaFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor
      });

      const shockwave = new THREE.Mesh(shockwaveGeometry, shockwaveMaterial);
      shockwave.position.set(x, y, z);
      shockwave.lookAt(0, 0, 0);
      shockwave.rotateX(Math.PI);
      shockwave.userData = { quake, type: 'earthquakeShockwave' };
      shockwave.renderOrder = 99;
      scene.add(shockwave);
      earthquakeMarkers.push(shockwave);
    }
  });

  // Start earthquake animation
  animateEarthquakes();
  log(`Updated ${earthquakeMarkers.length} earthquake markers`);
}

/**
 * Animate earthquake markers (seismic wave effect)
 */
let earthquakeAnimationId = null;
function animateEarthquakes() {
  if (earthquakeAnimationId) cancelAnimationFrame(earthquakeAnimationId);

  const animate = () => {
    const time = Date.now() * 0.001;

    earthquakeMarkers.forEach(marker => {
      if (marker.material && marker.material.uniforms) {
        // Update time for all earthquake-related shaders
        marker.material.uniforms.time.value = time;

        // Update age for main earthquake markers
        if (marker.userData.type === 'earthquake' && marker.userData.quake) {
          const ageSeconds = (Date.now() - marker.userData.quake.time.getTime()) / 1000;
          if (marker.material.uniforms.quakeAge) {
            marker.material.uniforms.quakeAge.value = ageSeconds;
          }
        }
      }
    });

    if (showEarthquakes && earthquakeMarkers.length > 0) {
      earthquakeAnimationId = requestAnimationFrame(animate);
    }
  };

  animate();
}

/**
 * Clear earthquake markers
 */
function clearEarthquakeMarkers() {
  const scene = globe.scene();
  if (!scene) return;

  earthquakeMarkers.forEach(marker => {
    scene.remove(marker);
    if (marker.geometry) marker.geometry.dispose();
    if (marker.material) marker.material.dispose();
  });
  earthquakeMarkers = [];

  if (earthquakeAnimationId) {
    cancelAnimationFrame(earthquakeAnimationId);
    earthquakeAnimationId = null;
  }
}

/**
 * Toggle earthquake visibility
 */
function toggleEarthquakes(visible) {
  showEarthquakes = visible;
  if (visible) {
    fetchEarthquakeData();
  } else {
    clearEarthquakeMarkers();
  }
  updateToggleButton('earthquakes-btn', showEarthquakes);
}

// ============================================
// WILDFIRE VISUALIZATION (NASA EONET)
// ============================================

async function fetchWildfireData() {
  try {
    const response = await fetch('https://eonet.gsfc.nasa.gov/api/v3/events?category=wildfires&status=open&limit=100');
    if (!response.ok) throw new Error('EONET unavailable');
    const data = await response.json();
    wildfireData = data.events.map(event => {
      const coords = event.geometry[event.geometry.length - 1]?.coordinates || [0, 0];
      return { lat: coords[1], lon: coords[0], title: event.title, date: new Date(event.geometry[event.geometry.length - 1]?.date || Date.now()) };
    }).filter(f => f.lat && f.lon);
    log('Loaded ' + wildfireData.length + ' active fires');
    updateWildfireMarkers();
  } catch (error) {
    console.warn('Failed to fetch wildfire data:', error);
  }
}

function updateWildfireMarkers() {
  const scene = globe.scene();
  if (!scene) return;
  clearWildfireMarkers();
  if (!showWildfires || wildfireData.length === 0) return;
  const globeRadius = 100;
  wildfireData.forEach((fire, index) => {
    const phi = (90 - fire.lat) * (Math.PI / 180);
    const theta = fire.lon * (Math.PI / 180);
    const r = globeRadius + 0.3;
    const x = r * Math.sin(phi) * Math.sin(theta);
    const y = r * Math.cos(phi);
    const z = r * Math.sin(phi) * Math.cos(theta);
    const geometry = new THREE.CircleGeometry(0.6, 16);
    const material = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float time; varying vec2 vUv; void main() { vec2 c = vec2(0.5); float d = length(vUv - c) * 2.0; if (d > 1.0) discard; float f = 0.7 + 0.3 * sin(time * 8.0 + vUv.x * 10.0); vec3 col = mix(vec3(1.0, 0.2, 0.0), vec3(1.0, 0.5, 0.0), d); gl_FragColor = vec4(col, exp(-d * 2.0) * f * 0.9); }',
      transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending
    });
    const marker = new THREE.Mesh(geometry, material);
    marker.position.set(x, y, z);
    marker.lookAt(0, 0, 0);
    marker.rotateX(Math.PI);
    marker.userData = { fire, type: 'wildfire', index };
    marker.renderOrder = 110;
    scene.add(marker);
    wildfireMarkers.push(marker);
  });
  animateWildfires();
}

let wildfireAnimationId = null;
function animateWildfires() {
  if (wildfireAnimationId) cancelAnimationFrame(wildfireAnimationId);
  const animate = () => {
    const time = Date.now() * 0.001;
    wildfireMarkers.forEach(m => { if (m.material?.uniforms?.time) m.material.uniforms.time.value = time; });
    if (showWildfires && wildfireMarkers.length > 0) wildfireAnimationId = requestAnimationFrame(animate);
  };
  animate();
}

function clearWildfireMarkers() {
  const scene = globe.scene();
  if (!scene) return;
  wildfireMarkers.forEach(m => { scene.remove(m); if (m.geometry) m.geometry.dispose(); if (m.material) m.material.dispose(); });
  wildfireMarkers = [];
  if (wildfireAnimationId) { cancelAnimationFrame(wildfireAnimationId); wildfireAnimationId = null; }
}

function toggleWildfires(visible) {
  showWildfires = visible;
  if (visible) fetchWildfireData(); else clearWildfireMarkers();
}

// ============================================
// VOLCANO VISUALIZATION
// ============================================

const KNOWN_VOLCANOES = [
  { name: 'Kilauea', lat: 19.421, lon: -155.287, alertLevel: 'watch' },
  { name: 'Etna', lat: 37.751, lon: 14.995, alertLevel: 'advisory' },
  { name: 'Stromboli', lat: 38.789, lon: 15.213, alertLevel: 'advisory' },
  { name: 'Merapi', lat: -7.540, lon: 110.446, alertLevel: 'warning' },
  { name: 'Sakurajima', lat: 31.593, lon: 130.657, alertLevel: 'warning' },
  { name: 'Popocatépetl', lat: 19.023, lon: -98.622, alertLevel: 'warning' },
  { name: 'Fuego', lat: 14.473, lon: -90.880, alertLevel: 'watch' },
  { name: 'Krakatoa', lat: -6.102, lon: 105.423, alertLevel: 'advisory' },
  { name: 'Nyiragongo', lat: -1.520, lon: 29.250, alertLevel: 'watch' },
  { name: 'Piton de la Fournaise', lat: -21.244, lon: 55.708, alertLevel: 'advisory' },
  { name: 'Klyuchevskoy', lat: 56.056, lon: 160.642, alertLevel: 'watch' },
  { name: 'Semeru', lat: -8.108, lon: 112.922, alertLevel: 'warning' },
  { name: 'Taal', lat: 14.002, lon: 120.993, alertLevel: 'advisory' },
  { name: 'Mauna Loa', lat: 19.475, lon: -155.608, alertLevel: 'advisory' },
  { name: 'Fagradalsfjall', lat: 63.903, lon: -22.273, alertLevel: 'watch' }
];

async function fetchVolcanoData() {
  try {
    const response = await fetch('https://eonet.gsfc.nasa.gov/api/v3/events?category=volcanoes&status=open&limit=50');
    if (response.ok) {
      const data = await response.json();
      volcanoData = data.events.map(event => {
        const coords = event.geometry[event.geometry.length - 1]?.coordinates || [0, 0];
        return { name: event.title, lat: coords[1], lon: coords[0], alertLevel: 'warning' };
      });
    }
    if (volcanoData.length === 0) volcanoData = KNOWN_VOLCANOES;
    log('Loaded ' + volcanoData.length + ' volcanoes');
    updateVolcanoMarkers();
  } catch (error) {
    volcanoData = KNOWN_VOLCANOES;
    updateVolcanoMarkers();
  }
}

function updateVolcanoMarkers() {
  const scene = globe.scene();
  if (!scene) return;
  clearVolcanoMarkers();
  if (!showVolcanoes || volcanoData.length === 0) return;
  const globeRadius = 100;
  const alertColors = { 'warning': new THREE.Color(1.0, 0.2, 0.0), 'watch': new THREE.Color(1.0, 0.5, 0.0), 'advisory': new THREE.Color(1.0, 0.7, 0.2) };
  volcanoData.forEach((volcano, index) => {
    const color = alertColors[volcano.alertLevel] || alertColors.advisory;
    const phi = (90 - volcano.lat) * (Math.PI / 180);
    const theta = volcano.lon * (Math.PI / 180);
    const r = globeRadius + 0.4;
    const x = r * Math.sin(phi) * Math.sin(theta);
    const y = r * Math.cos(phi);
    const z = r * Math.sin(phi) * Math.cos(theta);
    const geometry = new THREE.CircleGeometry(0.7, 24);
    const material = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, color: { value: color } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float time; uniform vec3 color; varying vec2 vUv; void main() { vec2 c = vec2(0.5); float d = length(vUv - c) * 2.0; if (d > 1.0) discard; float cone = exp(-d * 2.5) * (0.7 + 0.3 * sin(time * 2.0)); gl_FragColor = vec4(color, cone * 0.85); }',
      transparent: true, side: THREE.DoubleSide, depthWrite: false
    });
    const marker = new THREE.Mesh(geometry, material);
    marker.position.set(x, y, z);
    marker.lookAt(0, 0, 0);
    marker.rotateX(Math.PI);
    marker.userData = { volcano, type: 'volcano', index };
    marker.renderOrder = 105;
    scene.add(marker);
    volcanoMarkers.push(marker);
  });
  animateVolcanoes();
}

let volcanoAnimationId = null;
function animateVolcanoes() {
  if (volcanoAnimationId) cancelAnimationFrame(volcanoAnimationId);
  const animate = () => {
    const time = Date.now() * 0.001;
    volcanoMarkers.forEach(m => { if (m.material?.uniforms?.time) m.material.uniforms.time.value = time; });
    if (showVolcanoes && volcanoMarkers.length > 0) volcanoAnimationId = requestAnimationFrame(animate);
  };
  animate();
}

function clearVolcanoMarkers() {
  const scene = globe.scene();
  if (!scene) return;
  volcanoMarkers.forEach(m => { scene.remove(m); if (m.geometry) m.geometry.dispose(); if (m.material) m.material.dispose(); });
  volcanoMarkers = [];
  if (volcanoAnimationId) { cancelAnimationFrame(volcanoAnimationId); volcanoAnimationId = null; }
}

function toggleVolcanoes(visible) {
  showVolcanoes = visible;
  if (visible) fetchVolcanoData(); else clearVolcanoMarkers();
}

// ============================================
// AIR QUALITY VISUALIZATION (OpenAQ)
// ============================================

async function fetchAirQualityData() {
  try {
    const response = await fetch('https://api.openaq.org/v2/latest?limit=300&parameter=pm25&order_by=lastUpdated&sort=desc');
    if (!response.ok) throw new Error('OpenAQ unavailable');
    const data = await response.json();
    airQualityData = data.results.filter(r => r.coordinates?.latitude && r.coordinates?.longitude).map(r => {
      const pm25 = r.measurements.find(m => m.parameter === 'pm25');
      const val = pm25?.value || 0;
      return { lat: r.coordinates.latitude, lon: r.coordinates.longitude, location: r.location, city: r.city, country: r.country, pm25: val, aqi: pm25ToAqi(val) };
    }).filter(r => r.pm25 > 0);
    log('Loaded ' + airQualityData.length + ' air quality stations');
    updateAirQualityMarkers();
  } catch (error) {
    console.warn('Failed to fetch air quality data:', error);
  }
}

function pm25ToAqi(pm25) {
  if (pm25 <= 12) return Math.round((50 / 12) * pm25);
  if (pm25 <= 35.4) return Math.round(((100 - 51) / (35.4 - 12.1)) * (pm25 - 12.1) + 51);
  if (pm25 <= 55.4) return Math.round(((150 - 101) / (55.4 - 35.5)) * (pm25 - 35.5) + 101);
  if (pm25 <= 150.4) return Math.round(((200 - 151) / (150.4 - 55.5)) * (pm25 - 55.5) + 151);
  return Math.min(500, Math.round(((300 - 201) / (250.4 - 150.5)) * (pm25 - 150.5) + 201));
}

function getAqiColor(aqi) {
  if (aqi <= 50) return new THREE.Color(0.0, 0.8, 0.0);
  if (aqi <= 100) return new THREE.Color(1.0, 0.85, 0.0);
  if (aqi <= 150) return new THREE.Color(1.0, 0.5, 0.0);
  if (aqi <= 200) return new THREE.Color(1.0, 0.0, 0.0);
  if (aqi <= 300) return new THREE.Color(0.6, 0.2, 0.6);
  return new THREE.Color(0.5, 0.0, 0.2);
}

function updateAirQualityMarkers() {
  const scene = globe.scene();
  if (!scene) return;
  clearAirQualityMarkers();
  if (!showAirQuality || airQualityData.length === 0) return;
  const globeRadius = 100;
  airQualityData.forEach((station, index) => {
    const color = getAqiColor(station.aqi);
    const size = 0.3 + Math.min(station.aqi / 200, 1) * 0.4;
    const phi = (90 - station.lat) * (Math.PI / 180);
    const theta = station.lon * (Math.PI / 180);
    const r = globeRadius + 0.2;
    const x = r * Math.sin(phi) * Math.sin(theta);
    const y = r * Math.cos(phi);
    const z = r * Math.sin(phi) * Math.cos(theta);
    const geometry = new THREE.CircleGeometry(size, 12);
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false });
    const marker = new THREE.Mesh(geometry, material);
    marker.position.set(x, y, z);
    marker.lookAt(0, 0, 0);
    marker.rotateX(Math.PI);
    marker.userData = { station, type: 'airQuality', index };
    marker.renderOrder = 95;
    scene.add(marker);
    airQualityMarkers.push(marker);
  });
}

function clearAirQualityMarkers() {
  const scene = globe.scene();
  if (!scene) return;
  airQualityMarkers.forEach(m => { scene.remove(m); if (m.geometry) m.geometry.dispose(); if (m.material) m.material.dispose(); });
  airQualityMarkers = [];
}

function toggleAirQuality(visible) {
  showAirQuality = visible;
  if (visible) fetchAirQualityData(); else clearAirQualityMarkers();
}

// ============================================
// TECTONIC PLATES VISUALIZATION
// ============================================

async function loadTectonicPlates() {
  try {
    const response = await fetch('https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_boundaries.json');
    if (!response.ok) throw new Error('Tectonic plates data unavailable');
    const geojson = await response.json();
    renderTectonicPlates(geojson);
  } catch (error) {
    console.warn('Failed to load tectonic plates:', error);
  }
}

function renderTectonicPlates(geojson) {
  const scene = globe.scene();
  if (!scene) return;
  clearTectonicPlates();
  if (!showTectonicPlates) return;
  const globeRadius = 100;
  const plateColor = new THREE.Color(1.0, 0.4, 0.1);
  geojson.features.forEach((feature) => {
    const coordsList = feature.geometry.type === 'LineString' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    coordsList.forEach(coords => {
      const points = coords.map(c => {
        const phi = (90 - c[1]) * (Math.PI / 180);
        const theta = c[0] * (Math.PI / 180);
        const r = globeRadius + 0.15;
        return new THREE.Vector3(r * Math.sin(phi) * Math.sin(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.cos(theta));
      });
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({ color: plateColor, transparent: true, opacity: 0.6 });
      const line = new THREE.Line(geometry, material);
      line.renderOrder = 50;
      scene.add(line);
      tectonicPlateLines.push(line);
    });
  });
  log('Rendered ' + tectonicPlateLines.length + ' plate boundary segments');
}

function clearTectonicPlates() {
  const scene = globe.scene();
  if (!scene) return;
  tectonicPlateLines.forEach(l => { scene.remove(l); if (l.geometry) l.geometry.dispose(); if (l.material) l.material.dispose(); });
  tectonicPlateLines = [];
}

function toggleTectonicPlates(visible) {
  showTectonicPlates = visible;
  if (visible) loadTectonicPlates(); else clearTectonicPlates();
}

// ============================================
// WIND PARTICLE VISUALIZATION
// ============================================

/**
 * Initialize wind particle system
 * Creates flowing light streaks that show global wind patterns
 */
function initializeWindParticles() {
  const scene = globe.scene();
  if (!scene || windParticleSystem) return;

  const globeRadius = 100;
  const particleCount = 2000;   // More particles for denser coverage
  const trailLength = 24;       // Longer trails for smoother, flowing streaks

  // Generate initial particles with trail history
  windParticles = generateWindParticles(particleCount);

  // Initialize trail history for each particle
  windParticles.forEach(particle => {
    particle.trail = [];
    for (let i = 0; i < trailLength; i++) {
      particle.trail.push({ lat: particle.lat, lon: particle.lon });
    }
  });

  // Create line geometry - each particle has trailLength points connected as a line strip
  // Using LineSegments for better performance (pairs of points)
  const segmentsPerParticle = trailLength - 1;
  const totalSegments = particleCount * segmentsPerParticle;
  const positions = new Float32Array(totalSegments * 6); // 2 points * 3 coords per segment
  const colors = new Float32Array(totalSegments * 6);    // 2 colors * 3 components per segment

  // Initialize positions
  windParticles.forEach((particle, pIndex) => {
    for (let t = 0; t < segmentsPerParticle; t++) {
      const segIndex = pIndex * segmentsPerParticle + t;
      const trailPos = particle.trail[t];
      const nextTrailPos = particle.trail[t + 1];

      const p1 = latLonToXYZ(trailPos.lat, trailPos.lon, globeRadius + 0.8);
      const p2 = latLonToXYZ(nextTrailPos.lat, nextTrailPos.lon, globeRadius + 0.8);

      // Point 1
      positions[segIndex * 6] = p1.x;
      positions[segIndex * 6 + 1] = p1.y;
      positions[segIndex * 6 + 2] = p1.z;
      // Point 2
      positions[segIndex * 6 + 3] = p2.x;
      positions[segIndex * 6 + 4] = p2.y;
      positions[segIndex * 6 + 5] = p2.z;

      // Color gradient along trail (bright at head, fading to tail)
      const alphaHead = (t + 1) / trailLength;
      const alphaTail = t / trailLength;
      const speedNorm = Math.min(1, particle.speed / 35);

      // Light blue to white based on speed
      const r = 0.6 + speedNorm * 0.4;
      const g = 0.8 + speedNorm * 0.2;
      const b = 1.0;

      // Point 1 (tail end of segment)
      colors[segIndex * 6] = r * alphaTail;
      colors[segIndex * 6 + 1] = g * alphaTail;
      colors[segIndex * 6 + 2] = b * alphaTail;
      // Point 2 (head end of segment)
      colors[segIndex * 6 + 3] = r * alphaHead;
      colors[segIndex * 6 + 4] = g * alphaHead;
      colors[segIndex * 6 + 5] = b * alphaHead;
    }
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  // Smooth flowing wind streak material with soft glow
  const material = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      opacity: { value: 0.5 }
    },
    vertexShader: `
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vColor = color;
        vAlpha = length(color);  // Use color intensity for alpha gradient
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float opacity;
      uniform float time;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        // Soft, ethereal wind color - light cyan/white
        vec3 baseColor = vec3(0.7, 0.85, 1.0);
        vec3 glowColor = mix(baseColor, vec3(1.0), vAlpha * 0.5);

        // Smooth alpha falloff for flowing appearance
        float smoothAlpha = pow(vAlpha, 1.5) * opacity;

        // Subtle breathing effect
        float breath = sin(time * 0.8) * 0.08 + 1.0;
        smoothAlpha *= breath;

        // Very soft glow halo
        glowColor += vec3(0.1, 0.15, 0.2) * smoothAlpha;

        gl_FragColor = vec4(glowColor, smoothAlpha * 0.7);
      }
    `,
    transparent: true,
    vertexColors: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });

  windParticleSystem = new THREE.LineSegments(geometry, material);
  windParticleSystem.name = 'windStreaks';
  windParticleSystem.visible = showWindParticles;
  scene.add(windParticleSystem);

  // Start animation
  animateWindParticles();
  log('Wind streak system initialized with', particleCount, 'streaks');
}

/**
 * Convert lat/lon to 3D coordinates
 */
function latLonToXYZ(lat, lon, radius) {
  // Match globe.gl's coordinate system
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = lon * (Math.PI / 180);

  return {
    x: radius * Math.sin(phi) * Math.sin(theta),
    y: radius * Math.cos(phi),
    z: radius * Math.sin(phi) * Math.cos(theta)
  };
}

/**
 * Animate wind streaks - move them according to wind patterns
 */
function animateWindParticles() {
  if (windAnimationId) cancelAnimationFrame(windAnimationId);

  const globeRadius = 100;
  const trailLength = 16;
  const segmentsPerParticle = trailLength - 1;
  const speedScale = 0.4;  // Slow down wind for calmer appearance

  const animate = () => {
    if (!windParticleSystem || !showWindParticles) {
      windAnimationId = requestAnimationFrame(animate);
      return;
    }

    const positions = windParticleSystem.geometry.attributes.position.array;
    const colors = windParticleSystem.geometry.attributes.color.array;

    windParticles.forEach((particle, pIndex) => {
      // Update age
      particle.age += 1;

      // Reset if too old
      if (particle.age > particle.maxAge) {
        particle.age = 0;
        particle.lat = (Math.random() - 0.5) * 160;
        particle.lon = (Math.random() - 0.5) * 360;
        const wind = getClimatologicalWind(particle.lat, particle.lon);
        particle.speed = wind.speed;
        particle.direction = wind.direction;
        // Reset trail to new position
        particle.trail.forEach(p => {
          p.lat = particle.lat;
          p.lon = particle.lon;
        });
      }

      // Move particle according to wind (scaled for calmer appearance)
      const velocity = windToVelocity(particle.direction, particle.speed);
      particle.lon += velocity.vLon * speedScale;
      particle.lat += velocity.vLat * speedScale;

      // Wrap around
      if (particle.lon > 180) particle.lon -= 360;
      if (particle.lon < -180) particle.lon += 360;
      particle.lat = Math.max(-80, Math.min(80, particle.lat));

      // Shift trail - move all positions back, add new head position
      for (let t = 0; t < trailLength - 1; t++) {
        particle.trail[t].lat = particle.trail[t + 1].lat;
        particle.trail[t].lon = particle.trail[t + 1].lon;
      }
      particle.trail[trailLength - 1].lat = particle.lat;
      particle.trail[trailLength - 1].lon = particle.lon;

      // Update line segment positions and colors
      const speedNorm = Math.min(1, particle.speed / 35);
      const r = 0.6 + speedNorm * 0.4;
      const g = 0.8 + speedNorm * 0.2;
      const b = 1.0;

      for (let t = 0; t < segmentsPerParticle; t++) {
        const segIndex = pIndex * segmentsPerParticle + t;
        const trailPos = particle.trail[t];
        const nextTrailPos = particle.trail[t + 1];

        const p1 = latLonToXYZ(trailPos.lat, trailPos.lon, globeRadius + 0.8);
        const p2 = latLonToXYZ(nextTrailPos.lat, nextTrailPos.lon, globeRadius + 0.8);

        // Update positions
        positions[segIndex * 6] = p1.x;
        positions[segIndex * 6 + 1] = p1.y;
        positions[segIndex * 6 + 2] = p1.z;
        positions[segIndex * 6 + 3] = p2.x;
        positions[segIndex * 6 + 4] = p2.y;
        positions[segIndex * 6 + 5] = p2.z;

        // Update colors with fade along trail
        const alphaTail = t / trailLength;
        const alphaHead = (t + 1) / trailLength;

        colors[segIndex * 6] = r * alphaTail;
        colors[segIndex * 6 + 1] = g * alphaTail;
        colors[segIndex * 6 + 2] = b * alphaTail;
        colors[segIndex * 6 + 3] = r * alphaHead;
        colors[segIndex * 6 + 4] = g * alphaHead;
        colors[segIndex * 6 + 5] = b * alphaHead;
      }
    });

    windParticleSystem.geometry.attributes.position.needsUpdate = true;
    windParticleSystem.geometry.attributes.color.needsUpdate = true;

    windParticleSystem.material.uniforms.time.value = Date.now() * 0.001;

    windAnimationId = requestAnimationFrame(animate);
  };

  animate();
}

/**
 * Toggle wind particle visibility
 */
function toggleWindParticles(visible) {
  showWindParticles = visible;
  if (windParticleSystem) {
    windParticleSystem.visible = visible;
  }
  if (visible && !windParticleSystem) {
    initializeWindParticles();
  }
  updateToggleButton('wind-btn', showWindParticles);
}

/**
 * Add weather radar overlay to globe
 * Uses RainViewer precipitation radar data with standard weather colors
 * Note: Radar coverage is regional (mainly US, Europe, Australia, parts of Asia)
 * Color scale: Green=light rain, Yellow=moderate, Orange=heavy, Red=very heavy, Purple=extreme
 */
async function addRadarOverlay() {
  const scene = globe.scene();
  if (!scene) return;

  // Remove existing radar overlay
  if (radarOverlay) {
    scene.remove(radarOverlay);
    radarOverlay = null;
  }

  try {
    // Use backend proxy to bypass CORS
    const response = await fetch(`${API_BASE}/api/weather/rainviewer`);
    if (!response.ok) throw new Error('Backend proxy failed');
    const radarData = await response.json();

    if (!radarData) {
      console.warn('No RainViewer data available');
      return;
    }

    // Use actual precipitation radar data (not satellite IR)
    if (!radarData.radar || !radarData.radar.past || radarData.radar.past.length === 0) {
      console.warn('No radar data available, using procedural fallback');
      createProceduralRadarOverlay(scene);
      return;
    }

    const latestRadar = radarData.radar.past[radarData.radar.past.length - 1];
    const host = radarData.host || 'https://tilecache.rainviewer.com';
    // Get global radar composite - color scheme 2 (original weather colors), smooth, snow enabled
    // Format: {host}{path}/{size}/{z}/{x}/{y}/{color}/{options}.png
    // Use size 512, zoom 1 for global view with color scheme 2
    const originalUrl = `${host}${latestRadar.path}/512/1/0/0/2/1_1.png`;
    const radarUrl = `${API_BASE}/api/weather/radar/image?url=${encodeURIComponent(originalUrl)}`;

    const textureLoader = new THREE.TextureLoader();
    textureLoader.crossOrigin = 'anonymous';

    textureLoader.load(
      radarUrl,
      (texture) => {
        const globeRadius = 100;

        // Create radar overlay preserving RainViewer's weather colors
        const radarGeometry = new THREE.SphereGeometry(globeRadius + 0.8, 128, 64);

        const radarMaterial = new THREE.ShaderMaterial({
          uniforms: {
            radarTexture: { value: texture },
            opacity: { value: 0.9 }
          },
          vertexShader: `
            varying vec2 vUv;
            varying vec3 vNormal;

            void main() {
              vUv = uv;
              vNormal = normalize(normalMatrix * normal);
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: `
            uniform sampler2D radarTexture;
            uniform float opacity;

            varying vec2 vUv;
            varying vec3 vNormal;

            void main() {
              vec4 texColor = texture2D(radarTexture, vUv);

              // RainViewer radar uses color-coded precipitation intensity:
              // Green = light rain, Yellow = moderate, Orange = heavy
              // Red = very heavy, Purple/Pink = extreme, Blue = snow/ice

              // Check for actual precipitation data (skip transparent/black areas)
              float intensity = max(texColor.r, max(texColor.g, texColor.b));
              if (texColor.a < 0.1 || intensity < 0.05) discard;

              // Use original colors from RainViewer with enhanced saturation
              vec3 color = texColor.rgb;

              // Boost saturation for better visibility on globe
              float gray = dot(color, vec3(0.299, 0.587, 0.114));
              color = mix(vec3(gray), color, 1.4); // 40% saturation boost

              // Slight brightness boost for visibility
              color = color * 1.2;
              color = clamp(color, 0.0, 1.0);

              // Slight glow effect for intense precipitation
              if (intensity > 0.6) {
                color = mix(color, vec3(1.0), (intensity - 0.6) * 0.3);
              }

              float finalAlpha = texColor.a * opacity;

              gl_FragColor = vec4(color, finalAlpha);
            }
          `,
          transparent: true,
          depthWrite: false,
          side: THREE.FrontSide,
          blending: THREE.NormalBlending
        });

        radarOverlay = new THREE.Mesh(radarGeometry, radarMaterial);
        radarOverlay.name = 'radarOverlay';
        radarOverlay.visible = showRadar;
        // Rotate to align with globe.gl's internal mesh (longitude 0° alignment)
        radarOverlay.rotation.y = -Math.PI / 2;
        scene.add(radarOverlay);

        log('Real-time precipitation radar overlay added (regional coverage)');
      },
      undefined,
      (error) => {
        console.warn('Failed to load radar texture via proxy:', error);
        createProceduralRadarOverlay(scene);
      }
    );

  } catch (error) {
    console.warn('Failed to add radar overlay (using procedural fallback):', error.message);
    const scene = globe.scene();
    if (scene) createProceduralRadarOverlay(scene);
  }
}

/**
 * Create a procedural radar-style overlay as fallback
 * Shows simulated precipitation patterns when real radar data unavailable
 * Uses standard weather radar color scale: green/yellow/orange/red/purple
 */
function createProceduralRadarOverlay(scene) {
  const globeRadius = 100;

  // Create shader-based procedural clouds
  const irGeometry = new THREE.SphereGeometry(globeRadius + 1.0, 128, 64);

  const irMaterial = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0.0 },
      opacity: { value: 0.75 }
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vPosition;

      void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        vPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float time;
      uniform float opacity;

      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vPosition;

      // Simplex noise functions
      vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
      vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

      float snoise(vec3 v) {
        const vec2 C = vec2(1.0/6.0, 1.0/3.0);
        const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

        vec3 i  = floor(v + dot(v, C.yyy));
        vec3 x0 = v - i + dot(i, C.xxx);

        vec3 g = step(x0.yzx, x0.xyz);
        vec3 l = 1.0 - g;
        vec3 i1 = min(g.xyz, l.zxy);
        vec3 i2 = max(g.xyz, l.zxy);

        vec3 x1 = x0 - i1 + C.xxx;
        vec3 x2 = x0 - i2 + C.yyy;
        vec3 x3 = x0 - D.yyy;

        i = mod289(i);
        vec4 p = permute(permute(permute(
                 i.z + vec4(0.0, i1.z, i2.z, 1.0))
               + i.y + vec4(0.0, i1.y, i2.y, 1.0))
               + i.x + vec4(0.0, i1.x, i2.x, 1.0));

        float n_ = 0.142857142857;
        vec3  ns = n_ * D.wyz - D.xzx;

        vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

        vec4 x_ = floor(j * ns.z);
        vec4 y_ = floor(j - 7.0 * x_);

        vec4 x = x_ *ns.x + ns.yyyy;
        vec4 y = y_ *ns.x + ns.yyyy;
        vec4 h = 1.0 - abs(x) - abs(y);

        vec4 b0 = vec4(x.xy, y.xy);
        vec4 b1 = vec4(x.zw, y.zw);

        vec4 s0 = floor(b0)*2.0 + 1.0;
        vec4 s1 = floor(b1)*2.0 + 1.0;
        vec4 sh = -step(h, vec4(0.0));

        vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
        vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;

        vec3 p0 = vec3(a0.xy, h.x);
        vec3 p1 = vec3(a0.zw, h.y);
        vec3 p2 = vec3(a1.xy, h.z);
        vec3 p3 = vec3(a1.zw, h.w);

        vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
        p0 *= norm.x;
        p1 *= norm.y;
        p2 *= norm.z;
        p3 *= norm.w;

        vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
        m = m * m;
        return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
      }

      float fbm(vec3 p) {
        float value = 0.0;
        float amplitude = 0.5;
        float frequency = 1.0;
        for (int i = 0; i < 4; i++) {
          value += amplitude * snoise(p * frequency);
          amplitude *= 0.5;
          frequency *= 2.0;
        }
        return value;
      }

      void main() {
        // Generate cloud-like noise pattern
        vec3 noiseCoord = vPosition * 0.03 + vec3(time * 0.01, 0.0, 0.0);
        float noise = fbm(noiseCoord);

        // Add latitude-based cloud bands (ITCZ, storm tracks)
        float lat = asin(normalize(vPosition).y);
        float latBand = 0.0;
        // ITCZ near equator
        latBand += exp(-pow(lat, 2.0) * 20.0) * 0.3;
        // Mid-latitude storm tracks
        latBand += exp(-pow(lat - 0.7, 2.0) * 10.0) * 0.4;
        latBand += exp(-pow(lat + 0.7, 2.0) * 10.0) * 0.4;

        float cloudiness = (noise * 0.5 + 0.5) * (0.3 + latBand);

        // Enhanced infrared color scale - more vibrant
        vec3 color;
        if (cloudiness < 0.25) {
          // Clear skies - subtle dark blue
          color = vec3(0.05, 0.03, 0.12);
        } else if (cloudiness < 0.38) {
          // Low clouds - cyan to green
          float t = (cloudiness - 0.25) / 0.13;
          color = mix(vec3(0.0, 0.45, 0.55), vec3(0.25, 0.75, 0.25), t);
        } else if (cloudiness < 0.5) {
          // Mid clouds - green to yellow
          float t = (cloudiness - 0.38) / 0.12;
          color = mix(vec3(0.25, 0.75, 0.25), vec3(0.95, 0.9, 0.15), t);
        } else if (cloudiness < 0.65) {
          // High clouds - yellow to orange
          float t = (cloudiness - 0.5) / 0.15;
          color = mix(vec3(0.95, 0.9, 0.15), vec3(1.0, 0.55, 0.05), t);
        } else if (cloudiness < 0.8) {
          // Storm clouds - orange to red
          float t = (cloudiness - 0.65) / 0.15;
          color = mix(vec3(1.0, 0.55, 0.05), vec3(1.0, 0.2, 0.15), t);
        } else {
          // Intense activity - red to magenta
          float t = (cloudiness - 0.8) / 0.2;
          color = mix(vec3(1.0, 0.2, 0.15), vec3(1.0, 0.5, 0.9), t);
        }

        // Boost color intensity
        color *= 1.25;

        // Alpha based on cloudiness - lower threshold
        float alpha = smoothstep(0.2, 0.4, cloudiness) * opacity;

        // Gentle edge fade
        float edgeFade = max(0.35, dot(vNormal, vec3(0.0, 0.0, 1.0)));
        alpha *= edgeFade;

        if (alpha < 0.02) discard;

        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    blending: THREE.AdditiveBlending
  });

  radarOverlay = new THREE.Mesh(irGeometry, irMaterial);
  radarOverlay.name = 'radarOverlay';
  radarOverlay.visible = showRadar;
  // Rotate to align with globe.gl's internal mesh (longitude 0° alignment)
  radarOverlay.rotation.y = -Math.PI / 2;
  scene.add(radarOverlay);

  // Animate the procedural clouds
  function animateIR() {
    if (radarOverlay && radarOverlay.material.uniforms) {
      radarOverlay.material.uniforms.time.value += 0.016;
    }
    requestAnimationFrame(animateIR);
  }
  animateIR();

  log('Procedural radar overlay added (fallback - no real data)');
}

/**
 * Toggle radar visibility
 */
function toggleRadar(visible) {
  showRadar = visible;
  if (radarOverlay) {
    radarOverlay.visible = visible;
  }
  if (visible && !radarOverlay) {
    addRadarOverlay();
  }
  updateToggleButton('radar-btn', showRadar);
}

/**
 * Add satellite cloud overlay to globe
 * Uses NASA GIBS as primary (CORS-enabled), with procedural cloud fallback
 */
async function addSatelliteOverlay() {
  const scene = globe.scene();
  if (!scene) return;

  // Remove existing satellite overlay if present
  if (satelliteOverlay) {
    scene.remove(satelliteOverlay);
    satelliteOverlay = null;
  }

  const globeRadius = 100;

  // Try NASA GIBS first (CORS-enabled), then fall back to procedural clouds
  try {
    const cloudUrls = getGlobalCloudTextureUrls();
    const textureLoader = new THREE.TextureLoader();
    textureLoader.crossOrigin = 'anonymous';

    // Try NASA GIBS VIIRS (CORS-enabled)
    textureLoader.load(
      cloudUrls.viirsCloud,
      (texture) => {
        createSatelliteOverlayWithTexture(scene, texture, globeRadius);
        log('NASA GIBS satellite cloud overlay added');
      },
      undefined,
      (error) => {
        console.warn('NASA GIBS failed, using procedural clouds:', error.message);
        createProceduralCloudOverlay(scene, globeRadius);
      }
    );
  } catch (error) {
    console.warn('Satellite overlay error, using procedural clouds:', error);
    createProceduralCloudOverlay(scene, globeRadius);
  }
}

/**
 * Create satellite overlay with loaded texture
 */
function createSatelliteOverlayWithTexture(scene, texture, globeRadius) {
  const satGeometry = new THREE.SphereGeometry(globeRadius + 0.6, 256, 128);

  const satMaterial = new THREE.ShaderMaterial({
    uniforms: {
      cloudTexture: { value: texture },
      time: { value: 0 },
      cloudOpacity: { value: 0.65 },
      cloudBrightness: { value: 1.1 }
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vPosition;

      void main() {
        vUv = uv;
        vNormal = normalize(normal);
        vPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D cloudTexture;
      uniform float time;
      uniform float cloudOpacity;
      uniform float cloudBrightness;

      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vPosition;

      void main() {
        vec4 texColor = texture2D(cloudTexture, vUv);

        // Extract cloud brightness
        float cloudiness = (texColor.r + texColor.g + texColor.b) / 3.0;

        // Balanced cloud extraction
        float cloudAlpha = smoothstep(0.25, 0.6, cloudiness);
        cloudAlpha = pow(cloudAlpha, 0.8); // Gentle boost

        // Natural cloud colors
        vec3 cloudColor = mix(
          vec3(0.9, 0.92, 0.95),   // Slight blue tint for thin clouds
          vec3(1.0, 1.0, 1.0),     // Pure white for thick clouds
          cloudiness
        ) * cloudBrightness;

        // Subtle shading
        float shadow = 1.0 - smoothstep(0.5, 0.85, cloudiness) * 0.1;
        cloudColor *= shadow;

        float finalAlpha = cloudAlpha * cloudOpacity;

        if (finalAlpha < 0.02) discard;

        gl_FragColor = vec4(cloudColor, finalAlpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    blending: THREE.NormalBlending
  });

  satelliteOverlay = new THREE.Mesh(satGeometry, satMaterial);
  satelliteOverlay.name = 'satelliteOverlay';
  satelliteOverlay.visible = showSatellite;
  // Rotate to align with globe.gl's internal mesh (longitude 0° alignment)
  satelliteOverlay.rotation.y = -Math.PI / 2;
  scene.add(satelliteOverlay);
}

/**
 * Create beautiful procedural cloud overlay as fallback
 * Uses multi-octave noise for realistic cloud patterns
 */
function createProceduralCloudOverlay(scene, globeRadius) {
  const satGeometry = new THREE.SphereGeometry(globeRadius + 0.6, 256, 128);

  const satMaterial = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      cloudOpacity: { value: 0.55 },
      cloudScale: { value: 3.0 },
      cloudSpeed: { value: 0.02 }
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vPosition;

      void main() {
        vUv = uv;
        vNormal = normalize(normal);
        vPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float time;
      uniform float cloudOpacity;
      uniform float cloudScale;
      uniform float cloudSpeed;

      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vPosition;

      // Simplex-like noise functions
      vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
      vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

      float snoise(vec3 v) {
        const vec2 C = vec2(1.0/6.0, 1.0/3.0);
        const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

        vec3 i = floor(v + dot(v, C.yyy));
        vec3 x0 = v - i + dot(i, C.xxx);

        vec3 g = step(x0.yzx, x0.xyz);
        vec3 l = 1.0 - g;
        vec3 i1 = min(g.xyz, l.zxy);
        vec3 i2 = max(g.xyz, l.zxy);

        vec3 x1 = x0 - i1 + C.xxx;
        vec3 x2 = x0 - i2 + C.yyy;
        vec3 x3 = x0 - D.yyy;

        i = mod289(i);
        vec4 p = permute(permute(permute(
          i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));

        float n_ = 0.142857142857;
        vec3 ns = n_ * D.wyz - D.xzx;

        vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

        vec4 x_ = floor(j * ns.z);
        vec4 y_ = floor(j - 7.0 * x_);

        vec4 x = x_ * ns.x + ns.yyyy;
        vec4 y = y_ * ns.x + ns.yyyy;
        vec4 h = 1.0 - abs(x) - abs(y);

        vec4 b0 = vec4(x.xy, y.xy);
        vec4 b1 = vec4(x.zw, y.zw);

        vec4 s0 = floor(b0) * 2.0 + 1.0;
        vec4 s1 = floor(b1) * 2.0 + 1.0;
        vec4 sh = -step(h, vec4(0.0));

        vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
        vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

        vec3 p0 = vec3(a0.xy, h.x);
        vec3 p1 = vec3(a0.zw, h.y);
        vec3 p2 = vec3(a1.xy, h.z);
        vec3 p3 = vec3(a1.zw, h.w);

        vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
        p0 *= norm.x;
        p1 *= norm.y;
        p2 *= norm.z;
        p3 *= norm.w;

        vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
        m = m * m;
        return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
      }

      // FBM (Fractal Brownian Motion) for realistic clouds
      float fbm(vec3 p) {
        float value = 0.0;
        float amplitude = 0.5;
        float frequency = 1.0;

        for (int i = 0; i < 6; i++) {
          value += amplitude * snoise(p * frequency);
          amplitude *= 0.5;
          frequency *= 2.0;
        }

        return value;
      }

      void main() {
        // Convert UV to 3D position for seamless sphere mapping
        float theta = vUv.x * 6.28318530718;
        float phi = (vUv.y - 0.5) * 3.14159265359;

        vec3 spherePos = vec3(
          cos(phi) * cos(theta + time * cloudSpeed),
          sin(phi),
          cos(phi) * sin(theta + time * cloudSpeed)
        );

        // Multi-layer cloud noise
        float clouds = fbm(spherePos * cloudScale);
        clouds += fbm(spherePos * cloudScale * 2.0 + vec3(100.0)) * 0.5;
        clouds = clouds * 0.5 + 0.5; // Normalize to 0-1

        // Latitude-based cloud distribution (more clouds in mid-latitudes)
        float lat = abs(vUv.y - 0.5) * 2.0;
        float latFactor = smoothstep(0.0, 0.3, lat) * smoothstep(1.0, 0.7, lat);
        latFactor = mix(0.6, 1.0, latFactor);

        // Cloud threshold with soft edges
        float cloudAlpha = smoothstep(0.35, 0.65, clouds * latFactor);

        // Add subtle detail variation
        float detail = snoise(spherePos * cloudScale * 8.0) * 0.1;
        cloudAlpha = clamp(cloudAlpha + detail, 0.0, 1.0);

        // Cloud color with subtle shading
        float shadow = 1.0 - cloudAlpha * 0.2;
        vec3 cloudColor = vec3(0.95, 0.97, 1.0) * shadow;

        // Thin cloud edges are more transparent
        cloudAlpha = pow(cloudAlpha, 0.7);

        float finalAlpha = cloudAlpha * cloudOpacity;

        if (finalAlpha < 0.02) discard;

        gl_FragColor = vec4(cloudColor, finalAlpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    blending: THREE.NormalBlending
  });

  satelliteOverlay = new THREE.Mesh(satGeometry, satMaterial);
  satelliteOverlay.name = 'satelliteOverlay';
  satelliteOverlay.visible = showSatellite;
  // Rotate to align with globe.gl's internal mesh (longitude 0° alignment)
  satelliteOverlay.rotation.y = -Math.PI / 2;
  scene.add(satelliteOverlay);

  // Animate clouds
  function animateClouds() {
    if (satelliteOverlay && satelliteOverlay.material.uniforms) {
      satelliteOverlay.material.uniforms.time.value = Date.now() * 0.001;
    }
    requestAnimationFrame(animateClouds);
  }
  animateClouds();

  log('Procedural cloud overlay added');
}

/**
 * Toggle satellite visibility
 */
function toggleSatellite(visible) {
  showSatellite = visible;
  if (satelliteOverlay) {
    satelliteOverlay.visible = visible;
  }
  if (visible && !satelliteOverlay) {
    addSatelliteOverlay();
  }
  updateToggleButton('satellite-btn', showSatellite);
}

/**
 * Animation loop for day/night and sun
 */
function animateDayNight() {
  if (showSunCycle) {
    updateSunPosition();
    updateDayNightOverlay();
    updateNightLights();
  }
  requestAnimationFrame(animateDayNight);
}

// Add animated ice caps with gradient shader for natural falloff
function addIceCaps() {
  const scene = globe.scene();
  if (!scene) return;

  // Ice cap shader material with gradient falloff and shimmer
  const createIceCapMaterial = (isNorth) => {
    return new THREE.ShaderMaterial({
      uniforms: {
        sunPosition: { value: new THREE.Vector3(500, 200, 500) },
        iceColor: { value: new THREE.Color(0xffffff) },
        iceEdgeColor: { value: new THREE.Color(0xaaddff) },
        shimmerTime: { value: 0.0 },
        iceExtent: { value: 0.15 }, // How far ice extends from pole (0-1)
        isNorthPole: { value: isNorth ? 1.0 : 0.0 }
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vWorldPosition;
        varying vec3 vPosition;
        varying vec2 vUv;

        void main() {
          vNormal = normalize(normalMatrix * normal);
          vPosition = position;
          vUv = uv;
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPos.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 sunPosition;
        uniform vec3 iceColor;
        uniform vec3 iceEdgeColor;
        uniform float shimmerTime;
        uniform float iceExtent;
        uniform float isNorthPole;

        varying vec3 vNormal;
        varying vec3 vWorldPosition;
        varying vec3 vPosition;
        varying vec2 vUv;

        // Noise function for shimmer effect
        float noise(vec2 p) {
          return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
        }

        void main() {
          vec3 viewDir = normalize(cameraPosition - vWorldPosition);
          vec3 sunDir = normalize(sunPosition);

          // Calculate latitude (y component normalized)
          float latitude = vPosition.y / 100.0; // Assuming sphere radius ~100

          // Ice coverage based on latitude
          float polarDistance;
          if (isNorthPole > 0.5) {
            polarDistance = 1.0 - latitude; // Distance from north pole
          } else {
            polarDistance = 1.0 + latitude; // Distance from south pole
          }

          // Gradient falloff - smooth transition at ice edge
          float iceFactor = 1.0 - smoothstep(0.0, iceExtent, polarDistance);

          // Add noise for natural edge variation
          float edgeNoise = noise(vUv * 50.0 + shimmerTime * 0.1) * 0.15;
          iceFactor = clamp(iceFactor + (iceFactor > 0.1 ? edgeNoise - 0.075 : 0.0), 0.0, 1.0);

          // Shimmer/sparkle effect
          float shimmer = noise(vUv * 200.0 + shimmerTime) * 0.3;
          shimmer *= pow(max(0.0, dot(vNormal, sunDir)), 2.0); // Only visible in sunlight

          // Fresnel for ice edge glow
          float fresnel = pow(1.0 - max(0.0, dot(viewDir, vNormal)), 2.0);

          // Specular highlight on ice
          vec3 reflectDir = reflect(-sunDir, vNormal);
          float specular = pow(max(0.0, dot(viewDir, reflectDir)), 32.0);

          // Color mixing - white center, blue edge
          float edgeFactor = smoothstep(0.3, 0.0, iceFactor);
          vec3 finalColor = mix(iceColor, iceEdgeColor, edgeFactor);

          // Add shimmer and specular
          finalColor += shimmer * vec3(1.0, 1.0, 1.0);
          finalColor += specular * 0.5 * vec3(1.0, 0.98, 0.95);

          // Sun-facing brightness
          float sunFacing = max(0.2, dot(vNormal, sunDir));
          finalColor *= (0.6 + sunFacing * 0.6);

          // Fresnel edge glow
          finalColor += fresnel * iceEdgeColor * 0.2;

          // Final alpha with soft edge
          float alpha = iceFactor * 0.85;

          gl_FragColor = vec4(finalColor, alpha);
        }
      `,
      transparent: true,
      blending: THREE.NormalBlending,
      side: THREE.FrontSide,
      depthWrite: false  // Allow other transparent layers (city lights) to show through
    });
  };

  // North pole ice cap - full sphere with shader masking
  const northIceGeom = new THREE.SphereGeometry(100.4, 128, 64);
  const northIceMat = createIceCapMaterial(true);
  const northIce = new THREE.Mesh(northIceGeom, northIceMat);
  northIce.name = 'northIceCap';
  // Rotate to align with globe.gl's internal mesh (longitude 0° alignment)
  northIce.rotation.y = -Math.PI / 2;
  northIce.renderOrder = 5;  // Render before city lights (15) to allow blending
  scene.add(northIce);

  // South pole ice cap
  const southIceGeom = new THREE.SphereGeometry(100.4, 128, 64);
  const southIceMat = createIceCapMaterial(false);
  const southIce = new THREE.Mesh(southIceGeom, southIceMat);
  southIce.name = 'southIceCap';
  // Rotate to align with globe.gl's internal mesh (longitude 0° alignment)
  southIce.rotation.y = -Math.PI / 2;
  southIce.renderOrder = 5;  // Render before city lights (15) to allow blending
  scene.add(southIce);

  window.erfIceCaps = { north: northIce, south: southIce };

  // Animate shimmer effect
  function animateIceShimmer() {
    const time = performance.now() * 0.001;
    if (window.erfIceCaps) {
      window.erfIceCaps.north.material.uniforms.shimmerTime.value = time;
      window.erfIceCaps.south.material.uniforms.shimmerTime.value = time;
    }
    requestAnimationFrame(animateIceShimmer);
  }
  animateIceShimmer();
}

// Update ice coverage based on state - uses shader uniform for smooth gradient
// Supports full range from ice-free (0%) to Snowball Earth (90%+)
function updateIceCoverage(iceCoveragePercent) {
  if (!window.erfIceCaps) return;

  // Clamp to valid range (0 = ice-free tropics, 100 = full Snowball Earth)
  const normalizedCoverage = Math.max(0, Math.min(100, iceCoveragePercent));

  // Calculate ice extent (how far from pole the ice reaches, 0-1 where 1 = equator)
  // 0% coverage = 0.0 extent (no visible ice caps)
  // 10% (present day) = 0.15 extent
  // 30% (ice age) = 0.45 extent
  // 90% (Snowball Earth) = 0.95 extent (nearly entire globe)
  let targetExtent;

  if (normalizedCoverage <= 0.5) {
    // Ice-free world (Mesozoic greenhouse)
    targetExtent = 0.0;
  } else if (normalizedCoverage <= 10) {
    // Modern to warm conditions
    const minExtent = 0.05;
    const maxExtent = 0.15;
    targetExtent = minExtent + ((normalizedCoverage - 0.5) / 9.5) * (maxExtent - minExtent);
  } else if (normalizedCoverage <= 35) {
    // Ice age conditions
    const minExtent = 0.15;
    const maxExtent = 0.50;
    targetExtent = minExtent + ((normalizedCoverage - 10) / 25) * (maxExtent - minExtent);
  } else {
    // Extreme glaciation (Snowball Earth territory)
    const minExtent = 0.50;
    const maxExtent = 0.98; // Nearly full globe
    targetExtent = minExtent + ((normalizedCoverage - 35) / 65) * (maxExtent - minExtent);
  }

  // Get current extent for smooth interpolation
  const currentExtent = window.erfIceCaps.north.material.uniforms.iceExtent.value;
  const newExtent = currentExtent + (targetExtent - currentExtent) * 0.08;

  // Update shader uniforms
  window.erfIceCaps.north.material.uniforms.iceExtent.value = newExtent;
  window.erfIceCaps.south.material.uniforms.iceExtent.value = newExtent;

  // Adjust ice color based on coverage
  // Normal ice = white, extreme ice = slightly blue-tinged (ancient glacial ice)
  let brightness, blueTint;
  if (normalizedCoverage > 50) {
    // Snowball Earth - bluish ancient ice
    brightness = 0.85;
    blueTint = 0.1;
  } else if (normalizedCoverage > 20) {
    // Ice age - bright white
    brightness = 0.95;
    blueTint = 0.02;
  } else {
    // Normal/warm - pure white
    brightness = 1.0;
    blueTint = 0.0;
  }

  const iceColor = new THREE.Color(brightness - blueTint, brightness, brightness + blueTint * 0.5);
  window.erfIceCaps.north.material.uniforms.iceColor.value = iceColor;
  window.erfIceCaps.south.material.uniforms.iceColor.value = iceColor;

  // During Snowball Earth, also adjust edge color to be more dramatic
  if (normalizedCoverage > 50) {
    const edgeColor = new THREE.Color(0.7, 0.85, 1.0); // Icy blue edge
    window.erfIceCaps.north.material.uniforms.iceEdgeColor.value = edgeColor;
    window.erfIceCaps.south.material.uniforms.iceEdgeColor.value = edgeColor;
  } else {
    const edgeColor = new THREE.Color(0.67, 0.87, 1.0); // Default blue edge
    window.erfIceCaps.north.material.uniforms.iceEdgeColor.value = edgeColor;
    window.erfIceCaps.south.material.uniforms.iceEdgeColor.value = edgeColor;
  }
}

// Auto-play timeline through history
function toggleAutoPlay() {
  const btn = document.getElementById('autoplay-btn');
  const iconSpan = document.getElementById('autoplay-icon');
  const textSpan = document.getElementById('autoplay-text');

  if (isAutoPlaying) {
    // Stop auto-play
    clearInterval(autoPlayInterval);
    isAutoPlaying = false;
    if (btn) {
      btn.classList.remove('playing');
      if (iconSpan) iconSpan.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
      if (textSpan) textSpan.textContent = 'Play History';
    }
  } else {
    // Start auto-play
    isAutoPlaying = true;
    if (btn) {
      btn.classList.add('playing');
      if (iconSpan) iconSpan.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
      if (textSpan) textSpan.textContent = 'Pause';
    }

    const timeline = document.getElementById('timeline');
    const step = 5000000; // 5 million years per tick for geological timescale
    const intervalMs = 150; // Slightly slower for dramatic effect

    autoPlayInterval = setInterval(() => {
      let year = parseInt(timeline.value, 10);
      year -= step;

      // Loop back to present when reaching the past limit
      if (year < TIME_RANGE.min) {
        year = TIME_RANGE.max;
      }

      timeline.value = year;
      timeline.dispatchEvent(new Event('input', { bubbles: true }));
    }, intervalMs);
  }
}

// Create control buttons with refined styling (uses CSS classes from styles.css)
function createControlButtons() {
  // Container for buttons
  const container = document.createElement('div');
  container.className = 'erf-button-container';

  // Play/Pause timeline button
  const playBtn = document.createElement('button');
  playBtn.id = 'autoplay-btn';
  playBtn.className = 'erf-button';
  playBtn.innerHTML = `
    <span class="erf-button-icon" id="autoplay-icon">
      <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
    </span>
    <span id="autoplay-text">Play History</span>
  `;
  playBtn.addEventListener('click', toggleAutoPlay);

  // Rotation toggle button
  const rotateBtn = document.createElement('button');
  rotateBtn.id = 'rotation-btn';
  rotateBtn.className = 'erf-button active';
  rotateBtn.innerHTML = `
    <span class="erf-button-icon">
      <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
    </span>
    <span id="rotation-text">Rotating</span>
  `;
  rotateBtn.addEventListener('click', toggleRotation);

  // Layers button - clean stacked layers icon
  const settingsBtn = document.createElement('button');
  settingsBtn.id = 'settings-btn';
  settingsBtn.className = 'erf-button';
  settingsBtn.title = 'Toggle Layers';
  settingsBtn.innerHTML = `
    <span class="erf-button-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="12 2 2 7 12 12 22 7 12 2"/>
        <polyline points="2 17 12 22 22 17"/>
        <polyline points="2 12 12 17 22 12"/>
      </svg>
    </span>
    <span class="erf-button-text">Layers</span>
  `;
  settingsBtn.addEventListener('click', toggleSettingsPanel);

  // Only add settings button - removed playBtn and rotateBtn
  container.appendChild(settingsBtn);
  document.body.appendChild(container);

  // Create settings panel
  createSettingsPanel();

  // Create historical storms panel
  createHistoricalStormsPanel();

  // Create live storm info panel and click handler
  createLiveStormInfoPanel();
  initStormClickHandler();

  // Create earthquake and wind info panels
  createEarthquakeInfoPanel();
  createWindInfoPanel();

  // Initialize unified click handler for all interactive elements
  initUnifiedClickHandler();
}

// Toggle settings panel visibility
function toggleSettingsPanel() {
  const panel = document.getElementById('settings-panel');
  const btn = document.getElementById('settings-btn');
  if (panel) {
    panel.classList.toggle('visible');
    btn.classList.toggle('active');
  }
}

// Create the settings panel with layer toggles
function createSettingsPanel() {
  const panel = document.createElement('div');
  panel.id = 'settings-panel';

  const header = document.createElement('div');
  header.className = 'settings-header';
  header.textContent = 'Visual Layers';
  panel.appendChild(header);

  const group = document.createElement('div');
  group.className = 'settings-group';

  // Toggle items configuration
  // Note: Clouds toggle removed - static clouds layer was redundant with satellite overlay
  // Note: Ice Caps toggle removed - was procedural/fake data, not real ice coverage
  const toggles = [
    {
      id: 'atmosphere-btn',
      label: 'Atmosphere',
      icon: '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>',
      active: showAtmosphere,
      onClick: toggleAtmosphere
    },
    {
      id: 'storms-btn',
      label: 'Live Storms',
      icon: '<svg viewBox="0 0 24 24"><path d="M19 3H5c-1.11 0-2 .89-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2m-7.06 13.46c-.08.09-.17.18-.26.27l-.07.07c-.44.44-.91.83-1.41 1.16-.32.21-.64.4-.97.56-.33.16-.66.29-1 .38-.34.1-.68.16-1.02.19-.34.03-.67.02-1-.03-.33-.05-.65-.14-.96-.27-.31-.13-.6-.29-.88-.49-.28-.2-.54-.43-.78-.69-.24-.26-.45-.55-.63-.86-.18-.31-.33-.64-.44-.99-.11-.35-.19-.7-.23-1.07-.04-.37-.04-.73 0-1.1.04-.37.12-.73.24-1.08l3.77 2.17-1.53 1.53c.04.04.08.07.12.11.29.29.62.51.98.66.36.15.75.23 1.14.23.39 0 .78-.08 1.14-.23.36-.15.69-.37.98-.66.29-.29.51-.62.66-.98.15-.36.23-.75.23-1.14 0-.39-.08-.78-.23-1.14-.15-.36-.37-.69-.66-.98l-.08-.08-.03-.03-1.53-1.53 2.17 3.77c-.35.12-.71.2-1.08.24-.37.04-.73.04-1.1 0zM17 12l-5 5-1.5-1.5L14 12l-3.5-3.5L12 7l5 5z"/></svg>',
      active: showStorms,
      onClick: toggleStorms
    },
    {
      id: 'history-storms-btn',
      label: 'Historic Storms',
      icon: '<svg viewBox="0 0 24 24"><path d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/></svg>',
      active: historicalStormsMode,
      onClick: toggleHistoricalStormsMode
    },
    {
      id: 'suncycle-btn',
      label: 'Sun Cycle',
      icon: '<svg viewBox="0 0 24 24"><path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5z"/><path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z" opacity="0.3"/><path d="M2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1z"/></svg>',
      active: showSunCycle,
      onClick: () => { toggleSunCycle(!showSunCycle); updateToggleButton('suncycle-btn', showSunCycle); }
    },
    {
      id: 'citylights-btn',
      label: 'City Lights',
      icon: '<svg viewBox="0 0 24 24"><path d="M12 3L2 12h3v8h6v-6h2v6h6v-8h3L12 3zm0 2.84L18 11v7h-2v-6H8v6H6v-7l6-5.16z"/><circle cx="12" cy="9" r="1.5" fill="currentColor"/></svg>',
      active: showCityLights,
      onClick: () => { toggleCityLights(!showCityLights); updateToggleButton('citylights-btn', showCityLights); }
    },
    {
      id: 'weather-btn',
      label: 'City Weather',
      icon: '<svg viewBox="0 0 24 24"><path d="M6.76 4.84l-1.8-1.79-1.41 1.41 1.79 1.79 1.42-1.41zM4 10.5H1v2h3v-2zm9-9.95h-2V3.5h2V.55zm7.45 3.91l-1.41-1.41-1.79 1.79 1.41 1.41 1.79-1.79zm-3.21 13.7l1.79 1.8 1.41-1.41-1.8-1.79-1.4 1.4zM20 10.5v2h3v-2h-3zm-8-5c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm-1 16.95h2V19.5h-2v2.95zm-7.45-3.91l1.41 1.41 1.79-1.8-1.41-1.41-1.79 1.8z"/></svg>',
      active: showWeather,
      onClick: () => { toggleWeather(!showWeather); updateToggleButton('weather-btn', showWeather); }
    },
    {
      id: 'weather-systems-btn',
      label: 'Storm Systems',
      icon: '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="4 2"/></svg>',
      active: showWeatherSystems,
      onClick: () => { toggleWeatherSystems(!showWeatherSystems); updateToggleButton('weather-systems-btn', showWeatherSystems); }
    },
    {
      id: 'satellite-btn',
      label: 'Satellite',
      icon: '<svg viewBox="0 0 24 24"><path d="M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L2 16.99z"/><circle cx="19" cy="4" r="2"/></svg>',
      active: showSatellite,
      onClick: () => { toggleSatellite(!showSatellite); }
    },
    {
      id: 'radar-btn',
      label: 'Precip Radar',
      icon: '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z"/><path d="M12 6c-3.31 0-6 2.69-6 6h2c0-2.21 1.79-4 4-4V6z"/><circle cx="12" cy="12" r="2"/></svg>',
      active: showRadar,
      onClick: () => { toggleRadar(!showRadar); }
    },
    {
      id: 'earthquakes-btn',
      label: 'Earthquakes',
      icon: '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>',
      active: showEarthquakes,
      onClick: () => { toggleEarthquakes(!showEarthquakes); }
    },
    {
      id: 'wind-btn',
      label: 'Wind Flow',
      icon: '<svg viewBox="0 0 24 24"><path d="M14.5 17c0 1.65-1.35 3-3 3s-3-1.35-3-3h2c0 .55.45 1 1 1s1-.45 1-1-.45-1-1-1H2v-2h9.5c1.65 0 3 1.35 3 3zM19 6.5C19 4.57 17.43 3 15.5 3S12 4.57 12 6.5h2c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5S16.33 8 15.5 8H2v2h13.5c1.93 0 3.5-1.57 3.5-3.5zm-.5 4.5H2v2h16.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5v2c1.93 0 3.5-1.57 3.5-3.5S20.43 11 18.5 11z"/></svg>',
      active: showWindParticles,
      onClick: () => { toggleWindParticles(!showWindParticles); }
    },
    {
      id: 'wildfires-btn',
      label: 'Wildfires',
      icon: '<svg viewBox="0 0 24 24"><path d="M12 12.9l-2.13 2.09C9.31 15.55 9 16.28 9 17.06 9 18.68 10.35 20 12 20s3-1.32 3-2.94c0-.78-.31-1.52-.87-2.07L12 12.9z"/><path d="M16 6l-.44.55C14.38 8.02 12 7.19 12 5.3V2S4 6 4 13c0 2.92 1.56 5.47 3.89 6.86-.56-.79-.89-1.76-.89-2.8 0-1.32.52-2.56 1.47-3.5L12 10.1l3.53 3.47c.95.93 1.47 2.17 1.47 3.5 0 1.02-.31 1.96-.85 2.75 1.89-1.15 3.29-3.06 3.71-5.3.66-3.55-1.07-6.9-3.86-8.52z"/></svg>',
      active: showWildfires,
      onClick: () => { toggleWildfires(!showWildfires); updateToggleButton('wildfires-btn', showWildfires); }
    },
    {
      id: 'volcanoes-btn',
      label: 'Volcanoes',
      icon: '<svg viewBox="0 0 24 24"><path d="M9 12l-2 5h10l-2-5-2 3-2-4-2 1zm3-8l2 4h-4l2-4zm-6 18h12l-2-5H8l-2 5z"/></svg>',
      active: showVolcanoes,
      onClick: () => { toggleVolcanoes(!showVolcanoes); updateToggleButton('volcanoes-btn', showVolcanoes); }
    },
    {
      id: 'airquality-btn',
      label: 'Air Quality',
      icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>',
      active: showAirQuality,
      onClick: () => { toggleAirQuality(!showAirQuality); updateToggleButton('airquality-btn', showAirQuality); }
    },
    {
      id: 'tectonics-btn',
      label: 'Tectonic Plates',
      icon: '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/><path d="M7 14l2-4 3 2 2-3 3 4v2H7z"/></svg>',
      active: showTectonicPlates,
      onClick: () => { toggleTectonicPlates(!showTectonicPlates); updateToggleButton('tectonics-btn', showTectonicPlates); }
    }
  ];

  toggles.forEach(toggle => {
    const row = document.createElement('div');
    row.className = 'toggle-row';

    const label = document.createElement('div');
    label.className = 'toggle-label';
    label.innerHTML = `${toggle.icon}<span>${toggle.label}</span>`;

    const switchEl = document.createElement('div');
    switchEl.id = toggle.id;
    switchEl.className = `toggle-switch ${toggle.active ? 'active' : ''}`;
    switchEl.addEventListener('click', () => {
      toggle.onClick();
    });

    row.appendChild(label);
    row.appendChild(switchEl);
    group.appendChild(row);
  });

  panel.appendChild(group);
  document.body.appendChild(panel);
}

// Handle window resize
window.addEventListener('resize', () => {
  globe.width(window.innerWidth);
  globe.height(window.innerHeight);
});

// Initial sizing
globe.width(window.innerWidth);
globe.height(window.innerHeight);

// Toggle controls collapse
function toggleControlsCollapse() {
  const controls = document.getElementById('controls');
  const collapseBtn = document.getElementById('collapse-btn');
  controlsCollapsed = !controlsCollapsed;

  if (controlsCollapsed) {
    controls.classList.add('collapsed');
    collapseBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 8l-6 6 1.41 1.41L12 10.83l4.59 4.58L18 14z"/></svg>';
    collapseBtn.title = 'Expand controls';
  } else {
    controls.classList.remove('collapsed');
    collapseBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z"/></svg>';
    collapseBtn.title = 'Collapse controls';
  }
}

// Create enhanced UI using DOM methods (safe approach)
function createEnhancedUI() {
  const controls = document.getElementById('controls');

  // Clear existing content
  while (controls.firstChild) {
    controls.removeChild(controls.firstChild);
  }

  // Create collapse button
  const collapseBtn = document.createElement('button');
  collapseBtn.id = 'collapse-btn';
  collapseBtn.className = 'collapse-btn';
  collapseBtn.title = 'Collapse controls';
  collapseBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z"/></svg>';
  collapseBtn.addEventListener('click', toggleControlsCollapse);
  controls.appendChild(collapseBtn);

  // Create collapsible content wrapper
  const collapsibleContent = document.createElement('div');
  collapsibleContent.id = 'collapsible-content';

  // Create climate info section
  const climateInfo = document.createElement('div');
  climateInfo.id = 'climate-info';

  const infoItems = [
    { label: 'Sea Level', id: 'sea-level', value: '0m' },
    { label: 'Temperature', id: 'temperature', value: '+0.0C' },
    { label: 'Ice Coverage', id: 'ice-coverage', value: '10%' },
    { label: 'CO2', id: 'co2-level', value: '420 ppm' }
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

  collapsibleContent.appendChild(climateInfo);

  // Create timeline container
  const timelineContainer = document.createElement('div');
  timelineContainer.id = 'timeline-container';

  const timelineMarkers = document.createElement('div');
  timelineMarkers.id = 'timeline-markers';
  timelineContainer.appendChild(timelineMarkers);

  const timeline = document.createElement('input');
  timeline.type = 'range';
  timeline.id = 'timeline';
  timeline.min = String(TIME_RANGE.min);  // -750000000 (750 million years)
  timeline.max = String(TIME_RANGE.max);  // 0
  timeline.value = '0';
  timeline.step = '1000000';  // 1 million year steps for geological timescales
  timelineContainer.appendChild(timeline);

  const timelineLabels = document.createElement('div');
  timelineLabels.id = 'timeline-labels';
  timelineContainer.appendChild(timelineLabels);

  collapsibleContent.appendChild(timelineContainer);

  // Create year display
  const yearDisplay = document.createElement('div');
  yearDisplay.id = 'year-display';
  yearDisplay.textContent = 'Present Day';
  collapsibleContent.appendChild(yearDisplay);

  // Create API status
  const apiStatus = document.createElement('div');
  apiStatus.id = 'api-status';
  collapsibleContent.appendChild(apiStatus);

  // Append collapsible content to controls
  controls.appendChild(collapsibleContent);

  // Styles are now in external styles.css file
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
  if (absYear >= 1000000) {
    // Millions of years
    const millions = absYear / 1000000;
    return `${millions.toFixed(millions >= 1 ? 1 : 2)} million years ago`;
  }
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
  const co2El = document.getElementById('co2-level');

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

  // CO2 level
  if (co2El && state.co2_ppm) {
    co2El.textContent = `${Math.round(state.co2_ppm)} ppm`;
    // High CO2 = warm (greenhouse effect), low CO2 = cold
    co2El.className = `info-value ${state.co2_ppm > 350 ? 'warm' : state.co2_ppm < 200 ? 'cold' : ''}`;
  }
}

// Update active timeline label
function updateActiveLabel(year) {
  const labels = document.querySelectorAll('.timeline-label');
  labels.forEach(label => {
    const labelYear = parseInt(label.dataset.year);
    // Mark as active if within 10 million years of a key period (geological scale)
    const isNear = Math.abs(year - labelYear) < 10000000;
    label.classList.toggle('active', isNear);
  });
}

// Update epoch indicator based on year (supports 750 million year timeline)
function updateEpochIndicator(year) {
  const epochNameEl = document.getElementById('epoch-name');
  const epochEraEl = document.getElementById('epoch-era');
  if (!epochNameEl || !epochEraEl) return;

  // Convert year to Ma (millions of years ago)
  const yearInMa = Math.abs(year) / 1000000;

  // Find the appropriate geological era from GEOLOGICAL_ERAS
  // Keys are in Ma, we want the closest match that doesn't exceed our year
  const eraKeys = Object.keys(GEOLOGICAL_ERAS).map(Number).sort((a, b) => a - b);

  let selectedEra = GEOLOGICAL_ERAS[0]; // Default to Holocene

  for (const key of eraKeys) {
    if (key <= yearInMa) {
      selectedEra = GEOLOGICAL_ERAS[key];
    } else {
      break;
    }
  }

  // Handle edge cases for very recent times
  if (year === 0 || year > -11700) {
    selectedEra = { name: 'Holocene', period: 'Quaternary', era: 'Cenozoic', description: 'Modern Earth' };
  } else if (year > -2600000) {
    selectedEra = { name: 'Pleistocene', period: 'Quaternary', era: 'Cenozoic', description: 'Ice Ages' };
  }

  epochNameEl.textContent = selectedEra.name;
  epochEraEl.textContent = `${selectedEra.era} Era`;

  // Add description tooltip
  epochEraEl.title = selectedEra.description;
}

// Calculate atmosphere color and glow parameters based on climate state
// Returns object with color, intensity, and power for the glow shader
function calculateAtmosphereParams(state) {
  // Default values (modern Earth)
  const defaults = {
    color: '#3a7bd5',
    intensity: 0.4,
    power: 4.0
  };

  if (!state) return defaults;

  // Color definitions - MORE DRAMATIC differences
  // Base color (modern Earth - blue)
  const baseColor = { r: 58, g: 123, b: 213 };
  // Ice age color (cold white-blue, very distinct)
  const iceColor = { r: 200, g: 230, b: 255 };
  // Deep ice age (even whiter/colder)
  const deepIceColor = { r: 230, g: 245, b: 255 };
  // Warm period color (golden-orange tint)
  const warmColor = { r: 255, g: 180, b: 100 };

  let targetColor;
  let intensity = 0.4;
  let power = 4.0;

  const temp = state.global_temp_c;

  if (temp <= -4) {
    // Deep ice age (LGM): very white/cold blue, brighter glow
    const t = Math.min(1, (Math.abs(temp) - 4) / 4); // 0 at -4C, 1 at -8C
    targetColor = {
      r: iceColor.r + (deepIceColor.r - iceColor.r) * t,
      g: iceColor.g + (deepIceColor.g - iceColor.g) * t,
      b: iceColor.b + (deepIceColor.b - iceColor.b) * t
    };
    // Brighter, more diffuse glow for ice ages (more reflective ice)
    intensity = 0.5 + t * 0.2; // 0.5 to 0.7
    power = 3.0 - t * 1.0; // 3.0 to 2.0 (more diffuse)
  } else if (temp < -1) {
    // Moderate ice age: blend from base to ice color
    const t = (Math.abs(temp) - 1) / 3; // 0 at -1C, 1 at -4C
    targetColor = {
      r: baseColor.r + (iceColor.r - baseColor.r) * t,
      g: baseColor.g + (iceColor.g - baseColor.g) * t,
      b: baseColor.b + (iceColor.b - baseColor.b) * t
    };
    intensity = 0.4 + t * 0.1; // 0.4 to 0.5
    power = 4.0 - t * 1.0; // 4.0 to 3.0
  } else if (temp > 1.5) {
    // Warm interglacial: golden/orange tint, softer glow
    const t = Math.min(1, (temp - 1.5) / 2); // 0 at 1.5C, 1 at 3.5C
    targetColor = {
      r: baseColor.r + (warmColor.r - baseColor.r) * t,
      g: baseColor.g + (warmColor.g - baseColor.g) * t,
      b: baseColor.b + (warmColor.b - baseColor.b) * t
    };
    // Warmer, slightly less intense glow
    intensity = 0.35 + t * 0.1; // 0.35 to 0.45
    power = 4.5 + t * 0.5; // 4.5 to 5.0 (tighter glow)
  } else if (temp > 0.5) {
    // Mild warm period: subtle warm shift
    const t = (temp - 0.5) / 1.0; // 0 at 0.5C, 1 at 1.5C
    targetColor = {
      r: baseColor.r + (warmColor.r - baseColor.r) * t * 0.3,
      g: baseColor.g + (warmColor.g - baseColor.g) * t * 0.3,
      b: baseColor.b + (warmColor.b - baseColor.b) * t * 0.3
    };
    intensity = 0.38 + t * 0.02;
    power = 4.2 + t * 0.3;
  } else {
    // Near present day conditions
    targetColor = baseColor;
    intensity = 0.4;
    power = 4.0;
  }

  const color = `rgb(${Math.round(targetColor.r)}, ${Math.round(targetColor.g)}, ${Math.round(targetColor.b)})`;

  return { color, intensity, power };
}

// Legacy function for backwards compatibility
function calculateAtmosphereColor(state) {
  return calculateAtmosphereParams(state).color;
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

  // Update epoch indicator
  updateEpochIndicator(year);

  // Convert year to millions of years ago for paleomap texture lookup
  const yearInMa = Math.abs(year) / 1000000;

  // Find and load the appropriate paleomap texture
  const targetAge = findNearestPaleomapAge(yearInMa);
  updatePaleomapTexture(targetAge);

  // Fetch or calculate state
  // Use local interpolation for deep time (> 5 million years ago) since API was designed for recent history
  let state;
  const USE_API_THRESHOLD = -5000000; // 5 million years ago

  if (year >= USE_API_THRESHOLD && fetchData && apiAvailable) {
    // Use API for recent geological history (0 to 5 Ma)
    state = await getEarthState(year);
  } else {
    // Use local interpolation for deep time or when API unavailable
    state = interpolateLocalState(year);
  }

  currentState = state;

  // Update climate display
  updateClimateDisplay(state);

  // Calculate atmosphere parameters based on climate state
  const atmosParams = calculateAtmosphereParams(state);

  // Update globe's built-in atmosphere
  globe.atmosphereColor(atmosParams.color);

  // Update custom glow shader with color, intensity, and power
  updateAtmosphereGlow(atmosParams.color, atmosParams.intensity, atmosParams.power);

  // Adjust atmosphere altitude based on ice coverage
  // More ice = slightly denser atmosphere visual (more prominent)
  const baseAltitude = 0.25;
  const altitudeAdjust = (state.ice_coverage_pct - 10) / 100 * 0.15; // Increased from 0.1 to 0.15
  globe.atmosphereAltitude(baseAltitude + altitudeAdjust);

  // Update animated ice caps
  updateIceCoverage(state.ice_coverage_pct);

  // Debug log for development (can be removed in production)
  if (window.DEBUG_ATMOSPHERE) {
    log(`Atmosphere update: temp=${state.global_temp_c.toFixed(1)}C, color=${atmosParams.color}, intensity=${atmosParams.intensity.toFixed(2)}, power=${atmosParams.power.toFixed(1)}`);
  }
}

// Local interpolation for smooth transitions (750 million year timeline)
function interpolateLocalState(year) {
  // Climate data based on paleoclimate reconstructions
  // Sources: IPCC Paleoclimate, GTS2020, various peer-reviewed reconstructions
  const periods = [
    // Quaternary (Recent ice ages)
    { year: 0, sea_level_m: 0, global_temp_c: 0, ice_coverage_pct: 10.0, co2_ppm: 420 },
    { year: -6000, sea_level_m: 2, global_temp_c: 1, ice_coverage_pct: 9.0, co2_ppm: 265 },
    { year: -12000, sea_level_m: -60, global_temp_c: -4, ice_coverage_pct: 25.0, co2_ppm: 240 },
    { year: -20000, sea_level_m: -120, global_temp_c: -6, ice_coverage_pct: 30.0, co2_ppm: 180 },
    { year: -130000, sea_level_m: 6, global_temp_c: 2, ice_coverage_pct: 8.0, co2_ppm: 285 },

    // Neogene (warmer before ice ages)
    { year: -5000000, sea_level_m: 25, global_temp_c: 3, ice_coverage_pct: 4.0, co2_ppm: 400 },
    { year: -15000000, sea_level_m: 40, global_temp_c: 5, ice_coverage_pct: 2.0, co2_ppm: 500 },
    { year: -23000000, sea_level_m: 50, global_temp_c: 6, ice_coverage_pct: 1.5, co2_ppm: 600 },

    // Paleogene (very warm greenhouse)
    { year: -35000000, sea_level_m: 60, global_temp_c: 7, ice_coverage_pct: 0.5, co2_ppm: 800 },
    { year: -50000000, sea_level_m: 80, global_temp_c: 10, ice_coverage_pct: 0.0, co2_ppm: 1200 }, // PETM
    { year: -55000000, sea_level_m: 100, global_temp_c: 12, ice_coverage_pct: 0.0, co2_ppm: 1500 }, // PETM peak
    { year: -66000000, sea_level_m: 70, global_temp_c: 8, ice_coverage_pct: 0.0, co2_ppm: 1000 }, // K-Pg boundary

    // Cretaceous (warm greenhouse, dinosaurs)
    { year: -100000000, sea_level_m: 200, global_temp_c: 12, ice_coverage_pct: 0.0, co2_ppm: 1700 },
    { year: -145000000, sea_level_m: 150, global_temp_c: 10, ice_coverage_pct: 0.0, co2_ppm: 1400 },

    // Jurassic (warm, Pangaea breaking)
    { year: -150000000, sea_level_m: 100, global_temp_c: 8, ice_coverage_pct: 0.0, co2_ppm: 1200 },
    { year: -175000000, sea_level_m: 80, global_temp_c: 7, ice_coverage_pct: 0.0, co2_ppm: 1000 },
    { year: -200000000, sea_level_m: 60, global_temp_c: 6, ice_coverage_pct: 0.0, co2_ppm: 900 },

    // Triassic (hot, arid, recovery from extinction)
    { year: -250000000, sea_level_m: 30, global_temp_c: 8, ice_coverage_pct: 0.0, co2_ppm: 1500 }, // Permian extinction

    // Permian (late warm, then extinction)
    { year: -260000000, sea_level_m: 60, global_temp_c: 6, ice_coverage_pct: 3.0, co2_ppm: 800 },
    { year: -290000000, sea_level_m: -40, global_temp_c: -2, ice_coverage_pct: 20.0, co2_ppm: 300 }, // Late Carboniferous ice age

    // Carboniferous (ice age, then warm)
    { year: -320000000, sea_level_m: -60, global_temp_c: -4, ice_coverage_pct: 25.0, co2_ppm: 250 }, // Carboniferous ice age
    { year: -350000000, sea_level_m: 40, global_temp_c: 5, ice_coverage_pct: 2.0, co2_ppm: 1500 },

    // Devonian (warm, fish, forests)
    { year: -360000000, sea_level_m: 60, global_temp_c: 7, ice_coverage_pct: 0.5, co2_ppm: 2000 },
    { year: -400000000, sea_level_m: 80, global_temp_c: 8, ice_coverage_pct: 0.0, co2_ppm: 2500 },

    // Silurian (warm, first land plants)
    { year: -420000000, sea_level_m: 100, global_temp_c: 10, ice_coverage_pct: 0.0, co2_ppm: 4000 },

    // Ordovician (ends in ice age)
    { year: -445000000, sea_level_m: -40, global_temp_c: -3, ice_coverage_pct: 20.0, co2_ppm: 2000 }, // Ordovician ice age
    { year: -470000000, sea_level_m: 120, global_temp_c: 10, ice_coverage_pct: 0.0, co2_ppm: 4500 },

    // Cambrian (very warm, explosion of life)
    { year: -500000000, sea_level_m: 150, global_temp_c: 12, ice_coverage_pct: 0.0, co2_ppm: 5000 },
    { year: -540000000, sea_level_m: 130, global_temp_c: 11, ice_coverage_pct: 0.0, co2_ppm: 4500 },

    // Ediacaran (after Snowball Earth)
    { year: -600000000, sea_level_m: 50, global_temp_c: 6, ice_coverage_pct: 5.0, co2_ppm: 3000 },

    // Cryogenian (Snowball Earth)
    { year: -650000000, sea_level_m: -200, global_temp_c: -20, ice_coverage_pct: 80.0, co2_ppm: 200 }, // Marinoan glaciation
    { year: -700000000, sea_level_m: -180, global_temp_c: -15, ice_coverage_pct: 70.0, co2_ppm: 300 },
    { year: -720000000, sea_level_m: -200, global_temp_c: -25, ice_coverage_pct: 90.0, co2_ppm: 100 }, // Sturtian glaciation
    { year: -750000000, sea_level_m: -150, global_temp_c: -10, ice_coverage_pct: 50.0, co2_ppm: 500 }, // Pre-Snowball
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
    co2_ppm: lower.co2_ppm + t * (upper.co2_ppm - lower.co2_ppm),
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

  // Add visual enhancements after a short delay to ensure scene is ready
  setTimeout(() => {
    // Core lighting setup - most important for visibility
    addSunlight();

    // Apply renderer settings
    addBloomEffect();

    // Add twinkling stars (far from globe, safe to add)
    addTwinklingStars();

    // Static cloud layer removed - using satellite/procedural clouds instead
    // addCloudLayer();

    // Add subtle atmosphere enhancement
    addAtmosphereGlow();

    // Ice caps layer removed - was procedural/fake data, not real ice coverage
    // addIceCaps();

    // Add sun and day/night visualization
    addSun();
    addDayNightOverlay();
    addNightLights();  // City lights on night side
    animateDayNight();

    // Start weather updates (disabled by default)
    startWeatherUpdates();

    // Auto-rotate disabled - globe is now static for better interaction
    // startEarthRotation();

    log('Enhanced visualization initialized with sun, day/night, and weather');
  }, 200);

  // Create control buttons for animation
  createControlButtons();

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

  // Initialize storm system (only for present day or recent past)
  if (showStorms) {
    setTimeout(() => {
      initializeStormSystem();
    }, 500);
  }

  // Initialize earthquake visualization (live USGS data)
  if (showEarthquakes) {
    setTimeout(() => {
      initializeEarthquakes();
    }, 600);
  }

  // Initialize wind particle system
  if (showWindParticles) {
    setTimeout(() => {
      initializeWindParticles();
    }, 700);
  }

  // Initialize live satellite cloud overlay
  if (showSatellite) {
    setTimeout(() => {
      addSatelliteOverlay();
    }, 800);
  }

  // Hide loading screen
  document.getElementById('loading').style.display = 'none';

  // Auto-rotate
  // Disable auto-rotate - day/night follows real time
  globe.controls().autoRotate = false;

  // Set initial camera position
  globe.pointOfView({ lat: 30, lng: 0, altitude: 2.5 });

  log('ERF Globe initialized with enhanced features');
}

// Event delegation for dynamically created elements
document.addEventListener('click', (e) => {
  // Handle historical storm selection
  const stormEl = e.target.closest('[data-storm-id]');
  if (stormEl) {
    const stormId = stormEl.dataset.stormId;
    if (typeof selectHistoricalStorm === 'function') {
      selectHistoricalStorm(stormId);
    }
  }

  // Handle toggle historical storms mode button
  if (e.target.closest('.toggle-historical-btn')) {
    if (typeof toggleHistoricalStormsMode === 'function') {
      toggleHistoricalStormsMode();
    }
  }

  // Handle close live storm info button
  if (e.target.closest('.close-storm-info-btn')) {
    if (typeof closeLiveStormInfo === 'function') {
      closeLiveStormInfo();
    }
  }
});

// Start the application
init().catch(console.error);
