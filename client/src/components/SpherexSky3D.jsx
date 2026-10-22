// SPHEREx 3D — the four-epoch, full-sky timeline explorer.
//
// This is the presentation layer for the HEALPix tile pyramid in
// server/spherex/sky-tiles.js. The scientific status is deliberately explicit:
//
//   * the global four-epoch layer is an ILLUSTRATIVE prototype, not an archive
//     measurement;
//   * the two real reprojected NEP observations remain the validated detail
//     layer in the SPHEREx FIELD tab;
//   * the change candidates are prototype rendering targets, not variability or
//     motion detections.
//
// Performance is treated as part of the contract: progressive base-then-detail
// loading, worker decode, an LRU texture budget, adaptive pixel ratio, on-demand
// rendering and a reduced path on constrained devices.

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

export default function SpherexSky3D({ onOpenField } = {}) {
  const quality = useMemo(() => browserQuality(), []);
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const engineRef = useRef(null);
  const sourcesRef = useRef(null);

  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);
  const [meta, setMeta] = useState(null);
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

  const epochs = meta?.epochs ?? [];
  const activeEpoch = epochs[epochIndex] ?? null;
  const selectedCandidate = useMemo(
    () => sources?.candidates?.find((candidate) => candidate.id === selectedSourceId) ?? null,
    [sources, selectedSourceId],
  );
  const selectedMeasurement = measurementFor(selectedCandidate, epochIndex);

  // --- data -----------------------------------------------------------------

  useEffect(() => {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let alive = true;
    setStatus('loading');
    setError(null);
    setMeta(null);
    setSources(null);
    setEngineReady(false);
    setRuntimeError(null);
    setTileWarning(null);
    setSelectedSourceId(null);
    setEpochIndex(0);
    setPlaying(false);

    Promise.all([
      api.spherexSkyIndex({ signal: controller?.signal }),
      api.spherexSkySources({ signal: controller?.signal }),
    ])
      .then(([index, sourceData]) => {
        if (!alive) return;
        setMeta(index);
        setSources(sourceData);
        sourcesRef.current = sourceData;
        setStatus('ready');
      })
      .catch((reason) => {
        if (!alive || reason?.name === 'AbortError') return;
        setError(reason);
        setStatus('error');
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
        onReady: () => setEngineReady(true),
        onError: (warning) => setTileWarning(warning),
      });
    } catch (reason) {
      setRuntimeError({
        code: reason?.message?.includes('WebGL2') ? 'webgl2' : 'engine',
        message: String(reason?.message || reason),
      });
      return undefined;
    }

    engineRef.current = engine;
    if (sourcesRef.current) engine.setSources(sourcesRef.current);
    engine.setShowSources(showSources);

    return () => {
      if (engineRef.current === engine) engineRef.current = null;
      engine.dispose();
    };
  }, [meta, quality]);

  useEffect(() => {
    if (sources) engineRef.current?.setSources(sources);
  }, [sources]);

  // The engine already started on epoch 0; this only forwards later changes.
  const firstEpochEffect = useRef(true);
  useEffect(() => {
    if (firstEpochEffect.current) {
      firstEpochEffect.current = false;
      return;
    }
    engineRef.current?.setEpoch(epochIndex);
  }, [epochIndex]);

  useEffect(() => {
    engineRef.current?.setShowSources(showSources);
  }, [showSources]);

  useEffect(() => {
    engineRef.current?.selectSource(selectedSourceId);
  }, [selectedSourceId]);

  useEffect(() => {
    if (!playing || !meta?.epochs?.length) return undefined;
    const interval = window.setInterval(() => {
      setEpochIndex((index) => (index + 1) % meta.epochs.length);
    }, Math.max(900, quality.autoPlay ? 1500 : 1800));
    return () => window.clearInterval(interval);
  }, [playing, meta, quality.autoPlay]);

  // --- interactions ----------------------------------------------------------

  const handleSelectCandidate = useCallback((candidate) => {
    if (!candidate) return;
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
  }, [selectedSourceId, epochIndex]);

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
          Loading the four-epoch sky index and tile contract…
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="spherex sky3d">
        <div className="module-error" role="alert">
          <p>Could not load the 3D sky index</p>
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

  const sourceCount = sources?.candidates?.length ?? 0;
  const activeCandidates = sources?.candidates?.filter(
    (candidate) => measurementFor(candidate, epochIndex)?.visible,
  ).length ?? 0;

  return (
    <div className="spherex sky3d">
      <section className="panel sky3d-panel">
        <div className="panel-head sky3d-head">
          <div>
            <p className="sky3d-eyebrow">SPHEREx / GLOBAL SKY</p>
            <h2>Four-epoch 3D sky</h2>
            <div className="sky3d-badges">
              <span className="tag warn">ILLUSTRATIVE GLOBAL LAYER</span>
              <span className="sky3d-badge">HEALPix NEST</span>
              <span className="sky3d-badge">WEBGL2</span>
              <span className="sky3d-badge">{quality.tier.toUpperCase()} PATH</span>
            </div>
          </div>
          <div className="sky3d-head-actions">
            <button className="btn sm" onClick={handleReset}>RESET VIEW</button>
            <button
              className="btn sm"
              onClick={() => setShowSources((value) => !value)}
              aria-pressed={showSources}
            >
              {showSources ? 'HIDE CANDIDATES' : 'SHOW CANDIDATES'}
            </button>
            {onOpenField && (
              <button className="btn primary sm" onClick={onOpenField}>
                REAL NEP FIELD ↗
              </button>
            )}
          </div>
        </div>

        <p className="sky3d-lede">
          A real-time sphere with four illustrative epoch layers, driven by the timeline below.
          The whole sky is covered at low resolution first; finer HEALPix patches
          stream in only around the view. {meta.notice}
        </p>

        <div className="sky3d-layout">
          <div className="sky3d-stage" ref={stageRef}>
            <canvas
              ref={canvasRef}
              className="sky3d-canvas"
              tabIndex={0}
              role="application"
              aria-label="Interactive 3D sky. Drag to look around, scroll to zoom, and use the epoch timeline below."
              aria-describedby="sky3d-help"
            />

            <div className="sky3d-hud sky3d-hud-top" aria-hidden="true">
              <div className="sky3d-readout">
                <div><span>RA</span><strong>{fmtRA(view.ra)}</strong></div>
                <div><span>DEC</span><strong>{fmtDec(view.dec)}</strong></div>
                <div><span>FOV</span><strong>{view.fov.toFixed(1)}°</strong></div>
                <div><span>DETAIL</span><strong>L{view.order}</strong></div>
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
              DRAG TO LOOK · SCROLL / PINCH TO ZOOM · ARROW KEYS TO NAVIGATE ·
              CLICK A CANDIDATE TO INSPECT
            </p>

            {!engineReady && !runtimeError && (
              <div className="sky3d-overlay sky3d-loading" role="status" aria-live="polite">
                <span className="sky3d-spinner" aria-hidden="true" />
                <strong>Loading the first epoch</strong>
                <span>Base texture, then HEALPix detail tiles</span>
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
                Some epoch imagery failed to load ({tileWarning.message}). The view remains usable;
                switch epoch or retry to fetch it again.
              </div>
            )}

            <div className="sky3d-timeline">
              <button
                className={`sky3d-play${playing ? ' on' : ''}`}
                onClick={() => setPlaying((value) => !value)}
                aria-pressed={playing}
                aria-label={playing ? 'Pause the epoch timeline' : 'Play the epoch timeline'}
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
                  aria-label="Epoch timeline"
                  aria-valuetext={activeEpoch ? `${activeEpoch.label}, ${pct(activeEpoch.coverage)} coverage` : undefined}
                  style={{ '--timeline-progress': `${epochs.length > 1 ? (epochIndex / (epochs.length - 1)) * 100 : 0}%` }}
                />
                <div className="sky3d-stops">
                  {epochs.map((epoch, index) => (
                    <button
                      key={epoch.id}
                      className={`sky3d-stop${index === epochIndex ? ' on' : ''}`}
                      onClick={() => handleEpoch(index)}
                      aria-pressed={index === epochIndex}
                      title={`${epoch.label} · ${pct(epoch.coverage, 1)} coverage · ${epoch.status}`}
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
                <span>{pct(activeEpoch?.coverage, 1)} SKY</span>
                <span>{activeCandidates} CANDIDATES</span>
              </div>
            </div>
          </div>

          <aside className="sky3d-sidebar" aria-label="Epoch and candidate details">
            <div className="sky3d-card">
              <div className="sky3d-card-head">
                <h3>ACTIVE EPOCH</h3>
                <span className="sky3d-card-tag" style={{ '--epoch-accent': activeEpoch?.accent }}>
                  {activeEpoch?.status}
                </span>
              </div>
              <div className="sky3d-epoch-title">
                <strong>{activeEpoch?.label}</strong>
                <span>{activeEpoch?.campaign}</span>
              </div>
              <dl className="sky3d-kv">
                <div><dt>Coverage</dt><dd>{pct(activeEpoch?.coverage, 1)}</dd></div>
                <div><dt>Detail order</dt><dd>L{view.order}</dd></div>
                <div><dt>Tile scheme</dt><dd>HEALPix NEST</dd></div>
                <div><dt>Status</dt><dd>Illustrative prototype</dd></div>
              </dl>
              {activeEpoch?.realDetail && (
                <div className="sky3d-real-note">
                  <span className="tag live">REAL NEP DETAIL</span>
                  <p>{activeEpoch.realDetailLabel} is available as a validated reprojection in SPHEREx FIELD.</p>
                  {onOpenField && (
                    <button className="btn sm" onClick={onOpenField}>OPEN REAL FIELD ↗</button>
                  )}
                </div>
              )}
            </div>

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

            <div className="sky3d-card">
              <div className="sky3d-card-head">
                <h3>STREAMING BUDGET</h3>
                <span className="sky3d-card-tag">LIVE</span>
              </div>
              <dl className="sky3d-kv">
                <div><dt>Textures</dt><dd>{stats?.tiles?.textures ?? 0} / {quality.maxTextures}</dd></div>
                <div><dt>Texture memory</dt><dd>{bytes(stats?.tiles?.bytes)}</dd></div>
                <div><dt>Queued / active</dt><dd>{stats?.loader?.queued ?? 0} / {stats?.loader?.active ?? 0}</dd></div>
                <div><dt>Workers</dt><dd>{stats?.loader?.workers ?? quality.workerCount}</dd></div>
                <div><dt>Pixel ratio</dt><dd>{stats?.pixelRatio?.toFixed(2) ?? quality.pixelRatioCap}×</dd></div>
                <div><dt>Max detail</dt><dd>L{stats?.maxOrder ?? quality.maxOrder}</dd></div>
                <div><dt>Loaded tiles</dt><dd>{stats?.tiles?.loaded ?? 0}</dd></div>
                <div><dt>Failed tiles</dt><dd>{stats?.tiles?.failed ?? 0}</dd></div>
              </dl>
              <p className="sky3d-card-note">
                Base coverage first, then detail near the view. Textures are
                evicted least-recently-used under the device budget; rendering
                pauses when nothing changes.
              </p>
            </div>

            <div className="sky3d-card sky3d-provenance">
              <div className="sky3d-card-head">
                <h3>WHAT IS REAL HERE?</h3>
                <span className="sky3d-card-tag warn">READ ME</span>
              </div>
              <div className="sky3d-real-grid">
                <div>
                  <span className="tag warn">THIS VIEW</span>
                  <p>Deterministic illustrative tiles: full-sky coverage, four epoch identities and prototype change candidates.</p>
                </div>
                <div>
                  <span className="tag live">VALIDATED</span>
                  <p>Two real reprojected SPHEREx NEP observations on one agreed grid in the SPHEREx FIELD tab.</p>
                </div>
              </div>
              <p className="sky3d-card-note">
                No epoch-to-epoch subtraction, variability claim or motion
                measurement is computed here. The field view remains the source
                of truth for the real products.
              </p>
              {onOpenField && (
                <button className="btn sm" onClick={onOpenField}>OPEN VALIDATED FIELD →</button>
              )}
            </div>
          </aside>
        </div>

        <p className="sky3d-footnote">
          {sourceCount} prototype candidates · {epochs.length} epoch layers ·
          source measurements are rendered as GPU-instanced points; the sphere
          itself is a WebGL2 mesh with progressively loaded textures, not a
          pre-rendered image.
        </p>
      </section>
    </div>
  );
}
