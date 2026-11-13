'use strict';
/* test-brushup1113.js — brushup integration round 2026-11-13.
 *
 * BU-60: the deck page's middle region (.dp-main) spilled its
 * sections into the foot at 390x620 once a picked deck's row grew
 * (points line): the sound row painted over the summary line
 * (measured 17px of overlap after re-picking). The region now
 * contains its sections (overflow-y:auto), the page frame stays
 * fixed — same pattern as the deck lists.
 *
 * BU-61: the phase button ellipsised its longest labels
 * (「バトルフェイ…」; measured demand 135px of client width for
 * メインフェイズ2へ, the button flex-shrank to ~124px). The
 * button now never shrinks and reserves 136px, funded by the
 * mid bar's padding/gaps, the history button's slack and 1px of
 * the phase readout, which ellipsises cleanly under residual
 * pressure instead of being hard-clipped mid-glyph.
 *
 * BU-62: the history opened from anywhere but the result
 * screen's own button stayed UNDER the result overlay (z 60 over
 * the sheet's 50). The retreat now lives in openLogHistory
 * itself, so every entry shares it; the result button keeps only
 * its safety restore.
 *
 * Set-card plates (user decision 2026-11-13): the owner's set
 * cards keep their name plate and ATK/DEF plate. The stat plate
 * is slot-level (never covered); the name band sat inside .inner
 * under the animated veil (rig hit-test: veil on top at the
 * band's centre), so .tile.setown .nm is lifted above the veil.
 * The veil itself is untouched (2026-11-03 design).
 *
 * Spell/trap subtype icons (user instruction 2026-11-13): the
 * official symbols as pixel glyphs (tools/make_icons.py), derived
 * from the same type bits cardTypeLabel reads. marksChipHTML
 * returns the symbol chip for spells/traps; board tiles in the
 * spell/trap zone show it too (a monster lying there via an
 * effect keeps NO chip — the layout-fix J5 rule); the detail
 * meta line carries the icon next to the type words. Normal
 * spells/traps have no symbol on real cards -> no icon.
 * Pool census at the time of the round (165 cards): continuous
 * 14, quick-play 8, field 3, counter 2, ritual 2, equip 0,
 * normal (no symbol by design) 35.
 *
 * BU-20261113-01 needed no code: the engine probe (evidence in
 * the round's design record) shows the core itself delivers two
 * SELECT_CHAIN prompts for the set Gravekeeper's Trap in the
 * opponent's draw phase, in SEPARATE poc_process batches with
 * distinct raw bytes (a stepping timing counter) — two legal
 * priority windows, not a client re-presentation. YGOPro-faithful
 * behaviour is to present both, so the client is unchanged there.
 *
 * Geometry behaviour (overlap px, label sweep, hit tests) is
 * asserted by the round's Chrome rig (cap-brushup1113.js), not
 * here; this file pins the source contracts and the icon
 * derivation in jsdom.
 */
const fs = require('fs');
const path = require('path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { console.log('SKIP: jsdom not resolvable (set NODE_PATH)'); process.exit(0); }

const V2 = __dirname;
const html = fs.readFileSync(path.join(V2, 'index.html'), 'utf8');
const clientSrc = fs.readFileSync(path.join(V2, 'client.js'), 'utf8');
const iconsPy = fs.readFileSync(path.join(V2, '..', 'tools', 'make_icons.py'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(V2, 'data.json'), 'utf8'));
const wasmBinary = fs.readFileSync(path.join(V2, 'build', 'ocgcore.wasm'));
let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- source pins ----------
{
  ok(/\.dp-main\{[^}]*overflow-y:auto/.test(html) && /\.dp-main\{[^}]*overflow-x:hidden/.test(html),
    'B60a: .dp-main contains its sections (overflow-y auto / overflow-x hidden) — the foot can no longer be painted over');
  ok(/#phasebtn\{[^}]*flex:0 0 auto/.test(html) && /#phasebtn\{[^}]*min-width:136px/.test(html),
    'B61a: the phase button never shrinks and reserves the longest label width (136px)');
  ok(/#phaseinfo\{[^}]*flex:0 1 auto[^}]*min-width:0[^}]*text-overflow:ellipsis/.test(html),
    'B61b: the phase readout ellipsises cleanly under residual pressure (no mid-glyph hard clip)');
  // contract revised by fix round 2026-11-13 #2 (BU-65): the
  // band no longer sits inside .inner at all — it is a direct
  // child of the tile, upright and full-width, above the veil
  // by construction (the in-inner seat both hid it under the
  // veil and rotated it sideways on defense sets).
  ok(/\.tile\.setown > \.nm\{position:absolute;left:1px;right:1px;bottom:1px;z-index:2;\}/.test(html),
    'PLATEa: the name band of the owner\'s set cards is a tile-level plate above the veil (user decision 2026-11-13: plates stay)');
  ok(/\.tile\.setown \.inner \.veil\{position:absolute;inset:0;[^}]*setbreath/.test(html),
    'PLATEb: the veil itself is untouched (2026-11-03 design)');
  const olh = clientSrc.slice(clientSrc.indexOf('function openLogHistory()'));
  const olhHead = olh.slice(0, olh.indexOf('sheetOpen('));
  ok(olhHead.includes("resEl.style.display === 'flex'") && olhHead.includes("histFromResult = true"),
    'B62a: openLogHistory itself retreats the result overlay before opening (every entry shares it)');
  const rh = clientSrc.slice(clientSrc.indexOf("$('reshistbtn')"));
  ok(!rh.slice(0, 600).includes("$('result').style.display = 'none';\n    histFromResult = true;\n    openLogHistory();"),
    'B62b: the result button no longer carries its own private hide (single retreat path)');
  for (const g of ['st-quick', 'st-continuous', 'st-equip', 'st-field', 'st-ritual', 'st-counter'])
    ok(iconsPy.includes("icon('" + g + "', GOLD"), 'ICONa: make_icons.py generates ' + g);
  for (const g of ['st-quick', 'st-continuous', 'st-equip', 'st-field', 'st-ritual', 'st-counter']) {
    const p = path.join(V2, '..', 'assets', 'icons', g + '.png');
    ok(fs.existsSync(p) && fs.readFileSync(p).readUInt32BE(16) === 48 && fs.readFileSync(p).readUInt32BE(20) === 48,
      'ICONb: assets/icons/' + g + '.png exists at 48x48');
  }
  ok(clientSrc.includes('function stIconFile(code)') &&
     clientSrc.includes("if (t & 0x80000) return 'st-field.png'") &&
     clientSrc.includes("if (t & 0x100000) return 'st-counter.png'"),
    'ICONc: stIconFile derives the symbol from the cardTypeLabel type bits');
  ok(clientSrc.includes("loc !== E.LOC.SZONE || !isMonster(card.code)"),
    'ICONd: board S/T tiles carry the chip; a monster lying in the S/T zone still gets none (J5 rule kept)');
  ok(/\.sticon\{width:12px;height:12px/.test(html),
    'ICONe: the meta-line subtype icon is styled (.sticon, 12px pixel glyph)');
}

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
  const W = (fn) => window.eval(fn);
  // subtype derivation against real pool cards
  ok(W('stIconFile(28958464)') === 'st-quick.png', 'ICONf: MC版《死者蘇生》 (quick-play) -> st-quick');
  ok(W('stIconFile(98715423)') === 'st-continuous.png', 'ICONg: 《墓守の罠》 (continuous trap) -> st-continuous');
  ok(W('stIconFile(12923641)') === 'st-continuous.png', 'ICONh: 《闇の護封剣》 (continuous spell) -> st-continuous');
  ok(W('stIconFile(18158393)') === 'st-counter.png', 'ICONi: 《伍世壊浄心》 (counter trap) -> st-counter');
  ok(W('stIconFile(4398189)') === 'st-field.png', 'ICONj: 《白き森の魔女》 (field spell) -> st-field');
  ok(W('stIconFile(31002402)') === 'st-ritual.png', 'ICONk: 《凶導の福音》 (ritual spell) -> st-ritual');
  ok(W('stIconFile(83764718)') === null, 'ICONl: 《死者蘇生》 (normal spell) -> no symbol, as on real cards');
  ok(W('stIconFile(6351147)') === null, 'ICONm: 《ﾄﾗﾝｻﾞｸｼｮﾝ・ﾛｰﾙﾊﾞｯｸ》 (normal trap) -> no symbol, as on real cards');
  ok(W('stIconFile(46148485)') === null, 'ICONn: a monster -> no subtype symbol');
  // chip + meta line surfaces
  ok(W('marksChipHTML(28958464)').includes('st-quick.png'), 'ICONo: the chip for a quick-play spell carries the bolt');
  ok(W('marksChipHTML(83764718)') === '', 'ICONp: a normal spell gets no chip');
  ok(W('marksChipHTML(46148485)').includes('attr-earth.png'), 'ICONq: monster chips are unchanged (attribute/star/race)');
  const meta = W('cardMetaLine(28958464)');
  ok(meta.includes('sticon') && meta.includes('st-quick.png') && meta.includes('速攻魔法'),
    'ICONr: the detail meta line shows the symbol next to the type words');
  const metaN = W('cardMetaLine(83764718)');
  ok(!metaN.includes('sticon') && metaN.includes('通常魔法'), 'ICONs: a normal spell\'s meta line stays words only');
  window.close();
  console.log(failures ? ('FAILURES: ' + failures) : 'ALL PASS');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
