'use strict';
/* probe-render.js — renders REAL uiYesNo sheets in the live page
   for prompt shapes captured from real play / the real core:
     A: Vernusylph follow-up YESNO (live capture, spot run 1:
        desc=Stringid(9350312,1), ctx={62133026, HAND,
        Stringid(62133026,0)}) — must render as the pinned
        follow-up (の効果の続きです + 行う/行わない).
     D: Minerva ② EFFECTYN (engine capture, cap-minerva2.js:
        code=30100551, loc=16, desc=221) — must pin ② via the
        bare table.
   One fresh page per shape; the sheet is screenshotted at
   390x620 before any button is touched.                     */
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('/home/hatch/workspace/duel-review/node_modules/puppeteer');

const REAL = __dirname;
const OUT = path.join(__dirname, 'spotshots');
fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.m4a': 'audio/m4a', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(REAL, p);
  if (!file.startsWith(REAL) || !fs.existsSync(file)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const SHAPES = {
  A: { name: 'SELECT_YESNO', desc: 9804512755713, context: { code: 62133026, loc: 2, desc: 65151199870976 } },
  D: { name: 'SELECT_EFFECTYN', code: 30100551, loc: 16, desc: 221 },
};

(async () => {
  const which = process.argv[2] || 'A';
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 620 });
  page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 200)));
  await page.goto('http://127.0.0.1:' + port + '/v2/', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => document.getElementById('loadmsg') && document.getElementById('loadmsg').textContent.includes('準備完了'), { timeout: 60000 });
  await page.click('#startbtn');
  await page.waitForFunction(() => typeof currentPrompt !== 'undefined' && currentPrompt, { timeout: 60000 });
  const shape = SHAPES[which];
  const res = await page.evaluate((sh) => {
    try {
      uiYesNo(sh, duel.state);
      return 'rendered';
    } catch (e) { return 'ERR ' + String(e); }
  }, shape);
  await new Promise(r => setTimeout(r, 700));
  const sheetText = await page.evaluate('document.getElementById("sheet") ? document.getElementById("sheet").innerText : ""');
  await page.screenshot({ path: path.join(OUT, 'probe-' + which.toLowerCase() + '.png') });
  console.log('render:', res);
  console.log('sheet: ' + sheetText.replace(/\n+/g, ' | ').slice(0, 700));
  const pass = which === 'A'
    ? sheetText.includes('の効果の続きです') && sheetText.includes('行う')
    : sheetText.includes('聞かれている効果：②');
  console.log('VERDICT[' + which + ']: ' + (pass ? 'PASS' : 'FAIL'));
  await browser.close();
  server.close();
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
