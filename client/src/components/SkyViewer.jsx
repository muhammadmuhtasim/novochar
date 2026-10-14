import React, { useState } from 'react';
import CelestialExplore from './CelestialExplore.jsx';
import Space3DCanvas from './Space3DCanvas.jsx';

/**
 * Sky Viewer entry point. Explore mode is the default celestial-sphere experience.
 * The previous procedural free-flight environment remains available as a separate view.
 */
export default function SkyViewer() {
  const [view, setView] = useState('explore');
  return (
    <>
      <div className="sky-mode-switch" role="group" aria-label="Sky viewer experience">
        <button className={view === 'explore' ? 'active' : ''} onClick={() => setView('explore')}><span>✦</span> EXPLORE SKY</button>
        <button className={view === 'space' ? 'active' : ''} onClick={() => setView('space')}><span>◇</span> FREE-FLIGHT SPACE</button>
      </div>
      {view === 'explore' ? <CelestialExplore /> : (
        <div className="viewer-grid"><div className="viewer-main-col"><section className="panel viewer-panel">
          <div className="panel-head"><h2>FREE-FLIGHT SPACE</h2><span className="tag">PROCEDURAL 3D</span></div>
          <Space3DCanvas />
          <p className="muted caption">This is Novochar's original procedural free-flight environment. It is separate from the catalog-based celestial sphere in Explore Sky.</p>
        </section></div></div>
      )}
    </>
  );
}