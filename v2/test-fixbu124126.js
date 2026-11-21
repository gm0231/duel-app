'use strict';
/* test-fixbu124126.js — fix-bu124-126-1122 (run 21, 2026-11-22).
 *
 * BU-124: the deck page's "チェーン確認" row (3 seg buttons) cut
 * the third button ("自動") off at the right edge — rect x313 w111
 * against a 390px viewport, 34px missing, and its small
 * "必須以外は聞かずにパス" was unreadable. No scroll path exists
 * (.srow overflow-x visible, page cannot scroll sideways), so the
 * fix is to FIT: the three smalls keep their exact wording but
 * break at a phrase boundary (<br>), two lines each (DS-04 already
 * reserves 2.4em). Each line is <= 8 chars: at 9.5px in the
 * ~80px button content width (266px seg - 2x6px gap, /3, -2x2px
 * padding) 8 chars = 76px fits.
 *
 * BU-125: opening FX settings (#fxbtn) while the idle action
 * sheet (SELECT_IDLECMD/BATTLECMD) was up replaced the sheet, and
 * closing settings never brought the choice back — the player had
 * to re-tap the card. The action sheet is a 'view' sheet
 * (openActionSheet uses sheetOpenView), so the fix stashes the
 * choice when a view sheet covers it (sheetOpen) and restores it
 * when that sheet's close lands (sheetClose), but only while the
 * SAME idle prompt is still pending. Deliberately closing the
 * action sheet itself (x / 選択に戻る) restores nothing, and
 * opening settings with no action sheet up restores nothing.
 * The same hook covers the auto-pass manager and pile sheets.
 *
 * BU-126: Lightlord cards all share the 6-char prefix
 * "ライトロード", so at 5 visible chars every one read
 * "ライトロ…" (BU-122's residual). The band cannot grow (hand
 * floored at 56px, board dimensions frozen), so colliding cards
 * show their distinguishing TAIL — the last word after the final
 * ' ' or '・' (ルミナス / ライデン / ライコウ), prefixed with
 * '…' while it still fits the 5-glyph field. Non-colliding cards
 * are untouched; the preview band still shows the full name.
 *
 * Pinned by source + jsdom behaviour; the visual proof is the
 * Chromium probe (probe-fixbu124126.js): live duels at both
 * heights, Range-measured hand tiles with a Lightlord hand, and
 * the deck page shot at both heights.
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

// ---------- BU-124 source pins ----------
const segResp = html.match(/<div class="seg" id="seg-resp">([\s\S]*?)<\/div>/);
ok(!!segResp, 'F124a: the deck-page chain-confirm seg exists');
const smalls = segResp ? [...segResp[1].matchAll(/<small>([\s\S]*?)<\/small>/g)].map(m => m[1]) : [];
ok(smalls.length === 3, 'F124b: the chain row has exactly 3 smalls (got ' + smalls.length + ')');
ok(smalls.length === 3 && smalls[0] === '「聞かない」設定<br>だけ自動パス' &&
  smalls[1] === 'すべての<br>チェーンで聞く' && smalls[2] === '必須以外は<br>聞かずにパス',
  'F124c: the smalls break at phrase boundaries with <br> (got ' + JSON.stringify(smalls) + ')');
// wording unchanged apart from the break: the halves rejoin to the old texts
ok(smalls.map(s => s.replace('<br>', '')).join('|') === '「聞かない」設定だけ自動パス|すべてのチェーンで聞く|必須以外は聞かずにパス',
  'F124d: the wording is unchanged — only the break moved');
// width arithmetic: seg 266px (390 - 2x14 pad - 86 label - 10 gap),
// 3 buttons + 2x6px gap -> 84.67px each, padding 2px each side ->
// 80.67px content; at 9.5px per full-width char 8 chars = 76px.
const btnW = (266 - 12) / 3, contentW = btnW - 4;
for (const [i, s] of smalls.entries()) {
  const longest = Math.max(...s.split('<br>').map(l => l.length));
  ok(longest * 9.5 <= contentW,
    'F124e: small ' + i + ' longest line is ' + longest + ' chars (' + (longest * 9.5) + 'px <= ' + contentW.toFixed(2) + 'px content)');
}
ok(!html.includes('「聞かない」設定だけ自動パス</small>') && !html.includes('すべてのチェーンで聞く</small>') && !html.includes('必須以外は聞かずにパス</small>'),
  'F124f: no unbroken small remains in the chain row');
ok(/\.srow \.seg\{[^}]*flex-wrap:nowrap/.test(html), 'F124g: the row still lays its buttons out in one row (no scroll path)');

// ---------- BU-125 source pins ----------
ok(clientSrc.includes('let idleSheetKey = null;') && clientSrc.includes('let viewOverIdle = null;'),
  'F125a: the idle-sheet stash state exists');
ok(clientSrc.includes("if (kind === 'view' && idleSheetKey != null && currentPrompt && currentPrompt.prompt && isIdlePromptName(currentPrompt.prompt.name)"),
  'F125b: sheetOpen stashes the choice when a view sheet covers the idle action sheet');
ok(clientSrc.includes('if (viewOverIdle && currentPrompt === viewOverIdle.prompt'),
  'F125c: sheetClose restores only while the SAME idle prompt is still pending');
ok(clientSrc.includes('openActionSheet(k);'),
  'F125d: the restore re-opens the action sheet for the stashed key');
ok(clientSrc.includes('viewOverIdle = null;\n  idleSheetKey = (currentPrompt && currentPrompt.prompt && isIdlePromptName(currentPrompt.prompt.name)) ? key : null;'),
  'F125e: openActionSheet tracks the choice it just showed');
ok(clientSrc.includes('viewOverIdle = null; idleSheetKey = null;'),
  'F125f: answering/replacing the prompt drops the stash');

// ---------- BU-126 source pins ----------
ok(clientSrc.includes('const HAND_NAME_CAP = 5;') && clientSrc.includes('function handNameDisplays(names)'),
  'F126a: the tail-display helper exists with the 5-char cap');
ok(clientSrc.includes('const handDisplays = handNameDisplays(me.hand.map('),
  'F126b: the hand render computes displays from the live hand');
ok(clientSrc.includes('handDisplays[i]'),
  'F126c: the band shows the computed display, not the raw name');

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
  const sheetOn = () => doc.getElementById('sheetwrap').classList.contains('on');
  const sheetText = () => doc.getElementById('sheet').textContent || '';
  const waitFor = async (fn, ms) => { for (let i = 0; i < (ms || 3000) / 50; i++) { if (fn()) return true; await sleep(50); } return fn(); };
  const click = (el) => { if (el) el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); return !!el; };

  // ---------- BU-126: the display model on real pool names ----------
  const disp = (names) => window.eval('handNameDisplays(' + JSON.stringify(names) + ')');
  const llNames = Object.values(data.names).filter(n => n.includes('ライトロード'));
  ok(llNames.length === 13, 'F126d: the pool holds 13 Lightlord cards (got ' + llNames.length + ')');
  const llDisp = disp(llNames);
  ok(new Set(llDisp).size === llNames.length,
    'F126e: the whole Lightlord family renders distinctly (' + llDisp.join(' / ') + ')');
  ok(JSON.stringify(disp(['ライトロード・サモナー ルミナス', 'ライトロード・アサシン ライデン', 'ライトロード・ハンター ライコウ'])) ===
    JSON.stringify(['…ルミナス', '…ライデン', '…ライコウ']),
    'F126f: the run21 hand shows three distinct tails');
  ok(JSON.stringify(disp(['帝王の深怨', '帝王の烈旋', '帝王の開岩'])) ===
    JSON.stringify(['帝王の深怨', '帝王の烈旋', '帝王の開岩']),
    'F126g: the 帝王 trio is untouched (full 5-char names, no collision)');
  ok(JSON.stringify(disp(['森と目覚の春化精', '丘と芽吹の春化精', '花と野原の春化精', '春化精の花冠'])) ===
    JSON.stringify(['森と目覚…', '丘と芽吹…', '花と野原…', '春化精の…']),
    'F126h: distinct heads keep the head display');
  ok(JSON.stringify(disp(['ライトロード・サモナー ルミナス', 'ライトロード・サモナー ルミナス', 'ライトロード・ハンター ライコウ'])) ===
    JSON.stringify(['…ルミナス', '…ルミナス', '…ライコウ']),
    'F126i: same-code copies share one display (the ×N badge counts them)');
  const tailClash = disp(['ライトロード・A ルミナス', 'ライトロード・B ルミナス']);
  ok(tailClash[0] === '…ルミナス' && tailClash[1] === 'ライトロ…',
    'F126j: a shared tail keeps one tail and one head — no worse than before (got ' + JSON.stringify(tailClash) + ')');
  ok(JSON.stringify(disp(['宿神像ケルドウ', 'ライトロード・サモナー ルミナス', 'ライトロード・アサシン ライデン', '天至る叛逆'])) ===
    JSON.stringify(['宿神像ケ…', '…ルミナス', '…ライデン', '天至る叛逆']),
    'F126k: only the colliding cards switch to tails in a mixed hand');
  ok(JSON.stringify(disp(['月の書', '死者蘇生'])) === JSON.stringify(['月の書', '死者蘇生']),
    'F126l: short names are untouched');

  // ---------- BU-125: the settings detour returns to the choice ----------
  const LUM = 95503687; // ライトロード・サモナー ルミナス
  window.eval(`(() => {
    const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
    duelState = { players: [P(), P()], phaseName: 'MAIN1', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], dlog: [], lastAttack: null, deckTop: [null, null] };
    duelState.players[0].hand = [{ code: ${LUM} }];
    render(duelState);
    fxSettings.resp = 'auto';
    window.__b125done = false;
    uiAnswer({ name: 'SELECT_IDLECMD', summon: [{ con: 0, loc: 2, seq: 0, code: ${LUM}, desc: 0 }], spsummon: [], repos: [], mset: [], sset: [], activate: [], toBP: false, toEP: true, canShuffle: false }, duelState)
      .then(() => { window.__b125done = true; });
    return true; })()`);
  await sleep(200);
  ok(window.eval('!!currentPrompt && currentPrompt.prompt.name === "SELECT_IDLECMD"'), 'F125g: the idle prompt is live');
  window.eval(`openActionSheet('0:2:0')`);
  await sleep(60);
  ok(sheetOn() && sheetText().includes('ライトロード・サモナー ルミナス') && sheetText().includes('通常召喚'),
    'F125h: the action sheet shows the card and its summon action');
  window.eval('openFxSettings()');
  await sleep(60);
  ok(sheetOn() && sheetText().includes('演出・応答の設定'),
    'F125i: FX settings replace the action sheet');
  click(doc.getElementById('sheet-cancel'));
  await sleep(300); // sheetClose lands at 185ms, then the restore re-opens
  ok(sheetOn() && sheetText().includes('ライトロード・サモナー ルミナス') && sheetText().includes('通常召喚'),
    'F125j: closing settings brings the action sheet BACK (was: gone, re-tap needed)');
  ok(window.eval('window.__b125done') === false && window.eval('!!currentPrompt'),
    'F125k: the idle prompt is still pending after the detour');
  // deliberately closing the action sheet itself restores nothing
  click(doc.getElementById('sheetx'));
  await sleep(300);
  ok(!sheetOn(), 'F125l: closing the action sheet with x leaves it closed (no restore)');
  ok(window.eval('window.__b125done') === false && window.eval('!!currentPrompt'),
    'F125m: the prompt is still pending after closing its sheet');
  // settings with NO action sheet up restores nothing
  window.eval('openFxSettings()');
  await sleep(60);
  ok(sheetOn() && sheetText().includes('演出・応答の設定'), 'F125n: settings open with no action sheet up');
  click(doc.getElementById('sheet-cancel'));
  await sleep(300);
  ok(!sheetOn(), 'F125o: closing settings with no action sheet up opens nothing');
  ok(window.eval('window.__b125done') === false && window.eval('!!currentPrompt'),
    'F125p: the prompt is still pending after the empty detour');
  // the same hook covers the auto-pass manager
  window.eval(`openActionSheet('0:2:0')`);
  await sleep(60);
  ok(sheetOn() && sheetText().includes('通常召喚'), 'F125q: the action sheet is up again');
  window.eval('openDismissManager()');
  await sleep(60);
  ok(sheetOn() && sheetText().includes('自動パスと省略の確認'), 'F125r: the auto-pass manager replaces the action sheet');
  click(doc.getElementById('sheet-cancel'));
  await sleep(300);
  ok(sheetOn() && sheetText().includes('ライトロード・サモナー ルミナス') && sheetText().includes('通常召喚'),
    'F125s: closing the manager also brings the action sheet back');
  // the prompt still answers normally afterwards
  click(doc.getElementById('phasebtn'));
  await waitFor(() => window.eval('window.__b125done') === true, 2000);
  ok(window.eval('window.__b125done') === true, 'F125t: the idle prompt answers normally after the detours');

  console.log(failures === 0 ? 'ALL PASS' : failures + ' FIX-BU124-126 CHECK(S) FAILED');
  window.close();
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('ERROR', e && e.stack || e); process.exit(2); });
