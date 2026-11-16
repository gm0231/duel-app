'use strict';
/* test-ctpeek.js — ctpeek-1116：チェーントレイ（BU-74/76 機構）の
   「盤面を見る」ボタン ctpeek が盤面を覆う残存欠陥のピンテスト。
   修正前の座席：#chainui は flex column で、チップが皿の真上・
   右寄せに乗り、皿の高さ（積める札 1〜4 枚で変動）に連動して
   y が 346〜433 を動き、自分のモンスター／S ゾーン・LP帯を覆った
   （修正前実測：620h 468ティック・700h 478ティック、最大
   5876px²＝チップ全面）。修正後：#chainui を column-reverse
   にし、チップは皿の「下」＝ラッパー最下部の固定座席へ。開いて
   いる時も peek 中も同じ座席（右下角、手札帯の右端＝皿が元から
   覆う帯）で、ゾーン・パイル帯・ヘッダー・ログ行・チェーン
   バー・LP帯には重ならない。#chainui は absolute のまま
   （position:fixed の試みは、皿開示中に盤面がチップの下へ
   滑り、自分のパイル帯を覆ったため却下。620h で 73ティック、
   最大 2147px²。詳しくは RECORD.md）。jsdom で見える範囲（DOM・CSS
   契約・トグル挙動）をここで固定し、実測の重なり px 数は
   Puppeteer ミラーのプローブで測る（記録は
   hidden_files/ctpeek-1116/RECORD.md）。 */
const fs = require('fs');
const path = require('path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { console.log('SKIP: jsdom not resolvable (set NODE_PATH)'); process.exit(0); }

const V2 = __dirname;
const html = fs.readFileSync(path.join(V2, 'index.html'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(V2, 'data.json'), 'utf8'));
const fxmap = JSON.parse(fs.readFileSync(path.join(V2, 'fxmap.json'), 'utf8'));
const wasmBinary = fs.readFileSync(path.join(V2, 'build', 'ocgcore.wasm'));
let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const MUDORA = 99937011, KELDO = 63542003;

async function boot() {
  const dom = new JSDOM(html, { url: 'http://localhost/v2/', runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  window.Audio = class { constructor(src) { this.src = src; this.volume = 1; } play() { return Promise.resolve(); } pause() {} };
  window.Image = class { constructor() { this._src = ''; } set src(v) { this._src = v; } get src() { return this._src; } };
  const wasmBuf = wasmBinary.buffer.slice(wasmBinary.byteOffset, wasmBinary.byteOffset + wasmBinary.byteLength);
  window.fetch = async (url) => {
    if (String(url).includes('ocgcore.wasm')) return { ok: true, status: 200, url: String(url), arrayBuffer: async () => wasmBuf };
    if (String(url).includes('fxmap.json')) return { ok: true, status: 200, json: async () => fxmap, arrayBuffer: async () => wasmBuf };
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
  const ev = (expr) => window.eval(expr);
  const click = (el) => { if (el) el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); return !!el; };
  const tick = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, label) => { for (let i = 0; i < 60 && !fn(); i++) await tick(50); ok(!!fn(), label); return !!fn(); };
  const host = doc.getElementById('chainui');
  const chip = doc.getElementById('ctpeek');
  const tray = doc.getElementById('chaintray');

  ok(doc.getElementById('loadmsg').textContent.includes('準備完了'), 'CT-0a: client boots');
  ok(!!host && !!tray && !!chip, 'CT-0b: the tray host, tray and peek chip exist in the static DOM');

  // ---- CSS 契約：チップは皿の下（ラッパー最下部）の固定座席 ----
  const hostRule = (() => {
    const i = html.indexOf('\n  #chainui{');
    if (i < 0) return '';
    return html.slice(html.indexOf('{', i) + 1, html.indexOf('}', i));
  })();
  ok(/flex-direction:column-reverse/.test(hostRule),
    'CT-1 (ctpeek): #chainui is column-reverse, so the chip rides BELOW the tray instead of above it where its seat floated with the tray height over my zones and the LP band');
  ok(/position:absolute/.test(hostRule) && /right:10px/.test(hostRule) && /bottom:10px/.test(hostRule),
    'CT-2 (ctpeek): the tray host stays absolute against #app, anchored to the bottom-right corner — a fixed host was measured and rejected because the sliding board covers my pilebar under a viewport-anchored chip (73 ticks at 620h, max 2147px²)');
  ok(host.children[0] === chip && host.children[1] === tray,
    'CT-3 (ctpeek): in DOM order the chip is the first child and the tray the second, so column-reverse renders the chip at the bottom of the column, below the tray');
  ok(window.getComputedStyle(host).flexDirection === 'column-reverse',
    'CT-4 (ctpeek): the computed flex-direction of #chainui is column-reverse (got ' + window.getComputedStyle(host).flexDirection + ')');
  ok(window.getComputedStyle(host).position === 'absolute',
    'CT-4b (ctpeek): the computed position of #chainui is absolute (got ' + window.getComputedStyle(host).position + ')');
  ok(/#chainui\.peek #chaintray\{visibility:hidden/.test(html) && /#chainui\.peek #ctpeek\{pointer-events:auto/.test(html),
    'CT-5 (ctpeek): peeked, the tray retreats (visibility hidden) while the chip stays clickable in its seat');

  // ---- チップの格（BU-76）は不変 ----
  const chipRule = (() => {
    const i = html.indexOf('\n  #ctpeek{');
    if (i < 0) return '';
    return html.slice(html.indexOf('{', i) + 1, html.indexOf('}', i));
  })();
  const minH = (chipRule.match(/min-height:\s*(\d+)px/) || [])[1] || 0;
  ok(+minH >= 52 && /linear-gradient\(#e6c877/.test(chipRule),
    'CT-6 (ctpeek): the chip keeps the 52px gold primary grade (got min-height ' + minH + 'px)');

  // ---- 実プロンプトで皿を出し、トグル挙動と座席の不変を確認 ----
  ev(`(() => {
    const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [{}], deckCount: 38, lp: 8000 });
    const b = { players: [P(), P()], phaseName: 'MAIN1', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 1, log: [], dlog: [] };
    const mon = (code, pos) => ({ code, pos, materials: 0, counters: null, curAtk: null, curDef: null });
    b.players[1].mzone[0] = mon(${KELDO}, 0x1);
    duelState = b; render(b);
    fxSettings.resp = 'auto';
    dismissedChains = new Set(); dismissedDuel = new Map();
    return true;
  })()`);
  const E1 = { code: MUDORA, con: 0, loc: 8, seq: 0, desc: MUDORA * 1048576 };
  const dispatch = (prompt) => ev(`(() => {
    const s = duelState; s.chain = [{ code: ${KELDO}, con: 1, loc: 4, seq: 0, desc: 0 }];
    window.__cbDone = false; window.__cbBytes = null;
    uiAnswer(${JSON.stringify(prompt)}, s).then(b => { window.__cbDone = true; window.__cbBytes = Array.from(b); });
    return true;
  })()`);
  const trayOn = () => host.classList.contains('on');
  dispatch({ name: 'SELECT_CHAIN', player: 0, forced: false, entries: [E1], retryCount: 0 });
  await waitFor(trayOn, 'CT-7a: a live chain prompt raises the tray');
  ok(!!doc.querySelector('#chaintray .ct-cause-txt') && doc.querySelectorAll('#chaintray .ct-card').length === 1
    && !!doc.querySelector('#chaintray .ct-yes') && !!doc.querySelector('#chaintray .ct-no'),
    'CT-7b: the tray contents are intact after the reorder (cause + 1 mini + both badges)');
  ok(chip.textContent === '盤面を見る',
    'CT-7c: the chip reads 盤面を見る while the tray is open');
  const seatBefore = [chip.parentElement.id, [...host.children].indexOf(chip), window.getComputedStyle(host).flexDirection].join('|');
  click(chip);
  ok(host.classList.contains('peek') && chip.textContent === '選択に戻る',
    'CT-8a: peek retreats the tray; the chip stays and reads 選択に戻る');
  ok(!ev('window.__cbDone'), 'CT-8b: peeking does not answer the prompt');
  const seatPeeked = [chip.parentElement.id, [...host.children].indexOf(chip), window.getComputedStyle(host).flexDirection].join('|');
  ok(seatPeeked === seatBefore,
    'CT-8c: the chip keeps the same seat while peeked (same parent, same child order, same flex-direction: ' + seatPeeked + ')');
  click(chip);
  ok(!host.classList.contains('peek') && chip.textContent === '盤面を見る',
    'CT-8d: a second tap returns the tray with the chip back to 盤面を見る');
  ok(!ev('window.__cbDone'), 'CT-8e: the round trip leaves the prompt unanswered');
  click(doc.querySelector('#chaintray .ct-no'));
  await waitFor(() => ev('window.__cbDone'), 'CT-9a: しない still answers the prompt');
  ok(!trayOn(), 'CT-9b: neither tray nor chip survives the answer');

  console.log(failures === 0 ? 'ALL CTPEEK CHECKS PASSED' : failures + ' FAILURES');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
