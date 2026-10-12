import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Space3DCanvas from './Space3DCanvas.jsx';

/**
 * SKY VIEWER — the immersive 3D free-flight space ported from the standalone
 * `3d/` module.
 *
 * Two presentations:
 *   • embedded — the canvas sits inside the app panel with a caption/help.
 *   • FULL DISPLAY — a viewport-filling overlay (rendered through a portal so
 *     it covers the nav + ticker) that reproduces the standalone module: a
 *     full-bleed canvas with only the 3D HUD on top. Best-effort native
 *     fullscreen is requested as well; either way, EXIT returns to the panel.
 */
export default function SkyViewer() {
  const fullRef = useRef(null);
  const [fullDisplay, setFullDisplay] = useState(false);

  // Keep the page behind the overlay from scrolling while it is open.
  useEffect(() => {
    if (!fullDisplay) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [fullDisplay]);

  // Best-effort native fullscreen once the overlay has mounted.
  useEffect(() => {
    const el = fullRef.current;
    if (fullDisplay && el && el.requestFullscreen && !document.fullscreenElement) {
      el.requestFullscreen().catch(() => {});
    }
  }, [fullDisplay]);

  const exitFullDisplay = () => {
    setFullDisplay(false);
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
  };

  return (
    <>
      {!fullDisplay && (
        <div className="viewer-grid">
          <div className="viewer-main-col">
            <section className="panel viewer-panel">
              <div className="panel-head">
                <h2>SKY VIEWER</h2>
                <div className="viewer-tools">
                  <span className="tag">3D SPACE</span>
                  <button
                    className="btn sm"
                    onClick={() => setFullDisplay(true)}
                    title="Immersive full-display mode (standalone 3D module view)"
                  >
                    ⛶ FULL DISPLAY
                  </button>
                </div>
              </div>
              <Space3DCanvas />
              <p className="muted caption">
                Immersive 3D wireframe space · Click to capture pointer, fly with WASD + Mouse. Press ESC to release.
                Use <strong>FULL DISPLAY</strong> for the standalone module view.
              </p>

              <details className="sky-help">
                <summary>What am I looking at? <span className="muted">(a quick plain-English guide)</span></summary>
                <p>
                  This is an <strong>immersive 3D wireframe space</strong> rendered in real time with Three.js.
                </p>
                <ul>
                  <li><strong>FLIGHT:</strong> Click the scene to capture your pointer, then use WASD to translate, Mouse to look, Space/Ctrl for vertical movement, Q/E to roll, and Shift to boost.</li>
                  <li><strong>SECTORS:</strong> The world is divided into 72-unit cubic sectors that generate procedurally as you fly. Revisiting a sector always regenerates the same geometry.</li>
                  <li><strong>NO LIMITS:</strong> There are no boundaries, no gravity, and no collision — just infinite free flight.</li>
                  <li><strong>FULL DISPLAY:</strong> Fills the whole window (like the standalone 3D module) with the HUD only. Use the ✕ EXIT control in the top bar to return.</li>
                </ul>
              </details>
            </section>
          </div>
        </div>
      )}

      {fullDisplay && createPortal(
        <div className="space3d-fullscreen" ref={fullRef}>
          <Space3DCanvas
            headerSlot={
              <button
                className="s3d-exit"
                onClick={exitFullDisplay}
                title="Exit full display"
              >
                ✕ EXIT
              </button>
            }
          />
        </div>,
        document.body
      )}
    </>
  );
}
