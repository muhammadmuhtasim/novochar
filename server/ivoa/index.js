// Layer 1 - IVOA Ingestion & Access barrel.
//
// Re-exports the Node IVOA clients, the data-driven archive registry, and the
// live connectivity probe used by the Express routes (server/index.js) and the
// Vercel proxies (api/).

export * from './votable.js';
export * from './tap.js';
export * from './sia2.js';
export * from './ssa.js';
export * from './resolver.js';
export * from './registry.js';
export * from './probe.js';

import { ARCHIVES, ARCHIVE_KEYS, PROTOCOL_LABEL } from './registry.js';

/** Registry annotation surfaced for GET /api/ivoa metadata. */
export const IVOA_REGISTRY = {
  tap: Object.keys(ARCHIVES).filter((k) => ARCHIVES[k].protocols && ARCHIVES[k].protocols.tap),
  sia: Object.keys(ARCHIVES).filter((k) => ARCHIVES[k].protocols && ARCHIVES[k].protocols.sia),
  ssa: Object.keys(ARCHIVES).filter((k) => ARCHIVES[k].protocols && ARCHIVES[k].protocols.ssa),
  resolve: ['simbad', 'sesame'],
};

export const IVOA_LABEL = {
  tap: 'Table Access Protocol',
  sia: 'Simple Image Access',
  ssa: 'Simple Spectral Access',
  resolve: 'Object name resolution (SIMBAD TAP)',
  rest: 'REST API',
  file: 'Data-file download',
  registry: 'IVOA Registry / VOResource',
};

export { ARCHIVES, ARCHIVE_KEYS, PROTOCOL_LABEL };
