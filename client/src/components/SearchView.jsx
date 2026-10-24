import React, { Suspense, useState } from 'react';
import RetryableModule from './RetryableModule.jsx';

const loadCatalogue = () => import('./Catalogue.jsx');
const loadIvoaLab = () => import('./IvoaLab.jsx');

export default function SearchView({ objects = [], selectedId = null, onSelect = () => {}, onTarget = () => {} }) {
  const [section, setSection] = useState('catalogue');

  return (
    <>
      <div className="search-view-header">
        <div className="search-view-tabs" role="group" aria-label="Search sections">
          <button
            className={`search-view-tab ${section === 'catalogue' ? 'active' : ''}`}
            onClick={() => setSection('catalogue')}
          >
            <span>≋</span> Catalogue
          </button>
          <button
            className={`search-view-tab ${section === 'archives' ? 'active' : ''}`}
            onClick={() => setSection('archives')}
          >
            <span>⇆</span> Live Archives
          </button>
        </div>
      </div>
      
      <div className="search-view-content">
        {section === 'catalogue' ? (
          <RetryableModule 
            loader={loadCatalogue} 
            label="Loading catalogue…" 
            componentProps={{ objects, selectedId, onSelect, onTarget }} 
          />
        ) : (
          <RetryableModule 
            loader={loadIvoaLab} 
            label="Loading live archives…" 
          />
        )}
      </div>
    </>
  );
}
