/**
 * @fileoverview SceneManager.js — Single source of truth for scene state.
 *
 * All mutations to the scene MUST go through this module.
 * No direct scene[] array writes from outside this module.
 *
 * WebXR Note: The coordinate schema (x, y, z, rotation, scale) maps directly
 * to WebXR world-space anchors. In Phase 2, SceneManager.getAll() can feed
 * directly into XRAnchor.requestAnchor() placement calls.
 */

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

/** @typedef {{ id: string, type: string, x: number, y: number, z: number, rotation: number, scale: number }} SceneAsset */

/**
 * Internal scene state — DO NOT export or mutate directly.
 * @type {{ version: string, meta: { created: string, assetCount: number }, scene: SceneAsset[] }}
 */
const _state = {
  version: '1.0.0',
  meta: {
    created: new Date().toISOString(),
    assetCount: 0,
  },
  scene: [],
};

/** Parallel map from asset ID → THREE.Group for raycasting + position sync. */
const _meshMap = new Map();

/** Monotonically incrementing counter for unique IDs within a session. */
let _assetCounter = 0;

/** Maximum assets before AR performance warning is shown. */
const MAX_ASSETS_BEFORE_WARN = 20;

// ─── Private Helpers ──────────────────────────────────────────────────────────

/**
 * Generates a unique asset ID.
 * Format: `asset_{timestamp}_{counter}`
 * @param {string} type - Asset type slug.
 * @returns {string}
 */
function _generateId(type) {
  return `asset_${Date.now()}_${_assetCounter++}`;
}

/**
 * Ensures the given ID is unique in the current scene, suffixing if needed.
 * @param {string} id
 * @returns {string}
 */
function _ensureUniqueId(id) {
  const existing = _state.scene.map((a) => a.id);
  if (!existing.includes(id)) return id;

  let version = 2;
  while (existing.includes(`${id}_v${version}`)) version++;
  console.warn(`[SceneManager] Duplicate ID "${id}" — renamed to "${id}_v${version}"`);
  return `${id}_v${version}`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

const SceneManager = {
  // ── State Readers ───────────────────────────────────────────────────────────

  /** @returns {SceneAsset[]} Shallow copy of all assets (do not mutate). */
  getAll() {
    return [..._state.scene];
  },

  /** @returns {number} Current asset count. */
  count() {
    return _state.scene.length;
  },

  /**
   * Returns all tracked Three.js Groups for raycasting.
   * @returns {THREE.Group[]}
   */
  getMeshes() {
    return [..._meshMap.values()];
  },

  /**
   * Looks up the scene asset record for a given mesh or its ancestor Group.
   * @param {THREE.Object3D} object
   * @returns {SceneAsset|undefined}
   */
  getAssetByMesh(object) {
    // Walk up to the Group level
    let obj = object;
    while (obj && !(obj instanceof THREE.Group)) obj = obj.parent;
    if (!obj) return undefined;

    for (const [id, group] of _meshMap) {
      if (group === obj) return _state.scene.find((a) => a.id === id);
    }
    return undefined;
  },

  /**
   * Returns the Three.js Group for a given asset ID.
   * @param {string} id
   * @returns {THREE.Group|undefined}
   */
  getMeshById(id) {
    return _meshMap.get(id);
  },

  // ── State Mutations ─────────────────────────────────────────────────────────

  /**
   * Adds a new asset to the scene.
   * @param {{ type: string, mesh: THREE.Group, x?: number, y?: number, z?: number }} opts
   * @returns {SceneAsset} The created asset record.
   */
  add({ type, mesh, x = 0, y = 0, z = 0 }) {
    const rawId = _generateId(type);
    const id = _ensureUniqueId(rawId);

    /** @type {SceneAsset} */
    const asset = { id, type, x, y, z, rotation: 0, scale: 1.0 };
    _state.scene.push(asset);
    _meshMap.set(id, mesh);

    // Keep meta in sync
    _state.meta.assetCount = _state.scene.length;

    if (_state.scene.length > MAX_ASSETS_BEFORE_WARN) {
      console.warn('[SceneManager] ⚠️ Scene exceeds 20 assets — may impact AR performance.');
      SceneManager._dispatchWarning('Scene may impact AR performance (20+ assets)');
    }

    return asset;
  },

  /**
   * Updates position of an existing asset (called by DragController on pointerup).
   * @param {string} id
   * @param {{ x: number, y: number, z: number }} position
   */
  updatePosition(id, { x, y, z }) {
    const asset = _state.scene.find((a) => a.id === id);
    if (!asset) {
      console.error(`[SceneManager] updatePosition: asset "${id}" not found`);
      return;
    }
    asset.x = x;
    asset.y = y;
    asset.z = z;

    const mesh = _meshMap.get(id);
    if (mesh) {
      mesh.position.set(x, y, z);
    }
  },

  /**
   * Removes an asset from scene state and returns its mesh for disposal.
   * @param {string} id
   * @returns {THREE.Group|undefined}
   */
  remove(id) {
    const idx = _state.scene.findIndex((a) => a.id === id);
    if (idx === -1) {
      console.error(`[SceneManager] remove: asset "${id}" not found`);
      return undefined;
    }
    _state.scene.splice(idx, 1);
    _state.meta.assetCount = _state.scene.length;
    const mesh = _meshMap.get(id);
    _meshMap.delete(id);
    return mesh;
  },

  /**
   * Clears all assets from the scene (used by JSON import / reset).
   * @returns {THREE.Group[]} All removed meshes for disposal.
   */
  clear() {
    const meshes = [..._meshMap.values()];
    _state.scene.length = 0;
    _state.meta.assetCount = 0;
    _meshMap.clear();
    return meshes;
  },

  // ── JSON Import ─────────────────────────────────────────────────────────────

  /**
   * Replaces meta (called during JSON import to restore original timestamps).
   * @param {{ created: string }} meta
   */
  restoreMeta(meta) {
    _state.meta.created = meta.created ?? _state.meta.created;
  },

  // ── JSON Export ─────────────────────────────────────────────────────────────

  /**
   * Builds the exportable JSON object.
   * Returns null if the scene is empty (caller shows inline warning).
   * @returns {{ version: string, meta: object, scene: SceneAsset[] }|null}
   */
  exportJSON() {
    if (_state.scene.length === 0) return null;
    return {
      version: _state.version,
      meta: {
        created: _state.meta.created,
        assetCount: _state.scene.length,
      },
      scene: _state.scene.map((a) => ({ ...a })),
    };
  },

  // ── Internal Event Bus (lightweight, no external dep) ──────────────────────

  _listeners: {},

  /**
   * Subscribe to SceneManager events.
   * @param {'warn'|'change'} event
   * @param {Function} fn
   */
  on(event, fn) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
  },

  /** @param {string} msg */
  _dispatchWarning(msg) {
    (this._listeners['warn'] || []).forEach((fn) => fn(msg));
  },

  /** Notifies subscribers that the scene changed (asset added/removed/moved). */
  _dispatchChange() {
    (this._listeners['change'] || []).forEach((fn) => fn(_state.scene.length));
  },
};

export default SceneManager;
