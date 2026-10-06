import React, { useState, useEffect } from 'react';
import { api } from './lib/api.js';
import Logo from './components/Logo.jsx';
import Home from './components/Home.jsx';
import SkyViewer from './components/SkyViewer.jsx';
import BlinkComparator from './components/BlinkComparator.jsx';
import Catalogue from './components/Catalogue.jsx';
import DataSources from './components/DataSources.jsx';
import SpectraView from './components/SpectraView.jsx';
import IvoaLab from './components/IvoaLab.jsx';

const TABS = [
  { id: 'home', label: 'MISSION', icon: '◉' },
  { id: 'sky', label: 'SKY VIEWER', icon: '⌖' },
  { id: 'blink', label: 'BLINK COMPARATOR', icon: '⧗' },
  { id: 'catalogue', label: 'CATALOGUE', icon: '≋' },
  { id: 'spectra', label: 'SPECTRA', icon: '∿' },
  { id: 'archives', label: 'LIVE ARCHIVES', icon: '⇆' },
  { id: 'sources', label: 'DATA SOURCES', icon: '☍' },
];

export default function App() {
  const [tab, setTabRaw] = useState(initialTab());
  const [stats, setStats] = useState(null);
  const [health, setHealth] = useState(null);
  const [objects, setObjects] = useState([]);
  const [target, setTarget] = useState(null); // { tab, id } deep-link to a candidate
  const [menuOpen, setMenuOpen] = useState(false);

  const setTab = (t) => {
    setTabRaw(t);
    setTarget(null); // plain nav clears any deep-link target
    setMenuOpen(false);
    try { location.hash = t; } catch (_) {}
  };

  // Navigate to a tab and pre-select a target candidate (e.g. from a preset).
  const goToTarget = (t, id) => {
    setTarget(id ? { tab: t, id } : null);
    setTabRaw(t);
    setMenuOpen(false);
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

  useEffect(() => {
    // Scroll reveal observer for panels and cards
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in-view');
          }
        });
      },
      { threshold: 0.08, rootMargin: '0px 0px -30px 0px' }
    );

    const timer = setTimeout(() => {
      const elements = document.querySelectorAll('.panel, .source-card, .obj-card, .kv div, .sed-chart, .chip');
      elements.forEach((el) => observer.observe(el));
    }, 50);

    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [tab, target, objects]);

  // Custom sci-fi targeting-reticle cursor. Disabled on coarse-pointer (touch)
  // and `prefers-reduced-motion` devices, where the native cursor is kept.
  useEffect(() => {
    const mm = (q) => window.matchMedia && window.matchMedia(q).matches;
    if (mm('(any-pointer: coarse)') || mm('(prefers-reduced-motion: reduce)')) return undefined;

    const SVGNS = 'http://www.w3.org/2000/svg';
    const make = (tag, cls, ns) => {
      const el = ns ? document.createElementNS(ns, tag) : document.createElement(tag);
      if (cls) el.setAttribute('class', cls);
      return el;
    };

    const cursor = make('div', 'nc-cursor');
    const wrap = make('span', 'nc-cross-wrap');
    const cross = make('span', 'nc-cross');
    const svg = make('svg', null, SVGNS);
    svg.setAttribute('viewBox', '-24 -24 48 48');
    svg.setAttribute('width', '44');
    svg.setAttribute('height', '44');
    svg.setAttribute('aria-hidden', 'true');

    const g = make('g', null, SVGNS);
    g.setAttribute('stroke', 'currentColor');
    g.setAttribute('stroke-width', '1.2');
    g.setAttribute('stroke-linecap', 'square');
    g.setAttribute('fill', 'none');
    [
      'M-18-18 L-9-18 L-18-11',   // top-left bracket
      'M18-18 L9-18 L18-11',      // top-right
      'M-18 18 L-9 18 L-18 11',   // bottom-left
      'M18 18 L9 18 L18 11',      // bottom-right
      'M0-15 L0-9',               // N tick
      'M0 15 L0 9',               // S tick
      'M-15 0 L-9 0',             // W tick
      'M15 0 L9 0',               // E tick
    ].forEach((d) => {
      const p = make('path', null, SVGNS);
      p.setAttribute('d', d);
      g.appendChild(p);
    });
    svg.appendChild(g);

    const dot = make('circle', null, SVGNS);
    dot.setAttribute('r', '1.5');
    dot.setAttribute('fill', 'currentColor');
    svg.appendChild(dot);

    cross.appendChild(svg);
    wrap.appendChild(cross);
    const ring = make('span', 'nc-ring');
    const glow = make('span', 'nc-glow');
    cursor.appendChild(wrap);
    cursor.appendChild(ring);
    cursor.appendChild(glow);
    document.body.appendChild(cursor);
    document.documentElement.classList.add('nc-cursor-on');
    cursor.style.opacity = '0';

    const TARGET = { x: -100, y: -100 };
    const CUR = { x: -100, y: -100 };
    const RING = { x: -100, y: -100 };
    const GLOW = { x: -100, y: -100 };
    let shown = false;

    const INTERACTIVE =
      'a, button:not(:disabled), [role="button"], .tab, .btn, .seg, .chip, .tag, summary, label, ' +
      '.obj-card, .source-card, select, input[type="checkbox"], input[type="radio"], [onclick]';
    const TEXTISH =
      'textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="submit"]), select, [contenteditable="true"]';

    const updateHover = () => {
      if (!shown) return;
      const el = document.elementFromPoint(TARGET.x, TARGET.y);
      if (!el) return;
      if (el.closest && (el.closest(TEXTISH) || el.closest('[contenteditable]'))) {
        cursor.classList.remove('busy');
        cursor.classList.add('hidden');
        return;
      }
      cursor.classList.remove('hidden');
      if (el.closest && el.closest(INTERACTIVE)) cursor.classList.add('busy');
      else cursor.classList.remove('busy');
    };

    const onMove = (e) => {
      TARGET.x = e.clientX;
      TARGET.y = e.clientY;
      if (!shown) {
        CUR.x = TARGET.x; CUR.y = TARGET.y;
        RING.x = TARGET.x; RING.y = TARGET.y;
        GLOW.x = TARGET.x; GLOW.y = TARGET.y;
        shown = true;
        cursor.style.opacity = '1';
      }
      updateHover();
    };
    const hide = () => { cursor.style.opacity = '0'; shown = false; };
    const press = () => cursor.classList.add('press');
    const release = () => cursor.classList.remove('press');

    let raf;
    const loop = () => {
      CUR.x += (TARGET.x - CUR.x) * 0.9;
      CUR.y += (TARGET.y - CUR.y) * 0.9;
      RING.x += (CUR.x - RING.x) * 0.55;
      RING.y += (CUR.y - RING.y) * 0.55;
      GLOW.x += (CUR.x - GLOW.x) * 0.35;
      GLOW.y += (CUR.y - GLOW.y) * 0.35;
      wrap.style.transform = `translate3d(${CUR.x - 22}px, ${CUR.y - 22}px, 0)`;
      ring.style.transform = `translate3d(${RING.x - 23}px, ${RING.y - 23}px, 0)`;
      glow.style.transform = `translate3d(${GLOW.x - 37}px, ${GLOW.y - 37}px, 0)`;
      raf = requestAnimationFrame(loop);
    };

    document.addEventListener('mousemove', onMove, { passive: true });
    document.addEventListener('mouseleave', hide);
    document.addEventListener('mousedown', press);
    document.addEventListener('mouseup', release);
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseleave', hide);
      document.removeEventListener('mousedown', press);
      document.removeEventListener('mouseup', release);
      document.documentElement.classList.remove('nc-cursor-on');
      if (cursor.parentNode === document.body) cursor.remove();
    };
  }, []);

  const skyPreset = tab === 'sky' && target ? target.id : null;
  const blinkPreset = tab === 'blink' && target ? target.id : null;
  const cataloguePreset = tab === 'catalogue' && target ? target.id : null;
  const spectraPreset = tab === 'spectra' && target ? target.id : null;

  return (
    <div className="shell">
      <div className="bg fx">
        <div className="nebula" />
        <div className="stars-far" />
        <div className="stars-near" />
        <div className="dust" />
        <span className="meteor" />
        <span className="meteor" />
        <span className="meteor" />
      </div>
      <div className="app-sticky">
        <Navbar tab={tab} setTab={setTab} stats={stats} menuOpen={menuOpen} onToggleMenu={() => setMenuOpen((v) => !v)} />
        <NavMenu tab={tab} setTab={setTab} open={menuOpen} />
      </div>
      <main className="view" key={tab}>
        <div className="view-scanline-sweep" />
        <div className="view-tear" />
        <div className="hud-tab-banner">
          <span className="hud-banner-dot" />
          <span className="hud-banner-text">SYS.INIT // MODULE: {tab.toUpperCase()} // NOVOCHAR HUD OPERATIONAL</span>
        </div>
        {tab === 'home' && <Home stats={stats} health={health} objects={objects} onNavigate={setTab} onTarget={goToTarget} />}
        {tab === 'sky' && <SkyViewer objects={objects} presetId={skyPreset} onTarget={goToTarget} />}
        {tab === 'blink' && <BlinkComparator objects={objects} presetId={blinkPreset} onTarget={goToTarget} />}
        {tab === 'catalogue' && <Catalogue objects={objects} presetId={cataloguePreset} onTarget={goToTarget} />}
        {tab === 'spectra' && <SpectraView objects={objects} presetId={spectraPreset} onTarget={goToTarget} />}
        {tab === 'archives' && <IvoaLab />}
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

function Navbar({ tab, setTab, stats, menuOpen, onToggleMenu }) {
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
      <button
        className="nav-burger"
        onClick={onToggleMenu}
        aria-label="Toggle navigation menu"
        aria-expanded={menuOpen}
        aria-controls="mobile-nav"
      >
        {menuOpen ? '✕' : '☰'}
      </button>
    </header>
  );
}

function NavMenu({ tab, setTab, open }) {
  return (
    <nav className={`nav-mobile${open ? ' open' : ''}`} id="mobile-nav" aria-label="Mobile navigation">
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
      <a
        className="nav-repo nav-mobile-repo"
        href="https://github.com/muhammadmuhtasim/novochar"
        target="_blank"
        rel="noreferrer"
      >
        <svg className="nav-repo-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.09-.745.083-.729.083-.729 1.205.084 1.84 1.237 1.84 1.237 1.07 1.834 2.807 1.304 3.492.997.108-.775.418-1.305.762-1.605-2.665-.3-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.536-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.655 1.652.243 2.873.12 3.176.77.84 1.235 1.91 1.235 3.221 0 4.609-2.807 5.628-5.479 5.921.43.372.823 1.102.823 2.222 0 1.606-.015 2.903-.015 3.293 0 .322.216.694.825.576C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
          />
        </svg>
        GITHUB ↗
      </a>
    </nav>
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