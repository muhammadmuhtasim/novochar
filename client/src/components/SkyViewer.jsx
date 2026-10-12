import React, { useEffect, useRef, useState } from 'react';
import Space3DCanvas from './Space3DCanvas.jsx';

export default function SkyViewer() {
  const viewerRef = useRef(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await viewerRef.current?.requestFullscreen();
    } catch (_) {}
  };

  return (
    <div className="viewer-grid" ref={viewerRef}>
      <div className="viewer-main-col">
        <section className="panel viewer-panel">
          <div className="panel-head">
            <h2>SKY VIEWER</h2>
            <div className="viewer-tools">
              <span className="tag">3D SPACE</span>
              <button className="btn sm" onClick={toggleFullscreen} title="Toggle fullscreen">
                {fullscreen ? 'EXIT FULLSCREEN' : 'FULLSCREEN'}
              </button>
            </div>
          </div>
          <Space3DCanvas />
          <p className="muted caption">
            Immersive 3D wireframe space · Click to capture pointer, fly with WASD + Mouse. Press ESC to release.
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
            </ul>
          </details>
        </section>
      </div>
    </div>
  );
}