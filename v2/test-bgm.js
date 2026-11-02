'use strict';
/* test-bgm.js — BGM 3-stage verification (jsdom; NODE_PATH=<dir with jsdom>).
   The user-decided system (2026-11-03): start screen = upload track on
   loop; the duel climbs the MD-style ladder Normal -> Keycard -> Climax
   and never comes back down. Each stage owns a 2-track pool, picked at
   random; stage tracks do not loop — on 'ended' the next pick from the
   same stage excludes the track that just finished. Keycard trigger =
   either player summons a key card; Climax trigger = either LP <= 2000.
   Result: win = pyramid track, loss = a Climax-pool draw.

   Randomness is made deterministic by replacing window.Math.random with
   a seeded LCG before any interaction. Assertions therefore check pool
   MEMBERSHIP for fresh picks (the LCG sequence also feeds the engine's
   own shuffle) and exact EXCLUSION for ended re-picks (pool of 2 -> the
   other track, regardless of the random value).

   Two boots:
   (1) wiring — the real start flow: a pointerdown starts the 'start'
       scene (upload, looped); clicking the start button switches to
       Normal synchronously inside the click handler.
   (2) logic — no duel is started (a stalled human prompt would rightly
       defer every switch); the stage is entered through __bgm.sceneTo,
       the same setBgmScene call the start handler makes, and
       updateBgm is driven with synthetic engine-shaped states.
   The Audio stub records every element; the BGM element is the one
   whose src history touches ../assets/bgm/. */
const fs = require('fs');
const path = require('path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { console.log('SKIP: jsdom not resolvable (set NODE_PATH)'); process.exit(0); }

const V2 = __dirname;
const html = fs.readFileSync(path.join(V2, 'index.html'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(V2, 'data.json'), 'utf8'));
const wasmBinary = fs.readFileSync(path.join(V2, 'build', 'ocgcore.wasm'));

const POOLS = {
  normal: ['ishizu-start.mp3', 'ishizu-caravan.mp3'],
  keycard: ['ishizu-advantage.mp3', 'ishizu-big-advantage.mp3'],
  climax: ['ishizu-voice-note-2.mp3', 'ishizu-mystical.mp3'],
};
const inPool = (stage, file) => POOLS[stage].includes(file);
const otherOf = (stage, file) => POOLS[stage].find(f => f !== file);

async function boot() {
  const dom = new JSDOM(html, { url: 'http://localhost/v2/', runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  const audioLog = [];
  window.Audio = class {
    constructor(src) {
      this._src = src || '';
      this.srcHistory = this._src ? [this._src] : [];
      this.volume = 1; this.loop = false; this.currentTime = 0;
      this._ended = [];
      audioLog.push(this);
    }
    get src() { return this._src; }
    set src(v) { this._src = v; this.srcHistory.push(v); }
    addEventListener(name, fn) { if (name === 'ended') this._ended.push(fn); }
    removeEventListener() {}
    fireEnded() { for (const fn of this._ended.slice()) fn(); }
    play() { return Promise.resolve(); }
    pause() {}
  };
  const wasmBuf = wasmBinary.buffer.slice(wasmBinary.byteOffset, wasmBinary.byteOffset + wasmBinary.byteLength);
  window.fetch = async (url) => {
    if (String(url).includes('ocgcore.wasm')) return { ok: true, status: 200, url: String(url), arrayBuffer: async () => wasmBuf };
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
  inject('client.js');
  for (let i = 0; i < 100 && !window.document.getElementById('loadmsg').textContent.includes('準備完了'); i++)
    await new Promise(r => setTimeout(r, 50));
  // Deterministic randomness for every pick from here on.
  let seed = 123456789;
  window.Math.random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const bgmEl = () => audioLog.find(a => a.srcHistory.some(s => s.includes('assets/bgm/'))) || null;
  return { window, bgmEl };
}

const EMPTY = () => [null, null, null, null, null];
const mkState = (lp0, lp1, mz0, mz1) => ({
  winner: null,
  players: [{ lp: lp0, mzone: mz0 || EMPTY() }, { lp: lp1, mzone: mz1 || EMPTY() }],
});

(async () => {
  let failures = 0;
  const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };

  // ---------------- boot 1: the real start flow ----------------
  {
    const { window, bgmEl } = await boot();
    const B = window.__bgm;
    ok(!!B, 'BGM-0: window.__bgm test surface exists');
    window.document.dispatchEvent(new window.Event('pointerdown'));
    ok(B.scene === 'start' && B.file === 'ishizu-upload.mp3',
      'BGM-1: first tap starts the start scene with the upload track (scene=' + B.scene + ', file=' + B.file + ')');
    ok(!!bgmEl() && bgmEl().loop === true, 'BGM-2: the start track loops');
    window.document.getElementById('startbtn').click();
    for (let i = 0; i < 40 && B.scene !== 'normal'; i++) await new Promise(r => setTimeout(r, 50));
    ok(B.scene === 'normal', 'BGM-3: duel start switches start -> Normal (scene=' + B.scene + ')');
    ok(inPool('normal', B.file), 'BGM-4: the Normal track comes from the Normal pool (' + B.file + ')');
    ok(bgmEl().loop === false, 'BGM-5: stage tracks do not loop');
    window.close();
  }

  // ---------------- boot 2: the stage ladder logic ----------------
  {
    const { window, bgmEl } = await boot();
    const B = window.__bgm;
    const plain = mkState(8000, 8000);
    // No duel scene yet: triggers must not latch outside a duel.
    B.update(mkState(8000, 8000, [{ code: 8505920 }, null, null, null, null]));
    ok(B.scene === null && B.wantedRank === -1, 'BGM-6: before the duel, updateBgm is inert (no scene, nothing latched)');

    B.sceneTo('normal'); // the same call the start button makes
    ok(B.scene === 'normal' && inPool('normal', B.file), 'BGM-7: entering Normal draws from the Normal pool (' + B.file + ')');
    B.update(plain);
    ok(B.scene === 'normal' && B.wantedRank === -1, 'BGM-8: a plain state changes nothing');

    // Key card on the OPPONENT's field (either player's summon counts):
    // 8505920 = 合体魔神－ゲート・ガーディアン.
    B.update(mkState(8000, 8000, EMPTY(), [{ code: 8505920 }, null, null, null, null]));
    ok(B.scene === 'keycard' && B.wantedRank === 1 && inPool('keycard', B.file),
      'BGM-9: a key card summon climbs Normal -> Keycard (' + B.file + ')');

    // A non-key boss piece (25955164 = 雷魔神－サンガ) must not re-trigger
    // anything, and a plain state must not bring the stage back down.
    B.update(mkState(8000, 8000, [{ code: 25955164 }, null, null, null, null]));
    B.update(plain);
    ok(B.scene === 'keycard', 'BGM-10: the stage never goes back down');

    // Track end: same stage, the OTHER track (exclusion), no loop.
    const beforeEnd = B.file;
    bgmEl().fireEnded();
    ok(B.scene === 'keycard' && B.file === otherOf('keycard', beforeEnd),
      'BGM-11: on ended, the same stage re-draws excluding the finished track (' + beforeEnd + ' -> ' + B.file + ')');

    // Climax at exactly LP 2000 (the <= boundary), on the human's side.
    B.update(mkState(2000, 8000));
    ok(B.scene === 'climax' && B.wantedRank === 2 && inPool('climax', B.file),
      'BGM-12: LP 2000 climbs Keycard -> Climax (' + B.file + ')');
    B.update(plain); // LP "recovers" in the synthetic state — ladder stays.
    ok(B.scene === 'climax', 'BGM-13: Climax is latched even if LP rises again');
    const beforeEnd2 = B.file;
    bgmEl().fireEnded();
    ok(B.file === otherOf('climax', beforeEnd2), 'BGM-14: Climax re-draws its other track on ended (' + beforeEnd2 + ' -> ' + B.file + ')');

    // Result wiring: win = pyramid on loop; loss = a Climax-pool draw.
    B.sceneTo('win');
    ok(B.scene === 'win' && B.file === 'ishizu-big-advantage.mp3' && bgmEl().loop === true,
      'BGM-15: a win plays the pyramid track, looped');
    B.sceneTo('lose');
    ok(B.scene === 'climax' && inPool('climax', B.file) && bgmEl().loop === false,
      'BGM-16: a loss draws from the Climax pool (' + B.file + ')');
    window.close();
  }

  console.log(failures === 0 ? 'ALL BGM CHECKS PASSED' : failures + ' BGM CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
