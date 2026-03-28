/**
 * @fileoverview DragController.js — Smooth drag, placement mode, and slider-driven resize.
 *
 * Features:
 *  - Lerp-interpolated smooth drag
 *  - "Placement mode": asset follows cursor until clicked to commit
 *  - Public setScale() API for external slider control
 *  - Dynamic bounds from camera frustum (fills entire screen)
 *  - Pulsing selection ring
 *  - Delete key to remove
 */

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import SceneManager from './SceneManager.js';
import { setSelectionRing } from './AssetLoader.js';

const DRAG_LERP = 0.18;
const MIN_SCALE = 0.3;
const MAX_SCALE = 4.0;
const SCALE_STEP = 0.1;

export class DragController {
  /**
   * @param {THREE.OrthographicCamera} camera
   * @param {HTMLElement} domElement
   */
  constructor(camera, domElement) {
    this._camera = camera;
    this._domElement = domElement;

    this._raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();

    /** @type {THREE.Group|null} */
    this._selected = null;
    /** @type {string|null} */
    this._selectedId = null;

    this._dragOffset = new THREE.Vector3();
    this._dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._intersection = new THREE.Vector3();

    this._isDragging = false;
    this._targetPos = new THREE.Vector3();

    // ── Placement mode state ──
    /** @type {THREE.Group|null} Ghost mesh following cursor before placement. */
    this._placementGhost = null;
    this._isPlacing = false;

    this._ringPhase = 0;

    // Callbacks
    this.onDragEnd = null;
    this.onSelect = null;
    this.onDeselect = null;
    this.onDeleteMesh = null;
    /** Called when placement mode commits. Receives { group, worldPos }. */
    this.onPlacementCommit = null;
    /** Called to update HUD with current scale. */
    this.onScaleChange = null;

    this._bindEvents();
  }

  /**
   * Computes scene bounds dynamically from camera frustum.
   * This ensures placement/drag fills the entire visible area.
   */
  _getSceneBounds() {
    const cam = this._camera;
    const hw = (cam.right - cam.left) / 2;
    const hh = (cam.top - cam.bottom) / 2;
    return { halfW: hw * 0.95, halfH: hh * 0.95 }; // 5% margin from edge
  }

  _bindEvents() {
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);

    this._domElement.addEventListener('pointerdown', this._onPointerDown);
    this._domElement.addEventListener('pointermove', this._onPointerMove);
    this._domElement.addEventListener('pointerup', this._onPointerUp);
    this._domElement.addEventListener('pointerleave', this._onPointerUp);
    window.addEventListener('keydown', this._onKeyDown);
  }

  _toNDC(event) {
    const rect = this._domElement.getBoundingClientRect();
    this._pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this._pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  _clampToBounds(pos) {
    const b = this._getSceneBounds();
    pos.x = Math.max(-b.halfW, Math.min(b.halfW, pos.x));
    pos.z = Math.max(-b.halfH, Math.min(b.halfH, pos.z));
    return pos;
  }

  /** Get world position under mouse cursor. */
  _getWorldPosUnderMouse(event) {
    this._toNDC(event);
    this._raycaster.setFromCamera(this._pointer, this._camera);
    this._raycaster.ray.intersectPlane(this._dragPlane, this._intersection);
    return this._intersection.clone();
  }

  // ─── Placement Mode ──────────────────────────────────────────────────────

  /**
   * Enter placement mode. A ghost mesh follows the cursor.
   * Click on canvas to commit placement at that position.
   * @param {THREE.Group} ghostGroup — Pre-created mesh to place.
   */
  enterPlacementMode(ghostGroup) {
    // Cancel any existing placement
    if (this._placementGhost) {
      this._placementGhost.parent?.remove(this._placementGhost);
    }
    this._placementGhost = ghostGroup;
    this._isPlacing = true;
    // Hide initially — made visible on first pointermove (prevents flash at center)
    ghostGroup.visible = false;
    // Make ghost semi-transparent
    ghostGroup.traverse((c) => {
      if (c.material && c.name?.startsWith('sprite_')) {
        c.material.opacity = 0.6;
      }
    });
    this._domElement.style.cursor = 'crosshair';
  }

  /** Cancel placement mode without committing. */
  cancelPlacement() {
    if (this._placementGhost) {
      this._placementGhost.parent?.remove(this._placementGhost);
      this._placementGhost.traverse((c) => {
        if (c.geometry) c.geometry.dispose();
        if (c.material) c.material.dispose();
      });
    }
    this._placementGhost = null;
    this._isPlacing = false;
    this._domElement.style.cursor = 'default';
  }

  // ─── Pointer Events ──────────────────────────────────────────────────────

  _onPointerDown(event) {
    if (event.button !== 0) return;

    // ── Placement mode: commit the ghost at cursor position ──
    if (this._isPlacing && this._placementGhost) {
      const worldPos = this._getWorldPosUnderMouse(event);
      worldPos.y = 0;
      this._clampToBounds(worldPos);
      this._placementGhost.position.copy(worldPos);

      // Restore full opacity
      this._placementGhost.traverse((c) => {
        if (c.material && c.name?.startsWith('sprite_')) {
          c.material.opacity = 1.0;
        }
      });

      const group = this._placementGhost;
      this._placementGhost = null;
      this._isPlacing = false;
      this._domElement.style.cursor = 'default';

      this.onPlacementCommit?.({ group, worldPos });
      return;
    }

    // ── Normal mode: select/drag existing asset ──
    this._toNDC(event);
    this._raycaster.setFromCamera(this._pointer, this._camera);

    const meshes = SceneManager.getMeshes().flatMap((g) =>
      g.children.filter((c) => c.name?.startsWith('sprite_'))
    );
    const hits = this._raycaster.intersectObjects(meshes, false);

    if (hits.length > 0) {
      let group = hits[0].object;
      while (group && !(group instanceof THREE.Group)) group = group.parent;
      if (!group) return;

      if (this._selected && this._selected !== group) {
        setSelectionRing(this._selected, false);
        this.onDeselect?.();
      }

      this._selected = group;
      const asset = SceneManager.getAssetByMesh(hits[0].object);
      this._selectedId = asset?.id ?? null;

      setSelectionRing(group, true);
      this.onSelect?.(asset);

      this._isDragging = true;
      this._raycaster.ray.intersectPlane(this._dragPlane, this._intersection);
      this._dragOffset.copy(this._intersection).sub(group.position);
      this._targetPos.copy(group.position);

      this._domElement.style.cursor = 'grabbing';
      this._domElement.setPointerCapture(event.pointerId);
    } else {
      if (this._selected) {
        setSelectionRing(this._selected, false);
        this._selected = null;
        this._selectedId = null;
        this._isDragging = false;
        this.onDeselect?.();
      }
    }
  }

  _onPointerMove(event) {
    this._toNDC(event);

    // ── Placement mode: ghost follows cursor ──
    if (this._isPlacing && this._placementGhost) {
      this._raycaster.setFromCamera(this._pointer, this._camera);
      this._raycaster.ray.intersectPlane(this._dragPlane, this._intersection);
      if (this._intersection) {
        const wp = this._intersection.clone();
        wp.y = 0;
        this._clampToBounds(wp);
        this._placementGhost.position.copy(wp);
        // Show ghost now that it has a real position (prevents center flash)
        if (!this._placementGhost.visible) this._placementGhost.visible = true;
      }
      return;
    }

    // ── Drag mode: update target position ──
    if (this._isDragging && this._selected) {
      this._raycaster.setFromCamera(this._pointer, this._camera);
      this._raycaster.ray.intersectPlane(this._dragPlane, this._intersection);
      if (!this._intersection) return;
      const desired = this._intersection.clone().sub(this._dragOffset);
      desired.y = 0;
      this._clampToBounds(desired);
      this._targetPos.copy(desired);
      return;
    }

    // ── Hover cursor ──
    this._raycaster.setFromCamera(this._pointer, this._camera);
    const meshes = SceneManager.getMeshes().flatMap((g) =>
      g.children.filter((c) => c.name?.startsWith('sprite_'))
    );
    const hits = this._raycaster.intersectObjects(meshes, false);
    this._domElement.style.cursor = hits.length > 0 ? 'grab' : 'default';
  }

  _onPointerUp(event) {
    if (!this._isDragging || !this._selectedId) {
      this._isDragging = false;
      return;
    }
    this._isDragging = false;

    if (this._selected) this._selected.position.copy(this._targetPos);

    const p = this._selected.position;
    SceneManager.updatePosition(this._selectedId, { x: p.x, y: p.y, z: p.z });
    this.onDragEnd?.({ id: this._selectedId, position: p.clone() });

    this._domElement.style.cursor = 'grab';
    try { this._domElement.releasePointerCapture(event.pointerId); } catch {}
  }

  // ─── Slider-driven Resize ───────────────────────────────────────────────

  /**
   * Sets the scale of the currently selected asset.
   * Called by the external UI slider in main.js.
   * @param {number} newScale — Clamped between MIN_SCALE and MAX_SCALE.
   */
  setScale(newScale) {
    if (!this._selected || !this._selectedId) return;

    newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));

    const asset = SceneManager.getAll().find((a) => a.id === this._selectedId);
    if (!asset) return;

    asset.scale = newScale;
    this._selected.scale.set(newScale, newScale, newScale);

    this.onScaleChange?.(this._selectedId, newScale);
  }

  /**
   * Returns the currently selected asset record, or null.
   * @returns {{ id: string, scale: number }|null}
   */
  getSelectedAsset() {
    if (!this._selectedId) return null;
    return SceneManager.getAll().find((a) => a.id === this._selectedId) ?? null;
  }

  // ─── Keyboard ────────────────────────────────────────────────────────────

  _onKeyDown(event) {
    if (event.key === 'Escape' && this._isPlacing) {
      this.cancelPlacement();
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && this._selectedId) {
      this.deleteSelected();
    }
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  deleteSelected() {
    if (!this._selectedId) return;
    const mesh = SceneManager.remove(this._selectedId);
    if (mesh) this.onDeleteMesh?.(mesh);
    this._selected = null;
    this._selectedId = null;
    this._isDragging = false;
    this.onDeselect?.();
  }

  update(delta) {
    if (this._isDragging && this._selected) {
      this._selected.position.lerp(this._targetPos, DRAG_LERP);
    }
    if (this._selected) {
      this._ringPhase += delta * 2.5;
      const opacity = 0.5 + 0.4 * Math.sin(this._ringPhase);
      const ring = this._selected.getObjectByName('selection_ring');
      if (ring) ring.material.opacity = opacity;
    }
  }

  getSelectedId() { return this._selectedId; }

  clearSelection() {
    if (this._selected) {
      setSelectionRing(this._selected, false);
      this._selected = null;
      this._selectedId = null;
      this._isDragging = false;
      this.onDeselect?.();
    }
  }

  dispose() {
    this._domElement.removeEventListener('pointerdown', this._onPointerDown);
    this._domElement.removeEventListener('pointermove', this._onPointerMove);
    this._domElement.removeEventListener('pointerup', this._onPointerUp);
    this._domElement.removeEventListener('pointerleave', this._onPointerUp);
    window.removeEventListener('keydown', this._onKeyDown);
  }
}
