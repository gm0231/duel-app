'use strict';
/* test-fixbu127128.js — fix-bu127-128-1123 (run 22, 2026-11-23).
 *
 * BU-127: in the folded peekbar a long activation label read only
 * as its head ("効果を発動：①" — 0 chars of the effect in the
 * 700 case, 6 chars in the 620 case), and the card name never
 * appeared in it at all: the player could not tell WHICH card's
 * effect the mirror was. Worse, the mirror sits third in the
 * 201px scroller (after × and the set button), so only ~87px is
 * left for it at first paint. The fix has two halves:
 *   (a) the mirror carries the short form "効果を発動：<card>①" /
 *       "カードを発動：<card>" — verb + card name (from the
 *       sheet's title; action sheets only, the label prefix is
 *       created in uiCmd and nowhere else) + effect number, capped
 *       at 15 chars so it fits the narrowest band scroller
 *       (201px at 12.5px type). A long name keeps its tail
 *       ("…<last 7 chars>"), the part that distinguishes family
 *       members (BU-126's lesson: heads collide, tails
 *       distinguish).
 *   (b) the scroller wraps: mirrors flow to a second row instead
 *       of hiding behind the fade, so every mirror is fully
 *       readable at first paint. The band's max-height (34dvh)
 *       still caps it; the fade stays for the one case wrapping
 *       cannot fix (a single mirror wider than the scroller).
 * Without a card name the shortener behaves exactly as BU-119
 * (first sentence) — the BU-119/BU-120 pins below guard that.
 *
 * BU-128: the opponent-draw card-back ghost flew into the
 * #oppHandChip and covered "相手の手札" on every opponent draw
 * (baseline polar: 14-15 ghost hits per duel, max ~930px2 of the
 * chip's 1463px2, up to ~440-680ms). The chip is HUD and must
 * stay readable while the ghost lands on it. The fix raises ONLY
 * the chip above the fx layer (#oppHandChip z-index 26 over
 * #fxlayer 25; #header creates no stacking context, so the
 * chip's own z-index competes in the root context). The ghost
 * slides UNDER the chip instead of covering it. The logline's
 * locus is untouched (BU-108, user decision pending) and the
 * pile counts stay under the flight grammar.
 *
 * Pinned by source + jsdom behaviour; the visual proof is the
 * Chromium probe (probe-fixbu127128.js): live duels at both
 * heights, Range-measured mirror visibility, chip-polar
 * frequency, and overlap screenshots.
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

// ---------- BU-127 source pins ----------
ok(clientSrc.includes('function peekBarLabel(text, cardName)'),
  'F127a: the mirror-label shortener takes the sheet card name');
ok(clientSrc.includes("t.match(/^(効果を発動|カードを発動)：([①-⑳])?\\s?/)"),
  'F127b: activation labels are recognised by their verb prefix + effect number');
ok(clientSrc.includes('const budget = 15 - verb.length - 1 - num.length;'),
  'F127c: the short form is capped at 15 chars (narrowest band scroller)');
{
  const sync = clientSrc.slice(clientSrc.indexOf('function syncPeekBar()'), clientSrc.indexOf('// R-SEL-1:'));
  ok(sync.includes("querySelector('.ttl')"), 'F127d: syncPeekBar reads the sheet title as the card name');
  ok(sync.includes('peekBarLabel((el.textContent || \'\').trim(), sheetCard)'),
    'F127e: mirrors are built with the sheet card name');
}
ok(html.includes("#peekbar .pb-scroll{flex:1 1 auto;min-width:0;display:flex;flex-wrap:wrap;align-content:flex-start;gap:6px;overflow-x:auto;overflow-y:hidden;}"),
  'F127f: the mirrors wrap to a second row instead of hiding behind the fade');
ok(html.includes('.pb-scroll.canscroll{-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 26px),transparent 100%);'),
  'F127g: the fade stays for a single over-wide mirror (wrapping cannot fix that case)');

// ---------- BU-128 source pins ----------
ok(html.includes('#oppHandChip{position:relative;z-index:26;}'),
  'F128a: the opponent hand-count chip sits above the fx layer');
ok(html.includes('#fxlayer{position:absolute;inset:0;z-index:25;'),
  'F128b: the fx layer is still z-25 (the chip is exactly one above it)');
{
  const hdr = html.match(/#header\{[^}]*\}/);
  ok(!!hdr && !/z-index/.test(hdr[0]), 'F128c: #header itself takes no z-index (the chip escapes on its own, no new stacking context)');
}
ok(html.includes('#fxcutin{position:absolute;inset:0;z-index:35;'),
  'F128d: cut-ins (z-35) still paint above the chip, as before');
ok(html.includes('#sheetwrap{position:fixed;inset:0;z-index:50;'),
  'F128e: sheets (z-50) still paint above the chip, as before');

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

  // ----- BU-127 live: the shortener, pure function -----
  const lbl = (t, c) => window.eval('peekBarLabel(' + JSON.stringify(t) + (c === undefined ? '' : ', ' + JSON.stringify(c)) + ')');
  // no card name: exactly the BU-119 rule (first sentence)
  ok(lbl('効果を発動：① 手札を１枚捨てて発動できる。攻撃力が２４００以上か８００…') === '効果を発動：① 手札を１枚捨てて発動できる。',
    'F127h: without a card name a long activation label still shortens to its first sentence (BU-119 kept)');
  ok(lbl('魔法・罠をセット') === '魔法・罠をセット', 'F127i: standard labels pass through untouched');
  ok(lbl('この効果の確認を省略（このデュエル中）') === '省略（デュエル中）',
    'F127j: the BU-120 suppression short form is untouched');
  // with a card name: verb + name + number
  ok(lbl('効果を発動：① 手札から「帝王」魔法・罠カード１枚を墓地へ送って発動できる。', '汎神の帝王') === '効果を発動：汎神の帝王①',
    'F127k: the run-22 case shortens to 効果を発動：汎神の帝王① (got ' + JSON.stringify(lbl('効果を発動：① 手札から「帝王」魔法・罠カード１枚を墓地へ送って発動できる。', '汎神の帝王')) + ')');
  ok(lbl('カードを発動：このターン、自分がモンスターをアドバンス召喚する場合に１…', '帝王の烈旋') === 'カードを発動：帝王の烈旋',
    'F127l: a spell activation (no effect number) shortens to カードを発動：帝王の烈旋');
  ok(lbl('効果を発動：① 手札の「帝王」魔法・罠カード１枚を相手に見せ…', '源帝従騎テセラ') === '効果を発動：源帝従騎テセラ①',
    'F127m: the 700 baseline case shortens to 効果を発動：源帝従騎テセラ①');
  ok(lbl('効果を発動：① 手札の「帝王」魔法・罠カード１枚を相手に見せ…', 'ライトロード・サモナー ルミナス') === '効果を発動：…ナー ルミナス①',
    'F127n: a long family name keeps its distinguishing tail (got ' + JSON.stringify(lbl('効果を発動：① 手札の「帝王」魔法・罠カード１枚を相手に見せ…', 'ライトロード・サモナー ルミナス')) + ')');
  ok(lbl('この効果の確認を省略（このデュエル中）', '汎神の帝王') === '省略（デュエル中）',
    'F127o: the BU-120 special case wins over the card-name form');
  for (const [t, c] of [
    ['効果を発動：① 手札から「帝王」魔法・罠カード１枚を墓地へ送って発動できる。', '汎神の帝王'],
    ['効果を発動：① 手札の「帝王」魔法・罠カード１枚を相手に見せ…', 'ライトロード・サモナー ルミナス'],
    ['カードを発動：このターン、自分がモンスターをアドバンス召喚する場合に１…', '帝王の烈旋']]) {
    ok(lbl(t, c).length <= 15, 'F127p: short form is at most 15 chars (' + lbl(t, c).length + ' for ' + JSON.stringify(lbl(t, c)) + ')');
  }
  // a non-activation long label with a card name still takes the old path
  ok(lbl('手札を１枚捨てて発動できる。攻撃力が２４００以上か８００以下なら破壊する。', '汎神の帝王') === '手札を１枚捨てて発動できる。',
    'F127q: a non-activation label keeps the first-sentence rule even with a card name');

  // ----- BU-127 live: the band mirrors carry the short form -----
  window.eval(`(() => {
    const wrap = document.getElementById('sheetwrap');
    wrap.className = 'on peek'; wrap.dataset.kind = 'view';
    document.getElementById('sheet').innerHTML =
      '<div class="ttl">汎神の帝王</div>' +
      '<button class="optbtn" data-action-idx="0">魔法・罠をセット</button>' +
      '<button class="optbtn" data-action-idx="1">効果を発動：① 手札から「帝王」魔法・罠カード１枚を墓地へ送って発動できる。</button>';
    return true; })()`);
  window.eval('syncPeekBar()');
  const bar = doc.getElementById('peekbar');
  ok(bar.classList.contains('onbar'), 'F127r: peeking raises the answer band (setup)');
  const sc = bar.querySelector(':scope > .pb-scroll');
  ok(!!sc, 'F127s: the mirrors ride in the inner scroller (setup)');
  const mirrors = [...sc.querySelectorAll('button')].map((b) => b.textContent.trim());
  ok(mirrors.includes('魔法・罠をセット') && mirrors.includes('効果を発動：汎神の帝王①'),
    'F127t: the band mirrors the short form, not the 30-char label (got ' + JSON.stringify(mirrors) + ')');
  ok(!mirrors.some((t) => t.indexOf('墓地へ送って') >= 0),
    'F127u: no mirror carries the effect excerpt (it cannot identify the card at first paint)');
  // the sheet behind keeps the full wording — the mirror only names it
  const sheetBtns = [...doc.getElementById('sheet').querySelectorAll('[data-action-idx]')].map((b) => b.textContent.trim());
  ok(sheetBtns.some((t) => t.indexOf('墓地へ送って発動できる') >= 0),
    'F127v: the sheet itself still shows the full activation wording');
  const scCs = window.getComputedStyle(sc);
  ok(scCs.flexWrap === 'wrap', 'F127w: the scroller wraps (computed flex-wrap is wrap, got ' + scCs.flexWrap + ')');

  // ----- BU-128 live: the chip's stacking -----
  const chip = doc.getElementById('oppHandChip');
  ok(!!chip, 'F128f: the opponent hand-count chip exists (setup)');
  const chipCs = window.getComputedStyle(chip);
  ok(chipCs.position === 'relative' && chipCs.zIndex === '26',
    'F128g: the chip is positioned with z-index 26 (got position=' + chipCs.position + ' z=' + chipCs.zIndex + ')');
  const layerCs = window.getComputedStyle(doc.getElementById('fxlayer'));
  ok(layerCs.zIndex === '25', 'F128h: the fx layer is z-25 (one below the chip, got ' + layerCs.zIndex + ')');
  const hdrCs = window.getComputedStyle(doc.getElementById('header'));
  ok(hdrCs.zIndex === 'auto' && hdrCs.transform === 'none',
    'F128i: the header creates no stacking context of its own (z=' + hdrCs.zIndex + ', transform=' + hdrCs.transform + ')');

  console.log(failures === 0 ? 'ALL PASS' : failures + ' FIX-BU127-128 CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.log('FAIL: exception', e && e.stack || e); process.exit(1); });
