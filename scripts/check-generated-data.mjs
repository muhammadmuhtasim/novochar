// Verifies that the committed precomputed dataset matches a fresh regeneration.
//
// The generated JSON under client/public/data is committed and copied verbatim
// into the production bundle by Vite. That means a stale or non-deterministic
// generator could ship silently. This check regenerates into a scratch
// directory and compares byte-for-byte, so a failed precompute — or any drift
// between the generator and the committed files — fails the build.
//
// Run with: npm run check:data

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const committedDir = path.resolve(root, 'client', 'public', 'data');
const scratchDir = mkdtempSync(path.join(tmpdir(), 'novochar-precompute-'));

function listFiles(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) listFiles(full, base, out);
    else out.push(path.relative(base, full));
  }
  return out.sort();
}

try {
  execFileSync(process.execPath, [path.resolve(__dirname, 'precompute-data.mjs')], {
    cwd: root,
    env: { ...process.env, PRECOMPUTE_OUT: scratchDir },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  const expected = listFiles(committedDir);
  const actual = listFiles(scratchDir);
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const problems = [];

  for (const file of actual) {
    if (!expectedSet.has(file)) problems.push(`unexpected file: ${file} (regenerate & commit)`);
  }
  for (const file of expected) {
    if (!actualSet.has(file)) {
      problems.push(`missing file: ${file} (regenerate & commit)`);
      continue;
    }
    const committed = readFileSync(path.join(committedDir, file));
    const fresh = readFileSync(path.join(scratchDir, file));
    if (!committed.equals(fresh)) problems.push(`stale/non-deterministic: ${file}`);
  }

  if (problems.length) {
    console.error('Precomputed data check FAILED:');
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error('\nRun `npm run precompute:data` and commit the regenerated files.');
    process.exitCode = 1;
  } else {
    console.log(`Precomputed data OK: ${expected.length} files match a fresh regeneration.`);
  }
} finally {
  rmSync(scratchDir, { recursive: true, force: true });
}
