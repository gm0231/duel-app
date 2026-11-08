'use strict';
/* test-deckpage.js — deck selection as its own page, with the
   choice flow the user designed 2026-11-08: the deck page shows
   only the CURRENT choice per side; changing it walks deck page ->
   category page (#deckcat) -> deck modal (#deckmodal). Categories
   are data-driven (data.json decks carry category): キャラクター
   デッキ / Genesys環境テーマ（2026年10月時点） / 取り込んだデッキ
   (own side only). The modal lists the category's decks with a
   一覧 (contents) view per deck; picking a deck closes both layers
   and lands back on the deck page with the choice applied.
   Contract under test:
   - The title page (#start) carries NO deck controls — only the
     title, the tagline, the GENESYS rules line (2026年10月時点
     リスト), the load message and the 「デッキを選ぶ」 button.
   - The deck page (#deckpage) holds the two current-choice rows,
     先攻・後攻, the settings rows and the start button; it is
     hidden until navigated to, and the back button returns.
   - The seg lists live inside the modal, not on the deck page.
   - The selection summary above the start button always names the
     current own deck / opponent deck / first-second choice.
   - Starting from the deck page runs the existing flow unchanged:
     VS curtain (no start button on it), then both pre-duel pages
     are hidden and the duel board appears.
   Regression contract (2026-11-08 field report): modal deck rows
   must never overflow horizontally (the 一覧 button stays visible
   without sideways scrolling; list scroll offsets reset on open
   and on return from the contents view), and the imported
   category button is absent from the DOM itself — not merely
   hidden — on the opponent category page.
   Method: boot the real client in jsdom (harness as test-ui) and
   click through the pages with DOM clicks only. */
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
  const disp = (id) => window.getComputedStyle(doc.getElementById(id)).display;
  const segBtn = (id, v) => doc.querySelector('#' + id + ' button[data-v="' + v + '"]');
  const segSel = (id) => { const b = doc.querySelector('#' + id + ' button.sel'); return b ? b.dataset.v : null; };
  const catBtn = (c) => doc.querySelector('#deckcatlist .catbtn[data-cat="' + c + '"]');
  const visRows = (id) => Array.from(doc.querySelectorAll('#' + id + ' > *')).filter(el => el.style.display !== 'none');

  ok(doc.getElementById('loadmsg').textContent.includes('準備完了'), 'DP1: client boots, load message ready');

  // ---- page structure: the split itself ----
  ok(doc.querySelectorAll('#start .deck').length === 0 && !doc.getElementById('start').contains(doc.getElementById('seg-mydeck')),
    'DP2: title page holds no deck selection');
  ok(doc.querySelector('#start .rulesline') && doc.querySelector('#start .rulesline').textContent.includes('2026年10月時点リスト'),
    'DP2b: title page states the GENESYS rules basis (2026年10月時点リスト)');
  ok(doc.getElementById('deckpage').contains(doc.getElementById('mydeckcur')) &&
     doc.getElementById('deckpage').contains(doc.getElementById('opdeckcur')) &&
     doc.getElementById('deckpage').contains(doc.getElementById('seg-first')) &&
     doc.getElementById('deckpage').contains(doc.getElementById('startbtn')) &&
     doc.getElementById('deckpage').contains(doc.getElementById('deckimport')),
    'DP3: deck page holds both current-choice rows, first/second, the import entry and the start button');
  ok(doc.getElementById('deckmodal').contains(doc.getElementById('seg-mydeck')) &&
     doc.getElementById('deckmodal').contains(doc.getElementById('seg-opdeck')) &&
     !doc.getElementById('deckpage').contains(doc.getElementById('seg-mydeck')),
    'DP3b: the deck lists live inside the modal, not on the deck page');
  ok(doc.getElementById('todeck') && doc.getElementById('start').contains(doc.getElementById('todeck')),
    'DP4: title page has the deck-page navigation button');

  // ---- initial visibility + navigation ----
  ok(disp('deckpage') === 'none' && disp('start') !== 'none', 'DP5: at boot the title page shows and the deck page is hidden');
  doc.getElementById('todeck').click();
  ok(disp('deckpage') !== 'none' && disp('start') === 'none', 'DP6: 「デッキを選ぶ」 opens the deck page and leaves the title page');
  doc.getElementById('deckback').click();
  ok(disp('start') !== 'none' && disp('deckpage') === 'none', 'DP7: back button returns to the title page');
  doc.getElementById('todeck').click();

  // ---- defaults + summary ----
  ok(segSel('seg-mydeck') === 'ishizu' && segSel('seg-opdeck') === 'gg' && segSel('seg-first') === 'first',
    'DP8: defaults are own=Ishizu / opponent=GG / 先攻');
  ok(doc.querySelector('#mydeckcur .dn').textContent === 'MILLENNIUM PROPHECY' &&
     doc.querySelector('#mydeckcur .dd').textContent.includes('メイン45枚') &&
     doc.querySelector('#opdeckcur .dn').textContent === 'ゲート・ガーディアン' &&
     doc.querySelector('#opdeckcur .dd').textContent.includes('メイン40枚'),
    'DP8b: the current-choice rows name the defaults with their counts');
  const sum0 = doc.getElementById('decksum').textContent;
  ok(sum0.includes('自分：MILLENNIUM PROPHECY') && sum0.includes('相手：ゲート・ガーディアン') && sum0.includes('先攻'),
    'DP9: summary names the default selection (' + sum0 + ')');

  // ---- own side: deck page -> category page -> modal -> pick ----
  doc.getElementById('mydeckcur').click();
  ok(disp('deckcat') !== 'none' && disp('deckpage') === 'none' &&
     doc.getElementById('deckcattitle').textContent === '自分のデッキ' &&
     doc.getElementById('deckcatimp') && doc.getElementById('deckcatlist').contains(doc.getElementById('deckcatimp')) &&
     doc.getElementById('deckcatimp').style.display !== 'none',
    'DP10: own current row opens the category page (imported category offered)');
  catBtn('character').click();
  ok(doc.getElementById('deckmodal').style.display === 'flex' &&
     doc.getElementById('deckmodaltitle').textContent === 'キャラクターデッキ' &&
     doc.getElementById('seg-mydeck').style.display !== 'none' &&
     doc.getElementById('seg-opdeck').style.display === 'none' &&
     visRows('seg-mydeck').length === 2 && visRows('seg-mydeck').every(el => el.dataset.cat === 'character'),
    'DP11: character category opens the modal with both built-in decks on the own list');
  segBtn('seg-mydeck', 'gg').click();
  ok(doc.getElementById('deckmodal').style.display === 'none' && disp('deckcat') === 'none' && disp('deckpage') !== 'none' &&
     segSel('seg-mydeck') === 'gg' && doc.querySelector('#mydeckcur .dn').textContent === 'ゲート・ガーディアン' &&
     doc.getElementById('decksum').textContent.includes('自分：ゲート・ガーディアン'),
    'DP12: picking a deck closes modal + category page and applies the choice on the deck page');

  // ---- contents view (一覧) inside the modal ----
  doc.getElementById('mydeckcur').click();
  catBtn('character').click();
  const ishizuRow = doc.querySelector('#seg-mydeck .deckrow[data-key="ishizu"]');
  ishizuRow.querySelector('.decklist-btn').click();
  const viewTxt = doc.getElementById('deckviewlist').textContent;
  ok(doc.getElementById('deckview').style.display === 'flex' &&
     doc.getElementById('deckviewtitle').textContent === 'MILLENNIUM PROPHECY' &&
     viewTxt.includes('メイン（45枚）') && viewTxt.includes('エクストラ（15枚）') && viewTxt.includes('剣神官ムドラ'),
    'DP13: 一覧 shows the deck contents (main/extra counts and card names)');
  doc.getElementById('deckviewback').click();
  ok(doc.getElementById('deckview').style.display === 'none' && visRows('seg-mydeck').length === 2,
    'DP14: back from the contents view returns to the deck list');
  doc.getElementById('deckmodalx').click();
  ok(doc.getElementById('deckmodal').style.display === 'none' && disp('deckcat') !== 'none',
    'DP15: closing the modal returns to the category page');
  doc.getElementById('deckcatback').click();
  ok(disp('deckpage') !== 'none' && disp('deckcat') === 'none', 'DP16: category back button returns to the deck page');

  // ---- opponent side: no imported category; genesys is empty ----
  doc.getElementById('opdeckcur').click();
  ok(doc.getElementById('deckcattitle').textContent === '相手のデッキ' &&
     doc.getElementById('deckcatimp') === null &&
     !doc.querySelector('#deckcatlist [data-cat="imported"]'),
    'DP17: opponent category page holds no imported category (button removed from the DOM, not just hidden)');
  catBtn('genesys').click();
  ok(doc.getElementById('deckmodal').style.display === 'flex' &&
     doc.getElementById('deckmodaltitle').textContent.includes('2026年10月時点') &&
     doc.getElementById('seg-opdeck').style.display !== 'none' &&
     visRows('seg-opdeck').length === 0 &&
     doc.getElementById('deckmodalempty').style.display !== 'none' &&
     doc.getElementById('deckmodalempty').textContent === '準備中',
    'DP18: the (still empty) Genesys category shows the 準備中 empty state');
  doc.getElementById('deckmodalx').click();
  catBtn('character').click();
  segBtn('seg-opdeck', 'ishizu').click();
  ok(disp('deckpage') !== 'none' && segSel('seg-opdeck') === 'ishizu' &&
     doc.querySelector('#opdeckcur .dn').textContent === 'MILLENNIUM PROPHECY' &&
     doc.getElementById('decksum').textContent.includes('相手：MILLENNIUM PROPHECY'),
    'DP19: opponent pick applies and returns to the deck page');

  // ---- imported category: empty before any import ----
  doc.getElementById('mydeckcur').click();
  catBtn('imported').click();
  ok(visRows('seg-mydeck').filter(el => el.classList.contains('saveditem')).length === 0 &&
     doc.getElementById('deckmodalempty').textContent === '取り込んだデッキはまだありません',
    'DP20: imported category is reachable on the own side and says so when empty');
  doc.getElementById('deckmodalx').click();
  doc.getElementById('deckcatback').click();

  // ---- regression: modal rows never overflow; scroll resets ----
  // jsdom does no layout, so the geometric half is a stylesheet
  // contract: the row's deck button must be the shrinking side
  // (#deckmodal .deckrow .deck outranking #deckmodal .deck's
  // width:100% / flex:0 0 auto), the row itself width-capped, and
  // the list unable to scroll sideways at all. The scroll-offset
  // half is behavioral: jsdom keeps scrollLeft/scrollTop as plain
  // writable properties, so the reset is directly observable.
  const rowCss = /#deckmodal \.deckrow \.deck\{[^}]*flex:1 1 auto[^}]*width:auto/.test(html) &&
    /\.deckrow\{[^}]*width:100%[^}]*min-width:0/.test(html) &&
    /#deckmodal \.decklist\{[^}]*overflow-x:hidden/.test(html);
  ok(rowCss, 'DP25: stylesheet makes the row deck button the shrinking side and the list horizontally unscrollable');
  const allRows = Array.from(doc.querySelectorAll('#seg-mydeck .deckrow, #seg-opdeck .deckrow'));
  const rowShape = allRows.length === Object.keys(data.decks).length * 2 && allRows.every(r =>
    r.children.length === 2 && r.children[0].classList.contains('deck') &&
    r.children[1].classList.contains('decklist-btn') && !!r.querySelector('.deck .txt .dn'));
  ok(rowShape, 'DP26: every built-in row is [deck button][一覧 button] with a shrinkable text block');
  doc.getElementById('mydeckcur').click();
  catBtn('character').click();
  const myList = doc.getElementById('seg-mydeck');
  myList.scrollLeft = 40; myList.scrollTop = 40;
  doc.querySelector('#seg-mydeck .deckrow[data-key="ishizu"] .decklist-btn').click();
  doc.getElementById('deckviewback').click();
  ok(myList.scrollLeft === 0 && myList.scrollTop === 0,
    'DP27: returning from the contents view resets the list scroll offsets');
  myList.scrollLeft = 40; myList.scrollTop = 40;
  doc.getElementById('deckmodalx').click();
  catBtn('character').click();
  ok(myList.scrollLeft === 0 && myList.scrollTop === 0,
    'DP28: reopening the modal resets the list scroll offsets');
  doc.getElementById('deckmodalx').click();
  doc.getElementById('deckcatback').click();

  // ---- reset to defaults, then the start flow ----
  segBtn('seg-mydeck', 'ishizu').click(); segBtn('seg-opdeck', 'gg').click(); segBtn('seg-first', 'first').click();
  ok(segSel('seg-mydeck') === 'ishizu' && segSel('seg-opdeck') === 'gg' && segSel('seg-first') === 'first',
    'DP21: selection reset to defaults for the start check');

  // ---- scroll contract: lists scroll inside the modal; pages never scroll ----
  const listRule = /#deckmodal \.decklist\{[^}]*overflow-y:auto/.test(html) && /#deckpage\{[^}]*overflow:hidden/.test(html);
  ok(listRule, 'DP22: modal deck lists scroll inside their region; the deck page itself never scrolls (stylesheet contract)');

  // ---- start from the deck page: VS curtain, pages hidden, board up ----
  let vsSeen = false, boardUp = false;
  doc.getElementById('startbtn').click();
  for (let i = 0; i < 240 && !boardUp; i++) {
    if (doc.getElementById('vsoverlay').classList.contains('on')) vsSeen = true;
    if (doc.querySelectorAll('.slot').length >= 10 && disp('deckpage') === 'none' && disp('start') === 'none') boardUp = true;
    if (!boardUp) await sleep(50);
  }
  ok(vsSeen, 'DP23: starting from the deck page plays the VS curtain');
  ok(boardUp, 'DP24: after the VS beat both pre-duel pages are hidden and the duel board is up');

  console.log(failures === 0 ? 'ALL DECKPAGE CHECKS PASSED' : failures + ' DECKPAGE CHECK(S) FAILED');
  window.close();
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
