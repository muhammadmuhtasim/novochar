// Layer 1 — IVOA Ingestion & Access barrel.
//
// Re-exports the Node IVOA clients and provides a small endpoint registry for
// the Express routes (server/index.js) and future Vercel proxies.

export * from './votable.js';
export * from './tap.js';
export * from './sia2.js';
export * from './ssa.js';
export * from './resolver.js';

/** Human-safe registry surfaced for `GET /api/ivoa` metadata. */
export const IVOA_REGISTRY = {
  tap: ['vizier', 'simbad', 'gaia', 'irsa', 'heasarc', 'mast'],
  sia2: Object.keys({ irsa: 1, widefield: 1 }),
  ssa: Object.keys({ mast: 1, irsa: 1 }),
  resolver: ['simbad', 'sesame'],
};

export const IVOA_LABEL = {
  tap: 'Table Access Protocol',
  sia2: 'Simple Image Access 2',
  ssa: 'Simple Spectral Access',
  resolver: 'Name resolution (SIMBAD / Sesame)',
};