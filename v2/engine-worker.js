'use strict';
/* engine-worker.js — runs the ocgcore engine (engine.js Duel) off the main
   thread so a long synchronous poc_process() call never blocks rendering.
   One file, two hosts:
     - Browser Web Worker: importScripts('build/ocgcore.js', 'engine.js');
       self.onmessage / self.postMessage. This script lives in v2/ while
       the wasm lives in v2/build/, so locateFile prefixes 'build/'.
     - Node worker_threads: parentPort / workerData; build/ocgcore.js and
       engine.js are require()d (same style as test-node.js).
   Protocol:
     in : {type:'start', data, opts:{seed, pace, deckP0, deckP1, humanTeam,
                                     fast?, digest?, rngSeed?}}
          {type:'answer', id, bytes:Uint8Array}
          {type:'refresh'}                    (only while a prompt waits)
     out: {type:'update', state}              (per message batch)
          {type:'prompt', id, prompt, state}  (human seat must answer)
          {type:'refreshed', state}           (answer to 'refresh')
          {type:'done', stats, state, digest?}
          {type:'error', message}
   Snapshots are shallow copies of the GameState's own enumerable props
   minus names/cardData (static DATA references — the proxy re-attaches
   them from its own DATA) and graveResync (engine-internal Set). The
   postMessage structured clone deep-copies them, so nothing is JSON-
   encoded here. After each send the worker-side state.events is cleared:
   the client drains events per update, so each batch must arrive once. */

// ---------------------------------------------------------------- host glue
const HOST = (() => {
  // Node worker_threads?
  if (typeof process !== 'undefined' && process.versions && process.versions.node &&
      typeof require === 'function') {
    try {
      const wt = require('worker_threads');
      if (wt.parentPort) return { kind: 'node', wt };
    } catch (e) { /* fall through to browser */ }
  }
  return { kind: 'browser' };
})();

let post = null;             // (obj) => void
let Engine = null;           // engine.js exports (set during bootstrap)
let OcgCoreFactory = null;   // MODULARIZE factory for build/ocgcore.js

if (HOST.kind === 'node') {
  const { parentPort, workerData } = HOST.wt;
  post = (obj) => parentPort.postMessage(obj);
  // Deterministic deck shuffles for the identity test: engine.js's
  // randBelow reads globalThis.crypto.getRandomValues at call time, so a
  // seeded PRNG stub installed BEFORE engine.js is required governs every
  // shuffle in this worker. workerData.rngSeed is set only by tests.
  if (workerData && workerData.rngSeed != null) installSeededCrypto(workerData.rngSeed);
  OcgCoreFactory = require('./build/ocgcore.js');
  Engine = require('./engine.js');
  parentPort.on('message', (msg) => { handle(msg).catch(reportError); });
} else {
  post = (obj) => self.postMessage(obj);
  importScripts('build/ocgcore.js', 'engine.js');
  OcgCoreFactory = self.OcgCoreModule;
  Engine = self.Engine;
  self.onmessage = (ev) => { handle(ev.data).catch(reportError); };
}

function installSeededCrypto(seed) {
  let a = seed >>> 0;
  const next = () => { // mulberry32
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const stub = {
    getRandomValues(arr) {
      for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(next() * 4294967296);
      return arr;
    },
  };
  try { globalThis.crypto = stub; } catch (e) { /* getter-only global */ }
  if (globalThis.crypto !== stub)
    Object.defineProperty(globalThis, 'crypto', { value: stub, configurable: true, writable: true });
}

function reportError(e) {
  try { post({ type: 'error', message: (e && e.message) || String(e) }); } catch (e2) {}
}

// ---------------------------------------------------------------- snapshot
function snapshot(state) {
  const out = {};
  for (const k of Object.keys(state)) {
    if (k === 'names' || k === 'cardData' || k === 'graveResync') continue;
    out[k] = state[k];
  }
  return out;
}

// FNV-1a over every core message's bytes (identity test only, opts.digest).
function makeDigest() {
  let h = 0x811c9dc5 >>> 0, count = 0;
  return {
    add(bytes) {
      count++;
      for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193) >>> 0; }
    },
    result() { return { hash: h >>> 0, count }; },
  };
}

// ---------------------------------------------------------------- session
let duel = null;
let promptSeq = 0;
const pendingAnswers = new Map(); // id -> resolve(bytes)

async function handle(msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'start') return startSession(msg);
  if (msg.type === 'answer') {
    const res = pendingAnswers.get(msg.id);
    if (res) { pendingAnswers.delete(msg.id); res(msg.bytes); }
    return;
  }
  if (msg.type === 'refresh') {
    if (!duel) return;
    try { duel.refreshFieldStats(); } catch (e) {}
    post({ type: 'refreshed', state: snapshot(duel.state) });
  }
}

async function startSession(msg) {
  const opts = msg.opts || {};
  const data = msg.data;
  const digest = opts.digest ? makeDigest() : null;
  const M = await OcgCoreFactory({
    // Browser: this script sits in v2/, the wasm in v2/build/ — prefix
    // 'build/'. Node: the glue reads the located path from the filesystem,
    // so it must be absolute (a relative 'build/...' would depend on the
    // host process's CWD).
    locateFile: (path) => {
      if (!path.endsWith('.wasm')) return path;
      return HOST.kind === 'node'
        ? require('path').join(__dirname, 'build', path)
        : 'build/' + path;
    },
  });
  duel = new Engine.Duel(M, data, {
    seed: opts.seed,
    pace: opts.fast ? { bot: 0, botChain: 0, batch: 0 } : opts.pace,
    deckP0: opts.deckP0,
    deckP1: opts.deckP1,
    humanTeam: opts.humanTeam,
    sleep: opts.fast ? () => Promise.resolve() : undefined,
    onLog: () => {},
    onMessage: digest ? (m) => digest.add(m) : undefined,
    onUpdate: (state) => {
      try { duel.refreshFieldStats(); } catch (e) {}
      post({ type: 'update', state: snapshot(state) });
      state.events.length = 0; // client drains per update: deliver once
    },
    humanAnswerer: async (prompt, state) => {
      try { duel.refreshFieldStats(); } catch (e) {}
      const id = ++promptSeq;
      post({ type: 'prompt', id, prompt, state: snapshot(state) });
      state.events.length = 0;
      return new Promise((resolve) => pendingAnswers.set(id, resolve));
    },
  });
  const stats = await duel.run();
  const done = { type: 'done', stats, state: snapshot(duel.state) };
  if (digest) done.digest = digest.result();
  post(done);
}
