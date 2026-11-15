'use strict';
/* test-cardsearch.js — BU-100 pins: card-name word search on
 * the declare grid and the card-selection sheets (user
 * instruction 2026-11-15: declaring a card name by eye from the
 * whole pool — 《墓守の罠》③ — is the pain; deck / grave picks
 * get the same field secondarily).
 *
 * CS-A (matcher): substring match on the displayed name after
 *    NFKC / case / whitespace normalization.
 * CS-B (client, jsdom): the ANNOUNCE_CARD sheet renders the
 *    search field, typing filters the name tiles in place, a
 *    0-hit query shows the 0-hit line, widening the query
 *    restores tiles, and a chosen card stays chosen (declare
 *    button enabled, naming it) while filtered out of view.
 * CS-C (client, jsdom): the SELECT_CARD grid sheet and the
 *    SELECT_UNSELECT_CARD sheet carry the same field; a
 *    selection survives being filtered out (tray chip + valid
 *    confirm), and a hidden candidate never leaks its real
 *    name through the filter. */
const fs = require('fs');
const path = require('path');

const V2 = __dirname;
const data = JSON.parse(fs.readFileSync(path.join(V2, 'data.json'), 'utf8'));
const { LOC } = require(path.join(V2, 'engine.js'));

let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };

(async () => {
  let JSDOM;
  try { ({ JSDOM } = require('jsdom')); }
  catch (e) { console.log('SKIP: jsdom not resolvable (set NODE_PATH)'); process.exit(0); }

  const html = fs.readFileSync(path.join(V2, 'index.html'), 'utf8');
  const wasmBinary = fs.readFileSync(path.join(V2, 'build', 'ocgcore.wasm'));
  const dom = new JSDOM(html, { url: 'http://localhost/v2/', runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  window.Audio = class { constructor(src) { this.src = src; this.volume = 1; } play() { return Promise.resolve(); } pause() {} };
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
  inject('client.js');
  for (let i = 0; i < 100 && !window.document.getElementById('loadmsg').textContent.includes('準備完了'); i++)
    await new Promise(r => setTimeout(r, 50));
  ok(window.document.getElementById('loadmsg').textContent.includes('準備完了'), 'CS0: client boots');

  const doc = window.document;
  const sheet = () => doc.getElementById('sheet');
  const searchInput = () => sheet().querySelector('.cardsearch-input');
  const typeQuery = (q) => { const inp = searchInput(); inp.value = q; inp.dispatchEvent(new window.Event('input', { bubbles: true })); };
  const visTiles = (sel) => [...sheet().querySelectorAll(sel)].filter(el => el.style.display !== 'none');
  const tileByCode = (code) => sheet().querySelector('[data-code="' + code + '"]');

  // ---------------------------------------------------------- CS-A
  {
    const M = window.__cardsearch.matches;
    ok(M('墓守の罠', '墓守') === true, 'CS-A1: substring match on the name');
    ok(M('墓守の罠', '罠') === true && M('墓守の罠', '死者') === false, 'CS-A2: hit and miss');
    ok(M('墓守の罠', '') === true, 'CS-A3: empty query matches everything');
    ok(M('墓守の罠', '墓守 の 罠') === true, 'CS-A4: whitespace in the query is ignored');
    ok(M('Ｅ・ＨＥＲＯ ネオス', 'e・hero') === true, 'CS-A5: NFKC + case normalization (full-width latin query in lower case)');
    ok(M('死者蘇生', 'ｼｼｬ') === false && M('剣神官ムドラ', 'ムドラ') === true, 'CS-A6: no fuzzy magic — plain substring only');
  }

  // ---------------------------------------------------------- CS-B
  const TRAP = 98715423, SORCERY = 83764718, MUDORA = 99937011;
  const poolCount = Object.keys(data.cards).length;
  window.__announce.open({ name: 'ANNOUNCE_CARD', player: 0, context: { code: TRAP, con: 0, loc: LOC.SZONE, seq: 0 } });
  ok(!!searchInput(), 'CS-B1: declare sheet renders the search field');
  ok(sheet().querySelectorAll('[data-code]').length === poolCount, 'CS-B2: declare grid renders the whole pool (' + poolCount + ')');
  ok(visTiles('[data-code]').length === poolCount, 'CS-B3: no query -> every tile visible');

  typeQuery('墓守');
  ok(visTiles('[data-code]').length === 1 && visTiles('[data-code]')[0] === tileByCode(TRAP),
    'CS-B4: query 墓守 leaves exactly 《墓守の罠》 visible');
  ok(tileByCode(SORCERY).style.display === 'none', 'CS-B5: a non-matching tile is hidden in place');
  ok(sheet().querySelector('.search-none').style.display === 'none', 'CS-B6: 0-hit line stays hidden while there are hits');

  typeQuery('存在しないカード名');
  ok(visTiles('[data-code]').length === 0, 'CS-B7: a nonsense query hides every tile');
  { const none = sheet().querySelector('.search-none');
    ok(none.style.display !== 'none' && none.textContent.includes('存在しないカード名') && none.textContent.includes('一致するカードがありません'),
      'CS-B8: the 0-hit line shows and names the query'); }

  typeQuery('');
  ok(visTiles('[data-code]').length === poolCount, 'CS-B9: clearing the query restores every tile (widening works)');

  tileByCode(TRAP).click();
  { const okBtn = doc.getElementById('announce-ok');
    ok(!!okBtn && !okBtn.disabled && okBtn.textContent.includes('墓守の罠'), 'CS-B10: tapping a tile selects it and the declare button names it'); }
  ok(searchInput() && searchInput().value === '', 'CS-B11: the redraw after a tap keeps the search field (query preserved)');
  typeQuery('死者');
  ok(tileByCode(TRAP).style.display === 'none' && tileByCode(TRAP).classList.contains('sel'),
    'CS-B12: the chosen tile can be filtered out and keeps its selected mark');
  { const okBtn = doc.getElementById('announce-ok');
    ok(!!okBtn && !okBtn.disabled && okBtn.textContent.includes('墓守の罠'),
      'CS-B13: the declare button stays enabled and keeps naming the hidden pick'); }
  typeQuery('墓守');
  ok(visTiles('[data-code]').length === 1 && tileByCode(TRAP).classList.contains('sel'),
    'CS-B14: filtering back to the pick shows it still selected');

  // ---------------------------------------------------------- CS-C
  const KELDO = 63542003;
  const grave = (code, seq) => ({ code, con: 0, loc: LOC.GRAVE, seq, pos: 0x1 });
  window.__select.open({ name: 'SELECT_CARD', player: 0, cancelable: true, min: 1, max: 2, context: null,
    cards: [grave(MUDORA, 0), grave(KELDO, 1), grave(SORCERY, 2)] });
  ok(!!searchInput() && !!doc.getElementById('grid-search-toggle'), 'CS-C1: selection sheet renders the search field and its toggle');
  ok(sheet().querySelector('.cardsearch').style.display === 'none',
    'CS-C1b: the field starts closed (the 620px first-render fit budget is untouched)');
  ok(visTiles('[data-grid]').length === 3, 'CS-C2: all candidates visible with no query');
  doc.getElementById('grid-search-toggle').click();
  ok(sheet().querySelector('.cardsearch').style.display !== 'none', 'CS-C2b: the toggle opens the field');
  typeQuery('ムドラ');
  ok(visTiles('[data-grid]').length === 1 && visTiles('[data-grid]')[0].dataset.grid === '0',
    'CS-C3: query ムドラ leaves only the Mudora tile');
  typeQuery('');
  sheet().querySelector('[data-grid="1"]').click(); // select Keldou
  ok(!!sheet().querySelector('#tray .chip'), 'CS-C4: selecting a candidate puts it on the tray');
  typeQuery('ムドラ'); // hides the selected Keldou tile
  ok(sheet().querySelector('[data-grid="1"]').style.display === 'none', 'CS-C5: the selected tile is filtered out of view');
  ok(!!sheet().querySelector('#tray .chip') && sheet().querySelector('#tray .chip').textContent.includes('ケルドウ'),
    'CS-C6: the tray chip for the hidden selection survives');
  { const conf = doc.getElementById('grid-confirm');
    ok(!!conf && !conf.disabled, 'CS-C7: confirm stays valid while the selection is filtered out'); }

  typeQuery('zzz');
  { const none = sheet().querySelector('.search-none');
    ok(visTiles('[data-grid]').length === 0 && none.style.display !== 'none', 'CS-C8: selection sheet 0-hit line shows'); }
  doc.getElementById('grid-search-toggle').click(); // close the field
  ok(sheet().querySelector('.cardsearch').style.display === 'none' && searchInput().value === '' && visTiles('[data-grid]').length === 3,
    'CS-C8b: closing the field clears the query and un-filters every tile');

  // hidden candidate: the opponent's deck card is a card back —
  // its real name must not leak through the filter.
  window.__select.open({ name: 'SELECT_CARD', player: 0, cancelable: true, min: 1, max: 1, context: null,
    cards: [{ code: MUDORA, con: 1, loc: LOC.DECK, seq: 0, pos: 0x1 }] });
  { const tile = sheet().querySelector('[data-grid="0"]');
    ok(!!tile && !tile.textContent.includes('ムドラ'), 'CS-C9: hidden candidate renders without its real name');
    typeQuery('ムドラ');
    ok(tile.style.display === 'none' && !sheet().textContent.includes('剣神官ムドラ'),
      'CS-C10: searching the real name does not reveal the hidden candidate'); }

  window.__unselect.open({ name: 'SELECT_UNSELECT_CARD', player: 0, finishable: true, cancelable: true, min: 1, max: 1, context: null,
    select: [grave(MUDORA, 0), grave(KELDO, 1)], unselect: [] });
  ok(!!searchInput() && !!doc.getElementById('unselect-search-toggle'), 'CS-C11: unselect sheet renders the search field and its toggle');
  doc.getElementById('unselect-search-toggle').click();
  ok(sheet().querySelector('.cardsearch').style.display !== 'none', 'CS-C11b: the unselect toggle opens the field');
  typeQuery('ケルドウ');
  { const tiles = [...sheet().querySelectorAll('[data-unselect]')];
    ok(tiles.length === 2 && tiles[0].style.display === 'none' && tiles[1].style.display !== 'none',
      'CS-C12: unselect filter hides the non-matching tile only'); }

  window.close();
  console.log(failures === 0 ? 'ALL CARD-SEARCH CHECKS PASSED' : failures + ' CARD-SEARCH CHECK(S) FAILED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
