'use strict';
/* test-bigfix.js — 台帳一掃ラウンド第3弾 (bigfix-1115) のピンテスト。
   jsdom で見える範囲（純粋ヘルパー・DOM・スタイルシート契約）を
   ここで固定する。レイアウト実測が要る項目（BU-36/44/54/55、
   通知の幅、BU-39 の実プレイ理由表示、BU-24 のドック実物、
   BU-21/53 の実フロー）は Puppeteer ミラーのプローブで測る
   （記録は hidden_files/bigfix-1115/RECORD.md）。 */
const fs = require('fs');
const path = require('path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { console.log('SKIP: jsdom not resolvable (set NODE_PATH)'); process.exit(0); }

const V2 = __dirname;
const html = fs.readFileSync(path.join(V2, 'index.html'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(V2, 'data.json'), 'utf8'));
const wasmBinary = fs.readFileSync(path.join(V2, 'build', 'ocgcore.wasm'));
let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const codeOf = (name) => { for (const [c, n] of Object.entries(data.names)) if (n === name) return +c; return null; };

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
  const B = window.__bigfix;
  ok(!!B, 'BF0: window.__bigfix test surface exists');

  // ---- BU-48: favicon ----
  const fav = doc.querySelector('link[rel="icon"]');
  ok(!!fav && (fav.getAttribute('href') || '').includes('card-art-placeholder-s.jpg'), 'BF1 (BU-48): favicon link present');

  // ---- BU-57 / BU-14: quoting + context line ----
  ok(B.qName('マジックカード「死者蘇生」') === '《マジックカード「死者蘇生」》', 'BF2 (BU-57): a name carrying 「」 is wrapped in 《》');
  ok(B.qName('宿神像ケルドウ') === '「宿神像ケルドウ」', 'BF2b (BU-57): a plain name is wrapped in 「」');
  const mc = codeOf('マジックカード「死者蘇生」');
  const kel = codeOf('宿神像ケルドウ');
  ok(mc === 28958464 && !!kel, 'BF2c: fixture codes resolve from data.json (MC死者蘇生=28958464)');
  const strip = (h) => h.replace(/<[^>]+>/g, '');
  const ctx1 = strip(B.contextLineHTML({ context: { code: mc, con: 0, loc: 2, seq: 0 } }));
  ok(ctx1.startsWith('自分の手札の') && ctx1.includes('《マジックカード「死者蘇生」》の効果') && ctx1.endsWith('による確認') && !ctx1.includes('「マジックカード「'),
    'BF3 (BU-14/57): context line leads with the source location and never doubles brackets (' + ctx1 + ')');
  const ctx2 = strip(B.contextLineHTML({ context: { code: kel, con: 0, loc: 16, seq: 0 } }));
  ok(ctx2 === '自分の墓地の「宿神像ケルドウ」の効果による確認', 'BF3b (BU-14): plain context line form (' + ctx2 + ')');

  // ---- field-zone availability (availZones root-cause fix) ----
  const fz = B.availZones({ player: 0, flag: (0xFFFFFFFF ^ 0x2000) >>> 0 });
  ok(fz.length === 1 && fz[0].con === 0 && fz[0].loc === 8 && fz[0].seq === 5,
    'BF4 (fzone): a place offer of ONLY the field zone yields the fzone tile (SZONE seq 5)');
  const mz = B.availZones({ player: 1, flag: (0xFFFFFFFF ^ 0x1) >>> 0 });
  ok(mz.length === 1 && mz[0].loc === 4 && mz[0].seq === 0, 'BF4b: MZONE-only offer unchanged');

  // ---- BU-21: placement naming ----
  ok(B.placeZoneLabel({ con: 0, loc: 8, seq: 5 }) === '自分のフィールドゾーン', 'BF5 (BU-21): SZONE seq 5 names the field zone');
  ok(B.placeZoneLabel({ con: 0, loc: 4, seq: 2 }) === '自分のモンスターゾーン3', 'BF5b (BU-21): MZONE seq names with number');
  ok(B.placeZoneLabel({ con: 1, loc: 8, seq: 0 }) === '相手の魔法・罠ゾーン1', 'BF5c (BU-21): opponent SZONE names with number');

  // ---- BU-52: deck key-card thumbnails ----
  const keys = ['ishizu', 'gg', 'superquant', 'elfennotes', 'whiteforest', 'monarch'];
  const srcs = keys.map(k => B.deckThumbSrc(k));
  ok(srcs.every(s => s && s.includes('card-art-') && !s.includes('placeholder')), 'BF6 (BU-52): every builtin deck resolves a real key-card art (' + srcs.join(', ') + ')');
  ok(new Set(srcs).size === keys.length, 'BF6b (BU-52): the six key-card arts are all distinct');
  const myImg = doc.querySelector('#mydeckcur img'), opImg = doc.querySelector('#opdeckcur img');
  ok(myImg && myImg.src.endsWith(srcs[0].split('/').pop()), 'BF6c (BU-52): my current-deck row shows the Ishizu key card');
  ok(opImg && opImg.src.endsWith(srcs[1].split('/').pop()), 'BF6d (BU-52): opponent current-deck row shows the GG key card');

  // ---- BU-51: shortened blurbs (no redundant pt restatement) ----
  doc.getElementById('todeck').click();
  doc.getElementById('mydeckcur').click();
  doc.querySelector('#deckcatlist .catbtn[data-cat="genesys"]').click();
  const elfRow = doc.querySelector('#seg-mydeck .deckrow[data-key="elfennotes"] .dd');
  ok(!!elfRow && elfRow.textContent.includes('エルフェンノーツデッキ') && !elfRow.textContent.includes('組み直し'),
    'BF7 (BU-51): elfennotes blurb no longer restates the pt rebuild (' + (elfRow ? elfRow.textContent : 'row missing') + ')');
  doc.getElementById('deckmodalx').click();
  doc.getElementById('deckcatback').click();
  doc.getElementById('deckback').click();

  // ---- BU-45: confirm-sheet thumbnails ----
  window.__confirm.push({ kind: 'confirm', shown: 0, cards: [
    { code: 45409943, con: 0, loc: 1, seq: 0 },
    { code: kel, con: 0, loc: 1, seq: 1 },
  ] });
  const shown = window.__confirm.show();
  await sleep(30);
  const rows = doc.querySelectorAll('#sheet .sortrow');
  ok(rows.length === 2, 'BF8 (BU-45): confirm sheet lists both cards');
  ok(rows.length === 2 && [...rows].every(r => { const t = r.querySelector('.cthumb'); return t && (t.getAttribute('style') || '').includes('card-art-'); }),
    'BF8b (BU-45): every confirm row carries its card art thumbnail');
  doc.getElementById('sheet-cancel').click();
  await shown;

  // ---- BU-58: confirm-reveal matching ----
  const gg3 = [...new Set(data.decks.gg.main)].slice(0, 3);
  const mk = (codes, seqs) => ({ cards: codes.map((code, i) => ({ ref: { code, con: 1, loc: 1, seq: seqs[i] } })), prompt: {} });
  B.setLastConfirm(gg3.map((code, i) => ({ code, con: 1, loc: 1, seq: 5 + i })), null);
  ok(B.confirmRevealIdx(mk(gg3, [5, 6, 7])).size === 3, 'BF9 (BU-58): an exact confirmed set is revealed');
  ok(B.confirmRevealIdx(mk([gg3[0], gg3[1], 11111111], [5, 6, 7])).size === 0, 'BF9b (BU-58): a different code keeps the set hidden');
  ok(B.confirmRevealIdx(mk(gg3, [5, 6, 9])).size === 0, 'BF9c (BU-58): a seq outside the confirmed set keeps it hidden');
  ok(B.confirmRevealIdx(mk(gg3.slice(0, 2), [5, 6])).size === 0, 'BF9d (BU-58): a partial set keeps it hidden');
  B.setLastConfirm([], null);

  // ---- stylesheet contracts (source pins; geometry is probe-measured) ----
  ok(/#peekbar\{[^}]*flex-wrap:nowrap/.test(html), 'BF10 (BU-55): peek bar is one row (flex-wrap:nowrap)');
  ok(/\.ct-card\{[^}]*width:72px/.test(html) && /#chainui\{[^}]*width:252px/.test(html), 'BF10b (BU-74): tray cards widened to 72px, tray to 252px');
  ok(/#sheet \.actart\{/.test(html), 'BF10c (BU-38): action-sheet art band style exists');
  ok(/#dock \.chainlist\{/.test(html), 'BF10d (BU-24): dock chain list style exists');
  ok(/\.sortrow \.cthumb\{/.test(html), 'BF10e (BU-45): confirm thumb style exists');

  console.log(failures ? ('FAILURES: ' + failures) : 'ALL PASS');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('ERROR', e && e.stack || e); process.exit(2); });
