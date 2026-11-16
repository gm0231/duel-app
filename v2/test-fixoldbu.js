'use strict';
/* test-fixoldbu.js — the 2026-11-16 fix-oldbu pins (triage-1116-oldbu
   follow-ups — 4 items, of which one turned out NOT to be a fix):
   BU-47 (2-line deck summary), BU-46 (notice visibility gate),
   BU-39 (chain-dim on the hand), BU-16 (NOT changed — see below).
   BU-16: the triage REPORT claimed the duel-dismiss button's
   wording (「このデュエル中は聞かない」) mismatched a
   scene-scoped behaviour. That premise is stale: the 2026-11-05
   user decision widened the scope to card+effect, duel-long
   (duelKey = code + effect number, cleared only at duel start),
   so the current wording is TRUE and the proposed scene wording
   would have made the button lie. The live guard for the wording
   is test-chainpass DK9 (it pins the current label); this file
   pins the scope facts at source level (F16a-c) and asserts the
   scene wording is absent. Card facts: none needed beyond the
   deck names (MILLENNIUM PROPHECY / ゲート・ガーディアン). */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { TextEncoder, TextDecoder } = require('util');

const V2 = __dirname;
const data = JSON.parse(fs.readFileSync(path.join(V2, 'data.json'), 'utf8'));
const fxmap = JSON.parse(fs.readFileSync(path.join(V2, 'fxmap.json'), 'utf8'));
const clientSrc = fs.readFileSync(path.join(V2, 'client.js'), 'utf8');
const html = fs.readFileSync(path.join(V2, 'index.html'), 'utf8');

let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ================= Part A: BU-47 + BU-16 (vm stub DOM) =================
function stubEl() {
  return {
    children: [], style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    textContent: '', innerHTML: '', className: '', disabled: false, volume: 1,
    addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
    appendChild() {}, click() {}, animate: () => ({}), getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }),
    setAttribute() {}, removeAttribute() {}, remove() {}, play: () => Promise.resolve(), pause() {}, load() {},
  };
}
const els = {};
const documentStub = {
  getElementById: (id) => els[id] || (els[id] = stubEl()),
  querySelector: () => null, querySelectorAll: () => [],
  addEventListener() {}, createElement: () => stubEl(), body: stubEl(),
};
const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval, Promise, Math, JSON,
  TextEncoder, TextDecoder,
  document: documentStub,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  Audio: class { constructor() {} play() { return Promise.resolve(); } pause() {} },
  fetch: async () => ({ ok: true, json: async () => data, arrayBuffer: async () => new ArrayBuffer(0) }),
  performance: { now: () => 0 },
  requestAnimationFrame: () => 0,
  location: { href: 'http://localhost/v2/', search: '' },
  navigator: { userAgent: 'node' },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(V2, 'engine.js'), 'utf8'), sandbox, { filename: 'engine.js' });
const trailer = '\n;globalThis.__T = { updateDeckSum,' +
  ' setDATA: (d) => { DATA = d; },' +
  ' setFXMAP: (m) => { FXMAP = m; },' +
  ' setDecks: (my, op, first) => { myDeckKey = my; opDeckKey = op; firstChoice = first; },' +
  ' decksumEl: () => document.getElementById(\'decksum\') };';
vm.runInContext(clientSrc + trailer, sandbox, { filename: 'client.js' });
const T = sandbox.__T;
T.setDATA(data);
T.setFXMAP(fxmap);

// ---- BU-47: the turn rides its own line ----
ok(clientSrc.includes("el.innerHTML = nbHTML(decks) + '<br>' + nbHTML(turnLine);"),
  'F47a: the summary splits decks and turn with a <br>');
ok(clientSrc.includes('while (el.scrollHeight > 38 && fs > 10.5)'),
  'F47d: the shrink-to-fit loop is retargeted to two lines (38px)');
{
  T.setDecks('ishizu', 'gg', 'first');
  T.updateDeckSum();
  const el = T.decksumEl();
  const parts = el.innerHTML.split('<br>');
  ok(parts.length === 2, 'F47b: the summary has exactly two lines (got ' + parts.length + ')');
  ok(parts[0].includes('ゲート・ガーディアン') && !parts[0].trimEnd().endsWith('／') && !parts[0].includes('／</span>$'),
    'F47b: line 1 ends with a complete deck name, no dangling ／');
  ok(parts[1].replace(/<[^>]+>/g, '').trim() === '先攻',
    'F47b: line 2 is the turn alone (got ' + JSON.stringify(parts[1]) + ')');
  // the stub DOM does not sync innerHTML -> textContent (a real
  // DOM does); strip the tags to read the text instead
  const text = el.innerHTML.replace(/<[^>]+>/g, '');
  ok(text.includes('自分：MILLENNIUM PROPHECY') && text.includes('相手：ゲート・ガーディアン') && text.includes('先攻'),
    'F47b: text still carries all three parts (' + JSON.stringify(text) + ')');
}
{
  T.setDecks('ishizu', 'gg', 'second');
  T.updateDeckSum();
  const parts = T.decksumEl().innerHTML.split('<br>');
  ok(parts[1].replace(/<[^>]+>/g, '').trim() === '後攻', 'F47c: 後攻 rides its own line');
  T.setDecks('ishizu', 'gg', 'random');
  T.updateDeckSum();
  const partsR = T.decksumEl().innerHTML.split('<br>');
  ok(partsR[1].replace(/<[^>]+>/g, '').trim() === '先攻・後攻ランダム', 'F47c: 先攻・後攻ランダム rides its own line');
}

// ---- BU-16: no change — the scope IS duel-long (2026-11-05 ruling) ----
ok(clientSrc.includes('Duel-long dismissal class (BU-04, user ruling 2026-11-05)'),
  'F16a: duelKey is documented duel-long by the 2026-11-05 user ruling');
ok(clientSrc.includes("if (fx && fx.n && !fx.act) return e.code + '|fx' + fx.n;"),
  'F16a: the duel-dismiss key is card + effect number');
{
  const resets = (clientSrc.match(/dismissedDuel = new Map\(\)/g) || []).length;
  ok(resets === 2, 'F16b: dismissedDuel is assigned in exactly 2 places — declaration + duel-start reset (got ' + resets + ')');
  ok(!clientSrc.includes('dismissedDuel.clear()'), 'F16b: dismissedDuel is never cleared mid-duel');
}
ok(clientSrc.includes('このデュエル中は聞かない（このカードのこの効果）'),
  'F16c: the button wording is unchanged (it matches the duel-long scope)');
ok(!clientSrc.includes('この場面では聞かない'),
  'F16c: the scene wording is absent — it would have made the button lie');

// ================= Part B+C: jsdom (BU-46 gate, BU-39 live duel) =================
(async () => {
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { console.log('SKIP: jsdom not resolvable (set NODE_PATH)'); process.exit(failures ? 1 : 0); }
const wasmBinary = fs.readFileSync(path.join(V2, 'build', 'ocgcore.wasm'));

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

// ---- BU-46: the notice stays invisible until the header contains it ----
ok(clientSrc.includes("d.style.visibility = contained ? '' : 'hidden';"),
  'F46a: anchorNotice gates the notice on containment');
{
  // the ledger fix: the tag's restore must not take its share
  // back while a notice is live (the dip lives between anchors,
  // so the gate alone cannot catch it — see RECORD.md)
  const iFn = clientSrc.indexOf('function fxTagRestoreHeader()');
  const iNext = clientSrc.indexOf('function fxNotice(', iFn);
  const body = clientSrc.slice(iFn, iNext);
  ok(body.includes("if (document.querySelector('#fxlayer .fx-notice')) return;"),
    'F46d: the tag restore defers while a notice is live');
  const iEarly = body.indexOf("if (document.querySelector('#fxlayer .fx-notice')) return;");
  const iWant = body.indexOf('const want = Math.max(base, cur - grew);');
  ok(iEarly > 0 && iWant > iEarly,
    'F46d: the deferral runs before the take-back is computed');
}
{
  const window = await boot();
  const doc = window.document;
  ok(doc.getElementById('loadmsg').textContent.includes('準備完了'), 'F46b: boot loads data.json');
  // stub geometry: header 110px tall, row-2 bottom at 110, layer full
  const header = doc.getElementById('header');
  const layer = doc.getElementById('fxlayer');
  const logline = doc.getElementById('logline');
  const rect = (o) => () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, ...o });
  let headerBottom = 110;
  header.getBoundingClientRect = rect({ bottom: 110, height: 110, width: 390 });
  Object.defineProperty(header, 'getBoundingClientRect', { value: () => ({ top: 0, bottom: headerBottom, left: 0, right: 390, width: 390, height: headerBottom }), configurable: true });
  layer.getBoundingClientRect = rect({ top: 0, bottom: 620, left: 0, right: 390, width: 390, height: 620 });
  logline.getBoundingClientRect = rect({ top: 86, bottom: 110, left: 4, right: 204, width: 200, height: 24 });
  // offsetHeight: the notice measures 41px, the header 110px (its stub);
  // everything else reports 0, as jsdom does natively
  const ohMap = new WeakMap();
  ohMap.set(header, 110);
  Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', {
    get() {
      if (this.classList && this.classList.contains('fx-notice')) return 41;
      return ohMap.get(this) || 0;
    }, configurable: true,
  });
  window.eval('fxNoticeShow("テスト通知：カードの移動", null, true)');
  const n = doc.querySelector('#fxlayer .fx-notice');
  ok(!!n, 'F46b: the notice element exists after fxNoticeShow');
  ok(n && header.style.minHeight === '155px',
    'F46b: the header still grows synchronously (minHeight ' + header.style.minHeight + ')');
  ok(n && n.style.visibility === 'hidden',
    'F46b: while the measured header bottom (110) is short of the notice bottom (155), the notice is hidden (got ' + (n && n.style.visibility) + ')');
  // the growth lands: the measured header bottom moves to 155
  headerBottom = 155;
  logline.textContent = '新しいイベント行';
  await sleep(150);
  ok(n && n.style.visibility === '',
    'F46c: once the header contains the notice, it appears (got ' + (n && n.style.visibility) + ')');
}

// ---- BU-39: chain-dim on the hand, in real duels ----
  // Random play rarely sets a trap before dying, and without a
  // set trap (or a quick-play spell in hand) no chain prompt
  // ever carries a live candidate — the first version of this
  // driver played a whole duel with 0 tray ticks. The stepper
  // therefore prefers セット in the action sheet (traps reach
  // the field, chain questions arrive), and up to 3 fresh duels
  // are played until 5 qualifying dock-open moments are seen.
  async function playOneDuel() {
    const window = await boot();
    const doc = window.document;
    const $ = (id) => doc.getElementById(id);
    const q = (sel, root) => (root || doc).querySelector(sel);
    const qa = (sel, root) => [...(root || doc).querySelectorAll(sel)];
    $('startbtn').click();
    const obs = { qualify: 0, candSeen: 0, candDimmed: 0, nonCandUndimmed: 0, violations: [], ticks: 0, trayTicks: 0, dockTicks: 0, dockNoHand: 0, resultSeen: false };
    const t0 = Date.now();
    while (Date.now() - t0 < 180000 && obs.qualify < 5 && !obs.resultSeen) {
      obs.ticks++;
      if ($('result').style.display === 'flex') { obs.resultSeen = true; break; }
      const dockOn = $('dock').className === 'on';
      if ($('chainui') && $('chainui').classList.contains('on')) obs.trayTicks++;
      if (dockOn) {
        obs.dockTicks++;
        // hand candidates in this dock: .cand whose .loc names the hand
        const candHandNames = new Set();
        for (const c of qa('.cand', $('dock'))) {
          const loc = c.querySelector('.loc');
          const nm = c.querySelector('.cname');
          if (loc && nm && loc.textContent.includes('手札')) candHandNames.add(nm.textContent.trim());
        }
        const hand = qa('#hand .hcard[data-code]');
        if (hand.length === 0) obs.dockNoHand++;
        if (hand.length > 0) {
          let nonCand = 0, bad = [];
          for (const hc of hand) {
            const name = data.names[hc.dataset.code];
            const isCand = name && candHandNames.has(name);
            const dimmed = hc.classList.contains('dim');
            if (isCand) { obs.candSeen++; if (dimmed) { obs.candDimmed++; bad.push('CAND-DIMMED:' + name); } }
            else { nonCand++; if (!dimmed) { obs.nonCandUndimmed++; bad.push('NONCAND-LIT:' + name); } }
          }
          if (nonCand > 0) {
            obs.qualify++;
            if (bad.length) obs.violations.push({ tick: obs.ticks, bad });
          }
        }
      }
      // stepper (test-ui playDuel, trimmed): answer whatever is open
      const sheetOn = $('sheetwrap').className === 'on';
      const trayOn = $('chainui') && $('chainui').classList.contains('on');
      let acted = false;
      const click = (el) => { if (el) { el.click(); acted = true; } };
      if (trayOn) {
        click(q('.ct-yes', $('chaintray')) || q('.ct-no', $('chaintray')));
      } else if (sheetOn) {
        const sheet = $('sheet');
        const inc = q('[data-inc]', sheet);
        const counterOk = q('#counter-confirm', sheet);
        // prefer セット: a set trap is what makes chain questions
        // arrive at all (see the note above)
        const setBtn = qa('[data-action-idx]', sheet).find(b => b.textContent.includes('セット'));
        if (inc && counterOk && counterOk.disabled) click(inc);
        else if (counterOk && !counterOk.disabled) click(counterOk);
        else if (q('#grid-confirm', sheet) && !q('#grid-confirm', sheet).disabled) click(q('#grid-confirm', sheet));
        else if (setBtn) click(setBtn);
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
        else if (q('.optbtn:not(.disabled)', sheet)) click(q('.optbtn:not(.disabled)', sheet));
        else if (q('#grid-cancel', sheet)) click(q('#grid-cancel', sheet));
        else if (q('#sheet-cancel', sheet)) click(q('#sheet-cancel', sheet));
      } else if (dockOn) {
        click(q('#chain-pass', $('dock')) || q('[data-chain]', $('dock')));
      } else if ($('placehint').className === 'on') {
        click(q('.slot.hl'));
      } else if (!$('phasebtn').disabled) {
        click($('phasebtn'));
      } else {
        click(q('[data-act]'));
      }
      await sleep(30);
    }
    return obs;
  }
  const totals = { qualify: 0, candSeen: 0, candDimmed: 0, nonCandUndimmed: 0, trayTicks: 0, dockTicks: 0, duels: 0 };
  const allViolations = [];
  for (let d = 0; d < 3 && totals.qualify < 5; d++) {
    const o = await playOneDuel();
    totals.duels++;
    totals.qualify += o.qualify; totals.candSeen += o.candSeen; totals.candDimmed += o.candDimmed;
    totals.nonCandUndimmed += o.nonCandUndimmed; totals.trayTicks += o.trayTicks; totals.dockTicks += o.dockTicks;
    allViolations.push(...o.violations);
    console.log('  F39 duel ' + (d + 1) + ':', JSON.stringify(o));
    if (!o.resultSeen && o.qualify < 5) console.log('  F39 duel ' + (d + 1) + ' ended without a result screen (timeout) — continuing');
  }
  console.log('  F39 totals:', JSON.stringify({ ...totals, violations: allViolations.slice(0, 3) }));
  ok(totals.qualify >= 3, 'F39b: at least 3 dock-open moments with a non-candidate hand card (got ' + totals.qualify + ' in ' + totals.duels + ' duel(s))');
  ok(totals.nonCandUndimmed === 0, 'F39b: every non-candidate hand card was dimmed while the dock was open (undimmed: ' + totals.nonCandUndimmed + ')');
  ok(totals.candDimmed === 0, 'F39c: no chain-candidate hand card was dimmed (dimmed: ' + totals.candDimmed + ' of ' + totals.candSeen + ' seen)');
  if (totals.candSeen === 0) console.log('  NOTE F39c: no hand candidate appeared in these duels — the candidate branch is covered by the symmetric code + source pin, not by live play');

console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURES');
process.exit(failures ? 1 : 0);
})();

