#!/usr/bin/env node
/** Copy libavoid.wasm into apps/web/public for avoid-nodes-edge worker. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(__dirname, '..');
const candidates = [
  path.join(webRoot, 'node_modules', 'libavoid-js', 'dist', 'libavoid.wasm'),
  path.join(webRoot, '..', '..', 'node_modules', 'libavoid-js', 'dist', 'libavoid.wasm'),
  path.join(webRoot, '..', '..', 'node_modules', '.pnpm', 'libavoid-js@0.4.5', 'node_modules', 'libavoid-js', 'dist', 'libavoid.wasm'),
];

const src = candidates.find((p) => fs.existsSync(p));
const dest = path.join(webRoot, 'public', 'libavoid.wasm');

if (!src) {
  console.warn('[copy-libavoid-wasm] libavoid.wasm not found — run pnpm install first');
  process.exit(0);
}

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(src, dest);
console.log('[copy-libavoid-wasm] →', dest);
