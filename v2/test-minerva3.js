'use strict';
/* test-minerva3.js — Minerva 3rd triage: activation-lock reasons.
   Root cause of the user's 2026-11-03 report (turn 1, Minerva Xyz-
   summoned with materials x2 and a 30-card deck, yet 発動 greyed):
   the Vernusylph hand effects (森と目覚の春化精 36745317 / 花と野原の
   春化精 62133026) carry 「このターン、自分は地属性以外のモンスター
   の効果を発動できない」, and Minerva is LIGHT — the core correctly
   omits her ignition from SELECT_IDLECMD (reproduced at engine
   level in repro-minerva3b.js: 11 Vernusylph-fired duels, blocked
   every time; unfired controls offered and resolved normally).
   The defect was invisibility: the sheet's greyed row could only
   say 「今は発動できません」. The client now derives the locking
   cards from the pool's own texts, tracks the human's activation
   on the presentation event stream (same latch path as BGM), and
   states the real reason. This test drives that tracker through
   the window.__mlock surface — the same functions the duel flow
   itself calls (noteMonsterLock via drainSeEvents).            */
const fs = require('fs');
const path = require('path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { console.log('SKIP: jsdom not resolvable (set NODE_PATH)'); process.exit(0); }

const V2 = __dirname;
const html = fs.readFileSync(path.join(V2, 'index.html'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(V2, 'data.json'), 'utf8'));
const wasmBinary = fs.readFileSync(path.join(V2, 'build', 'ocgcore.wasm'));

const MINERVA = 30100551, KALDAN = 86605515, MORI = 36745317, HANA = 62133026, OKA = 9350312;
// The reason NAMES the card whose effect imposed the lock (user
// direction 2026-11-03: 「〜の効果の制約で発動できません」).
const REASON_MORI = '《森と目覚の春化精》の効果の制約で、このターンは地属性以外のモンスター効果を発動できません';
const REASON_HANA = '《花と野原の春化精》の効果の制約で、このターンは地属性以外のモンスター効果を発動できません';
const REASON_OKA = '《丘と芽吹の春化精》の効果の制約で、このターンは地属性以外のモンスター効果を発動できません';

async function boot() {
  const dom = new JSDOM(html, { url: 'http://localhost/v2/', runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  window.Audio = class {
    constructor(src) { this._src = src || ''; this.srcHistory = this._src ? [this._src] : []; this.volume = 1; this.loop = false; this.currentTime = 0; }
    get src() { return this._src; }
    set src(v) { this._src = v; this.srcHistory.push(v); }
    addEventListener() {} removeEventListener() {}
    play() { return Promise.resolve(); } pause() {}
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
  return { window };
}

(async () => {
  let failures = 0;
  const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };
  const { window } = await boot();
  const M = window.__mlock;
  ok(!!M, 'M3-0: window.__mlock test surface exists');

  const cards = M.cards();
  ok(cards.length === 3 && cards.every(c => c.attr === 1 && c.kanji === '地') &&
     cards.some(c => c.code === MORI) && cards.some(c => c.code === HANA) && cards.some(c => c.code === OKA),
     'M3-1: lock set derived from card texts = {森と目覚の春化精, 花と野原の春化精, 丘と芽吹の春化精}, all EARTH-exception (' + JSON.stringify(cards) + ')');

  ok(M.active === null && M.reason(MINERVA, 1) === null, 'M3-2: no lock before any activation -> no reason stated');

  M.note({ kind: 'activate', code: MORI, con: 1, loc: 2 }, { turnCount: 1 });
  ok(M.active === null, 'M3-3: the OPPONENT firing a Vernusylph effect does not latch the human lock');

  M.note({ kind: 'activate', code: MORI, con: 0, loc: 2 }, { turnCount: 1 });
  ok(!!M.active && M.active.turnCount === 1 && M.active.code === MORI, 'M3-4: human Vernusylph activation latches the lock for the turn, WITH the imposing card recorded');
  ok(M.reason(MINERVA, 1) === REASON_MORI, 'M3-5: LIGHT Minerva gets the real reason, naming 森と目覚の春化精');
  ok(M.reason(KALDAN, 1) === null, 'M3-6: EARTH Kaldan is the excepted attribute -> no reason');
  ok(M.reason(MINERVA, 2) === null, 'M3-7: the lock (and its reason) expires with the turn');

  M.reset();
  M.note({ kind: 'activate', code: 99937011, con: 0, loc: 2 }, { turnCount: 3 });
  ok(M.active === null, 'M3-8: an unrelated activation does not latch');
  M.note({ kind: 'activate', code: HANA, con: 0, loc: 2 }, { turnCount: 3 });
  ok(M.reason(MINERVA, 3) === REASON_HANA, 'M3-9: 花と野原の春化精 latches the same lock, and the reason names HER');

  M.reset();
  M.note({ kind: 'activate', code: OKA, con: 0, loc: 2 }, { turnCount: 5 });
  ok(M.reason(MINERVA, 5) === REASON_OKA, 'M3-10: 丘と芽吹の春化精 (new in v11) latches the same lock, and the reason names HER');

  window.close();
  console.log(failures ? 'TEST FAIL (' + failures + ')' : 'TEST PASS');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
