// Shell query surface for the Novochar API (Mode B Observe spherical shell).
//
// The science lives in the shared `@novochar/astro` core; this barrel exposes
// the source registry and the query service as the shell's public server API.

export * from './sources.js';
export * from './query.js';
