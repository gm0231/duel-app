'use strict';
/* test-fixbu129.js — fix-bu129-1125 (run 24, 2026-11-25).
 *
 * BU-129: in the fx settings sheet (#fxbtn) at 390x620 the last
 * line of the "自動" description ("表示します") was half-cut at
 * first paint (scrollH 554 vs clientH 534, 20px overflow — run 24;
 * this probe re-measures 552 vs 534, same 18-20px).
 *
 * Mechanism (measured, not assumed): #sheet IS the scroller and
 * its .btnrow is `position:sticky; bottom:0` with an opaque
 * background, so it paints over the scrolling content beneath it.
 * At scrollTop 0 the sticky row's top edge sat 5px into the last
 * description line (last-line bottom 555, btnrow top 550). The
 * line is only fully readable once the sheet stops overflowing.
 *
 * Two candidate fixes were MEASURED and rejected before editing:
 *   (a) ledger option 1 — padding-bottom on #sheet: overlap went
 *       5px -> 29px (the padding pushes content down under the
 *       sticky row; scrollH 552 -> 576). WORSE, not a fix.
 *   (b) ledger option 2 as written — "必須だけ表示します": the
 *       "自動" line is still 30 chars and still wraps to 2 visual
 *       lines (one visual line holds 29 chars at this width);
 *       scrollH/overlap unchanged at 552/5px. One char too long.
 * The fix shortens BOTH redundant lines (each repeats its own
 * mode name): "自動" drops "自動で" and "の確認", "毎回" drops
 * its repeated "毎回" — so the description goes from 6 visual
 * lines to 4 and the sheet stops overflowing at 620 (scrollH 512
 * = clientH 512, 20px of slack; overlap 0). Meanings are
 * unchanged; the mode names already say 自動 / 毎回.
 *
 * Pinned by source + jsdom behaviour; the visual proof is the
 * Chromium probe (probe-fixbu129.js): 620 baseline overlap 5px,
 * fixed build overlap 0px at both heights, screenshots eyeballed.
 */
const fs = require('fs');
const path = require('path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { console.log('SKIP: jsdom not resolvable (set NODE_PATH)'); process.exit(0); }

const V2 = __dirname;
const html = fs.readFileSync(path.join(V2, 'index.html'), 'utf8');
const clientSrc = fs.readFileSync(path.join(V2, 'client.js'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(V2, 'data.json'), 'utf8'));
const wasmBinary = fs.readFileSync(path.join(V2, 'build', 'ocgcore.wasm'));
let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- BU-129 source pins ----------
ok(clientSrc.includes('自動：任意のチェーン確認は全てパス。必須だけ表示します'),
  'F129a: the 自動 description is the short one-line form');
ok(clientSrc.includes('毎回：全てのチェーンで確認します（「聞かない」設定は無効）'),
  'F129b: the 毎回 description is the short one-line form');
ok(!clientSrc.includes('必須の確認だけ表示します'),
  'F129c: the old long 自動 line is gone (it wrapped to 2 visual lines)');
ok(!clientSrc.includes('すべてのチェーンで毎回確認します'),
  'F129d: the old long 毎回 line is gone (it wrapped with just 無効） on line 2)');
ok(!clientSrc.includes('全て自動でパス'),
  'F129e: no description repeats its own mode name (自動で / 毎回 are gone from the lines)');
{
  const m = clientSrc.match(/<div class="sub">おまかせ：[^<]*(?:<br>[^<]*)*<\/div>/);
  ok(!!m, 'F129f: the three-mode description block exists (setup)');
  if (m) {
    ok(m[0].includes('おまかせ：') && m[0].includes('毎回：') && m[0].includes('自動：'),
      'F129g: all three mode lines are still present (nothing was deleted, only shortened)');
  }
}
// the rejected padding fix must not come back: the sheet keeps its 12px padding
ok(html.includes('border-radius:12px 12px 0 0;padding:12px;'),
  'F129h: #sheet keeps padding:12px — no bottom-padding workaround (measured to WORSEN the cut, 5px -> 29px)');
// the mechanism pin: the sticky footer is WHY the last line must fit without scrolling
ok(html.includes('.btnrow{display:flex;gap:6px;margin-top:12px;position:sticky;bottom:0;background:#1d1811;z-index:2;padding-bottom:2px;}'),
  'F129i: the sheet confirm row is a sticky footer over scrolling content (the cut mechanism)');

// ---------- live behaviour in jsdom ----------
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

  // ----- BU-129 live: the settings sheet builds with the short descriptions -----
  window.eval('openFxSettings()');
  await sleep(100);
  const sheet = doc.getElementById('sheet');
  ok(doc.getElementById('sheetwrap').className.includes('on'), 'F129j: the settings sheet opens (setup)');
  const subs = [...sheet.querySelectorAll('.sub')];
  const desc = subs.find((el) => (el.textContent || '').includes('自動：'));
  ok(!!desc, 'F129k: the mode description block is in the sheet (setup)');
  if (desc) {
    const t = desc.textContent.replace(/\s+/g, ' ').trim();
    ok(t.includes('自動：任意のチェーン確認は全てパス。必須だけ表示します'),
      'F129l: the live sheet shows the short 自動 line (got ' + JSON.stringify(t.slice(t.indexOf('自動：'), t.indexOf('自動：') + 40)) + ')');
    ok(t.includes('毎回：全てのチェーンで確認します（「聞かない」設定は無効）'),
      'F129m: the live sheet shows the short 毎回 line');
    ok(!t.includes('必須の確認だけ') && !t.includes('すべてのチェーンで毎回確認'),
      'F129n: the live sheet shows neither old long line');
    const lines = desc.innerHTML.split('<br>');
    ok(lines.length === 3, 'F129o: the description is still exactly 3 logical lines (got ' + lines.length + ')');
  }
  const btns = [...sheet.querySelectorAll('.btnrow button')].map((b) => b.textContent.trim());
  ok(btns.includes('閉じる'), 'F129p: the sticky 閉じる row is present (got ' + JSON.stringify(btns) + ')');
  const segs = [...sheet.querySelectorAll('.seg button')].map((b) => b.textContent.trim());
  ok(segs.includes('おまかせ') && segs.includes('毎回') && segs.includes('自動') && segs.includes('ON') && segs.includes('OFF'),
    'F129q: all three setting segments are intact (got ' + JSON.stringify(segs) + ')');

  console.log(failures === 0 ? 'ALL PASS' : failures + ' FIX-BU129 CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.log('FAIL: exception', e && e.stack || e); process.exit(1); });
