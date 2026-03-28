/**
 * @fileoverview main.js — Application entry point.
 *
 * Responsibilities:
 *  - Animated water sprite-sheet background (2D canvas on water-layer)
 *  - Three.js renderer on objects-layer (transparent background)
 *  - Wire up SceneManager, AssetLoader, DragController, and Exporter
 *  - Drive the render loop
 *  - Handle sidebar interactions (double-click to place asset)
 *  - Handle toolbar button interactions (export, preview, import)
 *
 * WebXR Note (Phase 2):
 *  TODO: WebXR — replace OrthographicCamera with XRSession camera.
 *  Scene coordinate system is already in meters (Three.js default).
 */

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import SceneManager from './SceneManager.js';
import { ASSET_REGISTRY, preloadAllTextures, createAssetMesh } from './AssetLoader.js';
import { DragController } from './DragController.js';
import Exporter from './Exporter.js';

// ─── DOM References ───────────────────────────────────────────────────────────

const canvasContainer = document.getElementById('canvas-container');
const waterLayer = document.getElementById('water-layer');
const objectsLayer = document.getElementById('objects-layer');
const btnExport = document.getElementById('btn-export');
const btnPreview = document.getElementById('btn-preview');
const btnImport = document.getElementById('btn-import');
const jsonPanel = document.getElementById('json-panel');
const jsonPre = document.getElementById('json-pre');
const jsonClose = document.getElementById('json-close');
const warningEl = document.getElementById('export-warning');
const assetList = document.getElementById('asset-list');
const hudCount = document.getElementById('hud-count');
const hudPerfWarn = document.getElementById('hud-perf-warn');
const sizeSliderEl = document.getElementById('size-slider');
const sizeSliderValue = document.getElementById('size-slider-value');
const sizeSliderContainer = document.getElementById('size-slider-container');

// ═══════════════════════════════════════════════════════════════════════════════
// LAYER 0 — Animated Water Sprite-Sheet Background
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Static ocean background — displays the best frame from the sprite sheet.
 * Uses a 2D canvas to crop one frame and stretch it to fill the viewport.
 * Re-draws on resize to stay pixel-perfect at any window size.
 *
 * The sprite sheet is 3 cols × 4 rows (12 frames).
 * We pick frame index 6 (row 2, col 0) — a clean underwater shot.
 */
const SPRITE_COLS = 3;
const SPRITE_ROWS = 4;
const STATIC_FRAME_INDEX = 6; // pick a visually pleasing frame

let waterCanvas, waterCtx, waterSprite;

function initWaterBackground() {
  waterCanvas = document.createElement('canvas');
  waterCtx = waterCanvas.getContext('2d');
  // CSS fills the container; pixel buffer sized in drawStaticWaterFrame()
  waterCanvas.style.width = '100%';
  waterCanvas.style.height = '100%';
  waterCanvas.style.display = 'block';
  waterLayer.appendChild(waterCanvas);

  waterSprite = new Image();
  waterSprite.src = './assets/water_sprite_imag.png';

  waterSprite.onload = () => {
    // Delay one frame to ensure container has settled layout
    requestAnimationFrame(() => {
      drawStaticWaterFrame();
      console.log('[Water] ✓ Static ocean background loaded.');
    });
  };

  waterSprite.onerror = () => {
    console.warn('[Water] ⚠ Sprite failed — falling back to CSS gradient.');
    waterLayer.style.background = 'linear-gradient(180deg, #0a1628 0%, #0d3b6e 100%)';
  };
}

/**
 * Draws a single frame from the sprite sheet, stretched to fill the canvas.
 * Called once on load and again on every resize.
 */
function drawStaticWaterFrame() {
  if (!waterSprite || !waterSprite.complete || !waterSprite.naturalWidth) return;
  if (!waterCanvas) return;

  const w = canvasContainer.clientWidth || window.innerWidth;
  const h = canvasContainer.clientHeight || window.innerHeight;
  waterCanvas.width = w;
  waterCanvas.height = h;

  const frameW = waterSprite.naturalWidth / SPRITE_COLS;
  const frameH = waterSprite.naturalHeight / SPRITE_ROWS;
  const col = STATIC_FRAME_INDEX % SPRITE_COLS;
  const row = Math.floor(STATIC_FRAME_INDEX / SPRITE_COLS);

  waterCtx.drawImage(
    waterSprite,
    col * frameW, row * frameH, frameW, frameH,  // source rect
    0, 0, w, h                                     // dest rect (full canvas)
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// LAYER 1 — Three.js Scene (transparent background, assets only)
// ═══════════════════════════════════════════════════════════════════════════════

/** @type {THREE.WebGLRenderer} */
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: true, // Transparent background — water animation shows through
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0); // Fully transparent
renderer.outputColorSpace = THREE.SRGBColorSpace;
objectsLayer.appendChild(renderer.domElement);

/** @type {THREE.Scene} */
const scene = new THREE.Scene();

/**
 * OrthographicCamera — maps cleanly to AR placement grid.
 * Frustum: 20 units wide, aspect-correct height.
 * TODO: WebXR — replace OrthographicCamera with XRSession camera.
 */
const FRUSTUM_SIZE = 20;
let aspect = canvasContainer.clientWidth / canvasContainer.clientHeight;

/** @type {THREE.OrthographicCamera} */
const camera = new THREE.OrthographicCamera(
  (-FRUSTUM_SIZE * aspect) / 2,
  (FRUSTUM_SIZE * aspect) / 2,
  FRUSTUM_SIZE / 2,
  -FRUSTUM_SIZE / 2,
  0.1,
  100
);
camera.position.set(0, 10, 0);
camera.lookAt(0, 0, 0);

// ─── Resize Handling ──────────────────────────────────────────────────────────

function onResize() {
  const w = canvasContainer.clientWidth;
  const h = canvasContainer.clientHeight;
  aspect = w / h;

  camera.left = (-FRUSTUM_SIZE * aspect) / 2;
  camera.right = (FRUSTUM_SIZE * aspect) / 2;
  camera.top = FRUSTUM_SIZE / 2;
  camera.bottom = -FRUSTUM_SIZE / 2;
  camera.updateProjectionMatrix();

  renderer.setSize(w, h);

  // Redraw static water background at new size (guard: may not be initialised yet)
  if (waterSprite) drawStaticWaterFrame();
}

const resizeObserver = new ResizeObserver(onResize);
resizeObserver.observe(canvasContainer);
onResize();

// ─── DragController ────────────────────────────────────────────────────────────

const drag = new DragController(camera, renderer.domElement);

drag.onDragEnd = ({ id, position }) => {
  updateHUD();
  updateJsonPreviewIfOpen();
};

drag.onDeleteMesh = (mesh) => {
  scene.remove(mesh);
  mesh.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (child.material.map) child.material.map.dispose();
      child.material.dispose();
    }
  });
  hideSizeSlider();
  updateHUD();
  updateJsonPreviewIfOpen();
};

drag.onDeselect = () => {
  hideSizeSlider();
};

/**
 * Placement mode callback: ghost mesh has been clicked onto the canvas.
 * Commit it to SceneManager as a real asset.
 */
drag.onPlacementCommit = ({ group, worldPos }) => {
  const type = group.userData.assetType;
  scene.add(group);
  SceneManager.add({
    type,
    mesh: group,
    x: worldPos.x,
    y: 0,
    z: worldPos.z,
  });
  updateHUD();
  updateJsonPreviewIfOpen();
};

/** Update slider + HUD when scale changes via slider. */
drag.onScaleChange = (id, newScale) => {
  updateJsonPreviewIfOpen();
};

// ─── Size Slider ──────────────────────────────────────────────────────────────

let _sliderVisible = false;

/**
 * Convert a Three.js world position to screen pixel coordinates.
 * Returns { x, y } relative to the canvas container.
 */
function worldToScreen(worldPos) {
  const v = worldPos.clone().project(camera);
  const rect = canvasContainer.getBoundingClientRect();
  return {
    x: ((v.x + 1) / 2) * rect.width,
    y: ((-v.y + 1) / 2) * rect.height,
  };
}

/** Position the slider near a given screen point, clamped to canvas bounds. */
function positionSliderNear(screenX, screenY) {
  const rect = canvasContainer.getBoundingClientRect();
  const sliderW = sizeSliderContainer.offsetWidth || 200;
  const sliderH = sizeSliderContainer.offsetHeight || 40;
  const PAD = 12;

  // Place below the object, offset slightly
  let x = screenX - sliderW / 2;
  let y = screenY + 40; // 40px below asset center

  // Clamp within canvas bounds
  x = Math.max(PAD, Math.min(rect.width - sliderW - PAD, x));
  y = Math.max(PAD, Math.min(rect.height - sliderH - PAD, y));

  sizeSliderContainer.style.left = `${x}px`;
  sizeSliderContainer.style.top = `${y}px`;
  sizeSliderContainer.style.right = 'auto';
  sizeSliderContainer.style.bottom = 'auto';
}

/** Show slider and sync to the given asset's current scale. */
function showSizeSlider(asset) {
  if (!asset) return;
  const scale = asset.scale ?? 1.0;
  sizeSliderEl.value = scale;
  sizeSliderValue.textContent = `${scale.toFixed(1)}×`;
  _sliderVisible = true;
  sizeSliderContainer.classList.add('slider--visible');
}

/** Hide the slider panel. */
function hideSizeSlider() {
  _sliderVisible = false;
  sizeSliderContainer.classList.remove('slider--visible');
}

/**
 * Called every frame to keep the slider anchored near the selected object.
 * Only runs when the slider is visible.
 */
function updateSliderPosition() {
  if (!_sliderVisible) return;
  const sel = drag.getSelectedAsset();
  if (!sel) return;
  const mesh = SceneManager.getMeshById(sel.id);
  if (!mesh) return;
  const screen = worldToScreen(mesh.position);
  positionSliderNear(screen.x, screen.y);
}

/** Wire the slider input event. */
sizeSliderEl.addEventListener('input', () => {
  const val = parseFloat(sizeSliderEl.value);
  sizeSliderValue.textContent = `${val.toFixed(1)}×`;
  drag.setScale(val);
});

// Show slider when an asset is selected
drag.onSelect = (asset) => {
  showSizeSlider(asset);
};

// ─── Placement mode also hides slider ─────────────────────────────────────────
const _origEnterPlacement = drag.enterPlacementMode.bind(drag);
drag.enterPlacementMode = (ghostGroup) => {
  hideSizeSlider();
  _origEnterPlacement(ghostGroup);
};

// ─── Asset Placement (Placement Mode) ─────────────────────────────────────────

/**
 * Enters placement mode: creates a ghost mesh that follows the cursor.
 * On next canvas click, the asset is committed at that position.
 * @param {string} type - Asset type ID.
 */
async function startPlacement(type) {
  try {
    const group = await createAssetMesh(type);
    // Add to scene immediately (ghost — semi-transparent)
    scene.add(group);
    drag.enterPlacementMode(group);
  } catch (err) {
    console.error('[main] Failed to start placement:', err);
  }
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

/**
 * Populates the sidebar asset list from ASSET_REGISTRY.
 * Single click enters placement mode (asset follows cursor → click canvas to place).
 */
function buildSidebar() {
  assetList.innerHTML = '';
  ASSET_REGISTRY.forEach((def) => {
    const card = document.createElement('button');
    card.className = 'asset-card';
    card.setAttribute('data-type', def.id);
    card.setAttribute('title', `Click to add ${def.label} to scene`);
    card.innerHTML = `
      <span class="asset-card__icon">${def.icon}</span>
      <span class="asset-card__label">${def.label}</span>
      <span class="asset-card__cta">+ Add</span>
    `;
    card.addEventListener('click', () => {
      startPlacement(def.id);
      card.classList.add('card--activated');
      setTimeout(() => card.classList.remove('card--activated'), 300);
    });
    assetList.appendChild(card);
  });
}

// ─── Export / Preview ─────────────────────────────────────────────────────────

btnExport.addEventListener('click', () => {
  const ok = Exporter.download(warningEl);
  if (ok) {
    btnExport.classList.add('btn--success');
    btnExport.textContent = '✓ Exported';
    setTimeout(() => {
      btnExport.classList.remove('btn--success');
      btnExport.textContent = 'Export JSON';
    }, 2000);
  }
});

btnPreview.addEventListener('click', () => {
  const ok = Exporter.preview(jsonPre, warningEl);
  if (ok) {
    jsonPanel.classList.toggle('panel--visible');
    btnPreview.textContent = jsonPanel.classList.contains('panel--visible')
      ? 'Hide Preview'
      : 'Preview JSON';
  }
});

jsonClose.addEventListener('click', () => {
  jsonPanel.classList.remove('panel--visible');
  btnPreview.textContent = 'Preview JSON';
});

btnImport?.addEventListener('click', async () => {
  const data = await Exporter.importFromFile();
  if (!data) return;
  await importScene(data);
});

// ─── JSON Import ──────────────────────────────────────────────────────────────

async function importScene(data) {
  if (!data.version || !Array.isArray(data.scene)) {
    console.error('[main] Invalid scene JSON format');
    return;
  }
  drag.clearSelection();
  const oldMeshes = SceneManager.clear();
  oldMeshes.forEach((m) => {
    scene.remove(m);
    m.traverse((c) => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    });
  });

  SceneManager.restoreMeta(data.meta ?? {});

  for (const assetData of data.scene) {
    try {
      const group = await createAssetMesh(assetData.type);
      group.position.set(assetData.x, assetData.y, assetData.z);
      scene.add(group);
      SceneManager.add({
        type: assetData.type,
        mesh: group,
        x: assetData.x,
        y: assetData.y,
        z: assetData.z,
      });
    } catch (err) {
      console.warn(`[main] Failed to restore asset "${assetData.type}":`, err);
    }
  }

  updateHUD();
  updateJsonPreviewIfOpen();
}

// ─── HUD Updates ──────────────────────────────────────────────────────────────

function updateHUD() {
  const n = SceneManager.count();
  hudCount.textContent = `${n} asset${n !== 1 ? 's' : ''}`;

  if (n > 20) {
    hudPerfWarn.classList.add('warn--visible');
  } else {
    hudPerfWarn.classList.remove('warn--visible');
  }
}

function updateJsonPreviewIfOpen() {
  if (jsonPanel.classList.contains('panel--visible')) {
    Exporter.preview(jsonPre, null);
  }
}

// ─── Performance timer ────────────────────────────────────────────────────────

let _lastFrameTime = performance.now();
let _lastHudMsUpdate = 0;
let _frameMs = 0;
const hudMs = document.getElementById('hud-ms');

// ─── Render Loop ──────────────────────────────────────────────────────────────

const clock = new THREE.Clock();

function animate(timestamp) {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();
  const now = performance.now();
  _frameMs = now - _lastFrameTime;
  _lastFrameTime = now;

  // (Water background is static — no per-frame draw needed)

  // Layer 1: Smooth drag interpolation + Three.js render
  drag.update(delta);
  updateSliderPosition();
  renderer.render(scene, camera);

  // HUD render time (throttled to every ~500ms for performance)
  if (hudMs && now - _lastHudMsUpdate > 500) {
    hudMs.textContent = `${_frameMs.toFixed(1)}ms`;
    _lastHudMsUpdate = now;
  }
}

// ─── SceneManager Events ──────────────────────────────────────────────────────

SceneManager.on('warn', (msg) => {
  hudPerfWarn.textContent = `⚠ ${msg}`;
  hudPerfWarn.classList.add('warn--visible');
});

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  // Initialise water background layer
  initWaterBackground();

  // Preload all textures
  await preloadAllTextures();

  // Build sidebar
  buildSidebar();

  // Start render loop
  animate(0);

  // Initial HUD state
  updateHUD();

  console.log('[Marine Sandbox] ✓ Initialised. Layered architecture: water sprite + Three.js.');
}

init();
