import React, { useMemo, useState } from 'react';
import ScatterPlot from './ScatterPlot.jsx';
import { colourIndex } from '../lib/celestial.js';

const TYPE_COLORS = {
  TNO: '#ff8c1a',
  AST: '#27d4e6',
  HPM: '#ff5fc2',
};
const color = (o) => TYPE_COLORS[o.type] || '#ff8c1a';

const TABLE_COLS = [
  { key: 'id', label: 'ID', sort: (o) => o.id },
  { key: 'type', label: 'TYPE', sort: (o) => o.type },
  { key: 'mag', label: 'MAG', sort: (o) => o.mag },
  { key: 'motion', label: 'MOTION', sort: (o) => o.motion },
  { key: 'snr', label: 'SNR', sort: (o) => o.snr },
  { key: 'nBands', label: 'BANDS', sort: (o) => o.nBands },
  { key: 'band', label: 'DOMINANT BAND', sort: (o) => o.bandIndex },
  { key: 'status', label: 'STATUS', sort: (o) => o.status },
];

/**
 * Co-ordinated analysis panel for the sky viewer: a colour-colour diagram and a
 * magnitude-vs-motion ("reduced proper motion") diagram plus a sortable table,
 * all sharing one selection/brush state with the map.
 */
export default function SkyAnalysis({ objects, selectedId, onSelect, highlight, onBrush }) {
  const [sortKey, setSortKey] = useState('motion');
  const [dir, setDir] = useState(-1);

  const ccPoints = useMemo(
    () =>
      objects
        .map((o) => {
          const x = colourIndex(o, 1, 3); // B1 - B3
          const y = colourIndex(o, 4, 6); // B4 - B6
          return x == null || y == null ? null : { o, x, y, color: color(o) };
        })
        .filter(Boolean),
    [objects]
  );

  const mmPoints = useMemo(
    () =>
      objects
        .map((o) => ({
          o,
          x: Math.log10(Math.max(o.motion || 0.01, 0.01)), // reduced plot: log motion
          y: o.mag,
          color: color(o),
        })),
    [objects]
  );

  const rows = useMemo(() => {
    const col = TABLE_COLS.find((c) => c.key === sortKey);
    const sorted = [...objects].sort((a, b) => {
      const va = col.sort(a); const vb = col.sort(b);
      if (typeof va === 'string') return va.localeCompare(vb) * dir;
      return ((va - vb) || 0) * dir;
    });
    return sorted;
  }, [objects, sortKey, dir]);

  const toggleSort = (key) => {
    if (key === sortKey) setDir((d) => -d);
    else { setSortKey(key); setDir(key === 'motion' ? -1 : 1); }
  };

  const pick = (o) => {
    onSelect(o);
    // Selecting a point should not leave stale brush highlights behind.
    onBrush(new Set());
  };

  return (
    <section className="analysis-grid">
      <ScatterPlot
        title="COLOUR–COLOUR · SPHEREx BAND RATIOS"
        xLabel="B1 − B3 (mag)"
        yLabel="B4 − B6 (mag)"
        points={ccPoints}
        selectedId={selectedId}
        highlightIds={highlight}
        onPick={pick}
        onBrush={onBrush}
      />
      <ScatterPlot
        title="MAGNITUDE vs MOTION · REDUCED PROPER MOTION"
        xLabel="log₁₀ motion (mas/day)"
        yLabel="Apparent magnitude"
        points={mmPoints}
        selectedId={selectedId}
        highlightIds={highlight}
        onPick={pick}
        onBrush={onBrush}
      />

      <section className="panel-sub analysis-table">
        <div className="panel-head">
          <h3>SORTABLE TABLE</h3>
          <span className="tag">{rows.length} OBJECTS</span>
        </div>
        <div className="table-scroll">
          <table className="catalogue-table">
            <thead>
              <tr>
                {TABLE_COLS.map((c) => (
                  <th key={c.key} onClick={() => toggleSort(c.key)}>
                    {c.label}
                    {sortKey === c.key ? (dir === -1 ? ' ↓' : ' ↑') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => {
                const sel = selectedId === o.id;
                const hi = highlight && highlight.size > 0 && highlight.has(o.id);
                const dimmed = highlight && highlight.size > 0 && !hi && !sel;
                return (
                  <tr
                    key={o.id}
                    className={`${sel ? 'row-sel' : ''} ${hi ? 'row-hi' : ''} ${dimmed ? 'row-dim' : ''}`}
                    onClick={() => pick(o)}
                  >
                    <td>{o.id}</td>
                    <td>{o.type}</td>
                    <td>{o.mag}</td>
                    <td>{o.motion}</td>
                    <td>{o.snr}</td>
                    <td>{o.nBands}</td>
                    <td>{o.bandIndex}</td>
                    <td>{o.status}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}