'use strict';
/* cap-fix1113c.js — BU-69 real-flow evidence (fix round
 * 2026-11-13 #3): an ACTUAL duel is started through the UI,
 * left mid-duel via その他 → 選択に戻る → 終了する, and the
 * reload landing is sampled in-page (5ms) at 390x700 and
 * 390x620. Pass condition: the first sampled state that shows
 * the deck page already carries the RESTORED summary
 * （相手：帝王 ／ 後攻）, and no sampled state ever shows the
 * default opponent ゲート・ガーディアン on the deck page.
 * Screenshots land in the evidence dir given as argv[3].
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('/home/hatch/workspace/duel-review/node_modules/puppeteer');
const CHROME = '/home/hatch/.cache/puppeteer/chrome/linux-156.0.8078.47/chrome-linux64/chrome';
const URL = 'http://127.0.0.1:8931/v2/';
const EV = process.argv[2] || '/tmp/brushupfix1113c-ev';
fs.mkdirSync(EV, { recursive: true });

const RECORDER = () => {
  window.__marks = [];
  let last = '';
  const sample = () => {
    const g = (id) => document.getElementById(id);
    const st = g('start'), dp = g('deckpage'), ds = g('decksum'), sb = g('startbtn');
    if (!st) return;
    const snap = [
      st.style.display === 'none' ? 'start:gone' : 'start:UP',
      dp.style.display === 'flex' ? 'deck:FLEX' : 'deck:-',
      ds ? ds.textContent.trim() : '?',
      sb ? (sb.disabled ? 'btn:dis' : 'btn:EN') : '?',
    ].join('|');
    if (snap !== last) { last = snap; window.__marks.push([Math.round(performance.now()), snap]); }
  };
  const iv = setInterval(sample, 5);
  setTimeout(() => clearInterval(iv), 300000);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function flow(browser, w, h, tag) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h });
  await page.evaluateOnNewDocument(RECORDER);
  await page.goto(URL, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => { const sb = document.getElementById('startbtn'); return sb && !sb.disabled; }, { timeout: 180000 });
  // choose a NON-default setup through the UI: opponent = 帝王
  // (classic category), first = 後攻.
  await page.click('#todeck');
  await sleep(300);
  await page.click('#opdeckcur');
  await sleep(300);
  await page.evaluate(() => { document.querySelector('#deckcatlist .catbtn[data-cat="classic"]').click(); });
  await sleep(400);
  await page.evaluate(() => { const b = document.querySelector('#seg-opdeck button.deck[data-v="monarch"]'); if (b) b.click(); });
  await sleep(500);
  await page.evaluate(() => { const b = document.querySelector('#seg-first button[data-v="second"]'); if (b) b.click(); });
  await sleep(300);
  const sumBefore = await page.evaluate(() => document.getElementById('decksum').textContent.trim());
  console.log(tag, 'summary before duel:', sumBefore);
  // start the duel and wait for the first idle prompt (その他 live).
  // The human is SECOND here, so the bot's whole first turn runs
  // first at watchability pace — on a loaded VM that is minutes.
  await page.click('#startbtn');
  let menuReady = false;
  for (let i = 0; i < 360 && !menuReady; i++) {
    await sleep(1000);
    // a pending card-confirmation reveal (MSG_CONFIRM_CARDS)
    // legitimately waits for the human to close it — the flow
    // must do what the user would do, or the duel "stalls" with
    // the confirm log line frozen on screen.
    await page.evaluate(() => {
      const w = document.getElementById('sheetwrap');
      if (w && w.classList.contains('on') && w.textContent.includes('確認')) {
        const x = document.getElementById('sheetx');
        if (x) x.click();
      }
    }).catch(() => {});
    menuReady = await page.evaluate(() => { const m = document.getElementById('menubtn'); return m && !m.disabled; }).catch(() => false);
    if (i % 30 === 29) {
      const probe = await page.evaluate(() => {
        const l = document.getElementById('logline');
        return l ? l.textContent : '(no logline)';
      }).catch(() => '(eval failed)');
      console.log(tag, 'waiting for first prompt… logline:', probe);
    }
  }
  if (!menuReady) {
    await page.screenshot({ path: path.join(EV, tag + '-stuck.png') });
    throw new Error(tag + ': duel never reached an idle prompt');
  }
  await page.screenshot({ path: path.join(EV, tag + '-duel.png') });
  // leave the duel: その他 → 選択に戻る → 終了する (reload)
  await page.evaluate(() => { window.__marks = []; });
  await page.click('#menubtn');
  await sleep(600);
  await page.evaluate(() => { const b = document.getElementById('sheet-cancel'); if (b) b.click(); });
  await sleep(600);
  await page.evaluate(() => { const b = document.getElementById('quit-confirm'); if (b) b.click(); });
  await page.waitForFunction(() => { const sb = document.getElementById('startbtn'); return sb && !sb.disabled; }, { timeout: 240000 });
  await sleep(300);
  const marks = await page.evaluate(() => window.__marks);
  console.log(tag, '== landing marks (ms since navigation) ==');
  for (const [t, s] of marks) console.log(' ', String(t).padStart(6), s);
  const flexMarks = marks.filter(([, s]) => s.includes('deck:FLEX'));
  const firstFlex = flexMarks[0];
  const wrongShown = marks.some(([, s]) => s.includes('deck:FLEX') && s.includes('ゲート・ガーディアン'));
  const okFirst = !!firstFlex && firstFlex[1].includes('帝王') && firstFlex[1].includes('後攻');
  console.log(tag, 'first deck-page sample:', JSON.stringify(firstFlex));
  console.log(tag, 'wrong default shown on deck page:', wrongShown, '| first sample already correct:', okFirst);
  await page.screenshot({ path: path.join(EV, tag + '-landed.png') });
  await page.close();
  return okFirst && !wrongShown;
}

(async () => {
  // a fresh browser per flow: the second duel in one browser
  // process once stalled at the opening shuffle (worker start),
  // which is a rig artifact, not the landing under test.
  let all = true;
  const only = process.argv[3];
  if (!only || only === 'h700') {
    const b1 = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    all = (await flow(b1, 390, 700, 'h700')) && all;
    await b1.close();
  }
  if (!only || only === 'h620') {
    const b2 = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    all = (await flow(b2, 390, 620, 'h620')) && all;
    await b2.close();
  }
  console.log(all ? 'CAP FIX1113C: PASS' : 'CAP FIX1113C: FAIL');
  process.exit(all ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
