# VOID — Free-Roaming 3D Space

A browser-native, non-game 3D environment. It uses HTML, CSS, JavaScript modules, and Three.js (WebGL) to render a minimal wireframe space with six-degree-of-freedom flight and deterministic procedural sectors.

## Run locally

A local HTTP server is required because the project uses JavaScript modules. Python is enough; no bundler or build step is required.

```bash
cd 3d-space
python -m http.server 8000
```

Open <http://localhost:8000> in a modern browser. An internet connection is needed to load Three.js from jsDelivr and the optional Google font. For fully offline use, download `three.module.js`, save it under `vendor/three.module.js`, and update the import map in `index.html` to `./vendor/three.module.js`.

## Controls

- **Click** the scene to capture the pointer
- **W / S**: forward / backward
- **A / D**: strafe left / right
- **Space / Ctrl**: move up / down
- **Mouse**: look (yaw and pitch)
- **Q / E**: roll left / right
- **Shift**: boost speed
- **Esc**: release the pointer

The camera has no gravity and no collision constraints. Translation is relative to the camera's orientation, so looking upward and pressing W moves upward through the space.

## Project structure

```text
3d-space/
├── index.html          # Canvas, HUD, import map
├── style.css           # Responsive overlay UI
├── src/
│   ├── main.js          # Renderer, scene, UI, animation loop
│   ├── controls.js      # Free-flight camera and keyboard/mouse input
│   └── world.js         # Deterministic procedural sector generator
└── README.md
```

## How the effectively infinite world works

- Space is divided into 72-unit cubic sectors.
- Only sectors within a radius of one sector on each axis are kept active (up to 27 sectors).
- Each sector's geometry is seeded from its integer coordinates. Revisiting a sector regenerates the same shapes.
- When the camera moves, newly nearby sectors are generated and distant sectors are removed and their geometries disposed.
- The world has no fixed edge. Coordinates are ordinary floating-point world coordinates, so extremely large distances can eventually lose precision; floating-origin rebasing would be a sensible next upgrade for very long sessions.

## Customize

- `src/world.js`: change `sectorSize`, `viewRadius`, object count, primitive types, palette, and grid density.
- `src/controls.js`: change `speed`, `boost`, `lookSensitivity`, and `rollSpeed`.
- `src/main.js`: change field of view, fog density, renderer settings, and initial camera position.
- `style.css`: change the HUD and overall visual style.

## Notes

This is an intentionally small starter project, not a full game engine. It has no goals, physics, gravity, collision, or game loop beyond rendering and free flight. Browser performance varies by GPU and device; reduce `viewRadius` or object count on weaker hardware.
