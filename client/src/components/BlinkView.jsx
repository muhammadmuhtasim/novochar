import React, { useState } from 'react';
import RetryableModule from './RetryableModule.jsx';

const loadBlinkComparator = () => import('./BlinkComparator.jsx');
const loadSpectraView = () => import('./SpectraView.jsx');

export default function BlinkView({ objects = [], selectedId = null, onSelect = () => {}, onTarget = () => {} }) {
  const [section, setSection] = useState('blink');

  return (
    <>
      <div className="blink-view-header">
        <div className="blink-view-tabs" role="group" aria-label="Blink view sections">
          <button
            className={`blink-view-tab ${section === 'blink' ? 'active' : ''}`}
            onClick={() => setSection('blink')}
          >
            <span>⧗</span> Blink Comparator
          </button>
          <button
            className={`blink-view-tab ${section === 'spectra' ? 'active' : ''}`}
            onClick={() => setSection('spectra')}
          >
            <span>∿</span> Spectra
          </button>
        </div>
      </div>
      
      <div className="blink-view-content">
        {section === 'blink' ? (
          <RetryableModule 
            loader={loadBlinkComparator} 
            label="Loading blink comparator…" 
            componentProps={{ objects, selectedId, onSelect, onTarget }} 
          />
        ) : (
          <RetryableModule 
            loader={loadSpectraView} 
            label="Loading spectra…" 
            componentProps={{ objects, selectedId, onSelect, onTarget }} 
          />
        )}
      </div>
    </>
  );
}
