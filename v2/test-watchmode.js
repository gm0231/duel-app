'use strict';
/* test-watchmode.js — watchmode-1116: developer-only watch mode
 * (both seats CPU), entered ONLY by the URL parameter ?watch=1.
 *
 * Purpose (user, 2026-11-16): watch the CPU policy actually play
 * a deck — Ishizu above all — on the real screen (rendering and
 * FX included), not just in screen-less Node benches, so its
 * play can be eyeballed and improved.
 *
 * The wiring is deliberately NOT a new answer path. The engine
 * driver (engine.js) already routes a prompt to the bot path
 * whenever no humanAnswerer is registered for the human seat:
 *   if (prompt.player === this.humanTeam && opts.humanAnswerer)
 *     -> humanAnswerer (main-thread UI)
 *   else
 *     -> pace wait, refreshFieldStats, attachGKTrapOracle on
 *        ANNOUNCE_CARD, botAnswer — the CPU seat's exact path.
 * Watch mode therefore only has to WITHHOLD the humanAnswerer:
 *   - client.js: with ?watch=1 the start handler passes
 *     humanAnswerer: undefined, the wire flag watch:true and a
 *     readable pace (~800ms per prompt); without the parameter
 *     every value is the pre-existing one.
 *   - duel-worker.js: 'watch' joins the serializable wire keys.
 *   - engine-worker.js: with opts.watch the worker-side Duel is
 *     constructed with humanAnswerer undefined, so no 'prompt'
 *     message ever crosses to the main thread; the client only
 *     renders the update stream.
 * Because the human seat takes the bot branch, the Ishizu
 * Gravekeeper's Trap oracle (attachGKTrapOracle) applies to an
 * Ishizu deck on EITHER seat in watch mode — the same sanctioned
 * behaviour the CPU seat has today, on both sides of the table.
 *
 * Pins below:
 *   W1x  source: the flag, the gated start wiring, the wire key,
 *        the worker branch, the watch bar (markup + CSS + stop).
 *   W2x  live jsdom: the flag is false without the parameter and
 *        true with it; the watch bar exists and stays hidden
 *        until a duel starts.
 *   W3x  engine (Node): watch wiring (humanTeam seat, NO
 *        humanAnswerer) completes full Ishizu vs GG duels with
 *        humanPrompts == 0 and a decided winner, on both seats;
 *        a control duel WITH a humanAnswerer still routes the
 *        human seat to it (normal routing unchanged).
 *   W4x  worker (Node worker_threads): a WorkerDuel started
 *        with watch:true completes with ZERO 'prompt' messages
 *        reaching the main thread.
 */
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');

const V2 = __dirname;
const clientSrc = fs.readFileSync(path.join(V2, 'client.js'), 'utf8');
const duelWorkerSrc = fs.readFileSync(path.join(V2, 'duel-worker.js'), 'utf8');
const engineWorkerSrc = fs.readFileSync(path.join(V2, 'engine-worker.js'), 'utf8');
const html = fs.readFileSync(path.join(V2, 'index.html'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(V2, 'data.json'), 'utf8'));

let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------- W1x source
ok(clientSrc.includes("const watchModeOn = /[?&]watch=1(?:&|$)/.test(window.location.search || '');"),
  'W1a: watch mode is gated on the ?watch=1 URL parameter only');
ok(html.split('観戦').length - 1 === 2,
  'W1b: the word 観戦 appears in index.html only inside the watch bar (no title/settings entry point)');
ok(clientSrc.includes("$('watchbar').classList.toggle('on', watchModeOn);"),
  'W1c: the start handler shows the watch bar in watch mode only');
ok(clientSrc.includes('pace: watchModeOn ? { bot: 800, botChain: 800, batch: 40 } : { bot: 620, botChain: 300, batch: 40 }'),
  'W1d: watch pace is a readable ~800ms; the normal pace is untouched');
ok(clientSrc.includes('watch: watchModeOn || undefined,'),
  'W1e: the watch flag crosses to the worker only in watch mode');
ok(clientSrc.includes('humanAnswerer: watchModeOn ? undefined : async (prompt, state) => { maybeSettleLayout(); render(state); await fxTurnBannerHold(); await showPendingConfirms(); return uiAnswer(prompt, state); },'),
  'W1f: watch mode withholds the humanAnswerer; normal mode keeps the exact existing one');
ok(duelWorkerSrc.includes("'humanTeam', 'fast', 'digest', 'watch'"),
  'W1g: duel-worker.js forwards the watch flag in the wire opts');
ok(engineWorkerSrc.includes('humanAnswerer: opts.watch ? undefined : async (prompt, state) => {'),
  'W1h: engine-worker.js omits its main-thread answerer under opts.watch');
ok(html.includes('<div id="watchbar"><span class="wb-label">観戦中（開発者用・両席CPU）</span><button id="watchstop" type="button">観戦をやめる</button></div>'),
  'W1i: the watch bar markup (label + stop button) is in the header');
ok(html.includes('#watchbar{display:none;') && html.includes('#watchbar.on{display:flex;}'),
  'W1j: the watch bar is hidden unless .on (never visible in normal play)');
ok(clientSrc.includes("$('watchstop').addEventListener('click', () => location.reload());"),
  'W1k: the stop button exits to the title screen (plain reload, like the result screen)');
ok(clientSrc.includes("? '観戦モード ― 先攻は' + deckDisplayName(humanFirst ? myDeckKey : opDeckKey)"),
  'W1l: the VS overlay names watch mode instead of あなたは先攻/後攻');
ok(clientSrc.includes("? deckDisplayName(seatDeckKeys[st.winner]) + ' の勝利'"),
  'W1m: the watch result names the winning deck');

// ---------------------------------------------------------------- W2x jsdom
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { console.log('SKIP: jsdom not resolvable (set NODE_PATH)'); }
const wasmBinary = fs.readFileSync(path.join(V2, 'build', 'ocgcore.wasm'));

async function boot(url) {
  const dom = new JSDOM(html, { url, runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  window.Audio = class { constructor(src) { this.src = src; this.volume = 1; } play() { return Promise.resolve(); } pause() {} };
  window.Image = class { constructor() { this._src = ''; } set src(v) { this._src = v; } get src() { return this._src; } };
  const wasmBuf = wasmBinary.buffer.slice(wasmBinary.byteOffset, wasmBinary.byteOffset + wasmBinary.byteLength);
  window.fetch = async (u) => {
    if (String(u).includes('ocgcore.wasm')) return { ok: true, status: 200, url: String(u), arrayBuffer: async () => wasmBuf };
    return { ok: true, status: 200, json: async () => data, arrayBuffer: async () => wasmBuf };
  };
  const inject = (file) => {
    const s = window.document.createElement('script');
    s.textContent = fs.readFileSync(path.join(V2, file), 'utf8');
    window.document.body.appendChild(s);
  };
  inject('build/ocgcore.js');
  const origFactory = window.OcgCoreModule;
  window.OcgCoreModule = (opts) => origFactory(Object.assign({}, opts, { wasmBinary }));
  inject('engine.js');
  inject('duel-worker.js');
  inject('neuron.js');
  inject('client.js');
  for (let i = 0; i < 100 && !window.document.getElementById('loadmsg').textContent.includes('準備完了'); i++)
    await sleep(50);
  return window;
}

// ---------------------------------------------------------------- W3x/W4x rng
function installSeededCrypto(seed) { // mulberry32 — matches engine-worker.js / test-worker.js
  let a = seed >>> 0;
  const next = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const stub = { getRandomValues(arr) { for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(next() * 4294967296); return arr; } };
  try { globalThis.crypto = stub; } catch (e) { /* getter-only global */ }
  if (globalThis.crypto !== stub)
    Object.defineProperty(globalThis, 'crypto', { value: stub, configurable: true, writable: true });
}

const factory = require(path.join(V2, 'build', 'ocgcore.js'));
const Engine = require(path.join(V2, 'engine.js'));
const { WorkerDuel } = require(path.join(V2, 'duel-worker.js'));

async function runWatchDuel(M, { seed, rngSeed, humanTeam, deckP0, deckP1 }) {
  installSeededCrypto(rngSeed);
  const duel = new Engine.Duel(M, data, {
    seed, pace: { bot: 0, botChain: 0, batch: 0 }, sleep: () => Promise.resolve(),
    deckP0, deckP1, humanTeam,
    onLog: () => {},
    // watch wiring: NO humanAnswerer, NO botAnswerer override —
    // exactly what the start handler + worker produce under ?watch=1.
  });
  const stats = await duel.run();
  return { duel, stats };
}

(async () => {
  // ---- W2x: live flag behaviour in jsdom
  if (JSDOM) {
    const wOff = await boot('http://localhost/v2/');
    ok(wOff.eval('watchModeOn') === false, 'W2a: without the parameter, watchModeOn is false');
    ok(!!wOff.document.getElementById('watchbar') && !wOff.document.getElementById('watchbar').classList.contains('on'),
      'W2b: the watch bar exists but stays off in normal mode');
    wOff.close();
    const wOn = await boot('http://localhost/v2/?watch=1');
    ok(wOn.eval('watchModeOn') === true, 'W2c: with ?watch=1, watchModeOn is true');
    ok(!!wOn.document.getElementById('watchstop'), 'W2d: the stop button is wired into the DOM in watch mode');
    wOn.close();
  }

  // ---- W3x: engine-level watch duels run to a decision
  const M = await factory();
  {
    const { duel, stats } = await runWatchDuel(M, {
      seed: 111, rngSeed: 111 * 2654435761 % 4294967296, humanTeam: 0,
      deckP0: data.decks.ishizu, deckP1: data.decks.gg,
    });
    ok(duel.over && (duel.state.winner === 0 || duel.state.winner === 1),
      'W3a: watch duel (Ishizu on the human seat) completes with a winner');
    ok(stats.humanPrompts === 0 && stats.botPrompts > 0,
      'W3b: every prompt — the human seat included — took the bot path (humanPrompts 0)');
    ok(stats.retries === 0 && stats.stopReason === 'duel ended (MSG_WIN)',
      'W3c: no rejected answers; the duel ended by MSG_WIN, not a stop condition');
  }
  {
    const { duel, stats } = await runWatchDuel(M, {
      seed: 222, rngSeed: 222 * 2654435761 % 4294967296, humanTeam: 1,
      deckP0: data.decks.gg, deckP1: data.decks.ishizu,
    });
    ok(duel.over && (duel.state.winner === 0 || duel.state.winner === 1),
      'W3d: watch duel (Ishizu on the CPU seat, humanTeam 1) completes with a winner');
    ok(stats.humanPrompts === 0 && stats.botPrompts > 0,
      'W3e: with humanTeam 1 the withheld answerer still routes both seats to the bot path');
    ok(stats.retries === 0 && stats.stopReason === 'duel ended (MSG_WIN)',
      'W3f: no rejected answers in the swapped duel either');
  }
  {
    // control: WITH a humanAnswerer the human seat must still be
    // routed to it — the normal-mode dispatch is unchanged.
    installSeededCrypto(333 * 2654435761 % 4294967296);
    let calls = 0;
    const mem = Engine.makeBotMemory();
    const duel = new Engine.Duel(M, data, {
      seed: 333, pace: { bot: 0, botChain: 0, batch: 0 }, sleep: () => Promise.resolve(),
      deckP0: data.decks.ishizu, deckP1: data.decks.gg, humanTeam: 0,
      onLog: () => {},
      humanAnswerer: async (prompt, state) => { calls++; return Engine.botAnswer(prompt, state, data, mem); },
    });
    const stats = await duel.run();
    ok(duel.over && stats.humanPrompts > 0 && stats.humanPrompts === calls,
      'W3g: control — with a humanAnswerer registered, the human seat still answers through it');
  }

  // ---- W4x: the real worker path carries no prompts in watch mode
  {
    const worker = new Worker(path.join(V2, 'engine-worker.js'), { workerData: { rngSeed: 444 } });
    try {
      let promptMsgs = 0, updateMsgs = 0;
      const transport = {
        post: (obj) => worker.postMessage(obj),
        onMessage: (fn) => worker.on('message', (msg) => {
          if (msg && msg.type === 'prompt') promptMsgs++;
          if (msg && msg.type === 'update') updateMsgs++;
          fn(msg);
        }),
      };
      const duel = new WorkerDuel(transport, data, {
        seed: 444, deckP0: data.decks.ishizu, deckP1: data.decks.gg,
        humanTeam: 0, fast: true, watch: true,
        // NO humanAnswerer on the proxy either — the watch client
        // registers none, and none may be needed.
      });
      const stats = await duel.run();
      ok(duel.over && (duel.state.winner === 0 || duel.state.winner === 1),
        'W4a: the worker watch duel completes with a winner');
      ok(promptMsgs === 0, 'W4b: zero prompt messages crossed to the main thread');
      ok(updateMsgs > 0 && stats.humanPrompts === 0,
        'W4c: the update stream flowed (the screen has something to render) and no prompt was counted human');
    } finally {
      await worker.terminate();
    }
  }

  console.log(failures ? ('FAILURES: ' + failures) : 'ALL WATCHMODE CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
