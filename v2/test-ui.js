'use strict';
/* test-ui.js — Phase 2 jsdom click-through (needs jsdom: NODE_PATH=<dir with jsdom>).
   Loads the REAL index.html + build/ocgcore.js + engine.js + client.js into
   jsdom (wasm bytes injected, fetch/Audio stubbed) and plays two full duels by
   clicking the DOM like a user:
     run 1: defaults (自分=イシズ / 相手=ゲート・ガーディアン / 先攻)
     run 2: 自分=ゲート・ガーディアン / 相手=イシズ / 後攻 (seat swap)
   Asserts: duel reaches the result screen, the retry warning text never
   appears (proxy for MSG_RETRY == 0), Japanese names render, the chain
   duel-dismissal control works when offered, and an ANNOUNCE_CARD grid (if
   one appears) shows its source context and offers no Extra-Deck-type card. */
const fs = require('fs');
const path = require('path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { console.log('SKIP: jsdom not resolvable (set NODE_PATH)'); process.exit(0); }

const V2 = __dirname;
const html = fs.readFileSync(path.join(V2, 'index.html'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(V2, 'data.json'), 'utf8'));
const wasmBinary = fs.readFileSync(path.join(V2, 'build', 'ocgcore.wasm'));
const TYPE_EXTRA_MASK = 0x4802040;
const nameToCode = {};
for (const [code, nm] of Object.entries(data.names)) nameToCode[nm] = +code;

async function playDuel(window, opts) {
  const doc = window.document;
  const $ = (id) => doc.getElementById(id);
  const q = (sel, root) => (root || doc).querySelector(sel);
  const qa = (sel, root) => [...(root || doc).querySelectorAll(sel)];
  const obs = { retrySeen: false, retryContext: null, jpSeen: false, liveStatSamples: [], dismissClicked: 0,
                autopassChipSeen: false, announce: [], ticks: 0, stalls: 0 };
  let lastDom = '';
  const t0 = Date.now();
  while (Date.now() - t0 < opts.timeoutMs) {
    obs.ticks++;
    // Retry proxy: the warning text in a PROMPT container only. (Scanning
    // document.body would match the literal string inside client.js source.)
    if (!obs.retrySeen) {
      for (const id of ['sheet', 'dock', 'placehint']) {
        if ($(id).textContent.includes('その選択はできませんでした')) {
          obs.retrySeen = true;
          obs.retryContext = id + ': ' + $(id).textContent.slice(0, 120);
        }
      }
    }
    if ($('result').style.display === 'flex') { obs.resultTitle = $('resultTitle').textContent; obs.resultDetail = $('resultDetail').textContent; return obs; }
    // observations
    const ap = $('autopass');
    if (ap && ap.textContent.includes('自動パス')) obs.autopassChipSeen = true;
    for (const hc of qa('#hand .hcard .nm')) if (/[ぁ-んァ-ヶ一-龯]/.test(hc.textContent)) obs.jpSeen = true;
    for (const t of qa('.slot')) {
      // live stats now render in the slot-level .slotstats strip (ATK/DEF
      // labels, outside the card frame) instead of inside the tile
      const tile = t.querySelector('.tile');
      const nm = tile ? tile.querySelector('.nm') : null, st = t.querySelector('.slotstats');
      if (nm && st && nameToCode[nm.textContent] != null) {
        const cd = data.cards[nameToCode[nm.textContent]];
        const m = st.textContent.match(/ATK (\d+)DEF (\d+)/);
        if (cd && m && (+m[1] !== cd.atk || +m[2] !== cd.def) && obs.liveStatSamples.length < 4)
          obs.liveStatSamples.push(nm.textContent + ' 表示 ATK ' + m[1] + '／DEF ' + m[2] + ' / 印刷 ' + cd.atk + '/' + cd.def);
      }
    }
    const sheetOn = $('sheetwrap').className === 'on';
    const dockOn = $('dock').className === 'on';
    let acted = false;
    const click = (el) => { if (el) { el.click(); acted = true; } };
    if (sheetOn) {
      const sheet = $('sheet');
      const ttl = sheet.querySelector('.ttl');
      if (ttl && ttl.textContent.includes('カードの宣言')) {
        const ctx = sheet.querySelector('.ctx');
        const bad = qa('[data-code]', sheet).some(g => (data.cards[g.dataset.code].type & TYPE_EXTRA_MASK) !== 0);
        obs.announce.push({ ctx: ctx ? ctx.textContent : null, offersExtraType: bad });
      }
      const inc = q('[data-inc]', sheet);
      const counterOk = q('#counter-confirm', sheet);
      if (inc && counterOk && counterOk.disabled) click(inc);
      else if (counterOk && !counterOk.disabled) click(counterOk);
      else if (q('#grid-confirm', sheet) && !q('#grid-confirm', sheet).disabled) click(q('#grid-confirm', sheet));
      else if (q('[data-action-idx]', sheet)) click(q('[data-action-idx]', sheet));
      else if (q('[data-code]', sheet)) click(q('[data-code]', sheet));
      else if (q('[data-pos]', sheet)) click(q('[data-pos]', sheet));
      else if (q('.posbtn', sheet)) click(q('.posbtn', sheet));
      else if (q('#yn-yes', sheet)) click(q('#yn-yes', sheet));
      else if (q('[data-num]', sheet)) click(q('[data-num]', sheet));
      else if (q('[data-bit]', sheet)) click(q('[data-bit]', sheet));
      else if (q('[data-unselect]', sheet)) click(q('[data-unselect]', sheet));
      else if (q('#unselect-finish', sheet)) click(q('#unselect-finish', sheet));
      else if (q('#sort-ok', sheet)) click(q('#sort-ok', sheet));
      else if (q('#fb-auto', sheet)) click(q('#fb-auto', sheet));
      else if (q('[data-pile-act]', sheet)) click(q('[data-pile-act]', sheet));
      else if (q('[data-grid]:not(.sel)', sheet) || q('[data-grid]', sheet)) click(q('[data-grid]:not(.sel)', sheet) || q('[data-grid]', sheet));
      else if (q('.optbtn:not(.disabled)', sheet)) click(q('.optbtn:not(.disabled)', sheet)); // a disabled optbtn (e.g. an effect that cannot fire now) must not shadow #sheet-cancel — clicking it loops forever
      else if (q('#grid-cancel', sheet)) click(q('#grid-cancel', sheet));
      else if (q('#sheet-cancel', sheet)) click(q('#sheet-cancel', sheet));
    } else if (dockOn) {
      const dd = q('[data-dueldismiss]', $('dock'));
      if (dd && opts.useDismissal && obs.dismissClicked === 0) { obs.dismissClicked++; click(dd); }
      else click(q('#chain-pass', $('dock')) || q('[data-chain]', $('dock')));
    } else if ($('placehint').className === 'on') {
      click(q('.slot.hl'));
    } else if (!$('phasebtn').disabled) {
      click($('phasebtn'));
    } else {
      click(q('[data-act]'));
    }
    const domNow = doc.body.innerHTML.length + '|' + (sheetOn ? 's' : '') + (dockOn ? 'd' : '') + $('logline').textContent;
    if (domNow === lastDom && !acted) obs.stalls++; else obs.stalls = 0;
    lastDom = domNow;
    if (obs.stalls > 400) { obs.stalled = true; return obs; } // ~12s without any change
    await new Promise(r => setTimeout(r, 30));
  }
  obs.timedOut = true;
  return obs;
}

async function boot() {
  const dom = new JSDOM(html, { url: 'http://localhost/v2/', runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  window.Audio = class { constructor(src) { this.src = src; this.volume = 1; } play() { return Promise.resolve(); } pause() {} };
  // fetch stub: data.json -> parsed data; the wasm -> real bytes (the emscripten
  // glue fetches it even when wasmBinary is offered, depending on build flags)
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
  return window;
}

(async () => {
  let failures = 0;
  const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };

  // ---- run 1: defaults, 先攻, exercise the duel-dismissal once
  {
    const window = await boot();
    const doc = window.document;
    ok(doc.getElementById('loadmsg').textContent.includes('準備完了'), 'UI1: boot loads data.json');
    doc.getElementById('startbtn').click();
    const obs = await playDuel(window, { timeoutMs: 420000, useDismissal: true });
    console.log('  run1:', JSON.stringify({ ...obs, liveStatSamples: obs.liveStatSamples, announce: obs.announce.slice(0, 2) }));
    ok(!!obs.resultTitle, 'UI2: run 1 duel reaches the result screen (' + (obs.resultTitle || 'none') + ')');
    ok(!obs.retrySeen, 'UI3: run 1 retry warning never shown (MSG_RETRY proxy == 0)');
    ok(obs.jpSeen, 'UI4: Japanese card names rendered in hand');
    ok(!obs.stalled && !obs.timedOut, 'UI5: run 1 never stalled/timed out');
    if (obs.announce.length) {
      ok(obs.announce.every(a => a.ctx && a.ctx.includes('墓守の罠')), 'UI6: ANNOUNCE_CARD grid shows Gravekeeper\'s Trap context');
      ok(obs.announce.every(a => !a.offersExtraType), 'UI7: ANNOUNCE_CARD grid offers no Extra-Deck-type card');
    } else console.log('  (no ANNOUNCE_CARD prompt occurred in run 1 — context/filter are covered by test-phase2 A2/C)');
    window.close();
  }

  // ---- run 2: deck swap + 後攻 (human on core seat 1)
  {
    const window = await boot();
    const doc = window.document;
    const seg = (id, v) => doc.querySelector('#' + id + ' button[data-v="' + v + '"]').click();
    seg('seg-mydeck', 'gg'); seg('seg-opdeck', 'ishizu'); seg('seg-first', 'second');
    doc.getElementById('startbtn').click();
    const obs = await playDuel(window, { timeoutMs: 420000, useDismissal: false });
    console.log('  run2:', JSON.stringify({ ...obs, liveStatSamples: obs.liveStatSamples, announce: obs.announce.slice(0, 2) }));
    ok(!!obs.resultTitle, 'UI8: run 2 (後攻・seat 1, decks swapped) reaches the result screen (' + (obs.resultTitle || 'none') + ')');
    ok(!obs.retrySeen, 'UI9: run 2 retry warning never shown');
    ok(!obs.stalled && !obs.timedOut, 'UI10: run 2 never stalled/timed out');
    window.close();
  }

  console.log(failures === 0 ? 'ALL UI CHECKS PASSED' : failures + ' UI CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
