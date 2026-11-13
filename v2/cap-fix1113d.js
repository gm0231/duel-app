'use strict';
/* cap-fix1113d.js — BU-69 round 4 reproduction/verification rig.
 * Real flow under CPU x20 throttling + slow-network emulation:
 *   first load sampled, then an ACTUAL duel -> その他 -> 選択に戻る
 *   -> 終了する -> reload landing sampled at fine intervals and
 *   probed at +0s / +2s / +10s after the quit click:
 *     (a) no veil covering the screen (top element at probe points
 *         belongs to the deck page, and #start is gone)
 *     (b) no duel-view residue (duel sections' rects / top-element
 *         hits at their screen positions)
 *     (c) the history button (#loghistbtn, midbar): state recorded
 *         verbatim (visible? covered by what? clickable?)
 *     (d) summary line correct from the first landed sample
 * Screenshots: <tag>-load-0s/2s/10s.png, <tag>-land-0s/2s/10s.png,
 * <tag>-duel.png. Evidence dir = argv[2], height profile = argv[3]
 * ('h700' default, 'h620'), mode = argv[4] ('before'|'after' label
 * only, used in the summary print).
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('/home/hatch/workspace/duel-review/node_modules/puppeteer');
const CHROME = '/home/hatch/.cache/puppeteer/chrome/linux-156.0.8078.47/chrome-linux64/chrome';
const URL = 'http://127.0.0.1:8931/v2/';
const EV = process.argv[2] || '/tmp/brushupfix1113d-ev';
const PROF = process.argv[3] || 'h700';
const H = PROF === 'h620' ? 620 : 700;
fs.mkdirSync(EV, { recursive: true });

const RECORDER = () => {
  window.__marks = [];
  let last = '';
  const el = (id) => document.getElementById(id);
  const topAt = (x, y) => {
    const e = document.elementFromPoint(x, y);
    if (!e) return 'none';
    return (e.id ? '#' + e.id : e.tagName + '.' + (e.className && e.className.baseVal !== undefined ? '' : String(e.className).split(' ')[0]));
  };
  const sample = () => {
    try {
      const st = el('start'), dp = el('deckpage'), ds = el('decksum'), sb = el('startbtn');
      if (!st || !dp) return;
      const hb = el('loghistbtn');
      const hbr = hb ? hb.getBoundingClientRect() : null;
      const hbTop = hbr && hbr.width ? topAt(hbr.left + hbr.width / 2, hbr.top + hbr.height / 2) : '-';
      const sec = (id) => { const e = el(id); if (!e) return '?'; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return cs.display === 'none' || r.height === 0 ? 'hid' : 'vis'; };
      const snap = [
        'rs:' + document.readyState,
        st.style.display === 'none' || getComputedStyle(st).display === 'none' ? 'start:gone' : 'start:UP',
        dp.style.display === 'flex' || getComputedStyle(dp).display === 'flex' ? 'deck:FLEX' : 'deck:-',
        'sec:' + ['topbar', 'oppField', 'midbar', 'myField', 'handbar', 'mybar'].map(sec).join(','),
        'histTop:' + hbTop,
        'topC:' + topAt(195, 22),
        'midC:' + topAt(195, Math.round(innerHeight / 2)),
        'sum:' + (ds ? ds.textContent.trim() : '?'),
        'btn:' + (sb ? (sb.disabled ? 'dis:' : 'EN:') + sb.textContent.trim() : '?'),
        'log:' + (el('logline') ? el('logline').textContent.trim() : '?'),
      ].join('|');
      if (snap !== last) { last = snap; window.__marks.push([Math.round(performance.now()), snap]); }
    } catch (e) {}
  };
  const iv = setInterval(sample, 400);
  setTimeout(() => clearInterval(iv), 900000);
};

const PROBE = () => {
  const el = (id) => document.getElementById(id);
  const topAt = (x, y) => { const e = document.elementFromPoint(x, y); return e ? (e.id ? '#' + e.id : e.tagName + '.' + String(e.className).split(' ')[0]) : 'none'; };
  const out = {};
  for (const id of ['start', 'deckpage', 'deckcat', 'result', 'topbar', 'oppField', 'midbar', 'myField', 'preview', 'handbar', 'mybar', 'sheetwrap', 'dock']) {
    const e = el(id); if (!e) { out[id] = 'absent'; continue; }
    const r = e.getBoundingClientRect();
    out[id] = getComputedStyle(e).display + ' @' + Math.round(r.top) + '..' + Math.round(r.bottom);
  }
  const hb = el('loghistbtn');
  if (hb) {
    const r = hb.getBoundingClientRect();
    out.histBtn = 'rect ' + Math.round(r.left) + ',' + Math.round(r.top) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)
      + ' top:' + topAt(r.left + r.width / 2, r.top + r.height / 2)
      + ' hit:' + (document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === hb);
  }
  out.decksum = el('decksum') ? el('decksum').textContent.trim() : '?';
  out.appClass = el('app') ? el('app').className : '?';
  const sb = el('startbtn');
  out.startbtn = sb ? (sb.disabled ? 'disabled:' : 'enabled:') + sb.textContent.trim() : '?';
  out.loadmsg = el('loadmsg') ? el('loadmsg').textContent.trim() : '?';
  out.logline = el('logline') ? el('logline').textContent.trim() : '?';
  out.bodyDark = (() => { const e = document.elementFromPoint(195, 60); return e ? (e.id || e.tagName) : 'none'; })();
  return out;
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function throttle(page) {
  const cdp = await page.createCDPSession();
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 20 });
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false, latency: 150,
    downloadThroughput: Math.floor(400 * 1024 / 8), uploadThroughput: Math.floor(400 * 1024 / 8),
  });
  return cdp;
}

async function flow(tag) {
  const browser = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: H });
  await page.evaluateOnNewDocument(RECORDER);
  await throttle(page);

  // ---------- first load ----------
  const t0 = Date.now();
  const gotoP = page.goto(URL, { waitUntil: 'load', timeout: 600000 }).catch(e => console.log(tag, 'goto:', e.message));
  await page.screenshot({ path: path.join(EV, tag + '-load-0s.png') }).catch(() => {});
  while (Date.now() - t0 < 2000) await sleep(200);
  await page.screenshot({ path: path.join(EV, tag + '-load-2s.png') }).catch(() => {});
  while (Date.now() - t0 < 10000) await sleep(200);
  await page.screenshot({ path: path.join(EV, tag + '-load-10s.png') }).catch(() => {});
  console.log(tag, '== first-load probe @10s ==');
  console.log(JSON.stringify(await page.evaluate(PROBE).catch(e => ({ err: e.message })), null, 1));
  await gotoP;
  await page.waitForFunction(() => { const sb = document.getElementById('startbtn'); return sb && !sb.disabled; }, { timeout: 900000 });
  console.log(tag, 'startbtn enabled at', Date.now() - t0, 'ms');
  let marks = await page.evaluate(() => window.__marks);
  console.log(tag, '== first-load marks ==');
  for (const [t, s] of marks) console.log(' ', String(t).padStart(7), s);

  // ---------- choose non-default setup: opponent 帝王, 先攻 (self first for a fast quit) ----------
  await page.click('#todeck'); await sleep(500);
  await page.click('#opdeckcur'); await sleep(500);
  await page.evaluate(() => { document.querySelector('#deckcatlist .catbtn[data-cat="classic"]').click(); });
  await sleep(600);
  await page.evaluate(() => { const b = document.querySelector('#seg-opdeck button.deck[data-v="monarch"]'); if (b) b.click(); });
  await sleep(600);
  const sumBefore = await page.evaluate(() => document.getElementById('decksum').textContent.trim());
  console.log(tag, 'summary before duel:', sumBefore);

  // ---------- duel ----------
  await page.click('#startbtn');
  let menuReady = false;
  for (let i = 0; i < 600 && !menuReady; i++) {
    await sleep(1000);
    await page.evaluate(() => {
      const w = document.getElementById('sheetwrap');
      if (w && w.classList.contains('on') && w.textContent.includes('確認')) {
        const x = document.getElementById('sheetx'); if (x) x.click();
      }
    }).catch(() => {});
    menuReady = await page.evaluate(() => { const m = document.getElementById('menubtn'); return m && !m.disabled; }).catch(() => false);
  }
  if (!menuReady) { await page.screenshot({ path: path.join(EV, tag + '-stuck.png') }); throw new Error(tag + ': duel never reached an idle prompt'); }
  await page.screenshot({ path: path.join(EV, tag + '-duel.png') });
  console.log(tag, 'duel idle; quitting…');

  // ---------- quit -> reload landing ----------
  await page.evaluate(() => { window.__marks = []; });
  await page.click('#menubtn'); await sleep(800);
  await page.evaluate(() => { const b = document.getElementById('sheet-cancel'); if (b) b.click(); });
  await sleep(800);
  const tq = Date.now();
  await page.evaluate(() => { const b = document.getElementById('quit-confirm'); if (b) b.click(); });
  await page.screenshot({ path: path.join(EV, tag + '-land-0s.png') }).catch(() => {});
  while (Date.now() - tq < 2000) await sleep(150);
  await page.screenshot({ path: path.join(EV, tag + '-land-2s.png') }).catch(() => {});
  console.log(tag, '== landing probe @2s ==');
  console.log(JSON.stringify(await page.evaluate(PROBE).catch(e => ({ err: e.message })), null, 1));
  // history-button press attempt at ~2s: record what happens
  const histTry2 = await page.evaluate(() => {
    const hb = document.getElementById('loghistbtn');
    if (!hb) return 'absent';
    const r = hb.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    hb.click();
    const w = document.getElementById('sheetwrap');
    return 'top:' + (top ? (top.id || top.tagName) : 'none') + ' sheetOn:' + (w ? w.classList.contains('on') : '?');
  }).catch(e => 'err:' + e.message);
  console.log(tag, 'history press @2s ->', histTry2);
  await page.evaluate(() => { const x = document.getElementById('sheetx'); const w = document.getElementById('sheetwrap'); if (w && w.classList.contains('on') && x) x.click(); }).catch(() => {});
  while (Date.now() - tq < 10000) await sleep(200);
  await page.screenshot({ path: path.join(EV, tag + '-land-10s.png') }).catch(() => {});
  console.log(tag, '== landing probe @10s ==');
  console.log(JSON.stringify(await page.evaluate(PROBE).catch(e => ({ err: e.message })), null, 1));
  marks = await page.evaluate(() => window.__marks);
  console.log(tag, '== landing marks ==');
  for (const [t, s] of marks) console.log(' ', String(t).padStart(7), s);
  await page.waitForFunction(() => { const sb = document.getElementById('startbtn'); return sb && !sb.disabled; }, { timeout: 900000 }).catch(() => console.log(tag, 'startbtn never enabled'));
  console.log(tag, 'boot complete at', Date.now() - tq, 'ms after quit click');
  console.log(tag, '== final probe ==');
  console.log(JSON.stringify(await page.evaluate(PROBE).catch(e => ({ err: e.message })), null, 1));
  // the landed state itself, shot once the boot has completed
  // (the 0s/2s shots above are relative to the quit click and can
  // still show the pre-navigation frame — the browser holds it
  // until the new document is ready)
  await page.screenshot({ path: path.join(EV, tag + '-landed-clean.png') }).catch(() => {});

  // ---------- re-enter a duel: the duel view exists again and
  // its history button is visible, hit-testable and opens the
  // history (the button belongs to the duel view; round #4 hides
  // that view wholesale outside a duel instead of leaving it
  // half-covered under the deck page) ----------
  await page.click('#startbtn');
  let idle2 = false;
  for (let i = 0; i < 600 && !idle2; i++) {
    await sleep(1000);
    await page.evaluate(() => {
      const w = document.getElementById('sheetwrap');
      if (w && w.classList.contains('on') && w.textContent.includes('確認')) {
        const x = document.getElementById('sheetx'); if (x) x.click();
      }
    }).catch(() => {});
    idle2 = await page.evaluate(() => { const m = document.getElementById('menubtn'); return m && !m.disabled; }).catch(() => false);
  }
  if (!idle2) { await page.screenshot({ path: path.join(EV, tag + '-duel2-stuck.png') }); throw new Error(tag + ': second duel never reached an idle prompt'); }
  await page.screenshot({ path: path.join(EV, tag + '-duel2.png') });
  console.log(tag, '== in-duel probe (duel 2) ==');
  console.log(JSON.stringify(await page.evaluate(PROBE).catch(e => ({ err: e.message })), null, 1));
  await page.click('#loghistbtn');
  await sleep(1200);
  const hist = await page.evaluate(() => {
    const w = document.getElementById('sheetwrap');
    return 'sheetOn:' + (w ? w.classList.contains('on') : '?') + ' hasTitle:' + (w ? w.textContent.includes('履歴') : '?');
  }).catch(e => 'err:' + e.message);
  console.log(tag, 'history open in duel 2 ->', hist);
  await page.screenshot({ path: path.join(EV, tag + '-duel2-hist.png') });
  await page.evaluate(() => { const x = document.getElementById('sheetx'); if (x) x.click(); }).catch(() => {});
  await browser.close();
}

(async () => {
  const tag = PROF;
  await flow(tag);
  console.log('CAP FIX1113D DONE');
})().catch(e => { console.error('FATAL', e); process.exit(2); });
