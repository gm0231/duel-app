'use strict';
/* cap-tilecolor.js — prototype capture for card-kind colors on
   BOARD TILES (user follow-up 2026-11-03: variant A on the bands
   was adopted, and the user also wants the color on the board,
   where the name band is covered by the art). Two placements,
   switched by a body class that only this capture sets:
   body.tc-tile-frame = a 2px kind-colored frame inside the tile
   edge; body.tc-tile-chip = a small kind-colored tab centered on
   the tile's bottom edge. NOTHING here is merged to main.
   The board is painted through the client's own render() with a
   fabricated mixed board (declared fabrication, same composition
   as cap-typecolor-a: effect / fusion / synchro / xyz / face-up
   DEF effect, face-up spell + trap, an own set trap, an opponent
   face-up monster, face-down monster and set trap — the last
   three must stay colorless). Preview is set to Gate Guardian.
   Computed styles (frame border color, chip background, tile
   classes of the face-down/set tiles) land in styles.json.
   Usage: node cap-tilecolor.js <outDir> [heights=700,620]       */
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('/home/hatch/workspace/duel-review/node_modules/puppeteer');

const ROOT = __dirname;
const OUT = process.argv[2] || path.join(ROOT, 'shots-tilecolor');
const HEIGHTS = (process.argv[3] || '700,620').split(',').map(Number);
fs.mkdirSync(OUT, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.m4a': 'audio/m4a', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const browser = await puppeteer.launch({ executablePath: '/home/hatch/.cache/puppeteer/chrome/linux-156.0.8078.47/chrome-linux64/chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
  const report = {};
  for (const H of HEIGHTS) {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: H, deviceScaleFactor: 2 });
    page.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 160)));
    await page.goto('http://127.0.0.1:' + port + '/v2/', { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => document.getElementById('loadmsg').textContent.includes('準備完了'), { timeout: 60000 });
    await page.click('#startbtn');
    await page.waitForFunction(() => {
      try { return !!currentPrompt && window.__fx && window.__fx.ready && document.querySelectorAll('.slot').length >= 10; }
      catch (e) { return false; }
    }, { timeout: 60000 });
    await sleep(600);
    const shoot = async (name) => { await page.screenshot({ path: path.join(OUT, name + '-h' + H + '.png') }); console.log('  captured', name + '-h' + H + '.png'); };

    await page.evaluate(() => {
      const mon = (code, pos, mats) => { const d = DATA.cards[code]; return { code, pos, materials: mats || 0, curAtk: d.atk, curDef: d.def }; };
      const P = () => ({ mzone: [null, null, null, null, null, null, null], szone: [null, null, null, null, null, null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
      const b = { players: [P(), P()], phaseName: '', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], lastAttack: null };
      b.players[0].mzone[0] = mon(99937011, 0x1);        // 剣神官ムドラ (effect)
      b.players[0].mzone[1] = mon(8505920, 0x1);         // 合体魔神－ゲート・ガーディアン (fusion)
      b.players[0].mzone[2] = mon(36898537, 0x1);        // メタファイズ・ホルス・ドラゴン (synchro)
      b.players[0].mzone[3] = mon(82633039, 0x1, 2);     // 鳥銃士カステル (xyz, 2 materials)
      b.players[0].mzone[4] = mon(25926710, 0x4);        // 古尖兵ケルベク face-up DEF (rotated inner)
      b.players[0].szone[0] = mon(38699854, 0x5);        // 太陽の書 (face-up spell)
      b.players[0].szone[1] = mon(17484499, 0x5);        // 現世と冥界の逆転 (face-up trap)
      b.players[0].szone[2] = mon(98715423, 0xa);        // 墓守の罠 (own set — must stay colorless)
      b.players[1].mzone[0] = mon(63542003, 0x1);        // 宿神像ケルドウ (opp face-up)
      b.players[1].mzone[1] = mon(99937011, 0x8);        // face-down DEF Mudora (must stay colorless)
      b.players[1].szone[0] = mon(98715423, 0xa);        // opponent set trap (must stay colorless)
      b.players[0].hand = [{ code: 99937011 }, { code: 38699854 }, { code: 98715423 }, { code: 14087893 }, { code: 79106360 }];
      window.__fx.reset(); render(b); window.__fx.process([], b);
      setPreview(8505920, null);
    });
    await sleep(600);

    const base = await page.evaluate(() => {
      const tileCls = (sel) => { const t = document.querySelector(sel); return t ? t.className : null; };
      return {
        ownFusion: tileCls('#myMzone .slot:nth-child(2) .tile'),
        ownDef: tileCls('#myMzone .slot:nth-child(5) .tile'),
        ownSetTrap: tileCls('#mySzone .slot:nth-child(3) .tile'),
        oppDown: tileCls('#oppMzone .slot:nth-child(2) .tile'),
        oppSetTrap: tileCls('#oppSzone .slot:nth-child(1) .tile'),
        defInnerTransform: (() => { const i = document.querySelector('#myMzone .slot:nth-child(5) .tile .inner'); return i ? getComputedStyle(i).transform : null; })(),
      };
    });
    report[H] = { base };
    for (const variant of ['tc-tile-frame', 'tc-tile-chip']) {
      await page.evaluate(v => { document.body.classList.remove('tc-tile-frame', 'tc-tile-chip'); document.body.classList.add(v); }, variant);
      await sleep(250);
      await shoot('board-' + variant.replace('tc-', ''));
      report[H][variant] = await page.evaluate(() => {
        const fusionTile = document.querySelector('#myMzone .slot:nth-child(2) .tile');
        const effectChip = document.querySelector('#myMzone .slot:nth-child(1) .tile .kchip');
        const defTile = document.querySelector('#myMzone .slot:nth-child(5) .tile');
        const fa = fusionTile ? getComputedStyle(fusionTile, '::after') : null;
        const da = defTile ? getComputedStyle(defTile, '::after') : null;
        return {
          frameBorder: fa ? { color: fa.borderTopColor, width: fa.borderTopWidth } : null,
          defFrameBorder: da ? { color: da.borderTopColor, width: da.borderTopWidth } : null,
          chip: effectChip ? { display: getComputedStyle(effectChip).display, bg: getComputedStyle(effectChip).backgroundColor } : null,
        };
      });
    }
    await page.close();
  }
  fs.writeFileSync(path.join(OUT, 'styles.json'), JSON.stringify(report, null, 1));
  await browser.close();
  server.close();
  console.log('done');
})().catch(e => { console.error('FATAL', e); process.exit(1); });
