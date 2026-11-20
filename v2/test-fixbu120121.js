'use strict';
/* test-fixbu120121.js — fix-bu120-121-1120 (run 19, 2026-11-20).
 *
 * BU-120: in the folded peekbar the "don't ask again" suppression
 * label 「この効果の確認を、このデュエル中は省略する」 (21 chars,
 * 271px) did not fit the 255px scroller — at first paint only
 * 「この効果の確認を、」 was readable and the decisive meaning
 * ("omit for this duel") hid past the horizontal scroll. The
 * mirror shortener (peekBarLabel) only shortens labels over 30
 * chars, so this one passed through whole. Fix, in two layers:
 * (a) the SOURCE label is shortened to
 * 「この効果の確認を省略（このデュエル中）」 (19 chars, 246px)
 * so it fits the 255px scroller in one viewport and the sheet
 * keeps the full wording plus its explanatory sub; (b) the
 * Chromium probe then measured that the source shortening alone
 * is NOT enough at first paint — the suppress mirror rides
 * third (after 発動する / 発動しない) and only ~114px of it is
 * visible at scrollLeft=0, showing 「この効果の確認を省」 with
 * the decisive verb cut mid-word. So peekBarLabel mirrors the
 * suppression label as 「省略（デュエル中）」 (8 chars, ~113px),
 * verb + scope, fully readable at first paint. The suppression
 * semantics are unchanged (user decision 2026-11-05: card +
 * effect-number unit, for the duel).
 * BU-121: notice text broke connector phrases mid-phrase — the
 * filed 620-056 「相手の《水魔神－スーガ》が融合素材として
 * 除外された」 wrapped as 「と／して」. fxNoticeUnitize put a
 * <wbr> after every particle char, including と/て inside the
 * compound particle 「として」. The same rule also split か
 * inside 「から」「加えた」「加わった」, も inside 「戻った」,
 * と inside 「取り除いた」, て inside 「捨てた」「捨てられた」
 * 「失って」 — all of which occur in the notice templates.
 * Fix: the non-name branch masks those whole phrases first,
 * runs the particle rule on the gaps only, and rejoins with a
 * <wbr> on both sides of each phrase, so the line can still
 * break at the phrase boundary but never inside a word.
 *
 * Pinned by source + jsdom behaviour; the visual proof is the
 * Chromium probe (probe-fixbu120121.js): BU-120 the suppression
 * mirror fits its scroller at first paint at both heights,
 * BU-121 the filed 620-056 sentence and the other long notices
 * show no mid-phrase connector split and no mid-word name split.
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
ok(clientSrc.includes('この効果の確認を省略（このデュエル中）'), 'F120a: the suppression label is the shortened form');
ok(!clientSrc.includes('この効果の確認を、このデュエル中は省略する'), 'F120b: the old 21-char label is gone');
ok(clientSrc.includes('function fxNoticeUnitize(text)'), 'F121a: the notice unitizer exists');
const unitSrc = clientSrc.slice(clientSrc.indexOf('function fxNoticeUnitize(text)'), clientSrc.indexOf('function fxNoticeShow'));
ok(unitSrc.includes('として|から|加えた|加わった|戻った|取り除いた|捨てた|捨てられた|失って'), 'F121b: the protected phrases are listed whole (捨てられた, not the stem 捨てられ)');

// ---------- live behaviour in jsdom ----------
async function boot(url) {
  const dom = new JSDOM(html, { url: url || 'http://localhost/v2/', runScripts: 'dangerously', pretendToBeVisual: true });
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

  // ----- BU-121 live: protected phrases stay whole -----
  const u = (t) => window.eval('fxNoticeUnitize(' + JSON.stringify(t) + ')');
  const PROT = ['として', 'から', '加えた', '加わった', '戻った', '取り除いた', '捨てた', '捨てられた', '失って'];
  const corpus = [
    '相手の《水魔神－スーガ》が融合素材として除外された', // the filed 620-056 sentence
    '相手の《墓守の罠》《賢瑞官カルダーン》×2《生きる偲びのシルキィ》《転輪のスフィンクス》が効果で墓地へ送られた',
    '自分の《地久神－カルボン》が効果で捨てられた',
    '自分の《地久神－カルボン》を墓地から手札に加えた',
    '相手の《水魔神－スーガ》を除外から手札に加えた',
    '自分の《冥帝王エイドス》をEXデッキから手札に加えた',
    '相手の《合体魔神－ゲート・ガーディアン》がデッキに戻った',
    '自分の《賢瑞官カルダーン》が手札に加わった',
    '相手の《転輪のスフィンクス》（エクシーズ素材）を取り除いた',
    '相手の《宿神像ケルドウ》が対象を失って破壊された',
    '自分の《宿神像ケルドウ》の召喚が無効化され、破壊された',
    '相手の《宿神像ケルドウ》がシンクロ素材として送られ、代わりに除外された',
    '自分の《宿神像ケルドウ》が素材として墓地へ送られた',
    '相手の《宿神像ケルドウ》が融合素材としてデッキに戻った',
    '自分の《宿神像ケルドウ》が効果でリリースされた',
    '相手の《宿神像ケルドウ》をコストで墓地へ送った',
    '自分の《宿神像ケルドウ》が一時的に除外された',
    '相手の《宿神像ケルドウ》が破壊され、除外された',
    '自分の《宿神像ケルドウ》が手札上限でセットカードを捨てた',
    '相手の《合体魔神－ゲート・ガーディアン》が《賢瑞官カルダーン》に攻撃',
    '自分の《合体魔神－ゲート・ガーディアン》が直接攻撃',
    '相手の《宿神像ケルドウ》のコントロールが移った',
    '自分の《宿神像ケルドウ》が裏側守備表示になった',
    '相手の《宿神像ケルドウ》がエクシーズ素材になった',
    '自分の《宿神像ケルドウ》がフィールドを離れた',
  ];
  let intact = 0;
  for (const s of corpus) {
    const h = u(s);
    const whole = PROT.every((p) => !s.includes(p) || h.includes(p));
    const stemSplit = h.includes('捨てられ<wbr>た');
    if (whole && !stemSplit) intact++;
    else console.log('  SPLIT in', JSON.stringify(s), '->', h);
  }
  ok(intact === corpus.length, 'F121c: all ' + corpus.length + ' template sentences keep every protected phrase whole (' + intact + '/' + corpus.length + ')');
  const filed = u('相手の《水魔神－スーガ》が融合素材として除外された');
  ok(filed.includes('融合素材<wbr>として<wbr>'), 'F121d: the filed sentence breaks at the phrase boundary (融合素材<wbr>として), never inside として (got ' + filed.replace(/<wbr>/g, '|') + ')');
  ok(!filed.includes('と<wbr>し'), 'F121e: no break after と inside として');
  ok(!u('自分の《地久神－カルボン》が効果で捨てられた').includes('捨て<wbr>'), 'F121f: no break inside 捨てられた');
  ok(!u('自分の《地久神－カルボン》を墓地から手札に加えた').includes('加<wbr>'), 'F121g: no break inside 加えた');
  ok(!u('相手の《合体魔神－ゲート・ガーディアン》がデッキに戻った').includes('戻<wbr>'), 'F121h: no break inside 戻った');
  // BU-117 must not regress: names still break only at their own separators
  ok(u('相手の《丘と芽吹の春化精》《賢瑞官カルダーン》が効果で墓地へ送られた').includes('》<wbr>《'),
    'F121i: two adjacent names still get an explicit break between them');

  // ----- BU-120 live: the shortened label in sheet and band -----
  const lbl = (t) => window.eval('peekBarLabel(' + JSON.stringify(t) + ')');
  const NEW = 'この効果の確認を省略（このデュエル中）';
  const MIRROR = '省略（デュエル中）';
  ok(NEW.length === 19, 'F120c: the sheet label is 19 chars (old was 21)');
  ok(lbl(NEW) === MIRROR, 'F120d: the mirror shortens the suppression label to 省略（デュエル中） (got ' + JSON.stringify(lbl(NEW)) + ')');
  ok(lbl('発動する') === '発動する' && lbl('発動しない') === '発動しない', 'F120d2: the other yn mirrors pass through untouched');
  // open a yes/no sheet, peek, and read the band (same drive as F119k)
  window.eval(`(() => { window.__f120 = null;
    uiAnswer({ name: 'SELECT_EFFECTYN', player: 0, code: 0, desc: 0, loc: 4, retryCount: 0, context: null },
      { players: [{}, {}], phaseName: 'MAIN1', turnCount: 1, chain: [], turnPlayer: 0, log: [] }).then(b => { window.__f120 = b; });
    return true; })()`);
  for (let i = 0; i < 40 && !doc.getElementById('yn-suppress'); i++) await sleep(50);
  ok(!!doc.getElementById('yn-suppress'), 'F120e: the yes/no sheet carries the suppress button (setup)');
  ok(doc.getElementById('yn-suppress').textContent === NEW, 'F120f: the sheet shows the shortened label (got ' + JSON.stringify(doc.getElementById('yn-suppress') && doc.getElementById('yn-suppress').textContent) + ')');
  doc.getElementById('peekbtn').click();
  await sleep(80);
  const bar = doc.getElementById('peekbar');
  ok(bar.classList.contains('onbar'), 'F120g: peeking raises the answer band (setup)');
  const sc = bar.querySelector(':scope > .pb-scroll');
  ok(!!sc, 'F120h: the mirrors ride in the inner scroller (setup)');
  const mirrors = [...sc.querySelectorAll('button')].map((b) => b.textContent.trim());
  ok(mirrors.includes(MIRROR), 'F120i: the suppress mirror carries 省略（デュエル中） (got ' + JSON.stringify(mirrors) + ')');
  ok(!mirrors.includes(NEW), 'F120i2: no mirror carries the full 19-char label (it would be cut at first paint)');
  ok(!mirrors.some((t) => t.includes('この効果の確認を、このデュエル中は省略する')), 'F120j: no mirror carries the old label');

  console.log(failures === 0 ? 'ALL PASS' : failures + ' FIX-BU120-121 CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.log('FAIL: exception', e && e.stack || e); process.exit(1); });
