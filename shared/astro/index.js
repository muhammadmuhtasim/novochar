// Novochar shared scientific core (@novochar/astro).
//
// Pure, dependency-free astronomical mathematics consumed by both the server
// (Processing & Matching) and the Mode B Observe client, so there is a single
// authoritative implementation of frames, epochs, proper motion and angular
// geometry. Nothing here may import React, Three.js, or any renderer.

export * from './vector.js';
export * from './healpix-nest.js';
export * from './epochs.js';
export * from './frames.js';
export * from './proper-motion.js';
export * from './angular-distance.js';
export * from './distance.js';
export * from './shell.js';
export * from './distance-quality.js';
