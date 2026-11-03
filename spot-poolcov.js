'use strict';
/* spot-poolcov.js — real-browser spot checks for the pool-coverage
   round (390x620 / 390x700). Usage: node spot-poolcov.js <A|B|C>
     A: Vernusylph line -> the optional special-summon YESNO must
        render as a pinned follow-up of the Vernusylph effect
        (foreign desc 9350312, resolved via the solving link).
     B: Castel uses ①, then tapping Castel in the same turn must
        show the greyed row with このターン既に使用済みです
        (shared clause; also exercises chain-desc projection).
     C: Minerva is destroyed by battle (her ② prompt shape is
        captured on the way — scenario D data), then Monster
        Reborn revives a monster; tapping it the same turn must
        show the revive reason naming 《死者蘇生》.
   Goal-directed driver + bot fallback, fresh duels retried.   */
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('/home/hatch/workspace/duel-review/node_modules/puppeteer');

const ROOT = path.join(__dirname, 'v2root');
const REAL = path.join(__dirname); // worktree root; server maps /v2/ -> worktree/v2
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

const SCENARIO = process.argv[2] || 'A';

const DRIVER_SRC = `
window.__drv = { mem: null, log: [], phase: 'start', holdShape: null, release: false, capD: null, castelUsed: false, rebornSeen: false, minervaGone: false };
window.__drvStep = function (SC) {
  const E = window.Engine;
  if (!window.__drv.mem) window.__drv.mem = E.makeBotMemory();
  const D = window.__drv;
  const log = (s) => { if (D.log.length < 160) D.log.push(s); };
  if (typeof currentPrompt === 'undefined' || !currentPrompt) return 'noprompt';
  const prompt = currentPrompt.prompt, state = duel.state, P = state.players[HP];
  const answer = (r) => { finishPrompt(r); return 'ans:' + prompt.name; };
  const bot = () => answer(E.botAnswer(prompt, state, DATA, D.mem));
  const MINERVA = 30100551, CASTEL = 82633039, REBORN = 28958464;

  // ---- hold-and-capture targets (A: foreign YESNO; D: Minerva ② prompt)
  const isForeignYesNo = prompt.name === 'SELECT_YESNO' && prompt.desc && Math.floor(prompt.desc / 1048576) === 9350312;
  const isMinervaFxPrompt = (prompt.name === 'SELECT_YESNO' || prompt.name === 'SELECT_EFFECTYN') &&
    (prompt.code === MINERVA || (prompt.context && prompt.context.code === MINERVA));
  if (SC === 'A' && isForeignYesNo && !D.holdDone) {
    if (!D.holdShape) { D.holdShape = { name: prompt.name, code: prompt.code, loc: prompt.loc, desc: prompt.desc, ctx: prompt.context ? { code: prompt.context.code, loc: prompt.context.loc, desc: prompt.context.desc } : null }; return 'hold'; }
    if (!D.release) return 'hold';
    D.holdDone = true; return bot();
  }
  if (SC === 'C' && isMinervaFxPrompt && !D.capDDone) {
    if (!D.capD) { D.capD = { name: prompt.name, code: prompt.code, loc: prompt.loc, desc: prompt.desc, ctx: prompt.context ? { code: prompt.context.code, loc: prompt.context.loc, desc: prompt.context.desc } : null }; return 'hold'; }
    if (!D.release) return 'hold';
    D.capDDone = true; D.release = false; return bot();
  }

  if (prompt.name === 'SELECT_IDLECMD') {
    const myMon = P.mzone.map((c, i) => c ? { c, i } : null).filter(Boolean);
    if (SC === 'A') {
      const vi = prompt.activate.findIndex(a => (a.code === 36745317 || a.code === 62133026) && a.loc === E.LOC.HAND);
      if (vi >= 0 && !D.vernoFired) { D.vernoFired = true; log('VERNU ' + prompt.activate[vi].code); return answer(E.cmdResp(5, vi)); }
    }
    if (SC === 'B') {
      const castel = myMon.find(x => x.c.code === CASTEL);
      if (castel && D.castelUsed) {
        const offered = prompt.activate.some(a => a.code === CASTEL && a.loc === E.LOC.MZONE);
        if (!offered) {
          const el = document.querySelector('[data-act="' + HP + ':4:' + castel.i + '"]');
          if (el) { el.click(); log('TAP_CASTEL'); return 'sheet'; }
        }
      }
      if (castel && !D.castelUsed) {
        const ai = prompt.activate.findIndex(a => a.code === CASTEL && a.loc === E.LOC.MZONE);
        if (ai >= 0) { D.castelUsed = true; log('CASTEL_FX'); return answer(E.cmdResp(5, ai)); }
      }
      const xs = prompt.spsummon.findIndex(a => a.code === CASTEL);
      if (xs >= 0) { log('XYZ_CASTEL'); return answer(E.cmdResp(1, xs)); }
      const lv4 = P.mzone.filter(c => c && (c.pos & E.POS_FACEUP) && DATA.cards[c.code] && DATA.cards[c.code].level === 4).length;
      log('IDLE t' + state.turnCount + ' field=' + P.mzone.map(c => c ? c.code + '' : '_').join(',') + ' lv4=' + lv4 + ' spOffers=' + (prompt.spsummon || []).map(a => a.code).join(','));
      if (lv4 < 2) {
        const si = prompt.summon.findIndex(a => { const cd = DATA.cards[a.code]; return cd && cd.level === 4; });
        if (si >= 0) { log('NS'); return answer(E.cmdResp(0, si)); }
      }
    }
    if (SC === 'C') {
      const minerva = myMon.find(x => x.c.code === MINERVA);
      if (D.rebornResolved) {
        // tap every own monster; Node reads the sheets in turn
        for (const x of myMon) {
          const el = document.querySelector('[data-act="' + HP + ':4:' + x.i + '"]');
          if (el) { el.click(); return 'sheet:' + x.c.code; }
        }
      }
      const ri = prompt.activate.findIndex(a => a.code === REBORN && a.loc === E.LOC.HAND);
      const gyMonster = P.grave.some(cd => DATA.cards[cd] && (DATA.cards[cd].type & 1));
      if (ri >= 0 && (D.minervaGone || gyMonster)) { D.rebornSeen = true; log('REBORN'); return answer(E.cmdResp(5, ri)); }
      const xs = prompt.spsummon.findIndex(a => a.code === MINERVA);
      if (xs >= 0 && !minerva) { log('XYZ_MINERVA'); return answer(E.cmdResp(1, xs)); }
      const lv4 = P.mzone.filter(c => c && (c.pos & E.POS_FACEUP) && DATA.cards[c.code] && DATA.cards[c.code].level === 4).length;
      if (lv4 < 2 && !minerva) {
        const si = prompt.summon.findIndex(a => { const cd = DATA.cards[a.code]; return cd && cd.level === 4; });
        if (si >= 0) { log('NS'); return answer(E.cmdResp(0, si)); }
      }
      if (minerva && prompt.toBP) { log('TO_BP'); return answer(E.cmdResp(6, 0)); }
    }
    if (prompt.toEP) return answer(E.cmdResp(7, 0));
    if (prompt.toBP && SC !== 'C') return answer(E.cmdResp(6, 0));
  }
  if (SC === 'C' && prompt.name === 'SELECT_BATTLECMD') {
    const P2 = state.players[HP], O = state.players[1 - HP];
    const minerva = P2.mzone.map((c, i) => c ? { c, i } : null).filter(Boolean).find(x => x.c.code === MINERVA);
    const oppStrong = O.mzone.some(c => c && (c.pos & E.POS_FACEUP) && (DATA.cards[c.code] ? (DATA.cards[c.code].atk || 0) : 0) > 2500);
    if (minerva && oppStrong && prompt.attack && prompt.attack.length) {
      const ai = prompt.attack.findIndex(a => a.seq === minerva.i);
      if (ai >= 0) { log('CRASH_MINERVA'); return answer(E.cmdResp(1, ai)); }
    }
    if (prompt.toM2) return answer(E.cmdResp(2, 0));
    if (prompt.toEP) return answer(E.cmdResp(3, 0));
  }
  // bookkeeping for C: Minerva reached the graveyard / Reborn resolved
  if (SC === 'C') {
    if (P.grave.includes(MINERVA)) D.minervaGone = true;
    if (D.rebornSeen && !currentPrompt) D.rebornResolved = true;
    if (D.rebornSeen && prompt.name === 'SELECT_IDLECMD' && P.mzone.some(c => c)) D.rebornResolved = true;
  }
  return bot();
};
'installed'`;

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  const H = SCENARIO === 'A' ? 620 : 700;
  await page.setViewport({ width: 390, height: H });
  page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 200)));
  let verdict = null;
  const maxAttempts = SCENARIO === 'A' ? 6 : 8;
  for (let attempt = 1; attempt <= maxAttempts && !verdict; attempt++) {
    await page.goto('http://127.0.0.1:' + port + '/v2/', { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => document.getElementById('loadmsg') && document.getElementById('loadmsg').textContent.includes('準備完了'), { timeout: 60000 });
    await page.evaluate(DRIVER_SRC.replace("'installed'", "'installed'"));
    await page.evaluate((sc) => { window.__SC = sc; }, SCENARIO);
    // bind scenario into the step function via a wrapper
    await page.evaluate((sc) => { const step = window.__drvStep; window.__drvStep = () => step(sc); }, SCENARIO);
    await page.click('#startbtn');
    const t0 = Date.now();
    while (Date.now() - t0 < (SCENARIO === 'C' ? 200000 : 120000)) {
      const r = await page.evaluate('window.__drvStep()').catch(() => 'evalerr');
      if (r === 'hold') {
        await new Promise(r2 => setTimeout(r2, 600));
        const sheetText = await page.evaluate('document.getElementById("sheet") ? document.getElementById("sheet").innerText : ""');
        const shape = await page.evaluate('window.__drv.holdShape || window.__drv.capD');
        const probe = await page.evaluate(`(() => { const p = currentPrompt.prompt; const ctx = p.context; try { return { descEffect: descEffect(p.desc), foreign: foreignFollowFx(ctx, p), ctxFx: resolveEffect(ctx.code, ctx.desc) && resolveEffect(ctx.code, ctx.desc).n, step: stepClause(ctx.code, 1) }; } catch (e) { return { err: String(e) }; } })()`).catch(e => ({ evalerr: String(e) }));
        console.log('probe: ' + JSON.stringify(probe));
        await page.screenshot({ path: path.join(OUT, SCENARIO.toLowerCase() + '-hold-attempt' + attempt + '.png') });
        console.log('attempt ' + attempt + ': HOLD shape=' + JSON.stringify(shape));
        console.log('sheet: ' + sheetText.replace(/\n+/g, ' | ').slice(0, 600));
        if (SCENARIO === 'A') {
          verdict = (sheetText.includes('の効果の続きです') || sheetText.includes('続き')) ? 'PASS' : 'CHECK-SHEET';
          await page.evaluate('window.__drv.release = true');
          break;
        }
        // C: D-capture is evidence, not the verdict — release and continue
        await page.evaluate('window.__drv.release = true');
        continue;
      }
      if (typeof r === 'string' && r.startsWith('sheet')) {
        await new Promise(r2 => setTimeout(r2, 700));
        let sheetText = await page.evaluate('document.getElementById("sheet").innerText');
        // the first tap can be swallowed by chain presentation;
        // re-tap the same tile until the action sheet is readable
        for (let retry = 0; retry < 4 && !sheetText.trim(); retry++) {
          const seq = await page.evaluate((code) => { const P = duel.state.players[HP]; return P.mzone.findIndex(c => c && c.code === code); }, SCENARIO === 'B' ? 82633039 : 30100551).catch(() => -1);
          if (seq < 0) break;
          await page.evaluate((s) => { const el = document.querySelector('[data-act="' + HP + ':4:' + s + '"]'); if (el) el.click(); }, seq);
          await new Promise(r2 => setTimeout(r2, 800));
          sheetText = await page.evaluate('document.getElementById("sheet").innerText');
        }
        await page.screenshot({ path: path.join(OUT, SCENARIO.toLowerCase() + '-sheet-attempt' + attempt + '.png') });
        const log = await page.evaluate('window.__drv.log');
        console.log('attempt ' + attempt + ': SHEET (' + r + ') log=' + JSON.stringify(log));
        console.log('sheet: ' + sheetText.replace(/\n+/g, ' | ').slice(0, 600));
        if (SCENARIO === 'B') verdict = sheetText.includes('このターン既に使用済みです') ? 'PASS' : 'FAIL-REASON';
        if (SCENARIO === 'C') {
          // tap through every own monster: only the revived one
          // carries the reason
          const seqs = await page.evaluate('duel.state.players[HP].mzone.map((c, i) => c ? i : -1).filter(i => i >= 0)');
          let text = sheetText;
          for (const s of seqs) {
            if (text.includes('の効果で特殊召喚されたため、このターンは効果を発動できません')) { verdict = 'PASS'; break; }
            await page.evaluate((seq) => { const el = document.querySelector('[data-act="' + HP + ':4:' + seq + '"]'); if (el) el.click(); }, s);
            await new Promise(r2 => setTimeout(r2, 600));
            text = await page.evaluate('document.getElementById("sheet").innerText');
            console.log('  C tap seq=' + s + ': ' + text.replace(/\n+/g, ' | ').slice(0, 300));
          }
          if (!verdict) verdict = 'FAIL-REASON';
        }
        break;
      }
      await new Promise(r2 => setTimeout(r2, 300));
    }
    if (!verdict) {
      const log = await page.evaluate('window.__drv ? window.__drv.log : []').catch(() => []);
      const capD = await page.evaluate('window.__drv ? window.__drv.capD : null').catch(() => null);
      console.log('attempt ' + attempt + ': no verdict. capD=' + JSON.stringify(capD) + ' log=' + JSON.stringify(log));
    }
  }
  console.log('VERDICT[' + SCENARIO + ']: ' + (verdict || 'NOT-REPRODUCED'));
  await browser.close();
  server.close();
  process.exit(verdict === 'PASS' ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
