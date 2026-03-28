# Marine AR Sandbox Toolkit

## Overview

A browser-based authoring tool for building marine AR experiences. Place, arrange, and resize marine assets on an interactive canvas, then export the scene as WebXR-ready JSON. No build step required.

## Features

- Three.js r160 scene canvas with orthographic projection and ocean background
- Five marine assets: Fish, Coral, Shark, Jellyfish, Rock
- Click-to-place workflow with ghost preview that follows the cursor
- Drag-and-drop repositioning with smooth interpolation and bounds clamping
- Size slider appears near the selected object for precise scaling (0.3x to 4.0x)
- Selection ring highlight on selected assets
- JSON export and import for scene persistence
- Delete key to remove selected assets
- WebXR-ready coordinate schema (metres, x/y/z/rotation/scale)
- Asset count HUD with render timing and performance warnings (20+ assets)
- Syntax-highlighted JSON preview panel


## Improvements:
-Using ai to generate objects and textures
-Adding more assets
-Adding more features
-Adding more animations
-Adding more interactions
-Adding more sounds
-Adding more music
-Adding more effects
-Adding more transitions
-Adding more animations
-Adding more interactions
-Adding more sounds
-Adding more music
-Adding more effects
-Adding more transitions  

## Quick Start

```bash
git clone <repo>
cd marine-sandbox
npx serve .
```

Open http://localhost:3000 in your browser. A static file server is required because the project uses ES modules.

Alternative servers:

```bash
python -m http.server 8080
```

## Project Structure

```
marine-sandbox/
  index.html           Main HTML shell
  style.css            Design tokens, layout, component styles
  src/
    main.js            Entry point, Three.js setup, render loop, UI wiring
    SceneManager.js    Single source of truth for scene state
    AssetLoader.js     Texture loading, asset registry, mesh factory
    DragController.js  Pointer events, drag logic, selection, slider-driven resize
    Exporter.js        JSON build, file download, preview, import
  assets/
    fish.png
    coral.png
    shark.png
    jellyfish.png
    rock.png
    water_sprite_imag.png
```

## Module Responsibilities

| Module | Role |
|---|---|
| SceneManager.js | All state mutations, ID generation, JSON export schema |
| AssetLoader.js | Texture loading, asset registry, mesh factory |
| DragController.js | Raycaster pointer events, drag interpolation, bounds clamping, scale API |
| Exporter.js | JSON build, file download, syntax-highlighted preview, file import |
| main.js | Three.js scene setup, render loop, sidebar, size slider, toolbar wiring |

## Usage

1. Click an asset card in the sidebar to enter placement mode
2. Move the mouse over the canvas -- the asset ghost follows the cursor
3. Click to place the asset
4. Click a placed asset to select it -- a size slider appears near the object
5. Drag the slider to resize (0.3x to 4.0x) you can also rotate the asset.
6. Drag selected assets to reposition them
7. Press Delete to remove the selected asset
8. Use Export JSON to download the scene, or Preview JSON to inspect it
9. Use Import JSON to restore a previously exported scene

## JSON Export Format

```json
{
  "version": "1.0.0",
  "meta": {
    "created": "2025-01-01T00:00:00Z",
    "assetCount": 2
  },
  "scene": [
    {
      "id": "asset_1701234567_0",
      "type": "fish",
      "x": 1.2,
      "y": 0.0,
      "z": -0.8,
      "rotation": 0,
      "scale": 1.0
    }
  ]
}
```

Coordinates are in metres (Three.js default), mapping directly to WebXR world anchor coordinates.

## Tech Stack

| Technology | Role |
|---|---|
| Three.js r160 | Scene rendering, raycasting, WebGL canvas |
| Vanilla JS ES Modules | No build tooling required |
| HTML5 + CSS3 | Semantic layout, custom properties, animations |

## Validation Rules

| Condition | Behaviour |
|---|---|
| Asset dragged outside canvas | Clamped to scene boundary |
| Empty scene export | Inline warning shown |
| 20+ assets in scene | Console warning and HUD badge |
| Duplicate asset ID | Auto-suffixed with version number |
| Texture load failure | Fallback coloured mesh |
