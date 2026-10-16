import React, { useEffect, useMemo, useState } from 'react';

import { api } from '../lib/api.js';
import { VIEW_FRAMES } from '../lib/observe/frame.js';
import { createObserveScene, selectionViews, withViewFrame } from '../lib/observe/scene.js';
import { starArtifactMeta, starArtifactToRows } from '../lib/observe/source.js';
import ObserveMap2D from './ObserveMap2D.jsx';
import ObserveSphere3D from './ObserveSphere3D.jsx';

// Mode B — Observe: a linked 2D Mollweide map and 3D celestial sphere over one
// canonical star catalogue. Both renderers are handed the SAME observe scene, so
// selection is a single stable record id shared with each other and with the
// rest of the app (through `selectedId` / `onSelect`). The frame toggle re-derives
// both views from the same catalogue via the shared frame adapter; no view
// re-implements a frame transform.

const FRAME_OPTIONS = [
  { id: VIEW_FRAMES.ICRS, label: 'ICRS' },
  { id: VIEW_FRAMES.GALACTIC, label: 'GALACTIC' },
];

function degrees(value) {
  return Number.isFinite(value) ? `${value.toFixed(4)}°` : '—';
}

function TargetReadout({ views, viewFrame }) {
  const { record, sky } = views;
  const extras = record.extras ?? {};
  const lonLabel = viewFrame === VIEW_FRAMES.GALACTIC ? 'GALACTIC l' : 'RA';
  const latLabel = viewFrame === VIEW_FRAMES.GALACTIC ? 'GALACTIC b' : 'DEC';
  return (
    <div className="observe-target">
      <div className="target-info">
        <span className="obj-type">{extras.type || 'STAR'}</span>
        <div className="target-title">
          <h3>{record.name || record.id}</h3>
          <span className="muted sm">{record.id}</span>
        </div>
      </div>
      <dl className="kv inline">
        <div><dt>RA (ICRS)</dt><dd>{degrees(record.ra)}</dd></div>
        <div><dt>DEC (ICRS)</dt><dd>{degrees(record.dec)}</dd></div>
        <div><dt>{lonLabel}</dt><dd>{degrees(sky.lonDeg)}</dd></div>
        <div><dt>{latLabel}</dt><dd>{degrees(sky.latDeg)}</dd></div>
        <div><dt>V MAG</dt><dd>{Number.isFinite(record.mag) ? record.mag.toFixed(2) : '—'}</dd></div>
        <div><dt>SPECTRAL</dt><dd>{extras.spectralType || '—'}</dd></div>
      </dl>
      <p className="muted caption">
        Resolved in both views from one scene: the point is {views.map ? 'on' : 'off'} the Mollweide map and its
        sphere direction is shared with the 3D view.
      </p>
    </div>
  );
}

export default function Observe({ selectedId = null, onSelect = () => {} }) {
  const [artifact, setArtifact] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [viewFrame, setViewFrame] = useState(VIEW_FRAMES.ICRS);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError('');
    api
      .stars()
      .then((data) => {
        if (cancelled) return;
        if (!Array.isArray(data?.stars) || data.stars.length === 0) {
          throw new Error('Star catalog response contained no stars');
        }
        setArtifact(data);
        setStatus('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setArtifact(null);
        setError(err?.message || 'Unable to load the star catalog');
        setStatus('error');
      });
    return () => { cancelled = true; };
  }, [reload]);

  // One canonical scene built from the artifact; the frame toggle re-projects it.
  const baseScene = useMemo(() => {
    if (!artifact) return null;
    return createObserveScene(starArtifactToRows(artifact), {
      projection: 'mollweide',
      source: 'stars',
      meta: starArtifactMeta(artifact),
    });
  }, [artifact]);

  const scene = useMemo(
    () => (baseScene && viewFrame !== baseScene.viewFrame ? withViewFrame(baseScene, viewFrame) : baseScene),
    [baseScene, viewFrame],
  );

  const selected = useMemo(() => (scene ? selectionViews(scene, selectedId) : null), [scene, selectedId]);

  if (status === 'loading') {
    return <div className="module-loading" role="status" aria-live="polite">Loading star catalogue…</div>;
  }

  if (status === 'error') {
    return (
      <section className="panel">
        <div className="panel-head"><h2>OBSERVE</h2><span className="tag">ERROR</span></div>
        <p className="err">{error}</p>
        <button className="btn primary sm" onClick={() => setReload((n) => n + 1)}>Retry</button>
      </section>
    );
  }

  const stats = scene.catalog.stats;
  const firstIssue = scene.catalog.issues[0];

  return (
    <>
      <section className="sky-toolbar" aria-label="Observe view controls">
        <div className="tb-group">
          <span className="tb-label">VIEW FRAME</span>
          <div className="seg-view" role="group" aria-label="View frame">
            {FRAME_OPTIONS.map((frame) => (
              <button
                key={frame.id}
                className={`seg${viewFrame === frame.id ? ' on' : ''}`}
                aria-pressed={viewFrame === frame.id}
                onClick={() => setViewFrame(frame.id)}
              >
                {frame.label}
              </button>
            ))}
          </div>
        </div>
        <div className="tb-group">
          <span className="tb-label">PROJECTION</span>
          <span className="muted">{scene.projection.name}</span>
        </div>
        <div className="tb-spacer" />
        <div className="tb-group">
          <span className="tb-label">{stats.accepted} / {stats.rows} OBJECTS</span>
        </div>
      </section>

      {stats.rejected > 0 && (
        <p className="muted caption">
          {stats.rejected} row{stats.rejected === 1 ? '' : 's'} rejected by the catalog frame policy
          {firstIssue ? ` (first reason: ${firstIssue.reason})` : ''}. Coordinates are never reinterpreted.
        </p>
      )}

      {stats.accepted === 0 ? (
        <section className="panel">
          <div className="panel-head"><h2>NO OBSERVABLE OBJECTS</h2><span className="tag">FRAME POLICY</span></div>
          <p className="muted">
            The catalog rejected every row, so there is nothing to project. This is the frame policy working as
            intended: a source must declare ICRS, and any other frame must be converted before it reaches Observe.
          </p>
        </section>
      ) : (
        <div className="observe-grid">
          <section className="panel observe-panel">
            <div className="panel-head">
              <h2>MOLLWEIDE MAP</h2>
              <span className="tag">2D · {viewFrame.toUpperCase()}</span>
            </div>
            <ObserveMap2D scene={scene} selectedId={selectedId} onSelect={onSelect} />
          </section>

          <section className="panel observe-panel">
            <div className="panel-head">
              <h2>CELESTIAL SPHERE</h2>
              <span className="tag">3D · {viewFrame.toUpperCase()}</span>
            </div>
            <ObserveSphere3D scene={scene} selectedId={selectedId} onSelect={onSelect} />
          </section>

          <section className="panel observe-wide">
            <div className="panel-head">
              <h2>TARGET</h2>
              <span className="tag">SHARED SELECTION</span>
            </div>
            {selected ? (
              <TargetReadout views={selected} viewFrame={viewFrame} />
            ) : (
              <p className="muted">
                Click an object in the map or the sphere. The selection is one stable object id, so it appears in
                both views at once.
              </p>
            )}
          </section>
        </div>
      )}
    </>
  );
}
