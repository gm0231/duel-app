'use strict';
/* test-neuron.js — Neuron import Phase 1 (user concept 2026-11-04:
   own deck comes from Neuron, Genesis-illegal decks are rejected
   with reasons). Contract under test:
   - The deck page's own-deck section carries a saved-decks region
     and the import entry; the import panel accepts the official
     deck page HTML (text view), .ydk / passcode lists, YDKE and
     card-name lists.
   - Import of the real MILLENNIUM PROPHECY page (verbatim fixture,
     test-neuron-fixture.html) yields main 45 / extra 15 / side 9,
     100pt, Genesis-legal and fully pool-supported; it saves to
     localStorage, survives a reboot, can be selected and starts a
     real duel.
   - Variant passcodes normalize to the representative (83764719 ->
     83764718) so the imported deck matches the pool.
   - Genesis violations are rejected with specific reasons and NO
     save is offered: points over the cap, a 4th copy of a name, a
     Link monster. A release-cutoff card is rejected by the
     validator unit check.
   - A Genesis-legal deck with pool-unsupported cards saves but
     cannot start: the start button is disabled with the reason and
     the summary names the unsupported cards.
   - The deck page copied as rendered text (the shape a phone
     browser's select-all copy yields — real captures
     test-neuron-visual-fixture.txt in JA and
     test-neuron-share-fixture.txt in EN) parses to EXACTLY the
     same deck as the page's HTML: 45/15/9 for MILLENNIUM
     PROPHECY, 44/15/3 for the shared "Alluring Heroines". The
     EN deck trips the release cutoff under the bundled list
     202610: its two ORIGINAL ARTWORK COLLECTION cards (OCG
     release 2026-09-26) postdate the list's 2026-03-01 cutoff,
     so "cannot be used" naming both is the correct verdict.
   - The URL flow (share link / deck code pasted): the app
     fetches the deck page through its relay chain (fetch stubbed
     here per route), parses, validates and AUTO-SAVES a legal
     deck; a search page in between is followed to the embedded
     member_deck URL; total fetch failure shows the honest
     relay/fallback message and saves nothing.
   Method: jsdom boot (harness as test-deckpage; neuron.js injected
   in index.html order) + DOM clicks only for the UI flow; direct
   NeuronLib calls for the validator units. */
const fs = require('fs');
const path = require('path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { console.log('SKIP: jsdom not resolvable (set NODE_PATH)'); process.exit(0); }

const V2 = __dirname;
const html = fs.readFileSync(path.join(V2, 'index.html'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(V2, 'data.json'), 'utf8'));
const genesys = JSON.parse(fs.readFileSync(path.join(V2, 'genesys-data.json'), 'utf8'));
const fixture = fs.readFileSync(path.join(V2, 'test-neuron-fixture.html'), 'utf8');
const visualFixture = fs.readFileSync(path.join(V2, 'test-neuron-visual-fixture.txt'), 'utf8');
const shareFixtureHtml = fs.readFileSync(path.join(V2, 'test-neuron-share-fixture.html'), 'utf8');
const shareFixtureTxt = fs.readFileSync(path.join(V2, 'test-neuron-share-fixture.txt'), 'utf8');
const wasmBinary = fs.readFileSync(path.join(V2, 'build', 'ocgcore.wasm'));
let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function boot(storageSeed, neuronResponder) {
  const dom = new JSDOM(html, { url: 'http://localhost/v2/', runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  window.Audio = class { constructor(src) { this.src = src; this.volume = 1; } play() { return Promise.resolve(); } pause() {} };
  window.Image = class { constructor() { this._src = ''; } set src(v) { this._src = v; } get src() { return this._src; } };
  if (storageSeed) for (const [k, v] of Object.entries(storageSeed)) window.localStorage.setItem(k, v);
  const wasmBuf = wasmBinary.buffer.slice(wasmBinary.byteOffset, wasmBinary.byteOffset + wasmBinary.byteLength);
  window.fetch = async (url) => {
    const u = String(url);
    if (neuronResponder && /neuron\.konami\.net|db\.yugioh-card\.com|allorigins\.win|codetabs\.com/.test(u)) {
      const r = await neuronResponder(u);
      if (r) return r;
      throw new TypeError('Failed to fetch'); // direct route: CORS-blocked in reality
    }
    if (u.includes('ocgcore.wasm')) return { ok: true, status: 200, url: u, arrayBuffer: async () => wasmBuf };
    if (u.includes('genesys-data')) return { ok: true, status: 200, json: async () => genesys, arrayBuffer: async () => wasmBuf };
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

async function importText(window, text) {
  const doc = window.document;
  if (doc.getElementById('neuronpanel').style.display !== 'flex') doc.getElementById('deckimport').click();
  doc.getElementById('neurontext').value = text;
  doc.getElementById('neuronparse').click();
  for (let i = 0; i < 60 && !doc.getElementById('neuronresult').textContent.trim(); i++) await sleep(50);
  return doc.getElementById('neuronresult');
}
// URL flow: the result first shows a "fetching" note, so wait for
// a terminal marker instead of any text.
async function importUrlFlow(window, text, marker) {
  const doc = window.document;
  if (doc.getElementById('neuronpanel').style.display !== 'flex') doc.getElementById('deckimport').click();
  doc.getElementById('neurontext').value = text;
  doc.getElementById('neuronparse').click();
  for (let i = 0; i < 200 && !doc.getElementById('neuronresult').textContent.includes(marker); i++) await sleep(50);
  return doc.getElementById('neuronresult');
}
const multiEq = (a, b) => {
  const m = (arr) => { const o = {}; for (const c of arr) o[c] = (o[c] || 0) + 1; return JSON.stringify(Object.entries(o).sort()); };
  return ['main', 'extra', 'side'].every(s => m(a[s]) === m(b[s]));
};
// distinct Genesis-clean filler reps (no points, no link/pendulum,
// no cutoff, no ng) straight from the bundled dataset
function cleanReps(n, excludePool) {
  const pool = new Set(Object.keys(data.cards).map(Number));
  const lp = new Set(genesys.lp), late = new Set(genesys.late), ng = new Set(genesys.ng);
  const out = [];
  for (const k of Object.keys(genesys.names).map(Number)) {
    if (genesys.points[k] || lp.has(k) || late.has(k) || ng.has(k)) continue;
    if (excludePool && pool.has(k)) continue;
    out.push(k);
    if (out.length >= n) break;
  }
  return out;
}
const codesText = (main, extra, side) =>
  '#main\n' + main.join('\n') + (extra ? '\n#extra\n' + extra.join('\n') : '') + (side ? '\n!side\n' + side.join('\n') : '');

(async () => {
  // ------------------------------------------------ unit: validator via the real fixture parse
  {
    const window = await boot();
    const doc = window.document;
    const lib = window.NeuronLib;
    ok(!!lib, 'N0: NeuronLib is exposed');
    // genesys data loads through the same lazy path the panel uses
    doc.getElementById('todeck').click();
    doc.getElementById('deckimport').click();
    for (let i = 0; i < 60 && !lib.dataReady(); i++) await sleep(50);
    ok(lib.dataReady(), 'N0b: genesys-data loads for the import panel');
    const parsed = lib.parseImport(fixture, (h) => new window.DOMParser().parseFromString(h, 'text/html'));
    ok(parsed.ok && parsed.format === 'html', 'N1: real deck-page HTML parses');
    ok(parsed.deck.name === 'MILLENNIUM PROPHECY', 'N1b: deck name from the page (' + parsed.deck.name + ')');
    ok(parsed.deck.main.length === 45 && parsed.deck.extra.length === 15 && parsed.deck.side.length === 9,
      'N1c: composition 45/15/9 (got ' + parsed.deck.main.length + '/' + parsed.deck.extra.length + '/' + parsed.deck.side.length + ')');
    const val = lib.validateGenesis(parsed.deck);
    ok(val.totalPt === 100, 'N1d: point total is exactly 100 (got ' + val.totalPt + ')');
    ok(val.ok, 'N1e: the deck is Genesis-legal' + (val.ok ? '' : ' — ' + JSON.stringify(val.violations)));
    const pool = lib.poolCheck(parsed.deck, new Set(Object.keys(data.cards).map(Number)));
    ok(pool.ok, 'N1f: every main+extra card is in the current pool' + (pool.ok ? '' : ' — ' + JSON.stringify(pool.unsupported)));
    ok(parsed.deck.main.includes(83764718) && !parsed.deck.main.includes(83764719),
      'N1g: Monster Reborn normalized 83764719 -> 83764718');

    // unit: cutoff violation
    const lateRep = genesys.late.find(k => genesys.names[k]);
    const fillers = cleanReps(13, false);
    const deck2 = { name: 't', main: [...fillers.flatMap(r => [r, r, r]), lateRep], extra: [], side: [], names: {} };
    const v2 = lib.validateGenesis(deck2);
    ok(!v2.ok && v2.violations.some(v => v.kind === 'cutoff' && v.items.includes(genesys.names[lateRep])),
      'N2: a post-cutoff card is rejected with its name (' + genesys.names[lateRep] + ')');
    window.close();
  }

  // ------------------------------------------------ UI flow: HTML import -> save -> reboot -> duel
  let savedJson = null;
  {
    const window = await boot();
    const doc = window.document;
    doc.getElementById('todeck').click();
    ok(!!doc.getElementById('deckimport') && !!doc.getElementById('seg-mydeck'), 'N3: deck page carries the import entry and the own-deck list');
    const res = await importText(window, fixture);
    ok(res.textContent.includes('MILLENNIUM PROPHECY') && res.textContent.includes('メイン（45枚）') &&
       res.textContent.includes('エクストラ（15枚）') && res.textContent.includes('サイド（9枚）'),
      'N4: result shows the deck name and composition');
    ok(res.textContent.includes('ポイント合計：100pt') && res.textContent.includes('Genesis適合 ― そのまま対戦できます'),
      'N4b: verdict is Genesis-legal / playable');
    const saveBtn = doc.getElementById('neuronsave');
    ok(saveBtn.style.display !== 'none' && saveBtn.textContent === '保存する', 'N4c: save is offered');
    saveBtn.click();
    const savedEls = doc.querySelectorAll('#seg-mydeck .deck.saveditem');
    ok(savedEls.length === 1 && savedEls[0].querySelector('.dn').textContent === 'MILLENNIUM PROPHECY',
      'N5: the saved deck is listed under own decks');
    ok(savedEls[0].classList.contains('sel') && doc.getElementById('decksum').textContent.includes('自分：MILLENNIUM PROPHECY'),
      'N5b: the saved deck is selected and named in the summary');
    ok(doc.getElementById('startbtn').disabled === false, 'N5c: start is enabled for the playable saved deck');
    savedJson = window.localStorage.getItem('v2saveddecks');
    ok(!!savedJson && JSON.parse(savedJson).length === 1 && JSON.parse(savedJson)[0].poolOk === true,
      'N5d: the deck is persisted in localStorage');
    window.close();
  }
  {
    const window = await boot({ v2saveddecks: savedJson });
    const doc = window.document;
    doc.getElementById('todeck').click();
    const savedEls = doc.querySelectorAll('#seg-mydeck .deck.saveditem');
    ok(savedEls.length === 1, 'N6: the saved deck survives a reboot');
    savedEls[0].click();
    ok(doc.getElementById('decksum').textContent.includes('自分：MILLENNIUM PROPHECY'), 'N6b: it can be selected after reboot');
    let boardUp = false;
    doc.getElementById('startbtn').click();
    for (let i = 0; i < 240 && !boardUp; i++) {
      if (doc.querySelectorAll('.slot').length >= 10 && window.getComputedStyle(doc.getElementById('deckpage')).display === 'none') boardUp = true;
      if (!boardUp) await sleep(50);
    }
    ok(boardUp, 'N6c: a duel starts with the imported deck');
    window.close();
  }

  // ------------------------------------------------ variant passcode via ydk text
  {
    const window = await boot();
    const doc = window.document;
    doc.getElementById('todeck').click();
    const main = data.decks.ishizu.main.map(c => c === 83764718 ? 83764719 : c);
    const res = await importText(window, codesText(main, data.decks.ishizu.extra, []));
    ok(res.textContent.includes('Genesis適合 ― そのまま対戦できます'), 'N7: the variant-passcode deck validates as playable');
    doc.getElementById('neuronsave').click();
    const rec = JSON.parse(window.localStorage.getItem('v2saveddecks'))[0];
    ok(rec.main.includes(83764718) && !rec.main.includes(83764719), 'N7b: the saved deck holds the representative passcode');
    window.close();
  }

  // ------------------------------------------------ Genesis violations: no save offered
  {
    const window = await boot();
    const doc = window.document;
    doc.getElementById('todeck').click();
    const fillers = cleanReps(13, false);
    const filler39 = fillers.flatMap(r => [r, r, r]);
    // points: Kelbek x3 = 150pt
    let res = await importText(window, codesText([25926710, 25926710, 25926710, ...filler39], [], []));
    ok(res.textContent.includes('このデッキは使えません') && res.textContent.includes('150pt') &&
       res.textContent.includes('古尖兵ケルベク（50pt）×3＝150pt'),
      'N8: points over the cap is rejected with the breakdown');
    ok(doc.getElementById('neuronsave').style.display === 'none', 'N8b: no save is offered for an illegal deck');
    // copies: Mudora x4
    res = await importText(window, codesText([99937011, 99937011, 99937011, 99937011, ...filler39.slice(0, 36)], [], []));
    ok(res.textContent.includes('「剣神官ムドラ」が4枚'), 'N9: a 4th copy is rejected with the card name and count');
    // link monster
    res = await importText(window, codesText([86066372, ...filler39], [], []));
    ok(res.textContent.includes('リンク／ペンデュラムモンスターは使えません') && res.textContent.includes('アクセスコード・トーカー'),
      'N10: a Link monster is rejected with its name');
    ok(!window.localStorage.getItem('v2saveddecks'), 'N10b: nothing was saved across the illegal imports');
    window.close();
  }

  // ------------------------------------------------ pool-unsupported but Genesis-legal: saves, cannot start
  {
    const window = await boot();
    const doc = window.document;
    doc.getElementById('todeck').click();
    const outReps = cleanReps(14, true);
    const main = [...outReps.slice(0, 13).flatMap(r => [r, r, r]), outReps[13]];
    const res = await importText(window, codesText(main, [], []));
    ok(res.textContent.includes('Genesisには適合していますが') && res.textContent.includes('未対応のカード'),
      'N11: legal-but-unsupported verdict is worded separately from illegal');
    const saveBtn = doc.getElementById('neuronsave');
    ok(saveBtn.style.display !== 'none' && saveBtn.textContent.includes('対戦はまだできません'), 'N11b: save is offered with the cannot-play note');
    saveBtn.click();
    const el = doc.querySelector('#seg-mydeck .deck.saveditem');
    ok(!!el && el.querySelector('.dd').textContent.includes('未対応カードあり（対戦不可）'), 'N11c: the list marks the deck unplayable');
    ok(el.classList.contains('sel') && doc.getElementById('startbtn').disabled === true &&
       doc.getElementById('startbtn').textContent.includes('未対応カードがあるため開始できません'),
      'N11d: selecting it disables start with the reason');
    ok(doc.getElementById('decksum').textContent.includes('未対応：'), 'N11e: the summary names the unsupported cards');
    // delete (two-step)
    const del = el.querySelector('.deckdel');
    del.click();
    ok(doc.querySelectorAll('#seg-mydeck .deck.saveditem').length === 1 && del.textContent === '本当に削除', 'N12: first delete tap only arms the confirm');
    del.click();
    ok(doc.querySelectorAll('#seg-mydeck .deck.saveditem').length === 0 && !window.localStorage.getItem('v2saveddecks')?.includes('sv'),
      'N12b: second tap deletes the deck and its storage entry');
    window.close();
  }

  // ------------------------------------------------ name-list import
  {
    const window = await boot();
    const doc = window.document;
    doc.getElementById('todeck').click();
    const res = await importText(window, 'メインデッキ\n剣神官ムドラ ×3\n宿神像ケルドウ ×3\n古尖兵ケルベク ×1\n');
    ok(res.textContent.includes('メインデッキが7枚です') && !res.textContent.includes('読み取れなかった'),
      'N13: name lines resolve (the count violation proves the cards landed)');
    const res2 = await importText(window, 'メインデッキ\n剣神官ムドラ ×3\n存在しないカード ×1\n');
    ok(res2.textContent.includes('読み取れなかったカード名があります') && res2.textContent.includes('存在しないカード'),
      'N13b: an unknown name is rejected with the name itself');
    window.close();
  }

  // ------------------------------------------------ visual text (JA page copy) == HTML ground truth
  {
    const window = await boot();
    const doc = window.document;
    const lib = window.NeuronLib;
    doc.getElementById('todeck').click();
    doc.getElementById('deckimport').click();
    for (let i = 0; i < 60 && !lib.dataReady(); i++) await sleep(50);
    const truth = lib.parseImport(fixture, (h) => new window.DOMParser().parseFromString(h, 'text/html'));
    const vis = lib.parseImport(visualFixture, null);
    ok(vis.ok && vis.format === 'visual', 'V1: JA page copy parses as visual text' + (vis.ok ? '' : ' — ' + JSON.stringify(vis.errors)));
    ok(vis.ok && vis.deck.name === 'MILLENNIUM PROPHECY', 'V1b: deck name from the copied page (' + (vis.ok ? vis.deck.name : 'n/a') + ')');
    ok(vis.ok && truth.ok && multiEq(vis.deck, truth.deck), 'V1c: visual parse is card-for-card identical to the HTML parse (45/15/9)');
    const res = await importText(window, visualFixture);
    ok(res.textContent.includes('Genesis適合 ― そのまま対戦できます') && res.textContent.includes('ポイント合計：100pt'),
      'V1d: the copied page imports through the panel as playable');
    window.close();
  }

  // ------------------------------------------------ share page: EN HTML + EN visual text
  {
    const window = await boot();
    const doc = window.document;
    const lib = window.NeuronLib;
    doc.getElementById('todeck').click();
    doc.getElementById('deckimport').click();
    for (let i = 0; i < 60 && !lib.dataReady(); i++) await sleep(50);
    const hp = lib.parseImport(shareFixtureHtml, (h) => new window.DOMParser().parseFromString(h, 'text/html'));
    ok(hp.ok && hp.deck.name === 'Alluring Heroines' && hp.deck.main.length === 44 && hp.deck.extra.length === 15 && hp.deck.side.length === 3,
      'V2: the shared recipe page HTML parses (44/15/3)' + (hp.ok ? '' : ' — ' + JSON.stringify(hp.errors)));
    const vis = lib.parseImport(shareFixtureTxt, null);
    ok(vis.ok && vis.format === 'visual', 'V2b: EN page copy parses as visual text' + (vis.ok ? '' : ' — ' + JSON.stringify(vis.errors)));
    ok(vis.ok && hp.ok && multiEq(vis.deck, hp.deck), 'V2c: EN visual parse is card-for-card identical to the HTML parse');
    const val = lib.validateGenesis(vis.deck);
    ok(!val.ok && val.violations.some(v => v.kind === 'cutoff' && v.items.includes('ハーピィ・レディ－華麗なる分身－') && v.items.includes('香水戦術')),
      'V2d: under list 202610 the deck is cutoff-illegal, naming both 2026-09-26 cards (validator is right; the deck predates no cutoff)');
    ok(lib.displayName(64972181) === 'ハーピィ・レディ－華麗なる分身－', 'V2e: supplemental printed JA name resolves for display');
    window.close();
  }

  // ------------------------------------------------ URL helpers (unit)
  {
    const window = await boot();
    const lib = window.NeuronLib;
    ok(lib.extractImportUrl('https://neuron.konami.net/link/qae5uv7gmv1b9qrt') === 'https://neuron.konami.net/link/qae5uv7gmv1b9qrt',
      'U0: share link extracted verbatim');
    ok(lib.extractImportUrl('デッキ https://www.db.yugioh-card.com/yugiohdb/member_deck.action?ope=1&cgid=77ea9998fb9d10ecc6e6f70c1056a5d9&dno=71 です') !== null,
      'U0b: deck page URL extracted from surrounding text');
    ok(lib.extractImportUrl('https://example.com/deck') === null, 'U0c: foreign URLs are not import URLs');
    ok(lib.isDeckCode('2t9x91u') && !lib.isDeckCode('2t9x91') && !lib.isDeckCode('剣神官ムドラ'), 'U0d: deck code is exactly 7 alphanumerics');
    ok(lib.deckCodeSearchUrl('2t9x91u').includes('deck_search.action?ope=1&deck_code=2t9x91u'), 'U0e: search URL is built from the code');
    window.close();
  }

  // ------------------------------------------------ URL flow: share link -> fetch -> verdict -> auto-save
  {
    const relayDeck = async (u) => /allorigins|codetabs/.test(u) ? { ok: true, status: 200, text: async () => fixture } : null;
    const window = await boot(null, relayDeck);
    const doc = window.document;
    doc.getElementById('todeck').click();
    const res = await importUrlFlow(window, 'https://neuron.konami.net/link/qae5uv7gmv1b9qrt', '自動で保存しました');
    ok(res.textContent.includes('MILLENNIUM PROPHECY') && res.textContent.includes('自動で保存しました'),
      'U1: pasting the share link fetches, validates and auto-saves');
    const saved = JSON.parse(window.localStorage.getItem('v2saveddecks') || '[]');
    ok(saved.length === 1 && saved[0].name === 'MILLENNIUM PROPHECY' && saved[0].poolOk === true,
      'U1b: the auto-saved deck is in localStorage');
    ok(doc.querySelectorAll('#seg-mydeck .deck.saveditem').length === 1, 'U1c: the auto-saved deck is listed');
    window.close();
  }

  // ------------------------------------------------ URL flow: deck code -> search page -> member_deck (two hops)
  {
    const hopPage = '<html><body><a href="https://www.db.yugioh-card.com/yugiohdb/member_deck.action?ope=1&cgid=77ea9998fb9d10ecc6e6f70c1056a5d9&dno=71">MILLENNIUM PROPHECY</a></body></html>';
    const twoHop = async (u) => {
      if (!/allorigins|codetabs/.test(u)) return null;
      const dec = decodeURIComponent(u);
      if (dec.includes('deck_search.action')) return { ok: true, status: 200, text: async () => hopPage };
      if (dec.includes('member_deck.action')) return { ok: true, status: 200, text: async () => fixture };
      return { ok: true, status: 200, text: async () => hopPage };
    };
    const window = await boot(null, twoHop);
    const doc = window.document;
    doc.getElementById('todeck').click();
    const res = await importUrlFlow(window, '2t9x91u', '自動で保存しました');
    ok(res.textContent.includes('MILLENNIUM PROPHECY') && res.textContent.includes('自動で保存しました'),
      'U2: a bare deck code drives search -> member_deck -> auto-save');
    window.close();
  }

  // ------------------------------------------------ URL flow: every route down -> honest failure, no save
  {
    const allDown = async () => null;
    const window = await boot(null, allDown);
    const doc = window.document;
    doc.getElementById('todeck').click();
    const res = await importUrlFlow(window, 'https://neuron.konami.net/link/qae5uv7gmv1b9qrt', '取得できませんでした');
    ok(res.textContent.includes('取得できませんでした') && res.textContent.includes('中継サービス') && res.textContent.includes('貼り付けてください'),
      'U3: total fetch failure explains the relay situation and the paste fallback');
    ok(!window.localStorage.getItem('v2saveddecks'), 'U3b: nothing is saved when the fetch fails');
    window.close();
  }

  console.log(failures === 0 ? 'ALL NEURON CHECKS PASSED' : failures + ' NEURON CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
