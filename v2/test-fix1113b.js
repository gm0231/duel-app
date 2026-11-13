'use strict';
/* test-fix1113b.js — fix round 2026-11-13 #2 (BU-63..67).
 *
 * BU-63 (F1): the その他 menu's 選択に戻る no longer ends the
 * duel on a single tap — askQuitToDeckSelection puts one
 * confirmation sheet in between (nothing is stashed until
 * 終了する is pressed; 対局に戻る just closes the sheet). The
 * reload landing also lifts the 「読み込み中…」 veil up front
 * when a 'v3todeck' stash exists, instead of leaving the title
 * overlay up until data.json arrives. (The round trip itself —
 * stash contents, landing state — stays pinned by
 * test-quitdeck.js, updated for the confirmation step.)
 *
 * BU-64 (F2): openPileSheet's deck branch rendered only the
 * count — zero card rows. For the owner's seat it now derives
 * the remaining deck (ownDeckRemainder: the starting list
 * minus every own card visible outside the deck) and renders
 * rows whenever the derivation's size agrees with deckCount;
 * otherwise the count stands behind an explicit note. The
 * opponent's deck stays count-only (hidden information).
 *
 * BU-65 (F3): the owner's set card rendered its name band
 * INSIDE the rotating .inner: on a face-down defense tile the
 * band lay sideways with a measured 26.2px run on a 36px tile
 * (5-6 glyphs — 「森と目…」). The band is now a direct child
 * of the tile, upright, spanning the tile's full width with
 * the face-up band's font and ellipsis rule. The veil (inside
 * .inner, 2026-11-03 design) is untouched.
 *
 * BU-66 (F4): in selection grids the marks chip rode inside
 * the name band at the card's bottom, while every other
 * surface seats it top-left. The chip now leaves the band in
 * all three grid renderers and takes the top-left seat; the
 * location label stacks under it at a fixed seat. The preview
 * strip's thumbnail gains the same chip (suppressed in the
 * compact strip, whose thumbnail measures ~0 wide).
 *
 * BU-67 (F5): the deck summary line was one plain text node
 * and broke inside 先攻 (measured: 先 / 攻 on separate lines).
 * updateDeckSum now renders it through nbHTML — identical
 * text, break opportunities only between units.
 *
 * Geometry (band widths, chip seats, veil timelines) is
 * asserted by the round's Chrome rig (cap-fix1113b.js); this
 * file pins the source contracts in jsdom and drives one real
 * duel for the pile sheet behaviour.
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
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- source pins ----------
{
  // F1a: the confirmation gate
  ok(clientSrc.includes('function askQuitToDeckSelection()'), 'F63a: askQuitToDeckSelection exists');
  ok(clientSrc.includes("addEventListener('click', () => { playClick(); askQuitToDeckSelection(); })"),
    'F63b: the menu 選択に戻る routes through the confirmation, not straight to the exit');
  const ask = clientSrc.slice(clientSrc.indexOf('function askQuitToDeckSelection()'), clientSrc.indexOf('function quitToDeckSelection()') > clientSrc.indexOf('function askQuitToDeckSelection()') ? clientSrc.indexOf('function quitToDeckSelection()') : undefined);
  ok(ask.includes('対局を終了しますか？') && ask.includes('id="quit-confirm">終了する') && ask.includes('id="quit-cancel">対局に戻る'),
    'F63c: the confirmation sheet offers 終了する and 対局に戻る');
  ok(ask.includes("$('quit-cancel').addEventListener('click', () => { playClick(); sheetClose(); })"),
    'F63d: 対局に戻る only closes the sheet (the duel continues)');
  // F1b: the early veil lift sits BEFORE the data.json fetch in the boot IIFE
  const liftIdx = clientSrc.indexOf("if (sessionStorage.getItem('v3todeck')) {");
  const fetchIdx = clientSrc.indexOf("DATA = await (await fetch('data.json')).json();");
  ok(liftIdx > 0 && fetchIdx > 0 && liftIdx < fetchIdx,
    'F63e: the boot-time veil lift reads the stash before data.json is fetched');
  ok(clientSrc.slice(liftIdx, liftIdx + 220).includes("$('deckpage').style.display = 'flex'") &&
     clientSrc.slice(liftIdx, liftIdx + 220).includes("$('start').style.display = 'none'"),
    'F63f: the lift shows the deck page frame and hides the title overlay');
  // F2: the remainder derivation + deck rows
  ok(clientSrc.includes('function ownDeckRemainder(con)'), 'F64a: ownDeckRemainder exists');
  ok(clientSrc.includes('exact: rows.length === P.deckCount'),
    'F64b: the list is shown only when the derivation agrees with deckCount');
  const deckBranch = clientSrc.slice(clientSrc.indexOf("} else if (kind === 'deck') {"), clientSrc.indexOf("} else if (kind === 'hand') {"));
  ok(deckBranch.includes('if (con === HP)') && deckBranch.includes('class="sortrow"') && deckBranch.includes('（順不同）'),
    'F64c: the own deck branch renders rows labelled （順不同）');
  ok(deckBranch.includes('内訳を確認できないカードがあります'),
    'F64d: a count disagreement is stated, not silently listed');
  // F3: the set-card band leaves the rotating inner
  const tileFn = clientSrc.slice(clientSrc.indexOf('function tileHTML('), clientSrc.indexOf('function slotStatsHTML('));
  ok(tileFn.includes("(ownSet ? '' : (nm ?") && tileFn.includes("(ownSet && nm ? '<div class=\"nm'"),
    'F65a: tileHTML renders the set card band outside .inner (and face-up bands stay inside)');
  ok(/\.tile\.setown > \.nm\{position:absolute;left:1px;right:1px;bottom:1px;z-index:2;\}/.test(html),
    'F65b: the set band is a tile-level plate spanning the tile width, above the veil');
  ok(/\.tile\.setown \.inner \.veil\{position:absolute;inset:0;[^}]*setbreath/.test(html),
    'F65c: the veil itself is untouched (2026-11-03 design)');
  // F4: grid chips leave the band; preview thumbnail gains the chip
  ok(!html.includes('.gcard .nm .marks{position:static'), 'F66a: the in-band chip seat rule is gone');
  ok(/\.gcard > \.marks\{top:3px;left:3px;z-index:3;\}/.test(html), 'F66b: grid chips take the top-left seat');
  ok(/\.gcard \.loc\{position:absolute;top:23px;left:3px;/.test(html), 'F66c: the location label stacks under the chip seat');
  ok(clientSrc.includes("'</div>' + (hid ? '' : marksChipHTML(c.code)) + '<div class=\"nm'"),
    'F66d: gridSheet places the chip as a card-level child, before the band');
  ok(clientSrc.includes("'</div>' + (hid ? '' : marksChipHTML(x.c.code)) + '<div class=\"nm'"),
    'F66e: the unselect grid does the same');
  ok(clientSrc.includes("artInline(code, false, deckKeyOfCode(code)) + '>' + marksChipHTML(code) + '<div class=\"nm'"),
    'F66f: the announce grid does the same');
  ok(clientSrc.includes("+ '>' + marksChipHTML(previewState.code) + '</div><div class=\"pv-body\">'"),
    'F66g: the preview thumbnail carries the chip');
  ok(/#preview\.compact \.pv-art \.marks\{display:none;\}/.test(html),
    'F66h: the compact strip (thumbnail ~0 wide) suppresses the chip');
  // F5: the summary line uses unbreakable units
  const uds = clientSrc.slice(clientSrc.indexOf('function updateDeckSum()'));
  ok(uds.slice(0, uds.indexOf('refreshStartGate();')).includes('el.innerHTML = nbHTML(txt);'),
    'F67a: updateDeckSum renders the summary through nbHTML');
}

// ---------- live behaviour in jsdom ----------
async function boot() {
  const dom = new JSDOM(html, { url: 'http://localhost/v2/', runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  window.Audio = class { constructor(src) { this.src = src; this.volume = 1; } play() { return Promise.resolve(); } pause() {} };
  window.Image = class { constructor() { this._src = ''; } set src(v) { this._src = v; } get src() { return this._src; } };
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
  inject('duel-worker.js');
  inject('neuron.js');
  inject('client.js');
  for (let i = 0; i < 100 && !window.document.getElementById('loadmsg').textContent.includes('準備完了'); i++)
    await sleep(50);
  return window;
}

(async () => {
  const window = await boot();
  const doc = window.document;
  // F5 (live): the summary is unit-wrapped, text unchanged
  const sum = doc.getElementById('decksum');
  ok(sum.querySelectorAll('.nb').length >= 3, 'F67b: the summary renders as unbreakable units (' + sum.querySelectorAll('.nb').length + ')');
  const units = [...sum.querySelectorAll('.nb')].map(s => s.textContent);
  ok(units.some(u => u.includes('先攻')), 'F67c: 先攻 survives whole inside one unit (units: ' + units.join(' | ') + ')');
  ok(sum.textContent.includes('自分：') && sum.textContent.includes('／') && sum.textContent.includes('先攻'),
    'F67d: the summary text itself is unchanged');

  // start a duel and wait for the first idle prompt
  doc.getElementById('startbtn').click();
  let ready = false;
  for (let i = 0; i < 450 && !ready; i++) {
    await sleep(200);
    ready = !doc.getElementById('menubtn').disabled && doc.getElementById('sheetwrap').className !== 'on';
  }
  ok(ready, 'LIVE0: the duel reaches an idle prompt');
  if (ready) {
    const hp = window.eval('HP');
    ok(typeof window.eval('ownDeckRemainder') === 'function', 'F64e: ownDeckRemainder is reachable in the live client');
    window.eval('openPileSheet("deck", ' + hp + ')');
    await sleep(120);
    const sheet = doc.getElementById('sheet');
    const rows = sheet.querySelectorAll('.sortrow');
    const sub = (sheet.querySelector('.sub') || {}).textContent || '';
    const m = /残り (\d+) 枚/.exec(sub);
    ok(!!m && rows.length === +m[1], 'F64f: the own deck sheet renders one row per remaining card (' + rows.length + ' rows, sub says ' + (m ? m[1] : '?') + ')');
    ok(sub.includes('（順不同）'), 'F64g: the remainder is labelled （順不同）');
    ok([...rows].every(r => r.textContent.trim().length > 1), 'F64h: every row names a card');
    doc.getElementById('sheet-cancel').click();
    await sleep(120);
    window.eval('openPileSheet("deck", ' + (1 - hp) + ')');
    await sleep(120);
    const osheet = doc.getElementById('sheet');
    ok(osheet.querySelectorAll('.sortrow').length === 0 && /残り \d+ 枚/.test((osheet.querySelector('.sub') || {}).textContent || ''),
      'F64i: the opponent deck sheet stays count-only (hidden information)');
    doc.getElementById('sheet-cancel').click();
  }
  window.close();
  console.log(failures === 0 ? 'ALL FIX1113B CHECKS PASSED' : failures + ' FIX1113B CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
