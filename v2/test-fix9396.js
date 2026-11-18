'use strict';
/* test-fix9396.js — fix round 2026-11-15 (BU-93/94/95/96/99).
 *
 * BU-93: a direct attack's impact bloom sat on the defender's LP
 * numerals (measured: 64-80% of the numerals' pixels over luminance
 * 200 for ~180 ms at the peak). fxAttackSceneV3's drawLow is now
 * clipped around the numerals' rect (+4px) for direct attacks only,
 * so the comet / bloom / rings stop at the digits' box. Pinned here
 * by source; the luminance proof (numerals ~0 added brightness,
 * surrounding bloom intact) is the Chromium rig's job
 * (fix9396-1115/probe-fix9396.js).
 *
 * BU-94: a long notice at the 9px floor still rose into row 1
 * (measured 349 px2 of the phase readout covered). The notice now
 * grows the header (minHeight + the deficit, layoutFit re-run) and
 * restores it when it leaves; the font-fit key is the seat width
 * only, so the growth does not re-run the font fit mid-dwell.
 * Pinned here by source; the overlap proof is the Chromium rig.
 * (fix9396c-1115 revises the seat: the notice now sits in its own
 * band BELOW row 2 and the font fit is gone — see
 * test-fix9396c.js C94a.. and the F94 pins below, updated to the
 * new seat.)
 *
 * BU-95: a detail pop opened from the tray's cause row survived
 * into the dock (measured: 126,124 px2 over the dock, 22,106 px2
 * over the context line, 5,772 px2 over 盤面を見る). showChainTray
 * now closes it on show, and uiChain's draw() closes it again on
 * the FIRST draw only — a detail opened FROM the dock stays open.
 * The tray half is driven live below; the dock half is pinned by
 * source here and by the Chromium rig's real duel.
 *
 * BU-96: NOT reproduced in any of 6 measured states (the name band
 * sat 5px / 25px above the tile's bottom edge in every state).
 * No CSS change; the invariant (name bottom never past the tile
 * bottom, in every sheet state) is the Chromium rig's pin, and the
 * tile rules it rests on are pinned here so a later restyle cannot
 * silently move the seat.
 *
 * BU-99: a press-and-hold tap near the しない / パス button's
 * bottom edge, started inside the entrance animation, had the
 * button translate away from the press point before release —
 * the click never reached the button (measured: 3 of 9 hold-taps
 * absorbed in the first 150 ms of the tray, 2 of 3 on the dock).
 * The tray entrance is opacity-only now, チェーンする no longer
 * floats, and the dock's first-draw slide is gone. Pinned here by
 * source; the hold-tap proof is the Chromium rig.
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
function srcOf(fnName, from) {
  const i = clientSrc.indexOf(from);
  if (i < 0) return '';
  const j = clientSrc.indexOf('function ', i + 1);
  return clientSrc.slice(i, j < 0 ? clientSrc.length : j);
}
// BU-93
{
  const atk = clientSrc.slice(clientSrc.indexOf('function fxAttackSceneV3'));
  ok(atk.includes('const directClip = (o.direct'), 'F93a: the direct-attack numerals clip rect is computed in fxAttackSceneV3');
  ok(atk.includes("ctx.clip('evenodd')"), 'F93b: drawLow clips with evenodd around the numerals');
  ok(atk.includes('if (directClipped) ctx.restore();'), 'F93c: the clip is released at the end of drawLow');
  ok(!atk.includes("ctx.clip('evenodd')") || atk.indexOf("ctx.clip('evenodd')") > atk.indexOf('drawLow(ctx, t)'),
    'F93d: the clip lives inside drawLow (the low-canvas pass only)');
}
// BU-94 (seat revised fix9396c-1115: the notice sits in its own
// band below row 2 — see test-fix9396c.js — and no longer steps
// its type down; the old bottom-anchor / row-1-cap pins are
// retired, not loosened)
ok(clientSrc.includes('function fxNoticeGrowHeader(over)'), 'F94a: fxNoticeGrowHeader exists');
ok(clientSrc.includes('function fxNoticeRestoreHeader()'), 'F94b: fxNoticeRestoreHeader exists');
ok(clientSrc.includes('fxNoticeGrowHeader(need)'), 'F94c: the anchor grows the header by the notice height below row 2');
ok(clientSrc.includes('onDone() { try { d.remove(); } catch (e) {} if (logMo) { try { logMo.disconnect(); } catch (e) {} } fxNoticeRestoreHeader();'), 'F94d: the notice restores the header when it leaves (and disconnects the logline observer)');
ok(!clientSrc.includes("nt.style.fontSize = fs + 'px';"), 'F94e: the notice no longer steps its type down mid-dwell (full 12.5px, header absorbs the height)');
ok(clientSrc.includes('const seatTop = fxBelowRow2Seat();'), 'F94f: the notice seats below row 2 (fxBelowRow2Seat = fxRow2Bottom + 2 in normal duels; BU-115: watch seat below the watchbar)');
// BU-95
{
  const tray = srcOf('showChainTray', 'function showChainTray(');
  ok(tray.includes('closeInfoPop();'), 'F95a: showChainTray closes a stale detail pop on show');
  const dock = clientSrc.slice(clientSrc.indexOf("    $('dock').className = 'on';"));
  ok(dock.includes('if (firstDraw) closeInfoPop();'), 'F95b: uiChain draw() closes the detail on the FIRST draw only');
  ok(clientSrc.split('if (firstDraw) closeInfoPop();').length - 1 === 1,
    'F95c: the firstDraw close appears exactly once (no unconditional close anywhere in the dock path)');
}
// BU-99
{
  const ctin = html.slice(html.indexOf('@keyframes ctin'));
  ok(ctin.includes('from{opacity:0;}to{opacity:1;}'), 'F99a: the tray entrance is opacity-only (no translateY)');
  ok(!html.includes('animation:ctfloat 2.4s ease-in-out infinite;animation-delay:-.3s;'), 'F99b: チェーンする no longer floats');
  ok(html.includes('.ct-card{') && html.includes('animation:ctfloat 2.4s ease-in-out infinite;'),
    'F99c: the floating treatment stays on the .ct-card minis (not decision buttons)');
  const dockDraw = clientSrc.slice(clientSrc.indexOf("    $('dock').className = 'on';"));
  ok(!dockDraw.slice(0, 600).includes("translateY(14px)"), 'F99d: the dock first-draw slide is gone');
  ok(!dockDraw.slice(0, 600).includes('.animate('), 'F99e: no WAAPI entrance on the dock draw');
}
// BU-96 (no CSS change — pin the seat the invariant rests on)
ok(html.includes('min-height:170px;padding:4px;display:flex;flex-direction:column;justify-content:flex-end;'), 'F96a: the selection tile keeps min-height 170px with the name band at the bottom');
ok(html.includes('.nm{') && html.includes('flex:0 0 auto;'), 'F96b: the name band stays a fixed-height flex child at the tile bottom');

// ---------- live behaviour in jsdom (BU-95 tray half) ----------
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
  const GHUL = 62411811; // 《迷宮に潜むシャドウ・グール》 — the BU-95 report's card
  // 1. a detail pop is open (as from the tray's cause row) ...
  window.eval('openInfoPop(' + GHUL + ')');
  ok(doc.getElementById('infopop').classList.contains('on'), 'F95d: the detail pop opens (precondition)');
  // 2. ... then the tray shows: the pop must close, the tray must stand.
  let dockCalled = false;
  window.eval('showChainTray({ entries: [{ code: ' + GHUL + ', con: 1 }], forced: false }, { code: ' + GHUL + ', con: 1, tray: "相手の《迷宮に潜むシャドウ・グール》が発動" }, [0], () => { window.__dockCalled = true; })');
  window.__dockCalled = false;
  ok(!doc.getElementById('infopop').classList.contains('on'), 'F95e: showChainTray closes the stale detail pop');
  ok(doc.getElementById('chainui').classList.contains('on'), 'F95f: the tray stands after the close');
  // 3. the cause row re-opens the detail (the tray's own affordance survives) ...
  doc.querySelector('.ct-cause').click();
  await sleep(50);
  ok(doc.getElementById('infopop').classList.contains('on'), 'F95g: the cause row still opens the detail from the tray');
  // 4. ... and チェーンする reaches the dock opener (the tray is not left dead by the close).
  doc.querySelector('.ct-yes').click();
  await sleep(50);
  ok(window.__dockCalled === true, 'F95h: チェーンする still reaches the dock opener after the detail dance');
  ok(!doc.getElementById('chainui').classList.contains('on'), 'F95i: the tray closes on チェーンする');

  console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURES');
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
