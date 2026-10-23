// SPHEREx 3D — archive-backed regional observations plus a separate
// illustrative global timeline.
//
// Two data modes share one renderer:
//
//   * ARCHIVE: the two verified, reprojected NEP observations from the product
//     store. One tangent plane, one shared display stretch, no synthetic sky
//     and no change candidates. Every pixel outside the plane is no-data.
//   * ILLUSTRATIVE: the deterministic four-epoch HEALPix prototype. It is
//     labelled as a model everywhere; gaps are explicit no-data, never stars.
//
// Mode-specific labels and behaviour come from the active server index, so a
// future archive swap does not require rewriting the component.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, fmtRA, fmtDec } from '../lib/api.js';
import { skyQualityProfile } from '../lib/sky-tiles.js';
import { createSky3DEngine } from '../lib/sky3d-engine.js';

function browserQuality() {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return skyQualityProfile();
  return skyQualityProfile({
    deviceMemory: navigator.deviceMemory,
    hardwareConcurrency: navigator.hardwareConcurrency,
    saveData: Boolean(navigator.connection?.saveData),
    reducedMotion: Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches),
    mobile: Boolean(
      navigator.userAgentData?.mobile ||
      window.matchMedia?.('(pointer: coarse)')?.matches ||
      window.innerWidth < 760
    ),
  });
}

function bytes(value) {
  if (!Number.isFinite(value) || value <= 0) return '0 MB';
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(0)} kB`;
  return `${value} B`;
}

function pct(value, digits = 0) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : '—';
}

function measurementFor(candidate, epochIndex) {
  return candidate?.epochs?.find((epoch) => epoch.index === epochIndex) ?? null;
}

function StatusDot({ on, title }) {
  return (
    <span
      className={`sky3d-status-dot${on ? ' on' : ''}`}
      title={title}
      aria-label={title}
    />
  );
}

function Fact({ label, value, title }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div>
      <dt>{label}</dt>
      <dd title={title ?? String(value)}>{String(value)}</dd>
    </div>
  );
}

export default function SpherexSky3D({ onOpenField } = {}) {
  const quality = useMemo(() => browserQuality(), []);
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const engineRef = useRef(null);
  const sourcesRef = useRef(null);

  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);
  const [indexes, setIndexes] = useState({ archive: null, illustrative: null });
  const [mode, setMode] = useState('archive');
  const [sources, setSources] = useState(null);
  const [engineReady, setEngineReady] = useState(false);
  const [runtimeError, setRuntimeError] = useState(null);
  const [tileWarning, setTileWarning] = useState(null);
  const [epochIndex, setEpochIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [showSources, setShowSources] = useState(true);
  const [selectedSourceId, setSelectedSourceId] = useState(null);
  const [view, setView] = useState({ ra: 0, dec: 0, fov: 62, order: 1 });
  const [stats, setStats] = useState(null);

  const meta = indexes[mode] ?? null;
  const isArchive = meta?.mode === 'archive';
  const presentation = meta?.presentation ?? {};
  const epochs = meta?.epochs ?? [];
  const activeEpoch = epochs[epochIndex] ?? null;
  const selectedCandidate = useMemo(
    () => (isArchive ? null : sources?.candidates?.find((candidate) => candidate.id === selectedSourceId) ?? null),
    [isArchive, sources, selectedSourceId],
  );
  const selectedMeasurement = measurementFor(selectedCandidate, epochIndex);

  // --- data -----------------------------------------------------------------

  useEffect(() => {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let alive = true;
    setStatus('loading');
    setError(null);
    setIndexes({ archive: null, illustrative: null });
    setSources(null);
    sourcesRef.current = null;
    setEngineReady(false);
    setRuntimeError(null);
    setTileWarning(null);
    setSelectedSourceId(null);
    setEpochIndex(0);
    setPlaying(false);

    const settled = Promise.allSettled([
      api.spherexSkyArchive({ signal: controller?.signal }),
      api.spherexSkyIndex({ signal: controller?.signal }),
      api.spherexSkySources({ signal: controller?.signal }),
    ]);

    settled.then(([archiveResult, illustrativeResult, sourcesResult]) => {
      if (!alive) return;
      const nextIndexes = {
        archive: archiveResult.status === 'fulfilled' ? archiveResult.value : null,
        illustrative: illustrativeResult.status === 'fulfilled' ? illustrativeResult.value : null,
      };
      if (!nextIndexes.archive && !nextIndexes.illustrative) {
        const reason = archiveResult.status === 'rejected' ? archiveResult.reason : illustrativeResult.reason;
        if (reason?.name === 'AbortError') return;
        setError(reason);
        setStatus('error');
        return;
      }
      const nextSources = sourcesResult.status === 'fulfilled' ? sourcesResult.value : { candidates: [] };
      setIndexes(nextIndexes);
      setSources(nextSources);
      sourcesRef.current = nextSources;
      // Prefer the verified archive when it is available; the illustrative
      // global layer remains one explicit click away.
      setMode(nextIndexes.archive ? 'archive' : 'illustrative');
      setStatus('ready');
    });

    return () => {
      alive = false;
      controller?.abort();
    };
  }, [attempt]);

  useEffect(() => {
    sourcesRef.current = sources;
  }, [sources]);

  // --- engine ----------------------------------------------------------------

  useEffect(() => {
    if (!meta || !canvasRef.current || !stageRef.current) return undefined;
    let engine = null;
    try {
      engine = createSky3DEngine({
        canvas: canvasRef.current,
        wrap: stageRef.current,
        meta,
        quality,
        initialEpoch: 0,
        onStats: setStats,
        onView: setView,
        onSourceSelect: (candidate) => setSelectedSourceId(candidate?.id ?? null),
        onReady: () => {
          setEngineReady(true);
          // A successful active-epoch base (including a cached one) means the
          // previous failure banner is stale.
          setTileWarning(null);
        },
        onError: (warning) => {
          // The first epoch can fail before onReady; there is still a usable
          // placeholder/no-data view, so leave the loading overlay.
          setEngineReady(true);
          setTileWarning(warning);
        },
      });
    } catch (reason) {
      setRuntimeError({
        code: reason?.message?.includes('WebGL2') ? 'webgl2' : 'engine',
        message: String(reason?.message || reason),
      });
      return undefined;
    }

    engineRef.current = engine;
    const initialSources = isArchive ? { candidates: [] } : sourcesRef.current;
    if (initialSources) engine.setSources(initialSources);
    engine.setShowSources(!isArchive && showSources);

    return () => {
      if (engineRef.current === engine) engineRef.current = null;
      engine.dispose();
    };
  }, [meta, quality, isArchive]);

  useEffect(() => {
    if (!engineRef.current) return;
    if (isArchive) engineRef.current.setSources({ candidates: [] });
    else if (sources) engineRef.current.setSources(sources);
  }, [sources, isArchive]);

  useEffect(() => {
    engineRef.current?.setEpoch(epochIndex);
  }, [epochIndex, meta]);

  useEffect(() => {
    // A warning belongs to the epoch that produced it; do not carry it across
    // a timeline move (a new failure will raise a new warning).
    setTileWarning(null);
  }, [epochIndex]);

  useEffect(() => {
    engineRef.current?.setShowSources(!isArchive && showSources);
  }, [showSources, isArchive]);

  useEffect(() => {
    engineRef.current?.selectSource(isArchive ? null : selectedSourceId);
  }, [selectedSourceId, isArchive]);

  useEffect(() => {
    if (!playing || !meta?.epochs?.length) return undefined;
    const interval = window.setInterval(() => {
      setEpochIndex((index) => (index + 1) % meta.epochs.length);
    }, Math.max(1200, quality.autoPlay ? 1700 : 2100));
    return () => window.clearInterval(interval);
  }, [playing, meta, quality.autoPlay]);

  // --- interactions ----------------------------------------------------------

  const handleMode = useCallback((nextMode) => {
    if (nextMode !== 'archive' && nextMode !== 'illustrative') return;
    if (!indexes[nextMode]) return;
    setMode(nextMode);
    setEpochIndex(0);
    setSelectedSourceId(null);
    setPlaying(false);
    setTileWarning(null);
    setStats(null);
  }, [indexes]);

  const handleSelectCandidate = useCallback((candidate) => {
    if (!candidate || isArchive) return;
    if (candidate.id === selectedSourceId) {
      setSelectedSourceId(null);
      engineRef.current?.selectSource(null);
      return;
    }
    setSelectedSourceId(candidate.id);
    // Selecting a candidate records it everywhere; only move the camera when
    // it actually exists in the epoch currently on screen.
    if (measurementFor(candidate, epochIndex)?.visible) {
      engineRef.current?.focusSource(candidate.id);
    }
  }, [selectedSourceId, epochIndex, isArchive]);

  const handleEpoch = useCallback((index) => {
    setEpochIndex(index);
  }, []);

  const handleReset = useCallback(() => {
    engineRef.current?.resetView();
    setSelectedSourceId(null);
  }, []);

  const handleFocusSelected = useCallback(() => {
    if (selectedSourceId) engineRef.current?.focusSource(selectedSourceId);
  }, [selectedSourceId]);

  if (status === 'loading') {
    return (
      <div className="spherex sky3d">
        <div className="module-loading" role="status" aria-live="polite">
          Loading the verified archive and the illustrative sky contract…
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="spherex sky3d">
        <div className="module-error" role="alert">
          <p>Could not load the 3D sky data</p>
          <p className="module-error-detail">
            {error?.code ? `${error.code}: ` : ''}{error?.message || 'Unknown error'}
          </p>
          <div className="module-error-actions">
            <button className="btn primary sm" onClick={() => setAttempt((value) => value + 1)}>Retry</button>
          </div>
        </div>
      </div>
    );
  }

  const sourceCount = isArchive ? 0 : sources?.candidates?.length ?? 0;
  const activeCandidates = isArchive ? 0 : sources?.candidates?.filter(
    (candidate) => measurementFor(candidate, epochIndex)?.visible,
  ).length ?? 0;
  const warningEpoch = tileWarning?.epoch
    ? epochs.find((epoch) => epoch.id === tileWarning.epoch)
    : null;
  const coverageScope = activeEpoch?.coverageScope ?? (isArchive ? 'NEP grid pixels' : 'whole sky');
  const coverageLabel = activeEpoch?.coverageLabel ?? (isArchive ? 'valid NEP grid' : 'model sky');
  const detailReadout = isArchive ? 'NEP' : `L${view.order}`;
  const gateOn = Boolean(meta?.comparison?.quantitativeDifferenceEnabled);
  const baselineDays = meta?.dataset?.baselineDays;
  const display = meta?.display;

  return (
    <div className="spherex sky3d">
      <section className="panel sky3d-panel">
        <div className="panel-head sky3d-head">
          <div>
            <p className="sky3d-eyebrow">{presentation.eyebrow ?? 'SPHEREx / SKY'}</p>
            <h2>{presentation.title ?? '3D sky explorer'}</h2>
            <div className="sky3d-badges">
              <span className={`tag ${presentation.badgeTone === 'live' ? 'live' : 'warn'}`}>
                {presentation.badge ?? meta.mode.toUpperCase()}
              </span>
              <span className="sky3d-badge">{isArchive ? 'VERIFIED PRODUCTS' : 'HEALPix NEST'}</span>
              <span className="sky3d-badge">WEBGL2</span>
              <span className="sky3d-badge">{quality.tier.toUpperCase()} PATH</span>
            </div>
          </div>
          <div className="sky3d-head-actions">
            <button className="btn sm" onClick={handleReset}>RESET VIEW</button>
            {!isArchive && (
              <button
                className="btn sm"
                onClick={() => setShowSources((value) => !value)}
                aria-pressed={showSources}
              >
                {showSources ? 'HIDE CANDIDATES' : 'SHOW CANDIDATES'}
              </button>
            )}
            {onOpenField && (
              <button className="btn primary sm" onClick={onOpenField}>
                REAL NEP FIELD ↗
              </button>
            )}
          </div>
        </div>

        <div className="sky3d-mode-switch" role="tablist" aria-label="Sky data mode">
          <button
            role="tab"
            aria-selected={mode === 'archive'}
            className={`sky3d-mode${mode === 'archive' ? ' on' : ''}`}
            onClick={() => handleMode('archive')}
            disabled={!indexes.archive}
            title={indexes.archive
              ? 'Two verified QR2 observations of the NEP field'
              : 'The verified archive index is unavailable'}
          >
            <strong>NEP ARCHIVE</strong>
            <small>{indexes.archive?.epochs?.length ?? 2} verified observations · regional</small>
          </button>
          <button
            role="tab"
            aria-selected={mode === 'illustrative'}
            className={`sky3d-mode${mode === 'illustrative' ? ' on' : ''}`}
            onClick={() => handleMode('illustrative')}
            disabled={!indexes.illustrative}
            title={indexes.illustrative
              ? 'Deterministic four-epoch visualization prototype'
              : 'The illustrative index is unavailable'}
          >
            <strong>ILLUSTRATIVE</strong>
            <small>{indexes.illustrative?.epochs?.length ?? 4} model epochs · global</small>
          </button>
        </div>

        <p className="sky3d-lede">{presentation.lede ?? meta.notice}</p>
        <p className="sky3d-mode-notice">{meta.notice}</p>

        <div className="sky3d-layout">
          <div className="sky3d-stage" ref={stageRef}>
            <canvas
              ref={canvasRef}
              className="sky3d-canvas"
              tabIndex={0}
              role="application"
              aria-label={isArchive
                ? 'Interactive 3D view of two verified SPHEREx NEP observations. Drag to look around, scroll to zoom, and use the observation timeline below.'
                : 'Interactive 3D illustrative sky. Drag to look around, scroll to zoom, and use the epoch timeline below.'}
              aria-describedby="sky3d-help"
            />

            <div className="sky3d-hud sky3d-hud-top" aria-hidden="true">
              <div className="sky3d-readout">
                <div><span>RA</span><strong>{fmtRA(view.ra)}</strong></div>
                <div><span>DEC</span><strong>{fmtDec(view.dec)}</strong></div>
                <div><span>FOV</span><strong>{view.fov < 10 ? view.fov.toFixed(2) : view.fov.toFixed(1)}°</strong></div>
                <div><span>DETAIL</span><strong>{detailReadout}</strong></div>
              </div>
              <div className="sky3d-telemetry">
                <span>{stats?.fps ? `${stats.fps.toFixed(0)} FPS` : '— FPS'}</span>
                <span>{stats?.tiles?.textures ?? 0} TEX</span>
                <span>{stats?.loader?.queued ?? 0} QUEUED</span>
                <span>{stats?.pixelRatio?.toFixed(2) ?? quality.pixelRatioCap}× DPR</span>
              </div>
            </div>

            <div className="sky3d-reticle" aria-hidden="true">
              <span />
            </div>

            <p className="sky3d-hint" id="sky3d-help">
              {isArchive
                ? 'DRAG TO LOOK · SCROLL / PINCH TO ZOOM · USE THE TIMELINE TO SWITCH OBSERVATIONS'
                : 'DRAG TO LOOK · SCROLL / PINCH TO ZOOM · ARROW KEYS TO NAVIGATE · CLICK A CANDIDATE TO INSPECT'}
            </p>

            <div className="sky3d-legend" aria-label="Sky legend">
              <span><i className="sky3d-swatch observed" /> {presentation.observedLabel ?? 'OBSERVED'}</span>
              <span><i className="sky3d-swatch nodata" /> {presentation.noDataLabel ?? 'NO DATA'}</span>
              {isArchive && <span><i className="sky3d-swatch edge" /> REGION EDGE</span>}
            </div>

            {!engineReady && !runtimeError && (
              <div className="sky3d-overlay sky3d-loading" role="status" aria-live="polite">
                <span className="sky3d-spinner" aria-hidden="true" />
                <strong>{isArchive ? 'Loading the verified NEP archive' : 'Loading the first illustrative epoch'}</strong>
                <span>{isArchive
                  ? 'Decoding the real reprojected observation with the shared stretch'
                  : 'Base texture, then HEALPix detail tiles'}</span>
              </div>
            )}

            {runtimeError && (
              <div className="sky3d-overlay sky3d-fatal" role="alert">
                <strong>{runtimeError.code === 'webgl2' ? 'WebGL2 is not available' : 'The 3D view could not start'}</strong>
                <span>{runtimeError.message}</span>
                {onOpenField && (
                  <button className="btn primary sm" onClick={onOpenField}>OPEN THE VALIDATED FIELD VIEW</button>
                )}
              </div>
            )}

            {tileWarning && !runtimeError && (
              <div className="sky3d-warning" role="status">
                {warningEpoch ? `${warningEpoch.label} imagery` : 'Some sky imagery'} failed to load
                ({tileWarning.message}). The view remains usable; switch observation or retry to fetch it
                again.
              </div>
            )}

            <div className="sky3d-timeline">
              <button
                className={`sky3d-play${playing ? ' on' : ''}`}
                onClick={() => setPlaying((value) => !value)}
                aria-pressed={playing}
                aria-label={playing ? 'Pause the observation timeline' : 'Play the observation timeline'}
              >
                <span aria-hidden="true">{playing ? '❚❚' : '▶'}</span>
                {playing ? 'PAUSE' : 'PLAY'}
              </button>

              <div className="sky3d-track">
                <input
                  className="sky3d-range"
                  type="range"
                  min="0"
                  max={Math.max(0, epochs.length - 1)}
                  step="1"
                  value={epochIndex}
                  onChange={(event) => handleEpoch(Number(event.target.value))}
                  aria-label="Observation timeline"
                  aria-valuetext={activeEpoch
                    ? `${activeEpoch.label}, ${pct(activeEpoch.coverage)} ${coverageScope}`
                    : undefined}
                  style={{ '--timeline-progress': `${epochs.length > 1 ? (epochIndex / (epochs.length - 1)) * 100 : 0}%` }}
                />
                <div
                  className="sky3d-stops"
                  style={{ gridTemplateColumns: `repeat(${Math.max(1, epochs.length)}, minmax(0, 1fr))` }}
                >
                  {epochs.map((epoch, index) => (
                    <button
                      key={epoch.id}
                      className={`sky3d-stop${index === epochIndex ? ' on' : ''}`}
                      onClick={() => handleEpoch(index)}
                      aria-pressed={index === epochIndex}
                      title={`${epoch.label} · ${pct(epoch.coverage, 1)} ${epoch.coverageScope ?? coverageScope} · ${epoch.status}`}
                      style={{ '--epoch-accent': epoch.accent }}
                    >
                      <span className="sky3d-stop-dot" />
                      <strong>{epoch.shortLabel}</strong>
                      <small>{pct(epoch.coverage)}</small>
                    </button>
                  ))}
                </div>
              </div>

              <div className="sky3d-timeline-meta">
                <span>{activeEpoch?.label}</span>
                <span>{pct(activeEpoch?.coverage, 1)} {coverageLabel.toUpperCase()}</span>
                <span>{isArchive ? 'DIFFERENCE GATED' : `${activeCandidates} CANDIDATES`}</span>
              </div>
            </div>
          </div>

          <aside className="sky3d-sidebar" aria-label="Observation and data provenance details">
            <div className="sky3d-card">
              <div className="sky3d-card-head">
                <h3>{isArchive ? 'ACTIVE OBSERVATION' : 'ACTIVE EPOCH'}</h3>
                <span className="sky3d-card-tag" style={{ '--epoch-accent': activeEpoch?.accent }}>
                  {activeEpoch?.status}
                </span>
              </div>
              <div className="sky3d-epoch-title">
                <strong>{activeEpoch?.label}</strong>
                <span>{activeEpoch?.campaign}</span>
              </div>
              <dl className="sky3d-kv">
                {isArchive ? (
                  <>
                    <Fact label="Release" value={meta.release?.id} title={meta.release?.label} />
                    <Fact label="Observation" value={activeEpoch?.archive?.obs_id} />
                    <Fact label="Observed (UTC)" value={activeEpoch?.archive?.date_obs_utc ?? '—'} />
                    <Fact label="Detector" value={activeEpoch?.archive?.detector} />
                    <Fact label="Pipeline" value={activeEpoch?.archive?.pipeline_version} />
                    <Fact label="Units" value={activeEpoch?.units} />
                    <Fact label="Valid grid" value={pct(activeEpoch?.coverage, 2)} />
                    <Fact label="Grid coverage" value={pct(activeEpoch?.gridCoverage, 2)} />
                    <Fact label="Baseline" value={Number.isFinite(baselineDays) ? `${baselineDays.toFixed(1)} d` : null} />
                    <Fact label="Spatial alignment" value={meta.gate?.spatial_alignment ? 'ESTABLISHED' : 'NOT ESTABLISHED'} />
                  </>
                ) : (
                  <>
                    <Fact label="Coverage" value={pct(activeEpoch?.coverage, 1)} />
                    <Fact label="Detail order" value={`L${view.order}`} />
                    <Fact label="Tile scheme" value="HEALPix NEST" />
                    <Fact label="Status" value="Illustrative prototype" />
                  </>
                )}
              </dl>
              <p className="sky3d-card-note sky3d-epoch-note">{activeEpoch?.note}</p>
              {isArchive ? (
                <div className="sky3d-real-note">
                  <span className="tag live">VERIFIED ARCHIVE PRODUCT</span>
                  <p>
                    {meta.release?.label || 'SPHEREx archive'} · DOI {meta.release?.doi || '—'}.
                    The same reprojected pair remains available as the validated FIELD view.
                  </p>
                  {onOpenField && (
                    <button className="btn sm" onClick={onOpenField}>OPEN VALIDATED FIELD ↗</button>
                  )}
                </div>
              ) : activeEpoch?.realDetail ? (
                <div className="sky3d-real-note">
                  <span className="tag live">REAL NEP DETAIL</span>
                  <p>{activeEpoch.realDetailLabel} is available as a validated reprojection in SPHEREx FIELD.</p>
                  {onOpenField && (
                    <button className="btn sm" onClick={onOpenField}>OPEN REAL FIELD ↗</button>
                  )}
                </div>
              ) : null}
            </div>

            {isArchive ? (
              <div className="sky3d-card">
                <div className="sky3d-card-head">
                  <h3>COMPARISON GATE</h3>
                  <span className="sky3d-card-tag warn">
                    {gateOn ? 'ENABLED' : 'QUANTITATIVE OFF'}
                  </span>
                </div>
                <p className="sky3d-card-note">
                  Both observations sit on one reprojection grid and share one display stretch.
                  No difference image, variability statistic or motion result is computed or exposed.
                </p>
                <dl className="sky3d-kv">
                  <Fact label="Spatial alignment" value={meta.gate?.spatial_alignment ? 'ESTABLISHED' : 'NOT ESTABLISHED'} />
                  <Fact label="Quantitative difference" value={gateOn ? 'ENABLED' : 'DISABLED'} />
                  <Fact label="Shared stretch" value={display
                    ? `${Number(display.lo).toPrecision(4)} – ${Number(display.hi).toPrecision(4)}`
                    : '—'} />
                  <Fact label="Stretch method" value={display?.method ?? '—'} />
                  <Fact label="Valid samples" value={display?.sampleSize?.toLocaleString?.('en-US') ?? null} />
                </dl>
                <p className="sky3d-card-note">
                  {meta.comparison?.policy ?? 'A blink may show that something looks different; it cannot by itself establish variability.'}
                </p>
              </div>
            ) : (
              <div className="sky3d-card">
                <div className="sky3d-card-head">
                  <h3>CHANGE CANDIDATES</h3>
                  <label className="sky3d-toggle">
                    <input
                      type="checkbox"
                      checked={showSources}
                      onChange={(event) => setShowSources(event.target.checked)}
                    />
                    <span>OVERLAY</span>
                  </label>
                </div>
                <p className="sky3d-card-note">
                  Prototype movers, variables and transients. They exercise the
                  change-investigation layer; they are not measurements.
                </p>
                <div className="sky3d-source-list">
                  {(sources?.candidates ?? []).map((candidate) => {
                    const measurement = measurementFor(candidate, epochIndex);
                    const selected = candidate.id === selectedSourceId;
                    return (
                      <button
                        key={candidate.id}
                        className={`sky3d-source${selected ? ' on' : ''}${measurement?.visible ? '' : ' muted'}`}
                        onClick={() => handleSelectCandidate(candidate)}
                        aria-pressed={selected}
                      >
                        <span className="sky3d-source-dot" style={{ background: candidate.color }} />
                        <span className="sky3d-source-main">
                          <strong>{candidate.name}</strong>
                          <small>
                            {measurement?.visible
                              ? `${fmtRA(measurement.ra)} · ${fmtDec(measurement.dec)}`
                              : `not in ${activeEpoch?.shortLabel ?? 'this epoch'}`}
                          </small>
                        </span>
                        <span className="sky3d-source-kind">{candidate.kind}</span>
                        <span className="sky3d-source-epochs" aria-hidden="true">
                          {candidate.epochs.map((epoch) => (
                            <StatusDot
                              key={epoch.epoch}
                              on={epoch.visible}
                              title={`${epoch.epoch}: ${epoch.visible ? 'visible' : 'not visible'}`}
                            />
                          ))}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {selectedCandidate && (
                  <div className="sky3d-selected">
                    <div className="sky3d-selected-head">
                      <strong>{selectedCandidate.name}</strong>
                      <button className="sky3d-clear" onClick={() => setSelectedSourceId(null)}>CLEAR</button>
                    </div>
                    <table>
                      <thead>
                        <tr><th>EPOCH</th><th>RA</th><th>DEC</th><th>MAG</th></tr>
                      </thead>
                      <tbody>
                        {selectedCandidate.epochs.map((epoch) => (
                          <tr key={epoch.epoch} className={epoch.index === epochIndex ? 'on' : ''}>
                            <td>{epoch.index + 1}</td>
                            <td>{epoch.visible ? epoch.ra.toFixed(3) : '—'}</td>
                            <td>{epoch.visible ? epoch.dec.toFixed(3) : '—'}</td>
                            <td>{epoch.visible && epoch.mag !== null ? epoch.mag.toFixed(2) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="sky3d-selected-actions">
                      <button
                        className="btn sm"
                        onClick={handleFocusSelected}
                        disabled={!selectedMeasurement?.visible}
                      >
                        FOCUS IN THIS EPOCH
                      </button>
                      {selectedMeasurement?.visible && (
                        <span>
                          {fmtRA(selectedMeasurement.ra)} · {fmtDec(selectedMeasurement.dec)}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="sky3d-card">
              <div className="sky3d-card-head">
                <h3>STREAMING BUDGET</h3>
                <span className="sky3d-card-tag">LIVE</span>
              </div>
              <dl className="sky3d-kv">
                <Fact label="Mode" value={isArchive ? 'verified archive' : 'illustrative'} />
                <Fact label="Textures" value={`${stats?.tiles?.textures ?? 0} / ${quality.maxTextures}`} />
                <Fact label="Texture memory" value={bytes(stats?.tiles?.bytes)} />
                <Fact label="Queued / active" value={`${stats?.loader?.queued ?? 0} / ${stats?.loader?.active ?? 0}`} />
                <Fact label="Workers" value={stats?.loader?.workers ?? quality.workerCount} />
                <Fact label="Pixel ratio" value={`${stats?.pixelRatio?.toFixed(2) ?? quality.pixelRatioCap}×`} />
                <Fact label={isArchive ? 'Pixel scale' : 'Max detail'} value={isArchive
                  ? `${(Number(stats?.resolutionDeg) * 3600).toFixed(2)}″`
                  : `L${stats?.maxOrder ?? quality.maxOrder}`} />
                <Fact label="Loaded textures" value={stats?.tiles?.loaded ?? 0} />
                <Fact label="Failed tiles" value={stats?.tiles?.failed ?? 0} />
              </dl>
              <p className="sky3d-card-note">
                {isArchive
                  ? 'One texture per verified observation. The archive mode performs no HEALPix refinement because there is no fabricated all-sky coverage behind the region.'
                  : 'Base coverage first, then detail near the view. Textures are evicted least-recently-used under the device budget; rendering pauses when nothing changes.'}
              </p>
            </div>

            <div className="sky3d-card sky3d-provenance">
              <div className="sky3d-card-head">
                <h3>WHAT IS REAL HERE?</h3>
                <span className={`sky3d-card-tag ${isArchive ? '' : 'warn'}`}>
                  {isArchive ? 'VERIFIED' : 'READ ME'}
                </span>
              </div>
              <div className="sky3d-real-grid">
                {isArchive ? (
                  <>
                    <div>
                      <span className="tag live">THIS VIEW</span>
                      <p>
                        Two real reprojected SPHEREx QR2 observations of the NEP field, shown on one agreed
                        tangent plane with one shared display stretch. The rest of the sphere is no-data.
                      </p>
                    </div>
                    <div>
                      <span className="tag live">PROVENANCE</span>
                      <p>
                        {meta.dataset?.release?.id ?? 'QR2'} · {meta.epochs?.length ?? 0} observations ·
                        {' '}{Number.isFinite(baselineDays) ? `${baselineDays.toFixed(1)} day baseline` : 'baseline unavailable'}.
                        Source URLs, cutout SHA-256s and derived-output SHA-256s are recorded in the index.
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <span className="tag warn">THIS VIEW</span>
                      <p>Deterministic illustrative tiles: full-sky coverage, four epoch identities and prototype change candidates.</p>
                    </div>
                    <div>
                      <span className="tag live">VALIDATED</span>
                      <p>Two real reprojected SPHEREx NEP observations on one agreed grid in the SPHEREx FIELD tab.</p>
                    </div>
                  </>
                )}
              </div>
              <p className="sky3d-card-note">
                {isArchive
                  ? 'Quantitative differences remain disabled. Inspecting two observations one at a time is not a variability or motion detection.'
                  : 'No epoch-to-epoch subtraction, variability claim or motion measurement is computed here. The field view remains the source of truth for the real products.'}
              </p>
              {onOpenField && (
                <button className="btn sm" onClick={onOpenField}>OPEN VALIDATED FIELD →</button>
              )}
            </div>
          </aside>
        </div>

        <p className="sky3d-footnote">
          {isArchive
            ? `${epochs.length} verified observations · one regional NEP tangent plane · shared display stretch · no synthetic epoch coverage`
            : `${sourceCount} prototype candidates · ${epochs.length} epoch layers · source measurements are rendered as GPU-instanced billboards; the sphere itself is a WebGL2 mesh with progressively loaded textures, not a pre-rendered image.`}
        </p>
      </section>
    </div>
  );
}
