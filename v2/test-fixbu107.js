'use strict';
/* test-fixbu107.js — fix-bu107-1118 (BU-107 remainder).
 *
 * The last BU-107 item: the move notice "相手のカードが手札に
 * 加わった" broke mid-word ("加わっ／た") because the notice body
 * is one keep-all run with no break opportunity and
 * overflow-wrap:anywhere split it as a last resort (ledger
 * fix9396d section; parent re-verification: 23+ notices, 0 splits,
 * this one case unobserved). The fix unitizes the text at render
 * time in fxNoticeUnitize: a <wbr> break opportunity sits after
 * every particle / punctuation mark and after an "×N" count, so the
 * line breaks BETWEEN phrase units, never inside a word. Card
 * names ride intact inside 《》 (keep-all already confines their
 * breaks to the "－" / "・" / "～" separators, which the fix9396d
 * verification counts as NOT a mid-word split). Font size stays
 * 12.5px (parent decision: no font-fit revival).
 *
 * Pinned by source + the unitizer's output in jsdom; the
 * line-break proof is the Chromium probe (probe-bu107.js):
 * pre-fix 5 genuine bad breaks in 18 cases (the exact ledger
 * case "加わっ／た" reproduced), post-fix 0 bad breaks in 18
 * cases, 0 horizontal overflow, font 12.5px throughout.
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

// ---------- source pins ----------
ok(clientSrc.includes('function fxNoticeUnitize(text)'), 'B107a: the notice unitizer exists');
ok(clientSrc.includes("d.innerHTML = '<div class=\"nt\">' + (sub ? '<span class=\"ns\">' + sub + '</span><span class=\"nsep\">｜</span>' : '') + fxNoticeUnitize(text) + '</div>';"), 'B107b: fxNoticeShow renders the unitized text');
ok(clientSrc.includes("return esc(p).replace(/([がをにでともはのやかへて、。！？」』）]|×\\d+)/g, '$1<wbr>');"), 'B107c: break opportunities sit after particles / punctuation / ×N counts');
ok(clientSrc.includes("if (/^《[^》]*》$/.test(p)) return esc(p);"), 'B107d: card names ride intact inside 《》');
ok(html.includes('.fx-notice .nt{font-size:18px;font-weight:800;color:#ffe9a8;line-height:1.45;letter-spacing:.02em;word-break:keep-all;overflow-wrap:anywhere;}'), 'B107e: the notice keeps keep-all / anywhere (no font-fit revival; notice-center-1118: the centre band restores the pre-BU-83 18px/1.45 type)');
ok(!clientSrc.includes('fxNoticeUnitize') || !/font-size:\s*10px/.test(clientSrc.slice(clientSrc.indexOf('function fxNoticeShow'), clientSrc.indexOf('function fxNoticeShow') + 2000)), 'B107f: no font step-down inside fxNoticeShow');

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
  const unitize = (t) => window.eval('fxNoticeUnitize(' + JSON.stringify(t) + ')');
  const stripWbr = (s) => s.replace(/<wbr>/g, '');

  // the exact ledger case: break opportunities after の / が / に, never inside "加わった"
  const exact = unitize('相手のカード5枚が手札に加わった');
  ok(exact === '相手の<wbr>カード5枚が<wbr>手札に<wbr>加わった', 'B107g: the exact case unitizes at phrase boundaries — "' + exact + '"');
  ok(stripWbr(exact) === '相手のカード5枚が手札に加わった', 'B107h: unitizing loses no text');
  ok(!/加わっ<wbr>|加<wbr>わ/.test(exact), 'B107i: "加わった" is never split');

  // names stay intact: no <wbr> between 《 and 》
  const named = unitize('相手の《合体魔神－ゲート・ガーディアン》が直接攻撃');
  ok(named === '相手の<wbr>《合体魔神－ゲート・ガーディアン》が<wbr>直接攻撃', 'B107j: a long name rides intact — "' + named + '"');
  const nameInner = named.match(/《([^》]*)》/);
  ok(nameInner && !nameInner[1].includes('<wbr>'), 'B107k: no break opportunity inside a card name');

  // ×N counts: the opportunity sits after the digits, never between × and the digits
  const multi = unitize('相手の《合体魔神－ゲート・ガーディアン》×2《宵闇のルーチェ》が墓地へ送られた');
  ok(multi.includes('×2<wbr>《宵闇のルーチェ》'), 'B107l: the ×N count keeps its unit — "' + multi + '"');
  ok(!/×<wbr>/.test(multi), 'B107m: no break between × and its digits');

  // reason-class verbs break at particles, not inside the verb
  const fused = unitize('相手の《迷宮の重魔戦車》が融合素材として墓地へ送られた');
  ok(fused === '相手の<wbr>《迷宮の重魔戦車》が<wbr>融合素材と<wbr>して<wbr>墓地へ<wbr>送られた', 'B107n: the fusion-reason text unitizes at particles — "' + fused + '"');
  ok(!/送ら<wbr>|送<wbr>ら/.test(fused), 'B107o: "送られた" is never split');

  // HTML is escaped: a stray "<" cannot become markup
  const esc = unitize('A<B&C');
  ok(esc === 'A&lt;B&amp;C', 'B107p: markup characters are escaped — "' + esc + '"');

  // fxNoticeShow integration: the rendered notice carries the units, keeps the plain text, stays 12.5px
  window.eval("fxNoticeShow('相手のカード5枚が手札に加わった', 'カードの移動｜デッキ→手札', true)");
  await sleep(50);
  const nt = doc.querySelector('#fxlayer .fx-notice .nt');
  ok(!!nt, 'B107q: the notice element is created');
  ok(nt && nt.innerHTML.includes('相手の<wbr>カード5枚が<wbr>手札に<wbr>加わった'), 'B107r: the rendered notice carries the break opportunities');
  ok(nt && nt.textContent.includes('相手のカード5枚が手札に加わった'), 'B107s: the rendered notice reads the full plain text');
  const csNt = nt ? window.getComputedStyle(nt) : null;
  ok(csNt && csNt.fontSize === '18px', 'B107t: notice-center-1118: the centre band restores the 18px type (font ' + (csNt && csNt.fontSize) + ')');
  ok(csNt && csNt.wordBreak === 'keep-all' && csNt.overflowWrap === 'anywhere', 'B107u: keep-all / anywhere still govern the notice text');

  console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURES');
  process.exit(failures === 0 ? 0 : 1);
})();
