import React, { useEffect, useRef, useState } from 'react';
import { api } from './lib/api.js';
import Logo from './components/Logo.jsx';
import Home from './components/Home.jsx';
import RetryableModule from './components/RetryableModule.jsx';

const loadSkyView = () => import('./components/SkyView.jsx');
const loadSpherexView = () => import('./components/SpherexView.jsx');
const loadBlinkView = () => import('./components/BlinkView.jsx');
const loadSearchView = () => import('./components/SearchView.jsx');
const loadDataSources = () => import('./components/DataSources.jsx');

const TAB_MODULES = {
  skyview: loadSkyView,
  spherexview: loadSpherexView,
  blinkview: loadBlinkView,
  search: loadSearchView,
  sources: loadDataSources,
};
const OBJECT_DATA_TABS = new Set(['blinkview', 'search']);

const TABS = [
  { id: 'home', label: 'MISSION', icon: '◉' },
  { id: 'skyview', label: 'SKY VIEW', icon: '⌖' },
  { id: 'spherexview', label: 'SPHEREx VIEW', icon: '▣' },
  { id: 'blinkview', label: 'BLINK VIEW', icon: '⧗' },
  { id: 'search', label: 'SEARCH', icon: '≋' },
  { id: 'sources', label: 'DATA SOURCES', icon: '☍' },
];

export default function App() {
  // Read the initial tab + selection from the URL exactly once.
  const [initial] = useState(initialRoute);
  const [tab, setTabRaw] = useState(initial.tab);
  const [stats, setStats] = useState(null);
  const [health, setHealth] = useState(null);
  const [objects, setObjects] = useState([]);
  const [objectsLoaded, setObjectsLoaded] = useState(false);
  // Cross-view selection. Views unmount whenever the tab changes, so "which
  // object is selected" lives here and is shared by the Sky Viewer, Blink
  // Comparator, Catalogue and Spectra — picking an object anywhere updates it.
  const [selectedId, setSelectedId] = useState(initial.id);
  const [menuOpen, setMenuOpen] = useState(false);
  const objectsRequest = useRef(null);

  // Mirror the active tab + selection into the URL hash (`#tab/id`) so deep
  // links, reloads and browser history restore the exact view.
  const writeHash = (t, id) => {
    try { location.hash = id ? `${t}/${id}` : t; } catch (_) {}
  };

  const setTab = (t) => {
    setTabRaw(t);
    setMenuOpen(false);
    writeHash(t, selectedId); // plain nav keeps the current selection
  };

  // Select (or clear, with `null`) the shared object and reflect it in the URL.
  const selectObject = (id) => {
    setSelectedId(id || null);
    writeHash(tab, id || null);
  };

  // Navigate to a tab and select a target candidate (presets / "open in" links).
  const goToTarget = (t, id) => {
    if (id) setSelectedId(id);
    setTabRaw(t);
    setMenuOpen(false);
    writeHash(t, id || selectedId);
  };

  const onHashChange = () => {
    const { tab: t, id } = parseHash(location.hash);
    if (TABS.some((x) => x.id === t)) {
      setTabRaw(t);
      setSelectedId(id);
    }
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
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    TAB_MODULES[tab]?.().catch(() => {});

    if (!OBJECT_DATA_TABS.has(tab) || objectsLoaded) return undefined;

    let current = true;
    objectsRequest.current ??= api.objects();
    objectsRequest.current
      .then((data) => {
        if (!current) return;
        setObjects(Array.isArray(data?.objects) ? data.objects : []);
        setObjectsLoaded(true);
      })
      .catch(() => {
        objectsRequest.current = null;
        if (current) setObjectsLoaded(true);
      });

    return () => { current = false; };
  }, [tab, objectsLoaded]);

  useEffect(() => {
    // Scroll reveal observer for panels and cards
    const REVEAL_SELECTOR = '.panel, .source-card, .obj-card, .kv div, .sed-chart, .chip';
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

    const watch = () => {
      document.querySelectorAll(REVEAL_SELECTOR).forEach((el) => observer.observe(el));
    };

    const timer = setTimeout(watch, 50);

    // Safety net: if IntersectionObserver ever fails to fire (edge cases / odd
    // layouts), force-reveal anything already on screen so content is never left
    // invisible ("loading forever"). Below-the-fold items still wait for scroll.
    const fallback = setTimeout(() => {
      const vh = window.innerHeight;
      document
        .querySelectorAll(REVEAL_SELECTOR)
        .forEach((el) => {
          if (!el.classList.contains('in-view') && el.getBoundingClientRect().top < vh) {
            el.classList.add('in-view');
          }
        });
    }, 1100);

    // Panels can also arrive after that sweep. The Sky Viewer's Explore /
    // Free-flight toggle swaps its panel in place without touching `tab`, so
    // nothing here would observe the replacement and it would stay parked at
    // the pre-reveal `opacity: 0` — an apparently blank view. Catch late
    // arrivals too, coalescing bursts of DOM churn to one pass per frame.
    let queued = false;
    const mutations = new MutationObserver((records) => {
      const arrived = records.some((record) =>
        [...record.addedNodes].some(
          (node) => node.nodeType === 1 && (node.matches(REVEAL_SELECTOR) || node.querySelector(REVEAL_SELECTOR))
        )
      );
      if (!arrived || queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        watch();
      });
    });
    mutations.observe(document.body, { childList: true, subtree: true });

    return () => {
      clearTimeout(timer);
      clearTimeout(fallback);
      mutations.disconnect();
      observer.disconnect();
    };
  }, [tab, selectedId, objects]);

  // Custom sci-fi targeting-reticle cursor. Disabled on coarse-pointer (touch)
  // and `prefers-reduced-motion` devices, where the native cursor is kept.
  useEffect(() => {
    const mm = (q) => window.matchMedia && window.matchMedia(q).matches;
    if (mm('(any-pointer: coarse)') || mm('(prefers-reduced-motion: reduce)')) return undefined;

    const make = (tag, cls) => {
      const el = document.createElement(tag);
      if (cls) el.setAttribute('class', cls);
      return el;
    };

    const cursor = make('div', 'nc-cursor');
    const dot = make('span', 'nc-cursor-dot');
    cursor.appendChild(dot);
    document.body.appendChild(cursor);
    document.documentElement.classList.add('nc-cursor-on');
    cursor.style.opacity = '0';

    let shown = false;
    let movementTimer = null;
    let clickTimer = null;
    let hoverRaf = 0;
    let hoverPending = false;
    let lastHoverEl = null;

    const INTERACTIVE =
      'a[href], button:not(:disabled), [role="button"], [role="link"], [tabindex]:not([tabindex="-1"]), ' +
      '.tab, .btn, .seg, .chip, .tag, summary, label, .obj-card, .source-card, select, ' +
      'input[type="checkbox"], input[type="radio"], [onclick], [data-clickable="true"]';
    const NONINTERACTIVE = 'body, main, section, article, header, footer, nav, div, p, h1, h2, h3, span';
    const TEXTISH =
      'textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="submit"]), select, [contenteditable="true"]';

    // Hit-testing (elementFromPoint + several closest() calls over long selector
    // lists) is the single most expensive thing a mousemove can trigger, so it
    // runs at most once per animation frame and short-circuits when the pointer
    // is still over the same element. The cursor transform itself is cheap and
    // stays immediate for zero added latency.
    const updateHover = () => {
      if (!shown) return;
      const el = document.elementFromPoint(pointer.x, pointer.y);
      if (el === lastHoverEl) return;
      lastHoverEl = el;
      if (!el) return;
      if (el.closest && (el.closest(TEXTISH) || el.closest('[contenteditable]'))) {
        cursor.classList.remove('busy');
        cursor.classList.remove('over-content');
        cursor.classList.add('hidden');
        return;
      }
      cursor.classList.remove('hidden');
      const clickable = el.closest && el.closest(INTERACTIVE);
      cursor.classList.toggle('busy', Boolean(clickable));
      cursor.classList.toggle('over-content', !clickable && Boolean(el.closest && el.closest(NONINTERACTIVE)));
    };
    const scheduleHover = () => {
      if (hoverPending) return;
      hoverPending = true;
      hoverRaf = requestAnimationFrame(() => {
        hoverPending = false;
        hoverRaf = 0;
        updateHover();
      });
    };
    const pointer = { x: -100, y: -100 };

    const onMove = (e) => {
      if (document.pointerLockElement) {
        hide();
        return;
      }
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      cursor.style.transform = `translate3d(${pointer.x}px, ${pointer.y}px, 0)`;
      if (!shown) {
        shown = true;
        cursor.style.opacity = '1';
      }
      cursor.classList.add('moving');
      clearTimeout(movementTimer);
      movementTimer = setTimeout(() => cursor.classList.remove('moving'), 110);
      scheduleHover();
    };
    const hide = () => {
      cursor.style.opacity = '0';
      shown = false;
      lastHoverEl = null;
      clearTimeout(movementTimer);
      clearTimeout(clickTimer);
      cursor.classList.remove('moving', 'busy', 'over-content', 'press', 'clicked', 'hidden');
    };
    const press = () => cursor.classList.add('press');
    const release = (e) => {
      cursor.classList.remove('press');
      if (e.button !== 0) return;
      cursor.classList.remove('clicked');
      void dot.offsetWidth;
      cursor.classList.add('clicked');
      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => cursor.classList.remove('clicked'), 420);
    };
    const onPointerLockChange = () => {
      if (document.pointerLockElement) hide();
    };

    document.addEventListener('mousemove', onMove, { passive: true });
    document.addEventListener('mouseleave', hide);
    document.addEventListener('mousedown', press);
    document.addEventListener('mouseup', release);
    document.addEventListener('pointerlockchange', onPointerLockChange);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseleave', hide);
      document.removeEventListener('mousedown', press);
      document.removeEventListener('mouseup', release);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      cancelAnimationFrame(hoverRaf);
      clearTimeout(movementTimer);
      clearTimeout(clickTimer);
      cursor.classList.remove('moving', 'busy', 'over-content', 'press', 'clicked', 'hidden');
      document.documentElement.classList.remove('nc-cursor-on');
      if (cursor.parentNode === document.body) cursor.remove();
    };
  }, []);

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
        {tab === 'home' && <Home stats={stats} health={health} onNavigate={setTab} />}
        {tab === 'skyview' && <RetryableModule loader={loadSkyView} label="Loading sky view…" componentProps={{ selectedId, onSelect: selectObject, onTarget: goToTarget }} />}
        {tab === 'spherexview' && <RetryableModule loader={loadSpherexView} label="Loading SPHEREx view…" />}
        {tab === 'blinkview' && (objectsLoaded
          ? <RetryableModule loader={loadBlinkView} label="Loading blink view…" componentProps={{ objects, selectedId, onSelect: selectObject, onTarget: goToTarget }} />
          : <ModuleLoading label="Loading survey objects…" />)}
        {tab === 'search' && (objectsLoaded
          ? <RetryableModule loader={loadSearchView} label="Loading search…" componentProps={{ objects, selectedId, onSelect: selectObject, onTarget: goToTarget }} />
          : <ModuleLoading label="Loading search data…" />)}
        {tab === 'sources' && <RetryableModule loader={loadDataSources} label="Loading data sources…" />}
      </main>
      <Ticker />
    </div>
  );
}

function ModuleLoading({ label = 'Loading module…' }) {
  return <div className="module-loading" role="status" aria-live="polite">{label}</div>;
}

function parseHash(hash) {
  const raw = (hash || '').replace(/^#/, '');
  const [tab, ...rest] = raw.split('/');
  return { tab: tab || '', id: rest.join('/') || null };
}

function initialRoute() {
  if (typeof location === 'undefined') return { tab: 'home', id: null };
  const { tab, id } = parseHash(location.hash);
  return { tab: TABS.some((x) => x.id === tab) ? tab : 'home', id };
}

function Navbar({ tab, setTab, stats, menuOpen, onToggleMenu }) {
  return (
    <header className="nav">
      <div className="nav-brand" onClick={() => setTab('home')}>
        <Logo size={52} />
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
