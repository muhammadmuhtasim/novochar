import React, { useState, useEffect } from 'react';
import { api } from './lib/api.js';
import Logo from './components/Logo.jsx';
import Home from './components/Home.jsx';
import SkyViewer from './components/SkyViewer.jsx';
import BlinkComparator from './components/BlinkComparator.jsx';
import Catalogue from './components/Catalogue.jsx';
import DataSources from './components/DataSources.jsx';
import SpectraView from './components/SpectraView.jsx';

const TABS = [
  { id: 'home', label: 'MISSION', icon: '◉' },
  { id: 'sky', label: 'SKY VIEWER', icon: '⌖' },
  { id: 'blink', label: 'BLINK COMPARATOR', icon: '⧗' },
  { id: 'catalogue', label: 'CATALOGUE', icon: '≋' },
  { id: 'spectra', label: 'SPECTRA', icon: '∿' },
  { id: 'sources', label: 'DATA SOURCES', icon: '☍' },
];

export default function App() {
  const [tab, setTabRaw] = useState(initialTab());
  const [stats, setStats] = useState(null);
  const [health, setHealth] = useState(null);
  const [objects, setObjects] = useState([]);
  const [target, setTarget] = useState(null); // { tab, id } deep-link to a candidate

  const setTab = (t) => {
    setTabRaw(t);
    setTarget(null); // plain nav clears any deep-link target
    try { location.hash = t; } catch (_) {}
  };

  // Navigate to a tab and pre-select a target candidate (e.g. from a preset).
  const goToTarget = (t, id) => {
    setTarget(id ? { tab: t, id } : null);
    setTabRaw(t);
    try { location.hash = t; } catch (_) {}
  };

  useEffect(() => {
    api
      .stats()
      .then(setStats)
      .catch(() => {});
    api
      .health()
      .then(setHealth)
      .catch(() => {});
    api
      .objects()
      .then((d) => setObjects(d.objects))
      .catch(() => {});
    window.addEventListener('hashchange', () => {
      const t = location.hash.replace('#', '');
      if (TABS.some((x) => x.id === t)) { setTabRaw(t); setTarget(null); }
    });
  }, []);

  const skyPreset = tab === 'sky' && target ? target.id : null;
  const blinkPreset = tab === 'blink' && target ? target.id : null;

  return (
    <div className="shell">
      <div className="bg fx" />
      <Navbar tab={tab} setTab={setTab} stats={stats} />
      <main className="view">
        {tab === 'home' && <Home stats={stats} health={health} objects={objects} onNavigate={setTab} onTarget={goToTarget} />}
        {tab === 'sky' && <SkyViewer objects={objects} presetId={skyPreset} onTarget={goToTarget} />}
        {tab === 'blink' && <BlinkComparator objects={objects} presetId={blinkPreset} />}
        {tab === 'catalogue' && <Catalogue objects={objects} />}
        {tab === 'spectra' && <SpectraView objects={objects} presetId={target && target.tab === 'spectra' ? target.id : null} />}
        {tab === 'sources' && <DataSources />}
      </main>
      <Ticker />
    </div>
  );
}

function initialTab() {
  const t = typeof location !== 'undefined' ? location.hash.replace('#', '') : '';
  return TABS.some((x) => x.id === t) ? t : 'home';
}

function Navbar({ tab, setTab, stats }) {
  return (
    <header className="nav">
      <div className="nav-brand" onClick={() => setTab('home')}>
        <Logo />
        <div className="nav-title">
          <span className="brand-name">NOVOCHAR</span>
          <span className="brand-sub">নভোচার · SPHEREx BLINK COMPARATOR</span>
        </div>
      </div>
      <nav className="nav-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            <span className="tab-icon">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
      <div className="nav-status">
        <span className="pulse-dot" />
        <span className="status-text">
          {stats ? `${stats.completedPasses}/${stats.passes} passes` : 'LINK…'}
        </span>
      </div>
      <a
        className="nav-repo"
        href="https://github.com/muhammadmuhtasim/novochar"
        target="_blank"
        rel="noreferrer"
        aria-label="Novochar GitHub repository (opens in a new tab)"
      >
        <svg className="nav-repo-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.09-.745.083-.729.083-.729 1.205.084 1.84 1.237 1.84 1.237 1.07 1.834 2.807 1.304 3.492.997.108-.775.418-1.305.762-1.605-2.665-.3-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.536-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.655 1.652.243 2.873.12 3.176.77.84 1.235 1.91 1.235 3.221 0 4.609-2.807 5.628-5.479 5.921.43.372.823 1.102.823 2.222 0 1.606-.015 2.903-.015 3.293 0 .322.216.694.825.576C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
          />
        </svg>
        GITHUB ↗
      </a>
    </header>
  );
}

function Ticker() {
  const msg =
    '[SYS] ASTROMETRIC PIPELINE READY :: [SPX] PASS DWELL 44.2s :: [GBOT] TARGET QUEUE SYNCED :: [NEO] CLOSE-APPROACH WATCH ACTIVE :: [NOVOCHAR] blink comparator armed — track the movers';
  return (
    <footer className="ticker">
      <span className="ticker-label">TELEMETRY</span>
      <div className="ticker-scroll">{msg}</div>
    </footer>
  );
}