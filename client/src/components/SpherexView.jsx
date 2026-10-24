import React, { useState } from 'react';
import RetryableModule from './RetryableModule.jsx';

const loadSpherexViewer = () => import('./SpherexViewer.jsx');
const loadSpherexSky3D = () => import('./SpherexSky3D.jsx');

export default function SpherexView({ onOpenSky3D = null, onOpenField = null }) {
  const [section, setSection] = useState('field');

  return (
    <>
      <div className="spherex-view-header">
        <div className="spherex-view-tabs" role="group" aria-label="SphereX view sections">
          <button
            className={`spherex-view-tab ${section === 'field' ? 'active' : ''}`}
            onClick={() => setSection('field')}
          >
            <span>▣</span> Field
          </button>
          <button
            className={`spherex-view-tab ${section === '3d' ? 'active' : ''}`}
            onClick={() => setSection('3d')}
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
            componentProps={{ onOpenSky3D: () => setSection('3d') }} 
          />
        ) : (
          <RetryableModule 
            loader={loadSpherexSky3D} 
            label="Loading the 3D sky…" 
            componentProps={{ onOpenField: () => setSection('field') }} 
          />
        )}
      </div>
    </>
  );
}
