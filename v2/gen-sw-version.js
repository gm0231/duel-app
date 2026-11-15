'use strict';
/* gen-sw-version.js — loadspeed-1116.
 * The service worker's cache VERSION is a content hash over every
 * file whose staleness could break or mislead the app (the shell,
 * the code, the engine build and the data). Any change to one of
 * them changes VERSION, which changes the cache name in sw.js,
 * which makes the new worker purge the old cache on activate —
 * a deploy that passed the tests can never strand a player on
 * last deploy's data.json / wasm.
 *
 * Run directly (`node gen-sw-version.js`) to rewrite the VERSION
 * line in sw.js after changing a covered file. Required as a
 * module it only exports computeVersion() (test-loadspeed.js
 * recomputes and compares — a drift fails the suite).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const COVERED = [
  'index.html',
  'client.js',
  'engine.js',
  'duel-worker.js',
  'engine-worker.js',
  'neuron.js',
  'build/ocgcore.js',
  'build/ocgcore.wasm',
  'data.json',
  'genesys-data.json',
  'fxmap.json',
];

function computeVersion(dir) {
  const base = dir || __dirname;
  const h = crypto.createHash('sha256');
  for (const rel of COVERED) {
    h.update(rel);
    h.update('\0');
    h.update(fs.readFileSync(path.join(base, rel)));
    h.update('\0');
  }
  return h.digest('hex').slice(0, 12);
}

if (require.main === module) {
  const swPath = path.join(__dirname, 'sw.js');
  const v = computeVersion();
  const src = fs.readFileSync(swPath, 'utf8');
  const out = src.replace(/const VERSION = '[0-9a-f]+';/, "const VERSION = '" + v + "';");
  if (out === src && !src.includes("const VERSION = '" + v + "';")) {
    console.error('gen-sw-version: VERSION line not found in sw.js');
    process.exit(1);
  }
  fs.writeFileSync(swPath, out);
  console.log('sw.js VERSION =', v);
}

module.exports = { computeVersion, COVERED };
