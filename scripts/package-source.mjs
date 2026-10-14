import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(projectRoot, 'dist', 'novochar-source.zip');
const stagedOutput = `${output}.${process.pid}.tmp`;
mkdirSync(dirname(output), { recursive: true });

try {
  const result = spawnSync('zip', [
    '-qr', stagedOutput, '.',
    '-x',
    'node_modules/', 'node_modules/*', '*/node_modules/', '*/node_modules/*',
    '.git/', '.git/*', '*/.git/', '*/.git/*',
    'dist/', 'dist/*', '*/dist/', '*/dist/*',
  ], { cwd: projectRoot, stdio: 'inherit' });

  if (result.error) {
    throw new Error(`Could not create source ZIP with the system zip utility: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`Source ZIP creation failed with exit code ${result.status ?? 1}`);
  }
  // Replace atomically so rerunning the command cannot retain stale ZIP entries.
  renameSync(stagedOutput, output);
} finally {
  if (existsSync(stagedOutput)) unlinkSync(stagedOutput);
}
