import React, { useEffect, useMemo, useState } from 'react';

import { fromLightYears } from '@novochar/astro';
import { api } from '../lib/api.js';
import { VIEW_FRAMES } from '../lib/observe/frame.js';
import {
  DEFAULT_SHELL_VIEW,
  LAYER_META,
  LAYER_ORDER,
  SHELL_UNIT_OPTIONS,
  distanceNote,
  formatDistance,
  shellQueryParams,
  shellResultToRows,
  shellSceneMeta,
} from '../lib/observe/shell.js';
import { createObserveScene, selectionViews, withViewFrame } from '../lib/observe/scene.js';
import ObserveMap2D from './ObserveMap2D.jsx';
import ObserveSphere3D from './ObserveSphere3D.jsx';

// Mode B — Observe: a linked 2D Mollweide map and 3D celestial sphere over the
// Sun-centered shell query. The three layers are explicit and honest:
//
//   located    a usable distance that falls inside the band;
//   uncertain  distance evidence that overlaps the band but is not definite;
//   unknown    no usable distance — direction only, never an invented position.
//
// The band, the membership test and the classification all come from the server
// (which uses the shared @novochar/astro core); this component only owns the
// controls and hands one scene to both renderers, so the two views can never
// disagree about which object is which.

const FRAME_OPTIONS = [
  { id: VIEW_FRAMES.ICRS, label: 'ICRS' },
  { id: VIEW_FRAMES.GALACTIC, label: 'GALACTIC' },
];

const STATUS_LABEL = {
  located: 'LOCATED',
  uncertain: 'UNCERTAIN',
  unknown: 'UNKNOWN',
};

function degrees(value) {
  return Number.isFinite(value) ? `${value.toFixed(4)}°` : '—';
}

function parseBand(value, fallback) {
  const next = Number(value);
  return Number.isFinite(next) && next >= 0 ? next : fallback;
}

function ShellTarget({ views, viewFrame, unit }) {
  const { record, sky } = views;
  const extras = record.extras ?? {};
  const lonLabel = viewFrame === VIEW_FRAMES.GALACTIC ? 'GALACTIC l' : 'RA';
  const latLabel = viewFrame === VIEW_FRAMES.GALACTIC ? 'GALACTIC b' : 'DEC';
  const distance = formatDistance(extras, unit);
  const status = extras.status ?? null;
  return (
    <div className="observe-target">
      <div className="target-info">
        <span className="obj-type">{extras.type || 'OBJECT'}</span>
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
        <div><dt>SHELL</dt><dd>{status ? STATUS_LABEL[status] ?? status.toUpperCase() : '—'}</dd></div>
        <div><dt>DISTANCE</dt><dd>{distance ?? 'unknown (direction only)'}</dd></div>
        <div><dt>SOURCE</dt><dd>{extras.catalog || extras.source || '—'}</dd></div>
      </dl>
      <p className="muted caption">
        {distanceNote(extras) ||
          `Band membership comes from the shared shell predicate (${extras.reason || 'classified'}).`}
      </p>
    </div>
  );
}

export default function Observe({ selectedId = null, onSelect = () => {} }) {
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [viewFrame, setViewFrame] = useState(VIEW_FRAMES.ICRS);
  const [shell, setShell] = useState(DEFAULT_SHELL_VIEW);

  const layerKey = LAYER_ORDER.map((id) => (shell.layers[id] ? '1' : '0')).join('');

  useEffect(() => {
    let cancelled = false;
    setError('');
    const params = shellQueryParams(shell, { limit: 1000 });
    const timer = setTimeout(() => {
      api
        .shell(params)
        .then((data) => {
          if (cancelled) return;
          setResult(data);
          setStatus('ready');
        })
        .catch((err) => {
          if (cancelled) return;
          setError(err?.message || 'Unable to query the shell');
          setStatus('error');
        });
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `layerKey` collapses the three layer toggles into one dependency so the
    // effect does not re-run when an unrelated `shell` field changes identity.
  }, [shell.radius, shell.thickness, shell.unit, layerKey, reload]);

  const baseScene = useMemo(
    () => (result ? createObserveScene(shellResultToRows(result), {
      projection: 'mollweide',
      frame: 'icrs',
      source: 'shell',
      meta: shellSceneMeta(result),
    }) : null),
    [result],
  );

  const scene = useMemo(
    () => (baseScene && viewFrame !== baseScene.viewFrame ? withViewFrame(baseScene, viewFrame) : baseScene),
    [baseScene, viewFrame],
  );

  const selected = useMemo(() => (scene ? selectionViews(scene, selectedId) : null), [scene, selectedId]);

  if (status === 'loading' && !result) {
    return <div className="module-loading" role="status" aria-live="polite">Querying the shell…</div>;
  }

  if (status === 'error' && !result) {
    return (
      <section className="panel">
        <div className="panel-head"><h2>OBSERVE</h2><span className="tag">ERROR</span></div>
        <p className="err">{error}</p>
        <button className="btn primary sm" onClick={() => setReload((n) => n + 1)}>Retry</button>
      </section>
    );
  }

  const stats = result ? { accepted: shellResultToRows(result).length } : { accepted: 0 };
  const bounds = result?.bounds ?? null;
  const counts = result?.counts ?? null;
  const displayUnit = shell.unit;
  // Bounds come back in the canonical unit (ly); show them in the unit the user
  // chose, converting rather than relabelling.
  const band = bounds
    ? { lo: fromLightYears(bounds.rMin, displayUnit), hi: fromLightYears(bounds.rMax, displayUnit) }
    : null;
  const coverageNote = (result?.coverage ?? []).find((entry) => entry.status !== 'ok');

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
          <span className="tb-label">SHELL RADIUS</span>
          <input
            className="shell-number"
            type="number"
            min="0"
            step="1"
            value={shell.radius}
            aria-label="Shell mean radius"
            onChange={(event) => setShell((s) => ({ ...s, radius: parseBand(event.target.value, s.radius) }))}
          />
          <select
            className="select shell-select"
            value={shell.unit}
            aria-label="Distance unit"
            onChange={(event) => setShell((s) => ({ ...s, unit: event.target.value }))}
          >
            {SHELL_UNIT_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </div>
        <div className="tb-group">
          <span className="tb-label">THICKNESS</span>
          <input
            className="shell-number"
            type="number"
            min="0"
            step="1"
            value={shell.thickness}
            aria-label="Shell full thickness"
            onChange={(event) => setShell((s) => ({ ...s, thickness: parseBand(event.target.value, s.thickness) }))}
          />
          <span className="muted sm">{shell.unit}</span>
        </div>
        <div className="tb-group">
          <span className="tb-label">LAYERS</span>
          <div className="seg-view" role="group" aria-label="Distance layers">
            {LAYER_ORDER.map((id) => (
              <button
                key={id}
                className={`seg${shell.layers[id] ? ' on' : ''}`}
                aria-pressed={Boolean(shell.layers[id])}
                title={LAYER_META[id].note}
                onClick={() => setShell((s) => ({ ...s, layers: { ...s.layers, [id]: !s.layers[id] } }))}
              >
                {LAYER_META[id].label}
              </button>
            ))}
          </div>
        </div>
        <div className="tb-spacer" />
        <div className="tb-group">
          <span className="tb-label">BAND</span>
          <span className="muted sm">
            {band ? `${band.lo.toFixed(2)} – ${band.hi.toFixed(2)} ${displayUnit}` : '—'}
          </span>
        </div>
      </section>

      {(status === 'error' || coverageNote) && (
        <p className="err sm">
          {status === 'error' ? error : `Source warning: ${coverageNote.source} — ${coverageNote.error || 'unavailable'}.`}
        </p>
      )}

      {stats.accepted === 0 ? (
        <section className="panel">
          <div className="panel-head"><h2>EMPTY SHELL</h2><span className="tag">NO LAYER</span></div>
          <p className="muted">
            No records match this band and layer selection. Widen the radius or thickness, or enable the
            unknown/direction-only layer to see objects whose distance is not known.
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
              <h2>SHELL SPHERE</h2>
              <span className="tag">3D · {viewFrame.toUpperCase()}</span>
            </div>
            <ObserveSphere3D scene={scene} selectedId={selectedId} onSelect={onSelect} shell={bounds} />
          </section>

          <section className="panel observe-wide">
            <div className="panel-head">
              <h2>TARGET</h2>
              <span className="tag">SHARED SELECTION</span>
            </div>
            {selected ? (
              <ShellTarget views={selected} viewFrame={viewFrame} unit={displayUnit} />
            ) : (
              <p className="muted">
                Click an object in the map or the sphere. The selection is one stable object id, so it appears in
                both views at once.
              </p>
            )}
          </section>
        </div>
      )}

      {counts && (
        <p className="muted caption">
          {counts.returned} of {counts.members} matched records shown
          {' · '}
          {counts.located} located · {counts.uncertain} uncertain · {counts.unknown} unknown
          {counts.pending > 0 ? ` · ${counts.pending} more available` : ''}.
        </p>
      )}
    </>
  );
}
