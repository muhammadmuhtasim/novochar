import React, { useState, useEffect } from 'react';
import { api } from './lib/api.js';
import Logo from './components/Logo.jsx';
import Home from './components/Home.jsx';
import SkyViewer from './components/SkyViewer.jsx';
import BlinkComparator from './components/BlinkComparator.jsx';
import Catalogue from './components/Catalogue.jsx';
import DataSources from './components/DataSources.jsx';

const TABS = [
  { id: 'home', label: 'MISSION', icon: '◉' },
  { id: 'sky', label: 'SKY VIEWER', icon: '⌖' },
  { id: 'blink', label: 'BLINK COMPARATOR', icon: '⧗' },
  { id: 'catalogue', label: 'CATALOGUE', icon: '≋' },
  { id: 'sources', label: 'DATA SOURCES', icon: '☍' },
];

export default function App() {
  const [tab, setTabRaw] = useState(initialTab());
  const [stats, setStats] = useState(null);
  const [health, setHealth] = useState(null);
  const [objects, setObjects] = useState([]);

  const setTab = (t) => {
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
      if (TABS.some((x) => x.id === t)) setTabRaw(t);
    });
  }, []);

  return (
    <div className="shell">
      <div className="bg fx" />
      <Navbar tab={tab} setTab={setTab} stats={stats} />
      <main className="view">
        {tab === 'home' && <Home stats={stats} health={health} onNavigate={setTab} />}
        {tab === 'sky' && <SkyViewer objects={objects} />}
        {tab === 'blink' && <BlinkComparator objects={objects} />}
        {tab === 'catalogue' && <Catalogue objects={objects} />}
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