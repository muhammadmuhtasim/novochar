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
const INGEST_OPERATIONS = {
  vizier: ['tap'], simbad: ['tap'], gaia: ['tap'], noirlab: ['tap'], eso: ['tap'], irsa: ['tap'], heasarc: ['tap'],
  mast: ['cone', 'name', 'products'],
  ned: ['name'],
  lambda: ['index', 'file'],
  darts: ['index', 'file', 'discover', 'tap'],
  esdc: ['discover', 'tap'],
};

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
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
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
            <tr key={i}>{keys.map((k) => <td key={k} className="mono">{cell(r[k])}</td>)}<td /></tr>
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
  const [gaiaCenter, setGaiaCenter] = useState('266.405 -28.936');
  const [gaiaRadius, setGaiaRadius] = useState('0.1');
  const [gaiaEpoch, setGaiaEpoch] = useState('2025');
  const [gaiaRes, setGaiaRes] = useState(null);
  const [gaiaErr, setGaiaErr] = useState('');
  const [gaiaBusy, setGaiaBusy] = useState(false);
  const [ingestArchive, setIngestArchive] = useState('mast');
  const [ingestOperation, setIngestOperation] = useState('cone');
  const [ingestParams, setIngestParams] = useState({ ra: '83.63', dec: '22.01', radius: '0.05', page: '1', pagesize: '500', name: 'M31', obsid: '', term: 'DARTS', ivoid: 'ivo://esavo/psa/epntap', path: '', query: 'SELECT TOP 10 * FROM "I/345/gaia2"' });
  const [ingestResult, setIngestResult] = useState(null);
  const [ingestError, setIngestError] = useState('');
  const [ingestBusy, setIngestBusy] = useState(false);

  useEffect(() => {
    Promise.all([api.ivoa(), api.archives()]).then(([metadata, sourceAdapters]) => {
      const archives = Object.fromEntries(Object.entries(metadata.archives || {}).map(([key, archive]) => [
        key,
        { ...archive, ...(sourceAdapters.archives[key] || {}), status: sourceAdapters.archives[key]?.state || archive.status },
      ]));
      setRegistry({ ...metadata, archives });
    }).catch(() => {});
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
  const onGaiaMotion = async () => {
    const coordinates = gaiaCenter.trim().split(/[\s,]+/).map(Number);
    if (coordinates.length !== 2 || coordinates.some((value) => !Number.isFinite(value))) {
      setGaiaErr('Enter center coordinates as RA and Dec in degrees.');
      setGaiaRes(null);
      return;
    }
    setGaiaBusy(true); setGaiaErr(''); setGaiaRes(null);
    try {
      setGaiaRes(await api.ivoaGaiaMotion(coordinates[0], coordinates[1], Number(gaiaRadius), Number(gaiaEpoch)));
    } catch (e) { setGaiaErr(e.message || 'Gaia query failed'); }
    finally { setGaiaBusy(false); }
  };
  const onIngest = async () => {
    let params = {};
    if (ingestOperation === 'tap') params = ['darts', 'esdc'].includes(ingestArchive) ? { ivoid: ingestParams.ivoid, query: ingestParams.query } : { query: ingestParams.query };
    if (ingestOperation === 'cone') params = { ra: Number(ingestParams.ra), dec: Number(ingestParams.dec), radius: Number(ingestParams.radius), page: Number(ingestParams.page), pagesize: Number(ingestParams.pagesize) };
    if (ingestOperation === 'name') params = { name: ingestParams.name };
    if (ingestOperation === 'products') params = { obsid: ingestParams.obsid };
    if (ingestOperation === 'discover') params = { term: ingestParams.term };
    if (ingestOperation === 'file') params = { path: ingestParams.path };
    setIngestBusy(true); setIngestError(''); setIngestResult(null);
    try { setIngestResult(await api.archiveQuery(ingestArchive, ingestOperation, params)); }
    catch (e) { setIngestError(e.message || 'archive request failed'); }
    finally { setIngestBusy(false); }
  };

  const changeIngestArchive = (archive) => {
    setIngestArchive(archive);
    setIngestOperation(INGEST_OPERATIONS[archive][0]);
    if (INGEST_OPERATIONS[archive].includes('tap')) {
      setIngestParams((current) => ({ ...current, query: PRESET_ADQL[archive] || 'SELECT TOP 10 * FROM TAP_SCHEMA.tables' }));
    }
    setIngestResult(null); setIngestError('');
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
                <td><span className={`pill ${String(a.status).includes('verified') ? 'confirmed' : /unverified|no-match/.test(a.status) ? 'candidate' : ''}`}>{a.status}</span></td></tr>
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
        <div className="panel-head"><h2>ARCHIVE INGEST</h2><span className="tag">SOURCE ADAPTERS</span></div>
        <div className="toolbar ingest-controls">
          <label className="tb-group">ARCHIVE
            <select className="search" value={ingestArchive} onChange={(e) => changeIngestArchive(e.target.value)}>
              {Object.keys(INGEST_OPERATIONS).map((key) => <option key={key} value={key}>{key}</option>)}
            </select>
          </label>
          <label className="tb-group">OPERATION
            <select className="search" value={ingestOperation} onChange={(e) => { setIngestOperation(e.target.value); setIngestResult(null); }}>
              {INGEST_OPERATIONS[ingestArchive].map((op) => <option key={op} value={op}>{op}</option>)}
            </select>
          </label>
          <button className="btn" onClick={onIngest} disabled={ingestBusy}>{ingestBusy ? 'FETCHING…' : 'FETCH SOURCE DATA'}</button>
        </div>
        {ingestOperation === 'tap' && <textarea className="search adql" rows={3} value={ingestParams.query} onChange={(e) => setIngestParams({ ...ingestParams, query: e.target.value })} spellCheck="false" aria-label="Archive ADQL query" />}
        {ingestOperation === 'tap' && ['darts', 'esdc'].includes(ingestArchive) && <input className="search ingest-input mono" aria-label="IVOA registry identifier" placeholder="Service IVOID" value={ingestParams.ivoid} onChange={(e) => setIngestParams({ ...ingestParams, ivoid: e.target.value })} />}
        {ingestOperation === 'cone' && <div className="toolbar ingest-controls">
          <label className="tb-group">RA °<input className="search ingest-number" type="number" value={ingestParams.ra} onChange={(e) => setIngestParams({ ...ingestParams, ra: e.target.value })} /></label>
          <label className="tb-group">DEC °<input className="search ingest-number" type="number" value={ingestParams.dec} onChange={(e) => setIngestParams({ ...ingestParams, dec: e.target.value })} /></label>
          <label className="tb-group">RADIUS °<input className="search ingest-number" type="number" min="0.001" max="5" step="0.01" value={ingestParams.radius} onChange={(e) => setIngestParams({ ...ingestParams, radius: e.target.value })} /></label>
          <label className="tb-group">PAGE<input className="search ingest-number" type="number" min="1" value={ingestParams.page} onChange={(e) => setIngestParams({ ...ingestParams, page: e.target.value })} /></label>
          <label className="tb-group">PAGE SIZE<input className="search ingest-number" type="number" min="1" max="5000" value={ingestParams.pagesize} onChange={(e) => setIngestParams({ ...ingestParams, pagesize: e.target.value })} /></label>
        </div>}
        {ingestOperation === 'name' && <input className="search ingest-input" aria-label="Object name" placeholder="Object name" value={ingestParams.name} onChange={(e) => setIngestParams({ ...ingestParams, name: e.target.value })} />}
        {ingestOperation === 'products' && <input className="search ingest-input" aria-label="MAST observation identifier" placeholder="MAST observation ID" value={ingestParams.obsid} onChange={(e) => setIngestParams({ ...ingestParams, obsid: e.target.value })} />}
        {ingestOperation === 'discover' && <input className="search ingest-input" aria-label="Registry search term" placeholder="Service title term" value={ingestParams.term} onChange={(e) => setIngestParams({ ...ingestParams, term: e.target.value })} />}
        {ingestOperation === 'file' && <input className="search ingest-input mono" aria-label="Archive-relative product path" placeholder="Archive-relative file path" value={ingestParams.path} onChange={(e) => setIngestParams({ ...ingestParams, path: e.target.value })} />}
        {ingestError && <p className="muted err">{ingestError}</p>}
        {ingestResult && <>
          <StatusLine ok={ingestResult.status === 'READY' || (['OK', 'COMPLETE'].includes(ingestResult.status) && (ingestResult.count > 0 || ingestResult.content))} status={ingestResult.status} count={ingestResult.count ?? 0} />
          {ingestResult.rows && <ResultTable rows={ingestResult.rows} fields={ingestResult.fields} maxCols={12} maxRows={50} />}
          {ingestOperation === 'discover' && ingestResult.rows?.filter((row) => String(row.standard_id || '').toLowerCase().startsWith('ivo://ivoa.net/std/tap') && row.ivoid).map((row) => <button className="btn sm" key={`${row.ivoid}-${row.access_url}`} onClick={() => { setIngestParams({ ...ingestParams, ivoid: row.ivoid, query: 'SELECT TOP 10 * FROM TAP_SCHEMA.tables' }); setIngestOperation('tap'); }}>{`QUERY ${row.short_name || row.ivoid}`}</button>)}
          {ingestOperation === 'file' && ingestResult.rows?.[0]?.url && <p><a className="btn sm" href={ingestArchive === 'darts' ? api.dartsFile(ingestParams.path) : api.lambdaFile(ingestParams.path)} target="_blank" rel="noreferrer">OPEN PUBLIC FILE</a></p>}
          {ingestArchive === 'mast' && ingestOperation === 'products' && ingestResult.rows?.filter((row) => row.dataURI).map((row) => <p key={row.dataURI}><a className="btn sm" href={api.mastFile(row.dataURI)} target="_blank" rel="noreferrer">DOWNLOAD {row.productFilename || row.dataURI}</a></p>)}
          {['lambda', 'darts'].includes(ingestArchive) && ingestResult.content && <details><summary className="muted">{ingestArchive.toUpperCase()} directory response</summary><pre className="archive-payload">{ingestResult.content.slice(0, 30000)}</pre></details>}
          {ingestArchive === 'mast' && ingestOperation === 'products' && ingestResult.rows && ingestResult.rows.some((row) => row.dataURI) && <p className="muted">Product files are available from the returned MAST dataURI values.</p>}
          <details><summary className="muted">Response metadata</summary><pre className="archive-payload">{JSON.stringify({ archive: ingestResult.archive, service: ingestResult.service, status: ingestResult.status, count: ingestResult.count, query: ingestResult.query, data: ingestResult.data && !ingestResult.rows ? ingestResult.data : undefined }, null, 2).slice(0, 30000)}</pre></details>
        </>}
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

      <section className="panel wide gaia-motion-panel">
        <div className="panel-head"><h2>GAIA DR3 · PROPER MOTION</h2><span className="tag">LIVE ASTROMETRY</span></div>
        <div className="toolbar gaia-controls">
          <label className="tb-group">CENTER (RA DEC °)
            <input className="search" value={gaiaCenter} onChange={(e) => setGaiaCenter(e.target.value)} aria-label="Gaia cone center right ascension and declination" />
          </label>
          <label className="tb-group">RADIUS (°)
            <input className="search gaia-number" type="number" min="0.001" max="1" step="0.01" value={gaiaRadius} onChange={(e) => setGaiaRadius(e.target.value)} />
          </label>
          <label className="tb-group">PROJECT TO EPOCH
            <input className="search gaia-number" type="number" min="1900" max="2200" step="1" value={gaiaEpoch} onChange={(e) => setGaiaEpoch(e.target.value)} />
          </label>
          <button className="btn" onClick={onGaiaMotion} disabled={gaiaBusy}>{gaiaBusy ? 'QUERYING…' : 'QUERY GAIA DR3'}</button>
        </div>
        <p className="muted gaia-caption">Cone-searches Gaia DR3 at its reference astrometry, then propagates each source to the selected Julian year using pmRA = μα cos δ and pmDec. Arrows show direction; their lengths are normalized for visibility.</p>
        {gaiaErr && <p className="muted err">{gaiaErr}</p>}
        {gaiaRes && (
          <>
            <StatusLine ok={gaiaRes.status === 'OK' && gaiaRes.count > 0} status={gaiaRes.status} count={gaiaRes.count} />
            {gaiaRes.count > 0 && <GaiaMotionPlot rows={gaiaRes.rows} />}
            <ResultTable rows={gaiaRes.rows} maxCols={14} maxRows={30} />
          </>
        )}
      </section>
    </div>
  );
}

function GaiaMotionPlot({ rows }) {
  const plotted = rows.filter((row) => Number.isFinite(row.ra) && Number.isFinite(row.dec));
  if (!plotted.length) return null;
  const width = 760;
  const height = 280;
  const pad = 24;
  const raMin = Math.min(...plotted.map((row) => row.ra));
  const raMax = Math.max(...plotted.map((row) => row.ra));
  const decMin = Math.min(...plotted.map((row) => row.dec));
  const decMax = Math.max(...plotted.map((row) => row.dec));
  const x = (ra) => pad + (raMax === raMin ? 0.5 : (ra - raMin) / (raMax - raMin)) * (width - pad * 2);
  const y = (dec) => height - pad - (decMax === decMin ? 0.5 : (dec - decMin) / (decMax - decMin)) * (height - pad * 2);
  const maxMotion = Math.max(1, ...plotted.map((row) => Math.hypot(Number(row.pmra) || 0, Number(row.pmdec) || 0)));

  return (
    <div className="gaia-plot-wrap">
      <svg className="gaia-motion-plot" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Gaia DR3 source positions and proper motion directions">
        <rect x="0" y="0" width={width} height={height} />
        <text x={pad} y={15} className="gaia-plot-label">REFERENCE-POSITION FIELD · ICRS</text>
        {plotted.map((row) => {
          const px = x(row.ra);
          const py = y(row.dec);
          const eastMotion = Number(row.pmra) || 0;
          const northMotion = Number(row.pmdec) || 0;
          const length = 27 * Math.sqrt(Math.hypot(eastMotion, northMotion) / maxMotion);
          const angle = Math.atan2(-northMotion, eastMotion);
          const dx = Math.cos(angle) * length;
          const dy = Math.sin(angle) * length;
          return (
            <g key={row.source_id} className="gaia-vector">
              <line x1={px} y1={py} x2={px + dx} y2={py + dy} />
              <path d={`M ${px + dx} ${py + dy} l ${-dx * 0.35 - dy * 0.2} ${-dy * 0.35 + dx * 0.2} l ${dy * 0.4} ${-dx * 0.4} z`} />
              <circle cx={px} cy={py} r="2.5"><title>{row.source_id}: {row.displacementMas.toFixed(1)} mas to epoch {row.targetEpoch}</title></circle>
            </g>
          );
        })}
      </svg>
      <p className="muted gaia-caption">{plotted.length} sources · coordinates plotted at Gaia reference epoch · endpoint propagation values are returned in the table</p>
    </div>
  );
}
