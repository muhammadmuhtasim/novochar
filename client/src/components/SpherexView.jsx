import React, { useState } from 'react';
import RetryableModule from './RetryableModule.jsx';

const loadSpherexViewer = () => import('./SpherexViewer.jsx');
const loadSpherexSky3D = () => import('./SpherexSky3D.jsx');

// `#spherex3d` is the historical deep link to the 3D explorer. The nav merge
// folded both sections into one tab and the hash now usually says
// `#spherexview`; keep the old link (and `#spherexview/3d`) pointing at the
// section the user actually asked for instead of silently opening FIELD.
function initialSection() {
  if (typeof location === 'undefined') return 'field';
  const [tab, id] = location.hash.replace(/^#/, '').split('/');
  if (tab === 'spherex3d') return '3d';
  if (tab === 'spherexview' && id === '3d') return '3d';
  return 'field';
}

export default function SpherexView({ onOpenSky3D = null, onOpenField = null }) {
  const [section, setSection] = useState(initialSection);

  // Keep the URL in step with the section. `spherex3d` remains the canonical
  // 3D deep link; FIELD uses the merged tab's route.
  const selectSection = (next) => {
    setSection(next);
    if (typeof location === 'undefined' || typeof history === 'undefined') return;
    const hash = `#${next === '3d' ? 'spherex3d' : 'spherexview'}`;
    if (location.hash !== hash) {
      try { history.replaceState(null, '', hash); } catch (_) { /* history is optional */ }
    }
  };

  return (
    <>
      <div className="spherex-view-header">
        <div className="spherex-view-tabs" role="group" aria-label="SphereX view sections">
          <button
            className={`spherex-view-tab ${section === 'field' ? 'active' : ''}`}
            onClick={() => selectSection('field')}
          >
            <span>▣</span> Field
          </button>
          <button
            className={`spherex-view-tab ${section === '3d' ? 'active' : ''}`}
            onClick={() => selectSection('3d')}
          >
            <span>◍</span> 3D Sky
          </button>
        </div>
      </div>
      
      <div className="spherex-view-content">
        {section === 'field' ? (
          <RetryableModule 
            loader={loadSpherexViewer} 
            label="Loading SPHEREx products…" 
            componentProps={{ onOpenSky3D: () => selectSection('3d') }} 
          />
        ) : (
          <RetryableModule 
            loader={loadSpherexSky3D} 
            label="Loading the 3D sky…" 
            componentProps={{ onOpenField: () => selectSection('field') }} 
          />
        )}
      </div>
    </>
  );
}
