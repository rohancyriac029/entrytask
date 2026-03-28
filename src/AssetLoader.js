/**
 * @fileoverview AssetLoader.js — Texture loading, asset registry, and mesh factory.
 *
 * ─── A-Frame Bridge (Phase 3) ──────────────────────────────────────────────
 * In Phase 3, each asset in ASSET_REGISTRY can be registered as an A-Frame asset:
 *
 *   <a-assets>
 *     <a-asset-item id="fish-model" src="./assets/fish.png"></a-asset-item>
 *   </a-assets>
 *   <a-image src="#fish-model" position="0 1.5 -3"></a-image>
 *
 * The `id`, `label`, `icon`, and `texturePath` fields map directly to A-Frame's
 * asset management system. To bridge: iterate ASSET_REGISTRY and inject
 * <a-asset-item> tags before the A-Frame scene initialises.
 * ──────────────────────────────────────────────────────────────────────────────
 */

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

/**
 * Central registry of all marine assets.
 * Adding a new asset = add one entry here. No other code changes required.
 *
 * @type {Array<{ id: string, label: string, icon: string, texturePath: string, color: string }>}
 */
export const ASSET_REGISTRY = [
  {
    id: 'fish',
    label: 'Fish',
    icon: '🐟',
    texturePath: './assets/fish.png',
    color: '#ff8c00',  // Fallback color if texture fails
  },
  {
    id: 'coral',
    label: 'Coral',
    icon: '🪸',
    texturePath: './assets/coral.png',
    color: '#ff6b4a',
  },
  {
    id: 'shark',
    label: 'Shark',
    icon: '🦈',
    texturePath: './assets/shark.png',
    color: '#6c8fa8',
  },
  {
    id: 'jellyfish',
    label: 'Jellyfish',
    icon: '🪼',
    texturePath: './assets/jellyfish.png',
    color: '#9b59ff',
  },
  {
    id: 'rock',
    label: 'Rock',
    icon: '🪨',
    texturePath: './assets/rock.png',
    color: '#7f8c8d',
  },
];

/** @type {Map<string, THREE.Texture>} Cache to avoid redundant GPU uploads. */
const _textureCache = new Map();

const _textureLoader = new THREE.TextureLoader();

// ─── Texture Loading ──────────────────────────────────────────────────────────

/**
 * Loads a texture by URL with caching. Returns a Promise.
 * @param {string} url
 * @returns {Promise<THREE.Texture>}
 */
function loadTexture(url) {
  if (_textureCache.has(url)) {
    return Promise.resolve(_textureCache.get(url));
  }
  return new Promise((resolve, reject) => {
    _textureLoader.load(
      url,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        _textureCache.set(url, texture);
        resolve(texture);
      },
      undefined,
      (err) => reject(err)
    );
  });
}

/**
 * Pre-loads all registered asset textures. Call once at startup.
 * Assets that fail to load will use a fallback colored mesh (see createMesh).
 * @returns {Promise<void>}
 */
export async function preloadAllTextures() {
  const results = await Promise.allSettled(
    ASSET_REGISTRY.map((a) => loadTexture(a.texturePath))
  );
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      console.warn(
        `[AssetLoader] Texture failed for "${ASSET_REGISTRY[i].id}" — will use fallback mesh.`,
        result.reason
      );
    }
  });
}

// ─── Mesh Factory ─────────────────────────────────────────────────────────────

/**
 * Creates a Three.js Group for the given asset type.
 *
 * Each asset is a THREE.Group containing:
 *  - A PlaneGeometry mesh (the sprite)
 *  - An invisible hit-plane for raycasting (same size, transparent)
 *
 * Using THREE.Group per instance makes it trivial to:
 *  - Attach AR anchors in Phase 2 (group.add(anchorHelper))
 *  - Add child decorations (selection ring, label, etc.)
 *
 * @param {string} type - Asset type ID from ASSET_REGISTRY.
 * @param {number} [size=2.0] - World-space size (meters, maps to AR scale).
 * @returns {Promise<THREE.Group>}
 */
export async function createAssetMesh(type, size = 2.0) {
  const def = ASSET_REGISTRY.find((a) => a.id === type);
  if (!def) throw new Error(`[AssetLoader] Unknown asset type: "${type}"`);

  const group = new THREE.Group();
  group.name = `asset_group_${type}`;

  // ── Sprite Mesh ────────────────────────────────────────────────────────────
  const geometry = new THREE.PlaneGeometry(size, size);
  let material;

  try {
    const texture = await loadTexture(def.texturePath);
    material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.15,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  } catch {
    // Fallback: solid colored plane with asset initial as pseudo-label
    material = new THREE.MeshBasicMaterial({
      color: def.color,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    });
    console.warn(`[AssetLoader] Using fallback colored mesh for "${type}"`);
  }

  const spriteMesh = new THREE.Mesh(geometry, material);
  spriteMesh.name = `sprite_${type}`;
  spriteMesh.userData.assetType = type;
  // Rotate -90° on X so PlaneGeometry lies flat on XZ plane (visible top-down)
  spriteMesh.rotation.x = -Math.PI / 2;
  spriteMesh.position.y = 0.01; // Slightly above ocean background
  group.add(spriteMesh);

  // ── Selection Ring (EdgesGeometry) — hidden by default ───────────────────
  const ringGeo = new THREE.EdgesGeometry(new THREE.PlaneGeometry(size * 1.2, size * 1.2));
  const ringMat = new THREE.LineBasicMaterial({
    color: 0x00e5ff,
    transparent: true,
    opacity: 0,
    linewidth: 2,
  });
  const selectionRing = new THREE.LineSegments(ringGeo, ringMat);
  selectionRing.name = 'selection_ring';
  selectionRing.renderOrder = 1;
  // Match sprite orientation — flat on XZ plane
  selectionRing.rotation.x = -Math.PI / 2;
  selectionRing.position.y = 0.02;
  group.add(selectionRing);

  group.userData.assetType = type;

  return group;
}

/**
 * Shows or hides the selection ring on an asset Group.
 * Called by DragController on select/deselect.
 * @param {THREE.Group} group
 * @param {boolean} selected
 */
export function setSelectionRing(group, selected) {
  const ring = group.getObjectByName('selection_ring');
  if (!ring) return;
  ring.material.opacity = selected ? 0.85 : 0;
}
