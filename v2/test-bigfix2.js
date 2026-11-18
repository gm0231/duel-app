'use strict';
/* test-bigfix2.js — 台帳一掃ラウンド第4弾 (bigfix2-1115) のピンテスト。
   jsdom で見える範囲（純粋ヘルパー・DOM・スタイルシート契約）を
   ここで固定する。レイアウト実測が要る項目（BU-88 の桁隠れ、
   BU-54 の被り、BU-89 のチップ干渉、BU-90 のグリッド配置、
   BU-82/91 のデッキページ寸法、BU-51 の行割り）は Puppeteer
   ミラーのプローブで測る（記録は hidden_files/bigfix2-1115/
   RECORD.md）。 */
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
  const ev = (expr) => window.eval(expr);

  // ---- BU-88: the phase banner steps its label down until the
  // plaque clears both LP numerals (source contract; the geometry
  // itself is mirror-measured). Short labels keep 23px.
  ok(/const lpEls = \[\$\('oppLp'\), \$\('myLp'\)\]/.test(clientSrc) && /while \(fs > 15 && hitsLp\(\)\)/.test(clientSrc),
    'BF2-1 (BU-88): fxPhaseBanner fits the label against both LP numerals (23px floor 15px)');
  ok(/\.fx-phase \.lbl\{[^}]*padding:10px 15px/.test(html),
    'BF2-1b (BU-88): the plaque CSS seat/padding is unchanged (BU-44 grammar kept)');

  // ---- BU-54 residue: the direct-attack banner is a centred
  // plaque, not a full-width band.
  const atkRule = (html.match(/\.fx-atkbanner\{([^}]*)\}/) || [])[1] || '';
  ok(/left:50%/.test(atkRule) && /width:max-content/.test(atkRule) && !/right:0/.test(atkRule),
    'BF2-2 (BU-54): .fx-atkbanner is a centred plaque (left:50%, max-content, no full-width band)');

  // ---- BU-89: separator + flash deferral + chip-seat widening.
  ok(/<span class="nsep">｜<\/span>/.test(clientSrc),
    'BF2-3 (BU-89): the notice renders a gold separator between label and body');
  ok(/\.fx-notice \.nsep\{/.test(html),
    'BF2-3b (BU-89): the separator has its own style');
  ok(/classList\.contains\('apflash'\) && \(deferrals \|\| 0\) < 6/.test(clientSrc),
    'BF2-3c (BU-89): fxNoticeShow holds the notice while the autopass flash owns the header');
  ok(!/colRight = Math\.max\(colRight, hcr\.left - 6\)/.test(clientSrc),
    'BF2-3d (BU-89): notice-center-1118: the notice-column widening is retired with the header seat — the centre band takes its width from the screen (max-width 86%), never from the logline column');

  // functional: a notice fired during apflash does NOT appear
  // until the flash clears (jsdom: rects are 0, but the scene /
  // element lifecycle is real).
  try {
    doc.getElementById('header').classList.add('apflash');
    ev('fxNotice("テスト本文です", "カードの移動｜デッキ→手札", true)');
    await sleep(250);
    ok(!doc.querySelector('.fx-notice'), 'BF2-3e (BU-89): no notice element while apflash is up (held)');
    doc.getElementById('header').classList.remove('apflash');
    let appeared = false;
    for (let i = 0; i < 40 && !appeared; i++) { await sleep(150); appeared = !!doc.querySelector('.fx-notice'); }
    ok(appeared, 'BF2-3f (BU-89): the held notice appears once the flash clears');
    const nsep = doc.querySelector('.fx-notice .nsep');
    ok(!!nsep && nsep.textContent === '｜', 'BF2-3g (BU-89): the shown notice carries the separator');
  } catch (e) {
    ok(false, 'BF2-3e-g (BU-89): notice deferral functional check threw: ' + e.message);
  }

  // ---- BU-51 residue: word joiners guard the ・ inside blurb
  // names; phrase joints carry a zero-width space; the superquant
  // blurb is shortened so name + pt fit one wrapped line.
  try {
    const sq = ev('deckMetaLine("superquant")');
    ok(typeof sq === 'string' && sq.includes('グレート\u2060・\u2060マグナス') && !sq.includes('呼ぶデッキ'),
      'BF2-4 (BU-51): superquant meta line guards グレート・マグナス with word joiners, shortened blurb (' + sq + ')');
    const ish = ev('deckMetaLine("ishizu")');
    ok(typeof ish === 'string' && ish.includes('イシズ\u2060・\u2060墓地'),
      'BF2-4b (BU-51): ishizu meta line guards its ・ the same way (' + ish + ')');
    const elf = ev('deckMetaLine("elfennotes")');
    ok(typeof elf === 'string' && elf.includes('環境テーマの\u200bエルフェンノーツデッキ'),
      'BF2-4c (BU-51): elfennotes blurb carries a phrase-joint break opportunity (' + elf + ')');
    const mon = ev('deckMetaLine("monarch")');
    ok(typeof mon === 'string' && mon.includes('帝を\u200bアドバンス召喚する\u200bクラシックデッキ'),
      'BF2-4d (BU-51): monarch blurb carries two phrase-joint break opportunities (' + mon + ')');
  } catch (e) {
    ok(false, 'BF2-4 (BU-51): deckMetaLine checks threw: ' + e.message);
  }

  // ---- BU-82 residue: the dp-tight tier exists and is driven
  // from the selection / points / resize paths.
  ok(/function dpTightUpdate\(\)/.test(clientSrc) && /dp-tight', m\.scrollHeight > m\.clientHeight \+ 1/.test(clientSrc),
    'BF2-5 (BU-82): dpTightUpdate engages dp-tight only while the region overflows');
  ok(/#deckpage\.dp-tight \.deck\{/.test(html) && /#deckpage\.dp-tight \.srow \.seg button\{min-height:36px;\}/.test(html),
    'BF2-5b (BU-82): the tight tier tightens the deck page rhythm in CSS');
  ok((clientSrc.match(/dpTightUpdate\(\);/g) || []).length >= 3,
    'BF2-5c (BU-82): dpTightUpdate is wired to selection, points refresh and resize');

  // ---- BU-91: above the compact tier the deck page slack is
  // split by auto margins; the compact tier is untouched.
  ok(/#deckpage:not\(\.dp-compact\) \.dp-sec \+ \.dp-sec\{margin-top:auto;\}/.test(html)
    && /#deckpage:not\(\.dp-compact\) \.dp-main > \.segrow\{margin-top:auto;\}/.test(html),
    'BF2-6 (BU-91): tall-tier slack splits over the opponent section and the turn-order row');

  console.log(failures ? ('FAILURES: ' + failures) : 'ALL BIGFIX2 CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
