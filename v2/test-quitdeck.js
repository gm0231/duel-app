'use strict';
/* test-quitdeck.js — the mid-duel exit: デュエル中 → その他 →
   選択に戻る → デッキ選択画面に着く (field report 2026-11-08:
   the その他 menu's 選択に戻る only closed the sheet, and the
   duel had no exit of its own — deck selection was reachable
   only by reloading the page by hand).
   Contract under test:
   - In a live duel, the その他 menu (menubtn) opens the
     その他のアクション sheet whose bottom button is 選択に戻る.
   - Pressing it (BU-63: after one confirmation sheet — the
     exit is irreversible for the duel and the button sits in
     the sheet's cancel seat) stashes the current selections in
     sessionStorage ('v3todeck', the A-06 reload-exit pattern)
     and reloads.
   - A boot that finds 'v3todeck' lands on the deck-selection
     page (NOT the title screen), with the stashed selections
     applied (own deck / opponent deck / first-second, the
     current-choice rows and the selection summary), the stash
     consumed, and NO duel started.
   Method: boot the real client in jsdom (harness as test-ui /
   test-deckpage). jsdom cannot perform the reload navigation,
   so the round trip is pinned in two boots: boot 1 drives a
   real duel to its first idle prompt, opens その他 and presses
   選択に戻る, and asserts the stash; boot 2 starts with the
   stash in place and asserts the landing. */
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

async function boot(stash) {
  const dom = new JSDOM(html, { url: 'http://localhost/v2/', runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  window.Audio = class { constructor(src) { this.src = src; this.volume = 1; } play() { return Promise.resolve(); } pause() {} };
  window.Image = class { constructor() { this._src = ''; } set src(v) { this._src = v; } get src() { return this._src; } };
  const wasmBuf = wasmBinary.buffer.slice(wasmBinary.byteOffset, wasmBinary.byteOffset + wasmBinary.byteLength);
  window.fetch = async (url) => {
    if (String(url).includes('ocgcore.wasm')) return { ok: true, status: 200, url: String(url), arrayBuffer: async () => wasmBuf };
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
  for (let i = 0; i < 100 && !window.document.getElementById('loadmsg').textContent.includes('準備完了'); i++)
    await sleep(50);
  return window;
}

(async () => {
  // ---- boot 1: live duel -> その他 -> 選択に戻る stashes the exit ----
  {
    const window = await boot(null);
    const doc = window.document;
    ok(doc.getElementById('loadmsg').textContent.includes('準備完了'), 'QD1: boot loads data.json');
    ok(doc.getElementById('menubtn').disabled, 'QD2: その他 is disabled before any duel (no menu actions yet)');
    const seg = (id, v) => doc.querySelector('#' + id + ' button[data-v="' + v + '"]').click();
    seg('seg-mydeck', 'superquant');   // non-default own deck
    seg('seg-opdeck', 'ishizu');       // non-default opponent deck
    seg('seg-first', 'first');
    doc.getElementById('startbtn').click();
    // wait for the first idle prompt to populate the その他 menu
    let menuReady = false;
    for (let i = 0; i < 450 && !menuReady; i++) {
      await sleep(200);
      menuReady = !doc.getElementById('menubtn').disabled && doc.getElementById('sheetwrap').className !== 'on';
    }
    ok(menuReady, 'QD3: the duel reaches an idle prompt and その他 becomes available');
    if (menuReady) {
      doc.getElementById('menubtn').click();
      ok(doc.getElementById('sheetwrap').className === 'on' && doc.getElementById('sheet').textContent.includes('その他のアクション'), 'QD4: その他 opens the その他のアクション sheet');
      const cancel = doc.getElementById('sheet-cancel');
      ok(!!cancel && cancel.textContent === '選択に戻る', 'QD5: the sheet carries the 選択に戻る button');
      cancel.click();
      // BU-63: the exit is irreversible for the duel in progress,
      // so the button no longer fires it directly — a
      // confirmation sheet stands in between, and nothing is
      // stashed until the user confirms there.
      const confirmBtn = doc.getElementById('quit-confirm');
      const backBtn = doc.getElementById('quit-cancel');
      ok(!!confirmBtn && !!backBtn && doc.getElementById('sheet').textContent.includes('対局を終了しますか？'),
        'QD6a: 選択に戻る opens the exit confirmation (終了する／対局に戻る), it does not leave yet');
      let stashEarly = null;
      try { stashEarly = window.sessionStorage.getItem('v3todeck'); } catch (e) {}
      ok(stashEarly === null, 'QD6b: nothing is stashed before the confirmation');
      backBtn.click();
      await sleep(600); // sheetClose lands after its 180ms motion
      ok(doc.getElementById('sheetwrap').className !== 'on', 'QD6c: 対局に戻る closes the sheet and the duel continues');
      doc.getElementById('menubtn').click();
      doc.getElementById('sheet-cancel').click();
      doc.getElementById('quit-confirm').click();
      let stash = null;
      try { stash = JSON.parse(window.sessionStorage.getItem('v3todeck') || 'null'); } catch (e) {}
      ok(!!stash && stash.my === 'superquant' && stash.op === 'ishizu' && stash.first === 'first',
        'QD6: confirming with 終了する stashes the current selections for the reload exit (got ' + JSON.stringify(stash) + ')');
    }
    window.close();
  }

  // ---- boot 2: the reload lands on the deck-selection page ----
  {
    const window = await boot({ my: 'superquant', op: 'ishizu', first: 'first' });
    const doc = window.document;
    // the restore runs at the end of the boot sequence; poll for it
    let landed = false;
    for (let i = 0; i < 60 && !landed; i++) {
      await sleep(100);
      landed = doc.getElementById('deckpage').style.display === 'flex';
    }
    ok(landed, 'QD7: boot with the stash lands on the deck-selection page');
    ok(doc.getElementById('start').style.display === 'none', 'QD8: the title screen is NOT shown');
    ok(window.sessionStorage.getItem('v3todeck') === null, 'QD9: the stash is consumed');
    const sum = doc.getElementById('decksum').textContent;
    ok(sum.includes('自分：超量') && sum.includes('相手：MILLENNIUM PROPHECY') && sum.includes('先攻'),
      'QD10: the selection summary names the stashed choices (got: ' + sum + ')');
    ok(doc.querySelector('#mydeckcur .dn').textContent === '超量', 'QD11: the own current-choice row shows 超量');
    ok(doc.querySelector('#opdeckcur .dn').textContent === 'MILLENNIUM PROPHECY', 'QD12: the opponent current-choice row shows MILLENNIUM PROPHECY');
    ok(doc.querySelector('#seg-mydeck button[data-v="superquant"]').classList.contains('sel'), 'QD13: the modal list marks 超量 selected');
    ok(doc.getElementById('result').style.display !== 'flex' && doc.getElementById('menubtn').disabled,
      'QD14: no duel was started by the landing');
    window.close();
  }

  console.log(failures === 0 ? 'ALL QUITDECK CHECKS PASSED' : failures + ' QUITDECK CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
