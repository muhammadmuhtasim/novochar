import React, { useState } from 'react';
import SkyViewer from './SkyViewer.jsx';
import Observe from './Observe.jsx';

export default function SkyView({ selectedId = null, onSelect = () => {}, onTarget = () => {} }) {
  const [section, setSection] = useState('viewer');

  return (
    <>
      <div className="sky-view-header">
        <div className="sky-view-tabs" role="group" aria-label="Sky view sections">
          <button
            className={`sky-view-tab ${section === 'viewer' ? 'active' : ''}`}
            onClick={() => setSection('viewer')}
          >
            <span>⌖</span> Sky Viewer
          </button>
          <button
            className={`sky-view-tab ${section === 'observe' ? 'active' : ''}`}
            onClick={() => setSection('observe')}
          >
            <span>◐</span> Observer
          </button>
        </div>
      </div>
      
      <div className="sky-view-content">
        {section === 'viewer' ? (
          <SkyViewer selectedId={selectedId} onSelect={onSelect} onTarget={onTarget} />
        ) : (
          <Observe selectedId={selectedId} onSelect={onSelect} />
        )}
      </div>
    </>
  );
}
