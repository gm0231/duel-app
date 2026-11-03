'use strict';
/* test-logdetail-ui.js — the history sheet renders the DETAILED
   stream (log-detail round, user report 2026-11-03: 履歴ログが
   詳細でない). Boots the real client (jsdom; skipped when jsdom
   is unresolvable), plays bot-driven turns until the detailed
   stream has a chain episode, opens 履歴 during a live prompt and
   asserts the sheet's structure: turn headings, chain grouping,
   effect-numbered activation lines, resolution headers — i.e.
   that activation <-> resolution can be traced in the sheet.
   The engine-side content assertions live in test-logdetail.js. */
const fs = require('fs');
const path = require('path');

let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };

async function main() {
  let JSDOM;
  try { ({ JSDOM } = require('jsdom')); }
  catch (e) { console.log('SKIP: jsdom not resolvable (set NODE_PATH)'); return; }
  const V2 = __dirname;
  const html = fs.readFileSync(path.join(V2, 'index.html'), 'utf8');
  const data = JSON.parse(fs.readFileSync(path.join(V2, 'data.json'), 'utf8'));
  const fxmap = JSON.parse(fs.readFileSync(path.join(V2, 'fxmap.json'), 'utf8'));
  const wasmBinary = fs.readFileSync(path.join(V2, 'build', 'ocgcore.wasm'));
  const dom = new JSDOM(html, { url: 'http://localhost/v2/', runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  const doc = window.document;
  window.Audio = class { constructor(src) { this.src = src; } play() { return Promise.resolve(); } pause() {} };
  const wasmBuf = wasmBinary.buffer.slice(wasmBinary.byteOffset, wasmBinary.byteOffset + wasmBinary.byteLength);
  window.fetch = async (url) => String(url).includes('ocgcore.wasm')
    ? { ok: true, status: 200, url: String(url), arrayBuffer: async () => wasmBuf }
    : { ok: true, status: 200, json: async () => (String(url).includes('fxmap') ? fxmap : data), arrayBuffer: async () => wasmBuf };
  const inject = (file) => {
    const s = doc.createElement('script');
    s.textContent = fs.readFileSync(path.join(V2, file), 'utf8');
    doc.body.appendChild(s);
  };
  inject('build/ocgcore.js');
  const origFactory = window.OcgCoreModule;
  window.OcgCoreModule = (opts) => origFactory(Object.assign({}, opts, { wasmBinary }));
  inject('engine.js');
  inject('client.js');
  const ev = (src) => window.eval(src);
  for (let i = 0; i < 100 && !doc.getElementById('loadmsg').textContent.includes('準備完了'); i++)
    await new Promise(r => setTimeout(r, 50));
  ok(doc.getElementById('loadmsg').textContent.includes('準備完了'), 'D0: client booted');
  ev('window.__mem = Engine.makeBotMemory()');
  doc.getElementById('startbtn').click();
  // Drive with the bot policy until the detailed stream holds a
  // full chain episode (activation + resolution). The client runs
  // at presentation pace, so this can take a few real minutes.
  let ready = false;
  for (let i = 0; i < 4000 && !ready; i++) {
    ready = ev(`(() => {
      if (typeof histEntries !== 'undefined' && histEntries.some(e => e.k === 'act') && histEntries.some(e => e.k === 'solve')) return true;
      if (currentPrompt) { try { finishPrompt(Engine.botAnswer(currentPrompt.prompt, duel.state, DATA, window.__mem)); } catch (e) {} }
      return false;
    })()`);
    if (!ready) await new Promise(r => setTimeout(r, 30));
  }
  ok(ready, 'D1: detailed stream captured a chain episode during live play');
  if (!ready) { window.close(); return; }
  const counts = JSON.parse(ev('JSON.stringify({n: histEntries.length, act: histEntries.filter(e=>e.k==="act").length, rows: Math.min(histEntries.length, 240)})'));
  // The 履歴 button lives in the prompt dock; keep driving until
  // a prompt that carries it is on screen, then tap it like a user.
  for (let i = 0; i < 2000 && !doc.querySelector('#loghistbtn'); i++) {
    ev(`(() => { if (currentPrompt) { try { finishPrompt(Engine.botAnswer(currentPrompt.prompt, duel.state, DATA, window.__mem)); } catch (e) {} } return 0; })()`);
    await new Promise(r => setTimeout(r, 30));
  }
  ok(!!doc.querySelector('#loghistbtn'), 'D1b: 履歴 button reached');
  // A view sheet (e.g. the card-confirmation sheet) may own the
  // screen at this instant — openLogHistory rightly defers to it.
  // Close any view sheet first (its close path is the user's ×)
  // and retry the tap a few times, like a user would.
  let opened = false;
  for (let t = 0; t < 6 && !opened; t++) {
    if (doc.getElementById('sheetwrap').className === 'on') { ev('sheetClose()'); await new Promise(r => setTimeout(r, 120)); }
    const b = doc.querySelector('#loghistbtn');
    if (b) { b.click(); await new Promise(r => setTimeout(r, 120)); }
    opened = doc.getElementById('sheetwrap').className === 'on' && doc.getElementById('sheet').textContent.includes('対戦の履歴');
    if (!opened) {
      ev(`(() => { if (currentPrompt) { try { finishPrompt(Engine.botAnswer(currentPrompt.prompt, duel.state, DATA, window.__mem)); } catch (e) {} } return 0; })()`);
      await new Promise(r => setTimeout(r, 200));
    }
  }
  ok(opened, 'D2: 履歴 opens the history sheet during live play');
  const sheet = doc.getElementById('sheet');
  ok(sheet.textContent.includes('対戦の履歴'), 'D3: sheet is the history');
  ok(sheet.querySelectorAll('.logturn').length >= 1, 'D4: turn headings render (' + sheet.querySelectorAll('.logturn').length + ')');
  ok(sheet.querySelectorAll('.logchain').length >= 1, 'D5: chain episodes are grouped (' + sheet.querySelectorAll('.logchain').length + ')');
  ok(sheet.querySelectorAll('.loghistrow.solve').length >= 1, 'D6: resolution headers render (' + sheet.querySelectorAll('.loghistrow.solve').length + ' for ' + counts.act + ' activations)');
  const subM = sheet.textContent.match(/全 (\d+) 件/);
  const expectRows = subM ? Math.min(parseInt(subM[1], 10), 240) : -1;
  ok(sheet.querySelectorAll('.loghistrow').length === expectRows, 'D7: every captured entry renders as a row (' + sheet.querySelectorAll('.loghistrow').length + '/' + expectRows + ')');
  const txt = sheet.textContent;
  ok(/リンク\d+：(自分|相手) の \S+/.test(txt), 'D8: activation lines carry link, owner and card');
  // Deterministic suffix check with the real fxmap: find a pool
  // card whose wire desc resolves to a numbered effect and verify
  // the activation-line builder stamps that number. (Whether the
  // first chained card of THIS game was a numbered-effect card is
  // game variance, so the sheet text itself is not asserted here.)
  const probe = ev(`(() => {
    for (const k of Object.keys(FXMAP)) {
      const code = +k, m = FXMAP[k];
      for (let idx = 0; idx < 4; idx++) {
        const desc = code * 1048576 + idx;
        const fx = resolveEffect(code, desc);
        if (fx && fx.n) return dlogText({ k: 'act', con: HP, code, desc, loc: 4, link: 1 });
      }
    }
    return '';
  })()`);
  ok(/の効果[①-⑯]/.test(probe), 'D8b: numbered effects are stamped with their number (' + probe + ')');
  ok(/▼ 解決：リンク\d+/.test(txt), 'D9: resolution headers name their link');
  ok(!/(#0|undefined|NaN)/.test(txt), 'D10: no placeholder garbage in the sheet');
  // Deterministic renderer probe: two back-to-back chain episodes
  // (different episode ids, no plain entry between them) must get
  // SEPARATE boxes — the frame check caught them merged into one.
  ev('sheetClose()');
  await new Promise(r => setTimeout(r, 500));
  ev(`(() => {
    histEntries = [
      { turn: 1, tp: 0, ph: 'MAIN1', k: 'act', cid: 11, sol: 0, text: 'リンク1：自分 の A の効果①' },
      { turn: 1, tp: 0, ph: 'MAIN1', k: 'solve', cid: 11, sol: 0, text: '▼ 解決：リンク1 A の効果①' },
      { turn: 1, tp: 0, ph: 'MAIN1', k: 'act', cid: 12, sol: 0, text: 'リンク1：相手 の B の発動' },
      { turn: 1, tp: 0, ph: 'MAIN1', k: 'solve', cid: 12, sol: 0, text: '▼ 解決：リンク1 B の発動' },
      { turn: 1, tp: 0, ph: 'MAIN1', k: 'info', cid: 0, sol: 0, text: '自分：C を召喚（表側攻撃表示）' },
    ];
    if (!logHist.length) logHist = [{ turn: 1, text: 'x' }];
    openLogHistory();
    return 0;
  })()`);
  await new Promise(r => setTimeout(r, 150));
  ok(doc.getElementById('sheet').querySelectorAll('.logchain').length === 2, 'D11: back-to-back episodes get separate boxes (' + doc.getElementById('sheet').querySelectorAll('.logchain').length + ')');
  ok(doc.getElementById('sheet').querySelectorAll('.logturn').length === 1, 'D12: one turn heading for one turn');
  console.log(failures === 0 ? 'ALL LOGDETAIL-UI CHECKS PASSED' : failures + ' LOGDETAIL-UI CHECK(S) FAILED');
  window.close();
  process.exit(failures === 0 ? 0 : 1);
}
main().catch(e => { console.error('FATAL', e); process.exit(2); });
