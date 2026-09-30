// Layer 1 - LIVE IVOA ARCHIVES.
//
// A real ingestion workbench against the live archive registry: connectivity
// probe, object-name resolution, ADQL TAP queries, table discovery, SIA image
// search and SSA spectral search. Every panel calls the live backend routes
// (server/ivoa/*) - no synthetic data. Archive status is whatever the live
// probe reports, never fabricated.

import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const TAP_ARCHIVES = ['vizier', 'simbad', 'gaia', 'eso', 'noirlab', 'irsa', 'heasarc'];
const SIA_ARCHIVES = ['noirlab', 'irsa', 'mast'];
const SSA_ARCHIVES = ['eso', 'mast', 'irsa'];

const PRESET_ADQL = {
  vizier: 'SELECT TOP 10 * FROM "I/345/gaia2"',
  simbad: 'SELECT TOP 10 main_id, ra, dec FROM basic',
  gaia: 'SELECT TOP 10 source_id, ra, dec FROM gaiaedr3.gaia_source',
  eso: 'SELECT TOP 10 * FROM dbo.raw',
  noirlab: 'SELECT TOP 10 * FROM TAP_SCHEMA.tables',
  irsa: 'SELECT ra, dec FROM fp_psc WHERE CONTAINS(POINT(ra,dec),CIRCLE(66.76957,26.10453,0.01))=1',
  heasarc: 'SELECT TOP 3 * FROM TAP_SCHEMA.tables',
};

function cell(v) {
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Number.isFinite(v) ? (Math.abs(v) > 1e6 || (v !== 0 && Math.abs(v) < 1e-4) ? v.toExponential(3) : String(Number(v.toFixed(4)))) : '—';
  const s = String(v);
  return s.length > 60 ? s.slice(0, 60) + '…' : s;
}

function ResultTable({ rows, fields, maxCols = 7, maxRows = 50 }) {
  if (!rows || rows.length === 0) return <div className="empty-table">0 rows returned — no data at this request.</div>;
  const keys = [];
  const seen = new Set();
  for (const r of rows) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); keys.push(k); }
  if (fields && fields.length) {
    const named = keys.filter((k) => fields.some((f) => f.name === k));
    const rest = keys.filter((k) => !named.includes(k));
    keys.length = 0; keys.push(...named.slice(0, maxCols), ...rest.slice(0, Math.max(0, maxCols - Math.min(named.length, maxCols))));
  } else keys.splice(maxCols);
  const body = rows.slice(0, maxRows);
  return (
    <div className="table-scroll">
      <table className="catalogue-table">
        <thead><tr>{keys.map((k) => <th key={k}>{k}</th>)}<th>·</th></tr></thead>
        <tbody>
          {body.map((r, i) => (
            <tr key={i}>{keys.map((k) => <td key={k} className="mono">{cell(r[k])}</td>)}<td /> </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusLine({ ok, status, count, error }) {
  return (
    <p className="muted">
      <span className={`pill ${ok ? 'confirmed' : 'candidate'}`}>{ok ? 'LIVE' : 'error'}</span>{' '}
      <span className="mono">status={status || 'n/a'} · {count} rows</span>
      {error && <span className="muted err"> — {error}</span>}
    </p>
  );
}

export default function IvoaLab() {
  // --- registry + probe ---
  const [registry, setRegistry] = useState(null);
  const [probe, setProbe] = useState(null);
  const [probeBusy, setProbeBusy] = useState(false);

  // --- resolve ---
  const [rTerm, setRTerm] = useState('M1');
  const [resolved, setResolved] = useState(null);
  const [rErr, setRerr] = useState('');
  const [rBusy, setRbusy] = useState(false);

  // --- tap ---
  const [tapArchive, setTapArchive] = useState('vizier');
  const [adql, setAdql] = useState(PRESET_ADQL.vizier);
  const [tapRes, setTapRes] = useState(null);
  const [tapErr, setTapErr] = useState('');
  const [tapBusy, setTapBusy] = useState(false);
  const [tables, setTables] = useState([]);

  // --- sia / ssa ---
  const [pos, setPos] = useState('83.63 22.01');
  const [siaArchive, setSiaArchive] = useState('noirlab');
  const [siaRes, setSiaRes] = useState(null);
  const [siaErr, setSiaErr] = useState('');
  const [ssaArchive, setSsaArchive] = useState('eso');
  const [ssaRes, setSsaRes] = useState(null);
  const [ssaErr, setSsaErr] = useState('');

  useEffect(() => {
    api.ivoa().then(setRegistry).catch(() => {});
  }, []);

  const runProbe = async () => {
    setProbeBusy(true);
    try { setProbe(await api.ivoaProbe()); } catch (e) { setProbe({ error: e.message }); }
    setProbeBusy(false);
  };

  const onResolve = async () => {
    setRbusy(true); setRerr(''); setResolved(null);
    try { setResolved(await api.ivoaResolve(rTerm)); }
    catch (e) { setRerr(e.message || 'resolve failed'); }
    setRbusy(false);
  };

  const onTap = async () => {
    setTapBusy(true); setTapErr(''); setTapRes(null);
    try { setTapRes(await api.ivoaTap(tapArchive, adql)); }
    catch (e) { setTapErr(e.message || 'query failed'); }
    setTapBusy(false);
  };

  const onTables = async () => {
    setTapErr('');
    try { const d = await api.ivoaTapTables(tapArchive); setTables(d.rows.slice(0, 60)); }
    catch (e) { setTapErr('tables: ' + e.message); }
  };

  const onSia = async () => {
    setSiaErr(''); setSiaRes(null);
    try { setSiaRes(await api.ivoaSia2(siaArchive, pos)); } catch (e) { setSiaErr(e.message); }
  };
  const onSsa = async () => {
    setSsaErr(''); setSsaRes(null);
    try { setSsaRes(await api.ivoaSsa(ssaArchive, pos)); } catch (e) { setSsaErr(e.message); }
  };

  const archives = (registry && registry.archives) || {};
  const probeOk = probe && probe.okArchives && probe.okArchives.length;

  return (
    <div className="sources-grid">
      <section className="panel wide">
        <div className="panel-head"><h2>LIVE ARCHIVE REGISTRY</h2><span className="tag">LAYER 1 · IVOA</span></div>
        <div className="toolbar">
          <button className="btn" onClick={runProbe} disabled={probeBusy}>{probeBusy ? 'probing…' : probe ? 'RE-PROBE' : 'PROBE CONNECTIVITY'}</button>
          {probe && <span className="muted">{probe.ok}/{probe.probed} archives live · {probe.generated}</span>}
        </div>
        {probe && probe.okArchives && <div className="flags">{probe.okArchives.map((k) => <span className="tag" key={k}>{k}</span>)}</div>}
        {Object.keys(archives).length > 0 && (
          <table className="catalogue-table"><thead><tr><th>key</th><th>archive</th><th>org</th><th>category</th><th>protocols</th><th>declared</th></tr></thead>
            <tbody>{Object.entries(archives).map(([k, a]) => (
              <tr key={k}><td className="mono">{k}</td><td>{a.name}</td><td>{a.org}</td><td>{a.category}</td><td className="mono">{a.protocols.join(', ')}</td>
                <td><span className={`pill ${a.status === 'verified' ? 'confirmed' : a.status === 'configured' ? 'candidate' : ''}`}>{a.status}</span></td></tr>
            ))}</tbody></table>
          )}
        {registry && registry.note && <p className="muted note">{registry.note}</p>}
      </section>

      <section className="panel">
        <div className="panel-head"><h2>OBJECT RESOLVER</h2><span className="tag">SESAME / SIMBAD</span></div>
        <div className="resolve-row">
          <input className="search grow" value={rTerm} onChange={(e) => setRTerm(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onResolve()} placeholder="M1, Crab, 3C 273, NGC 1952…" />
          <button className="btn" onClick={onResolve} disabled={rBusy}>{rBusy ? '…' : 'RESOLVE'}</button>
        </div>
        {resolved && (resolved.found ? (
          <dl className="kv inline">
            <div><dt>RA</dt><dd className="mono">{resolved.ra}°</dd></div>
            <div><dt>DEC</dt><dd className="mono">{resolved.dec}°</dd></div>
            <div><dt>Service</dt><dd>{resolved.service}</dd></div>
          </dl>
        ) : <p className="muted">Not resolved: {resolved.reason}</p>)}
        {rErr && <p className="muted err">{rErr}</p>}
      </section>

      <section className="panel wide">
        <div className="panel-head"><h2>ADQL TAP QUERY</h2><span className="tag">LIVE</span></div>
        <div className="toolbar">
          <select className="search" value={tapArchive} onChange={(e) => { setTapArchive(e.target.value); setAdql(PRESET_ADQL[e.target.value] || adql); }}>
            {TAP_ARCHIVES.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <button className="btn sm" onClick={onTables}>TABLES</button>
          <button className="btn" onClick={onTap} disabled={tapBusy}>{tapBusy ? '…' : 'RUN ADQL'}</button>
        </div>
        <textarea className="search adql" rows={3} value={adql} onChange={(e) => setAdql(e.target.value)} spellCheck="false" />
        {tapRes && (
          <>
            <StatusLine ok={tapRes.status === 'OK'} status={tapRes.status} count={tapRes.count} error={tapRes.error} />
            <ResultTable rows={tapRes.rows} fields={tapRes.fields} />
          </>
        )}
        {tapErr && <p className="muted err">{tapErr}</p>}
        {tables.length > 0 && (
          <details><summary className="muted">↑ {tables.length} TAP_SCHEMA tables</summary>
            <div className="tables-scroll">{tables.map((t) => <span className="tag mono" key={t.table_name || JSON.stringify(t)}>{t.table_name || t.schema_name}</span>)}</div>
          </details>
        )}
      </section>

      <section className="panel">
        <div className="panel-head"><h2>SIA IMAGE SEARCH</h2><span className="tag">LIVE CUTOUTS</span></div>
        <div className="resolve-row">
          <select className="search" value={siaArchive} onChange={(e) => setSiaArchive(e.target.value)}>
            {SIA_ARCHIVES.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <button className="btn" onClick={onSia}>SEARCH</button>
        </div>
        <input className="search" value={pos} onChange={(e) => setPos(e.target.value)} placeholder="RA DEC (deg)" />
        {siaRes && <StatusLine ok={siaRes.status === 'OK'} status={siaRes.status} count={siaRes.count} error={siaRes.error} />}
        {siaRes && <ResultTable rows={siaRes.rows} fields={siaRes.fields} maxCols={6} />}
        {siaErr && <p className="muted err">{siaErr}</p>}
      </section>

      <section className="panel">
        <div className="panel-head"><h2>SSA SPECTRA SEARCH</h2><span className="tag">LIVE</span></div>
        <div className="resolve-row">
          <select className="search" value={ssaArchive} onChange={(e) => setSsaArchive(e.target.value)}>
            {SSA_ARCHIVES.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <button className="btn" onClick={onSsa}>SEARCH</button>
        </div>
        <input className="search" value={pos} onChange={(e) => setPos(e.target.value)} placeholder="RA DEC (deg)" />
        {ssaRes && <StatusLine ok={ssaRes.status === 'OK'} status={ssaRes.status} count={ssaRes.count} error={ssaRes.error} />}
        {ssaRes && <ResultTable rows={ssaRes.rows} fields={ssaRes.fields} maxCols={6} />}
        {ssaErr && <p className="muted err">{ssaErr}</p>}
      </section>
    </div>
  );
}
