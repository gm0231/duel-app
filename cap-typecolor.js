'use strict';
/* cap-typecolor.js — prototype capture for card-kind colors on name
   bands (user request 2026-11-03). Two variants, switched by a body
   class that only the capture sets (nothing is visible in the plain
   build): body.tc-full = whole band takes the kind color;
   body.tc-accent = band stays black, kind-colored left core +
   hairline. The board is painted through the client's own render()
   with a fabricated mixed board (declared fabrication — an effect
   monster, a fusion, a synchro and an Xyz never share one real
   field with a face-up spell, a face-up trap, an own set trap and
   an opponent's face-down monster in a single opening). The grid /
   legend panel is injected by this harness using the client's own
   helpers (artInline / kindCls / cardName) and the real .gcard
   markup pattern; the legend cards are harness-only (the current
   pool has no Normal or Ritual monster to show). Preview is set to
   Gate Guardian (fusion) through the real setPreview().
   Usage: node cap-typecolor.js <outDir> [heights=700,620]        */
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('/home/hatch/workspace/duel-review/node_modules/puppeteer');

const ROOT = __dirname;
const OUT = process.argv[2] || path.join(ROOT, 'shots-typecolor');
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

    // ---- fabricated mixed board through the client's own render() ----
    await page.evaluate(() => {
      const mon = (code, pos, mats) => { const d = DATA.cards[code]; return { code, pos, materials: mats || 0, curAtk: d.atk, curDef: d.def }; };
      const P = () => ({ mzone: [null, null, null, null, null, null, null], szone: [null, null, null, null, null, null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
      const b = { players: [P(), P()], phaseName: '', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], lastAttack: null };
      // own field: effect / fusion / synchro / xyz / face-up DEF effect
      b.players[0].mzone[0] = mon(99937011, 0x1);        // 剣神官ムドラ (effect)
      b.players[0].mzone[1] = mon(8505920, 0x1);         // 合体魔神－ゲート・ガーディアン (fusion)
      b.players[0].mzone[2] = mon(36898537, 0x1);        // メタファイズ・ホルス・ドラゴン (synchro)
      b.players[0].mzone[3] = mon(82633039, 0x1, 2);     // 鳥銃士カステル (xyz, 2 materials)
      b.players[0].mzone[4] = mon(25926710, 0x4);        // 古尖兵ケルベク face-up DEF (band rotates)
      // own s/t: face-up spell / face-up trap / own set trap (veil)
      b.players[0].szone[0] = mon(38699854, 0x5);        // 太陽の書
      b.players[0].szone[1] = mon(17484499, 0x5);        // 現世と冥界の逆転
      b.players[0].szone[2] = mon(98715423, 0xa);        // 墓守の罠 (own set)
      // opponent: face-up effect + face-down DEF (must stay colorless)
      b.players[1].mzone[0] = mon(62320425, 0x1);        // 古衛兵アギド
      b.players[1].mzone[1] = mon(99937011, 0x8);        // face-down DEF Mudora
      b.players[1].szone[0] = mon(98715423, 0xa);        // opponent set trap (plain back)
      b.players[0].hand = [{ code: 99937011 }, { code: 38699854 }, { code: 98715423 }, { code: 14087893 }, { code: 79106360 }];
      window.__fx.reset(); render(b); window.__fx.process([], b);
      setPreview(8505920, null); // preview name band = fusion
    });
    await sleep(600);

    if (H === 700) await shoot('board-base');
    const styles = {};
    for (const variant of ['tc-full', 'tc-accent']) {
      await page.evaluate(v => { document.body.classList.remove('tc-full', 'tc-accent'); document.body.classList.add(v); }, variant);
      await sleep(250);
      await shoot('board-' + variant.replace('tc-', ''));
      styles[variant] = await page.evaluate(() => {
        const grab = (sel) => { const el = document.querySelector(sel); if (!el) return null; const cs = getComputedStyle(el); return { cls: el.className, bg: cs.backgroundColor, shadow: cs.boxShadow.slice(0, 60), color: cs.color }; };
        return {
          tileEffect: grab('#myMzone .slot:nth-child(1) .tile .nm'),
          tileFusion: grab('#myMzone .slot:nth-child(2) .tile .nm'),
          tileSynchro: grab('#myMzone .slot:nth-child(3) .tile .nm'),
          tileXyz: grab('#myMzone .slot:nth-child(4) .tile .nm'),
          tileSpell: grab('#mySzone .slot:nth-child(1) .tile .nm'),
          tileTrap: grab('#mySzone .slot:nth-child(2) .tile .nm'),
          oppDownNm: document.querySelectorAll('#oppMzone .tile.back .nm').length,
          handTrap: grab('#hand .hcard[data-code="98715423"] .nm'),
          pvName: grab('#preview .pv-name'),
        };
      });
      if (H === 700) {
        // ---- harness-injected grid + kind legend (declared) ----
        await page.evaluate(() => {
          const codes = [99937011, 8505920, 36898537, 82633039, 38699854, 14087893, 98715423, 17484499, 79106360];
          const kinds = [['normal', '通常モンスター'], ['effect', '効果モンスター'], ['ritual', '儀式'], ['fusion', '融合'], ['synchro', 'シンクロ'], ['xyz', 'エクシーズ'], ['spell', '魔法'], ['trap', '罠']];
          const gc = c => '<div class="gcard"' + artInline(c) + '><div class="nm' + kindCls(c) + '">' + cardName(c) + '</div></div>';
          const lc = ([k, label]) => '<div class="gcard"><div class="nm k-' + k + '">' + label + '</div></div>';
          document.body.insertAdjacentHTML('beforeend',
            '<div id="protoPanel" style="position:fixed;left:0;right:0;bottom:0;max-height:54%;overflow:auto;background:#1d1811;border-top:2px solid #c9a227;padding:8px;z-index:9999">' +
            '<div style="font-size:11px;color:#a89878;margin-bottom:4px">選択グリッド（ハーネス作画）</div><div class="grid">' + codes.map(gc).join('') + '</div>' +
            '<div style="font-size:11px;color:#a89878;margin:8px 0 4px">種別カラー凡例（ハーネス注入・現行プールに通常／儀式はいない）</div><div class="grid">' + kinds.map(lc).join('') + '</div></div>');
        });
        await sleep(250);
        await shoot('grid-' + variant.replace('tc-', ''));
        await page.evaluate(() => document.getElementById('protoPanel').remove());
      }
    }
    report[H] = styles;
    await page.close();
  }
  fs.writeFileSync(path.join(OUT, 'styles.json'), JSON.stringify(report, null, 1));
  await browser.close();
  server.close();
  console.log('done');
})().catch(e => { console.error('FATAL', e); process.exit(1); });
