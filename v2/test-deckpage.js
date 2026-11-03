'use strict';
/* test-deckpage.js — deck selection as its own page (user request
   2026-11-04: 「デッキ選択は前みたいに別ページで選択できる形に」).
   Contract under test:
   - The title page (#start) carries NO deck/first/settings/start
     controls any more — only the title, the tagline, the load
     message and the 「デッキを選ぶ」 navigation button.
   - The deck page (#deckpage) holds both deck lists (own /
     opponent, clearly separated), 先攻・後攻, the settings rows and
     the start button; it is hidden until navigated to, and the
     back button returns to the title page.
   - The selection summary above the start button always names the
     current own deck / opponent deck / first-second choice.
   - Starting from the deck page runs the existing flow unchanged:
     VS curtain (no start button on it), then both pre-duel pages
     are hidden and the duel board appears.
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

  ok(doc.getElementById('loadmsg').textContent.includes('準備完了'), 'DP1: client boots, load message ready');

  // ---- page structure: the split itself ----
  ok(doc.querySelectorAll('#start .deck').length === 0 && !doc.getElementById('start').contains(doc.getElementById('seg-mydeck')),
    'DP2: title page holds no deck selection');
  ok(doc.getElementById('deckpage').contains(doc.getElementById('seg-mydeck')) &&
     doc.getElementById('deckpage').contains(doc.getElementById('seg-opdeck')) &&
     doc.getElementById('deckpage').contains(doc.getElementById('seg-first')) &&
     doc.getElementById('deckpage').contains(doc.getElementById('startbtn')),
    'DP3: deck page holds both deck lists, first/second and the start button');
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
  const sum0 = doc.getElementById('decksum').textContent;
  ok(sum0.includes('自分：MILLENNIUM PROPHECY') && sum0.includes('相手：ゲート・ガーディアン') && sum0.includes('先攻'),
    'DP9: summary names the default selection (' + sum0 + ')');
  segBtn('seg-mydeck', 'gg').click(); segBtn('seg-opdeck', 'ishizu').click(); segBtn('seg-first', 'second').click();
  const sum1 = doc.getElementById('decksum').textContent;
  ok(segSel('seg-mydeck') === 'gg' && segSel('seg-opdeck') === 'ishizu' && segSel('seg-first') === 'second' &&
     sum1.includes('自分：ゲート・ガーディアン') && sum1.includes('相手：MILLENNIUM PROPHECY') && sum1.includes('後攻'),
    'DP10: changing the segs updates the selection and the summary (' + sum1 + ')');
  segBtn('seg-mydeck', 'ishizu').click(); segBtn('seg-opdeck', 'gg').click(); segBtn('seg-first', 'first').click();

  // ---- list region: each deck list is its own scroll region ----
  const listRule = /\.decklist\{[^}]*overflow-y:auto/.test(html) && /#deckpage\{[^}]*overflow:hidden/.test(html);
  ok(listRule, 'DP11: deck lists scroll inside their region; the page itself never scrolls (stylesheet contract)');

  // ---- start from the deck page: VS curtain, pages hidden, board up ----
  let vsSeen = false, boardUp = false;
  doc.getElementById('startbtn').click();
  for (let i = 0; i < 240 && !boardUp; i++) {
    if (doc.getElementById('vsoverlay').classList.contains('on')) vsSeen = true;
    if (doc.querySelectorAll('.slot').length >= 10 && disp('deckpage') === 'none' && disp('start') === 'none') boardUp = true;
    if (!boardUp) await sleep(50);
  }
  ok(vsSeen, 'DP12: starting from the deck page plays the VS curtain');
  ok(boardUp, 'DP13: after the VS beat both pre-duel pages are hidden and the duel board is up');

  console.log(failures === 0 ? 'ALL DECKPAGE CHECKS PASSED' : failures + ' DECKPAGE CHECK(S) FAILED');
  window.close();
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
