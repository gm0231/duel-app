'use strict';
/* test-fix1113d.js — fix round 2026-11-13 #4 (BU-69 continued).
 *
 * The parent's re-verification of round #3 (d81dee8, real
 * device-class environment, two returns reproduced) found the
 * landing itself working — correct summary from the first
 * moment, deck-page controls live — yet the screen stayed dark
 * with the duel view ghosting through it: 「その他のアクション」
 * (disabled), the opponent's LP / hand count and the player's
 * own LP readable as residue, the history button present in the
 * DOM but covered, unchanged after ~40 s. Reproduced locally
 * under CPU x20 + 400 kbps (cap-fix1113d before-run): the deck
 * page IS up within ~1.6 s of the reload with the right summary,
 * but the LP digits bleed through it in the screenshots. Split:
 *  - the duel view's sections stayed RENDERED under the
 *    full-screen pages for the entire boot (they are the base
 *    layer of #app and nothing ever hid them outside a duel);
 *  - the pages' surface (.overlay) was TRANSLUCENT (#0d0b08f5,
 *    ~96%), so the bright frozen board underneath — LP numbers,
 *    bars, the stale 「読み込み中…」 log line — showed through
 *    and read as "the veil never lifted".
 * The cure is structural, not a faster veil:
 *  - #app ships in the static markup with class "preduel": the
 *    ten duel sections are display:none until client.js removes
 *    the class at the one moment a duel starts (the start
 *    button's handler — the rematch path clicks the same
 *    button). Nothing rendered, nothing to bleed.
 *  - .overlay is fully opaque (#0d0b08), the same cure #deckcat
 *    already carried alone since 2026-11-08.
 *  - the inline landing script is fully self-contained: it
 *    re-asserts preduel and wires the title screen's own
 *    navigation （デッキを選ぶ / タイトルへ) at parse time, so a
 *    drawn title screen answers before the external chain has
 *    executed; the remaining load state lives only in the
 *    #loadmsg line and the start button's label.
 *  - the boot prefix no longer hides the deck page
 *    unconditionally: a page the inline script already put up
 *    (stash landing or an early tap) is left standing.
 * Pins: S = source, B = jsdom behaviour, including the delayed-
 * boot landing state (beforeParse stash, NO external script
 * injected at all) that this round's contract requires.
 */
const fs = require('fs');
const path = require('path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { console.log('SKIP: jsdom not resolvable (set NODE_PATH)'); process.exit(0); }

const V2 = __dirname;
const html = fs.readFileSync(path.join(V2, 'index.html'), 'utf8');
const clientSrc = fs.readFileSync(path.join(V2, 'client.js'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(V2, 'data.json'), 'utf8'));
const wasmBinary = fs.readFileSync(path.join(V2, 'build', 'ocgcore.wasm'));
let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const SECTIONS = ['header', 'placehint', 'oppField', 'lpband', 'myField', 'preview', 'handbar', 'fxlayer', 'fxcutin']; // BU-73: header + lpband replaced topbar/midbar/mybar

// ---------------------------------------------------------------- S: source pins
{
  ok(/<div id="app" class="preduel">/.test(html), 'S1: #app ships with class "preduel" in the static markup');
  const rule = html.match(/#app\.preduel[^{]*\{display:none;?\}/);
  ok(!!rule && SECTIONS.every(id => rule[0].includes('#' + id)), 'S2: the preduel rule hides all nine duel sections');
  const overlayRule = html.match(/\.overlay\{[^}]*\}/);
  ok(!!overlayRule && /background:#0d0b08;/.test(overlayRule[0]) && !/0d0b08f5/.test(overlayRule[0]),
    'S3: .overlay is fully opaque (#0d0b08, no alpha)');
  const startHandler = clientSrc.indexOf("$('startbtn').addEventListener('click'");
  const lift = clientSrc.indexOf("$('app').classList.remove('preduel')");
  ok(startHandler > -1 && lift > startHandler, 'S4: starting a duel (the start button handler) lifts preduel');
  ok((clientSrc.match(/classList\.remove\('preduel'\)/g) || []).length === 1, 'S5: preduel is lifted in exactly one place');
  const inlineAt = html.indexOf("getElementById('todeck')");
  const engineAt = html.indexOf('build/ocgcore.js');
  ok(inlineAt > -1 && engineAt > -1 && inlineAt < engineAt && html.includes("getElementById('deckback')"),
    'S6: the inline script wires todeck/deckback before the external chain');
  ok(clientSrc.includes("if ($('deckpage').style.display !== 'flex') $('deckpage').style.display = 'none';"),
    'S7: the boot prefix no longer hides a deck page the inline script already put up');
}

// ---------------------------------------------------------------- helpers
function parseOnly(stash) {
  // beforeParse plants the stash BEFORE the inline landing
  // script runs — the true parse-time path, no external script
  // is ever injected into this document.
  return new JSDOM(html, {
    url: 'http://localhost/v2/', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(window) {
      if (stash) window.sessionStorage.setItem('v3todeck', JSON.stringify(stash));
    },
  });
}
const sectionsHidden = (doc) => SECTIONS.every(id => doc.getElementById(id) && doc.getElementById(id).matches('#app.preduel>*'));

async function bootDeferred(stash) {
  const dom = new JSDOM(html, { url: 'http://localhost/v2/', runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  window.Audio = class { constructor(src) { this.src = src; this.volume = 1; } play() { return Promise.resolve(); } pause() {} };
  window.Image = class { constructor() { this._src = ''; } set src(v) { this._src = v; } get src() { return this._src; } };
  const wasmBuf = wasmBinary.buffer.slice(wasmBinary.byteOffset, wasmBinary.byteOffset + wasmBinary.byteLength);
  let resolveData = null;
  const dataPromise = new Promise(r => { resolveData = () => r({ ok: true, status: 200, json: async () => data, arrayBuffer: async () => wasmBuf }); });
  window.fetch = async (url) => {
    const u = String(url);
    if (u.includes('ocgcore.wasm')) return { ok: true, status: 200, url: u, arrayBuffer: async () => wasmBuf };
    if (u.includes('data.json')) return dataPromise;
    return { ok: true, status: 200, json: async () => data, arrayBuffer: async () => wasmBuf };
  };
  if (stash) window.sessionStorage.setItem('v3todeck', JSON.stringify(stash));
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
  return { window, resolveData };
}

(async () => {
  // ---- B1: delayed boot — the landing is complete with NO
  // external script at all (parse-time state) ----
  {
    const stash = { my: 'ishizu', op: 'monarch', first: 'second', sum: '自分：MILLENNIUM PROPHECY ／ 相手：帝王 ／ 後攻' };
    const dom = parseOnly(stash);
    const doc = dom.window.document;
    ok(doc.getElementById('app').classList.contains('preduel'), 'B1a: parse time, #app carries preduel');
    ok(sectionsHidden(doc), 'B1b: parse time, every duel section matches the hidden rule (nothing rendered to bleed through)');
    ok(doc.getElementById('start').style.display === 'none' && doc.getElementById('deckpage').style.display === 'flex',
      'B1c: parse time, landed on the deck page with no external script');
    ok(doc.getElementById('decksum').textContent.includes('帝王'), 'B1d: parse time, the stashed summary is already written');
    dom.window.close();
  }
  // ---- B2: first load — the drawn title screen answers at
  // parse time, with the duel view unrendered beneath it ----
  {
    const dom = parseOnly(null);
    const doc = dom.window.document;
    ok(sectionsHidden(doc), 'B2a: first load, duel sections are unrendered from the first parse');
    ok(doc.getElementById('deckpage').style.display !== 'flex', 'B2b: first load, the deck page is not up yet');
    doc.getElementById('todeck').click();
    ok(doc.getElementById('start').style.display === 'none' && doc.getElementById('deckpage').style.display === 'flex',
      'B2c: デッキを選ぶ answers with NO external script executed (parse-time wiring)');
    doc.getElementById('deckback').click();
    ok(doc.getElementById('deckpage').style.display === 'none' && doc.getElementById('start').style.display === 'flex',
      'B2d: タイトルへ answers the same way');
    dom.window.close();
  }
  // ---- B3: the boot prefix does not undo the inline landing,
  // and the pre-DATA state keeps the sections hidden ----
  {
    const stash = { my: 'ishizu', op: 'monarch', first: 'second', sum: '自分：MILLENNIUM PROPHECY ／ 相手：帝王 ／ 後攻' };
    const { window, resolveData } = await bootDeferred(stash);
    const doc = window.document;
    ok(doc.getElementById('deckpage').style.display === 'flex', 'B3a: pre-DATA, the deck page the prefix inherited is still up');
    ok(doc.getElementById('decksum').textContent.includes('帝王'), 'B3b: pre-DATA, the summary is the restored one');
    ok(doc.getElementById('app').classList.contains('preduel') && sectionsHidden(doc),
      'B3c: pre-DATA, the duel view is still unrendered (preduel held through the prefix)');
    resolveData();
    for (let i = 0; i < 100 && !doc.getElementById('loadmsg').textContent.includes('準備完了'); i++) await sleep(50);
    ok(doc.getElementById('loadmsg').textContent.includes('準備完了'), 'B3d: the boot still completes when data arrives');
    ok(doc.getElementById('app').classList.contains('preduel'), 'B3e: after the boot, preduel is STILL held (only a duel start lifts it)');
    window.close();
  }

  console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURES');
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('ERROR', e); process.exit(2); });
