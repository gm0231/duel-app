'use strict';
/* test-worker.js — identity check for the engine-Worker migration.
   Runs the SAME duel (same seed, same decks, all-bot answers) twice:
     (a) in-process Engine.Duel (the pre-migration path), and
     (b) engine-worker.js on a Node worker_thread behind the WorkerDuel
         proxy (the post-migration path),
   and asserts byte-level identity of the duel's progression:
     - FNV-1a digest + count over every core message (in-process side
       taps opts.onMessage; worker side accumulates under opts.digest),
     - stats {steps, prompts, retries, turns, stopReason},
     - a summary JSON of the final state (winner, winReason, per-player
       LP and hand/grave/removed/extra code lists, monster-zone codes
       and positions).
   Determinism: both sides get the same Duel seed, and the deck-shuffle
   RNG (engine.js randBelow -> globalThis.crypto.getRandomValues) is
   replaced by the same seeded mulberry32 PRNG on both sides — directly
   on this process's globalThis for (a), via workerData.rngSeed for (b)
   (engine-worker.js installs it before requiring engine.js). Pace/sleep
   are immediate on both sides.
   humanTeam is set to a seat that does not exist (999), so every prompt
   is answered by the bot policy on both sides and no human answerer is
   ever invoked. */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { Worker } = require('worker_threads');
const factory = require(path.join(__dirname, 'build', 'ocgcore.js'));
const Engine = require(path.join(__dirname, 'engine.js'));
const { WorkerDuel } = require(path.join(__dirname, 'duel-worker.js'));

const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));

// ---------------------------------------------------------------- helpers
function installSeededCrypto(seed) {
  let a = seed >>> 0;
  const next = () => { // mulberry32 — must match engine-worker.js
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

function makeDigest() { // FNV-1a — must match engine-worker.js
  let h = 0x811c9dc5 >>> 0, count = 0;
  return {
    add(bytes) {
      count++;
      for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193) >>> 0; }
    },
    result() { return { hash: h >>> 0, count }; },
  };
}

function summarize(state) {
  const codes = (arr) => (arr || []).map((e) => (e && typeof e === 'object' ? e.code : e));
  return {
    winner: state.winner,
    winReason: state.winReason,
    players: state.players.map((P) => ({
      lp: P.lp,
      hand: codes(P.hand),
      grave: codes(P.grave),
      removed: codes(P.removed),
      extra: codes(P.extra),
      mzone: P.mzone.map((c) => (c ? { code: c.code, pos: c.pos } : null)),
    })),
  };
}

const pickStats = (s) => ({
  steps: s.steps, prompts: s.prompts, retries: s.retries,
  turns: s.turns, stopReason: s.stopReason,
});

// ---------------------------------------------------------------- side (a)
async function runInProcess({ seed, rngSeed, deckP0, deckP1, humanTeam }) {
  installSeededCrypto(rngSeed);
  const M = await factory();
  const digest = makeDigest();
  const mem = Engine.makeBotMemory();
  const duel = new Engine.Duel(M, DATA, {
    seed,
    pace: { bot: 0, botChain: 0, batch: 0 },
    sleep: () => Promise.resolve(),
    deckP0, deckP1,
    humanTeam,
    onMessage: (m) => digest.add(m),
    // Only used by the case-3 variant (humanTeam = a real seat): the bot
    // policy stands in for the human, refreshing first like client.js.
    humanAnswerer: async (prompt, state) => {
      duel.refreshFieldStats();
      return Engine.botAnswer(prompt, state, DATA, mem);
    },
  });
  const stats = await duel.run();
  return { digest: digest.result(), stats, summary: summarize(duel.state), over: duel.over };
}

// ---------------------------------------------------------------- side (b)
async function runInWorker({ seed, rngSeed, deckP0, deckP1, humanTeam }) {
  const worker = new Worker(path.join(__dirname, 'engine-worker.js'), {
    workerData: { rngSeed },
  });
  try {
    const transport = {
      post: (obj) => worker.postMessage(obj),
      onMessage: (fn) => worker.on('message', fn),
    };
    const mem = Engine.makeBotMemory();
    const duel = new WorkerDuel(transport, DATA, {
      seed,
      deckP0, deckP1,
      humanTeam,
      fast: true,
      digest: true,
      // Case-3 variant only: answer through the proxy, exercising the
      // prompt/answer transport AND the refresh round-trip (awaited
      // before answering, exactly as client.js's uiAnswer does).
      humanAnswerer: async (prompt, state) => {
        await duel.refreshFieldStats();
        return Engine.botAnswer(prompt, state, DATA, mem);
      },
    });
    const stats = await duel.run();
    return { digest: duel.digest, stats, summary: summarize(duel.state), over: duel.over };
  } finally {
    await worker.terminate();
  }
}

// ---------------------------------------------------------------- cases
const CASES = [
  { label: 'case 1: seed 20261102, ishizu vs gg', seed: 20261102, rngSeed: 111, humanTeam: 999 },
  {
    label: 'case 2: seed 777, gg vs ishizu (decks swapped)',
    seed: 777, rngSeed: 222, humanTeam: 999,
    deckP0: DATA.decks.gg, deckP1: DATA.decks.ishizu,
  },
  {
    // Extra case beyond the all-bot baseline: seat 0 IS the human seat,
    // answered by the bot policy through the prompt/answer transport,
    // with a refreshFieldStats() round-trip before every answer — the
    // exact path client.js takes in the browser.
    label: 'case 3: seed 20261102, human seat 0 via prompt transport + refresh',
    seed: 20261102, rngSeed: 111, humanTeam: 0,
  },
];

(async () => {
  let failures = 0;
  for (const c of CASES) {
    const t0 = Date.now();
    const a = await runInProcess(c);
    const b = await runInWorker(c);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const tag = (ok, what) => {
      console.log((ok ? 'PASS' : 'FAIL'), c.label, '-', what);
      if (!ok) failures++;
    };
    console.log('---', c.label, '(' + secs + 's) ---');
    console.log('  in-process:', JSON.stringify(pickStats(a.stats)), 'digest', JSON.stringify(a.digest));
    console.log('  worker    :', JSON.stringify(pickStats(b.stats)), 'digest', JSON.stringify(b.digest));
    try {
      assert.deepStrictEqual(b.digest, a.digest);
      tag(true, 'core-message FNV-1a digest + count identical (' + a.digest.count + ' messages)');
    } catch (e) { tag(false, 'core-message digest differs: ' + e.message); }
    try {
      assert.deepStrictEqual(pickStats(b.stats), pickStats(a.stats));
      tag(true, 'stats identical (steps/prompts/retries/turns/stopReason)');
    } catch (e) { tag(false, 'stats differ: ' + e.message); }
    try {
      assert.deepStrictEqual(b.summary, a.summary);
      tag(true, 'final-state summary identical (winner=' + a.summary.winner +
        ', turns=' + a.stats.turns + ', stopReason=' + a.stats.stopReason + ')');
    } catch (e) { tag(false, 'final-state summary differs: ' + String(e.message).slice(0, 400)); }
    tag(a.over && b.over, 'both sides completed the duel (over=true)');
  }
  console.log(failures === 0 ? 'TEST PASS' : 'TEST FAIL (' + failures + ')');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
