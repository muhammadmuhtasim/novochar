import React, { useState } from 'react';
import { fmtRA, fmtDec } from '../lib/api.js';

const FILTERS = ['ALL', 'TNO', 'AST', 'HPM'];
const STATUS = ['ALL', 'candidate', 'confirmed'];

export default function Catalogue({ objects }) {
  const [type, setType] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('id');
  const [dir, setDir] = useState(1);
  const [detail, setDetail] = useState(null);

  let list = objects;
  if (type !== 'ALL') list = list.filter((o) => o.type === type);
  if (status !== 'ALL') list = list.filter((o) => o.status === status);
  if (q) {
    const t = q.trim().toLowerCase();
    list = list.filter((o) => o.id.toLowerCase().includes(t) || o.name.toLowerCase().includes(t) || o.type.toLowerCase().includes(t));
  }
  list = [...list].sort((a, b) => {
    let va = a[sort], vb = b[sort];
    if (sort === 'mag' || sort === 'motion' || sort === 'ra' || sort === 'dec') { va = a[sort]; vb = b[sort]; }
    return (va < vb ? -1 : va > vb ? 1 : 0) * dir;
  });

  const toggle = (k) => {
    if (sort === k) setDir(-dir);
    else { setSort(k); setDir(1); }
  };
  const head = (k, label) => (
    <th onClick={() => toggle(k)} className={sort === k ? `sorted ${dir > 0 ? 'asc' : 'desc'}` : ''}>
      {label}
    </th>
  );

  return (
    <section className="catalogue">
      <div className="panel">
        <div className="panel-head">
          <h2>TRACKED OBJECT CATALOGUE</h2>
          <span className="tag">{list.length}/{objects.length} SHOWN</span>
        </div>

        <div className="toolbar">
          <span className="tb-label">CLASS</span>
          {FILTERS.map((f) => (
            <button key={f} className={`seg${type === f ? ' on' : ''}`} onClick={() => setType(f)}>{f}</button>
          ))}
          <span className="tb-spacer" />
          <span className="tb-label">STATUS</span>
          {STATUS.map((s) => (
            <button key={s} className={`seg${status === s ? ' on' : ''}`} onClick={() => setStatus(s)}>{s}</button>
          ))}
          <input
            className="search"
            placeholder="Filter ID / name / class…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <div className="table-scroll">
          <table className="catalogue-table">
            <thead>
              <tr>
                {head('id', 'ID')}
                {head('name', 'Designation')}
                {head('type', 'Class')}
                {head('ra', 'RA')}
                {head('dec', 'DEC')}
                {head('mag', 'Mag')}
                {head('motion', 'Motion (mas/d)')}
                {head('discovered', 'First Pass')}
                {head('status', 'Status')}
              </tr>
            </thead>
            <tbody>
              {list.map((o) => (
                <tr key={o.id} onClick={() => setDetail(detail && detail.id === o.id ? null : o)} className={detail && detail.id === o.id ? 'selected' : ''}>
                  <td className="mono">{o.id}</td>
                  <td>{o.name}</td>
                  <td><span className="chip-type" style={{ color: o.color }}>{o.type}</span></td>
                  <td className="mono">{fmtRA(o.ra)}</td>
                  <td className="mono">{fmtDec(o.dec)}</td>
                  <td>{o.mag}</td>
                  <td>{o.motion}</td>
                  <td className="mono">{o.discovered}</td>
                  <td><span className={`pill ${o.status}`}>{o.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.length === 0 && <div className="empty-table">No objects match the current filters.</div>}
        </div>
      </div>

      {detail && (
        <aside className="panel side detail-panel">
          <div className="panel-head">
            <h2>{detail.id} — {detail.name}</h2>
            <button className="btn sm" onClick={() => setDetail(null)}>✕</button>
          </div>
          <DetailCard o={detail} />
        </aside>
      )}
    </section>
  );
}

function DetailCard({ o }) {
  return (
    <div>
      <div className="target-title">
        <span className="obj-type" style={{ color: o.color }}>{o.type}</span>
        <span className="pill">{o.status}</span>
      </div>
      <dl className="kv stacked">
        <div><dt>RA</dt><dd className="mono">{fmtRA(o.ra)}</dd></div>
        <div><dt>DEC</dt><dd className="mono">{fmtDec(o.dec)}</dd></div>
        <div><dt>Apparent mag</dt><dd>{o.mag}</dd></div>
        <div><dt>Motion</dt><dd>{o.motion} {o.motionUnits}</dd></div>
        <div><dt>First pass</dt><dd>{o.discovered}</dd></div>
        <div><dt>Orbit a / e / i</dt><dd>{o.orbit.a} au · {o.orbit.e} · {o.orbit.i}°</dd></div>
      </dl>
      <div className="flags">
        {o.flags.map((f) => (
          <span className="tag" key={f}>{f}</span>
        ))}
      </div>
      <p className="muted note">{o.note}</p>
    </div>
  );
}