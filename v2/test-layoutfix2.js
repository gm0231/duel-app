'use strict';
/* test-layoutfix2.js — layout-fix round 2 contracts (J1' / J2' / J4'),
 * written against the parent's published-build re-verification that
 * found round 1's fixes incomplete IN REAL PLAY.
 *
 * J1' (the xyz material sheet had NO way forward): the real core
 *     traffic for an Xyz material choice is MSG_SELECT_UNSELECT_CARD
 *     with finishable=false at BOTH prompt steps (measured against
 *     the production core below, in a scripted duel that actually
 *     summons 《神羊樹バロメット》). With finishable=false the
 *     決定 button never exists for this prompt family — by design —
 *     but round 1's sheet said nothing about how to proceed, and
 *     after the first pick cancelable also turned false, leaving a
 *     footer with no buttons and no guidance. Contract: a
 *     non-finishable unselect sheet states that there is no 決定
 *     button and that tapping to the required count advances; when
 *     cancel is also gone it states the way out (deselect all); and
 *     the footer is never left empty (a .btnnote stands in).
 * J2' (names still split mid-word in the band and the dock ctx):
 *     round 1 wrapped only strings that already carried 《》 — but
 *     the ENGINE built bare band lines from raw names, so the
 *     wrapper never matched; and plain prose could break anywhere.
 *     Contract: the engine wraps every card name it interpolates
 *     into a band (pushLog) line in 《》 (the detailed history is
 *     untouched), and the client tokenises band / ctx / purpose
 *     lines with nbHTML: 《…》 and 「…」 are atomic units, plain
 *     prose breaks only after ：、｜。 or at spaces, and a unit
 *     wider than the line shrinks (nbFit) instead of splitting.
 * J4' (timing windows named nothing): round 1 attached the last
 *     trigger only within the same turn AND phase, and knew only
 *     summons and attacks — so post-resolution windows and
 *     phase-start windows (the most frequent "any response?"
 *     prompts) arrived nameless. Contract: the engine also records
 *     chain resolutions (MSG_CHAIN_SOLVED) and major phase starts
 *     (MSG_NEW_PHASE / NEW_TURN), the driver attaches the trigger
 *     whenever it is from the SAME TURN, and the dock labels read
 *     《X》の効果解決の後 / <phase>開始時. Measured below over real
 *     duels: every context-free SELECT_CHAIN prompt carries a
 *     trigger (100%), none from another turn.
 *
 * Method: source pins; jsdom renders of REAL captured prompt JSON
 * (the two unselect steps of an actual Baromett summon, seed 1;
 * a real post-resolution chain prompt naming the 13-char
 * 《迷宮に潜むシャドウ・グール》); engine behaviour over real
 * duels (band name coverage + trigger coverage); and a scripted
 * Xyz duel that must end with Baromett on the field. */
const fs = require('fs');
const path = require('path');
const factory = require(path.join(__dirname, 'build', 'ocgcore.js'));
const Engine = require(path.join(__dirname, 'engine.js'));

let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };

const V2 = __dirname;
const html = fs.readFileSync(path.join(V2, 'index.html'), 'utf8');
const clientSrc = fs.readFileSync(path.join(V2, 'client.js'), 'utf8');
const engineSrc = fs.readFileSync(path.join(V2, 'engine.js'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(V2, 'data.json'), 'utf8'));

// ---------- source pins ----------
{
  ok(clientSrc.includes('この選択に決定ボタンはありません') && clientSrc.includes('必要な枚数がそろった時点でそのまま進みます'),
    "LF2-J1'a: a non-finishable unselect sheet explains there is no 決定 button and that reaching the count advances");
  ok(clientSrc.includes('やめる場合は選択をすべて外してください') && clientSrc.includes('btnnote') && html.includes('#sheet .btnnote'),
    "LF2-J1'b: with cancel also gone the sheet names the way out, and the footer keeps a .btnnote stand-in (styled)");
  ok(clientSrc.includes('function nbHTML(text)') && clientSrc.includes('function nbFit(container)') && html.includes('.nb{') &&
     clientSrc.includes('ll.innerHTML = nbHTML(txt)') && clientSrc.includes('class="ctx">\' + nbHTML(timingText(state)'),
    "LF2-J2'a: nbHTML/nbFit exist, .nb units are styled, and the band line + dock ctx render through them");
  ok(engineSrc.includes("bn(name) { return '《' + name + '》'; }") && (engineSrc.match(/this\.bn\(/g) || []).length >= 8 &&
     engineSrc.includes("this.pushLog('チェーン' + this.chain.length + '：' + this.bn(this.nameOf(code)))"),
    "LF2-J2'b: the engine wraps band-line names in 《》 (chain line + at least 8 bn() call sites in pushLog paths)");
  ok(clientSrc.includes('の効果解決の後') && clientSrc.includes("phaseJaContext(trig.phase) + '開始時'") &&
     engineSrc.includes("case 73:") && engineSrc.includes("kind: 'solved'") && engineSrc.includes("kind: 'phase'"),
    "LF2-J4'a: solved/phase triggers are recorded engine-side and labelled in the dock");
  ok(!engineSrc.includes('lt.phase === this.state.phaseName'),
    "LF2-J4'b: trigger attachment is same-turn (the round-1 turn+phase gate is gone)");
  ok(clientSrc.includes('window.__chain = { open:'),
    "LF2-J4'c: the __chain test surface exists (captured-prompt dock renders)");
}

function installSeededCrypto(seed) {
  let s = seed >>> 0;
  const fake = { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; a[i] = s; } return a; } };
  Object.defineProperty(globalThis, 'crypto', { value: fake, configurable: true, writable: true });
}

// Real captured prompts (production core, seed 1): the two steps of
// the Baromett material choice, and a post-resolution chain window.
const UNSEL_A = { name: 'SELECT_UNSELECT_CARD', player: 0, finishable: false, cancelable: true, min: 1, max: 1,
  select: [{ code: 63542003, con: 0, loc: 4, seq: 0, pos: 1 }, { code: 63542003, con: 0, loc: 4, seq: 1, pos: 1 }],
  unselect: [], selectHint: 513, retryCount: 0 };
const UNSEL_B = { name: 'SELECT_UNSELECT_CARD', player: 0, finishable: false, cancelable: false, min: 1, max: 1,
  select: [{ code: 63542003, con: 0, loc: 4, seq: 1, pos: 1 }],
  unselect: [{ code: 63542003, con: 0, loc: 4, seq: 0, pos: 1 }], selectHint: 513, retryCount: 0 };
const CHAIN_SOLVED = { prompt: { name: 'SELECT_CHAIN', player: 0, forced: false,
    entries: [{ code: 99937011, con: 0, loc: 4, seq: 1, pos: 1, desc: 104791551246337, mode: 0 }],
    context: null, trigger: { kind: 'solved', code: 62411811, con: 1, turn: 2, phase: 'MAIN1' }, retryCount: 0 },
  state: { chain: [], turnCount: 2, turnPlayer: 1, phaseName: 'MAIN1' } };
const CHAIN_PHASE = { prompt: { name: 'SELECT_CHAIN', player: 0, forced: false,
    entries: [{ code: 99937011, con: 0, loc: 4, seq: 1, pos: 1, desc: 104791551246337, mode: 0 }],
    context: null, trigger: { kind: 'phase', code: 0, con: 0, turn: 1, phase: 'END' }, retryCount: 0 },
  state: { chain: [], turnCount: 1, turnPlayer: 0, phaseName: 'END' } };

(async () => {
  // ---------------------------------------------------------- jsdom
  let JSDOM;
  try { ({ JSDOM } = require('jsdom')); }
  catch (e) { console.log('SKIP: jsdom not resolvable (set NODE_PATH) — render parts skipped'); }
  if (JSDOM) {
    const wasmBinary = fs.readFileSync(path.join(V2, 'build', 'ocgcore.wasm'));
    const dom = new JSDOM(html, { url: 'http://localhost/v2/', runScripts: 'dangerously', pretendToBeVisual: true });
    const { window } = dom;
    window.Audio = class { constructor(src) { this.src = src; this.volume = 1; } play() { return Promise.resolve(); } pause() {} };
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
    inject('client.js');
    for (let i = 0; i < 100 && !window.document.getElementById('loadmsg').textContent.includes('準備完了'); i++)
      await new Promise(r => setTimeout(r, 50));
    ok(window.document.getElementById('loadmsg').textContent.includes('準備完了'), 'LF2-C0: client boots');
    const doc = window.document;
    const subText = () => (doc.querySelector('#sheet .sub') || {}).textContent || '';

    window.__unselect.open(JSON.parse(JSON.stringify(UNSEL_A)));
    ok(!!doc.getElementById('unselect-cancel') && !doc.getElementById('unselect-finish'),
      "LF2-C1: step A (nothing picked) — cancel exists, finish does not (the core's real shape)");
    ok(subText().includes('決定ボタンはありません') && subText().includes('タップして選ぶと'),
      "LF2-C2: step A already explains the way forward (no 決定 button; tap to the count)");
    window.__unselect.open(JSON.parse(JSON.stringify(UNSEL_B)));
    ok(!doc.getElementById('unselect-cancel') && !doc.getElementById('unselect-finish'),
      "LF2-C3: step B (one picked, min reached) — neither button exists (the reported dead end)");
    ok(!!doc.querySelector('#sheet .btnnote') && doc.querySelector('#sheet .btnnote').textContent.includes('タップで選ぶと進みます'),
      "LF2-C4: step B — the footer is not empty: the .btnnote stand-in says how it proceeds");
    ok(subText().includes('選択をすべて外してください'),
      "LF2-C5: step B — the way out (deselect all) is stated in the guidance");

    window.__chain.open(JSON.parse(JSON.stringify(CHAIN_SOLVED.prompt)), JSON.parse(JSON.stringify(CHAIN_SOLVED.state)));
    const ctx1 = doc.querySelector('#dock .ctx');
    ok(!!ctx1 && ctx1.textContent.includes('《迷宮に潜むシャドウ・グール》の効果解決の後'),
      "LF2-C6: a post-resolution window names what just resolved (J4' solved label, real prompt)");
    const nameSpans = ctx1 ? [...ctx1.querySelectorAll('.nb')].filter(sp => sp.textContent.includes('迷宮に潜む')) : [];
    ok(nameSpans.length === 1 && nameSpans[0].textContent === '《迷宮に潜むシャドウ・グール》',
      "LF2-C7: the long name is ONE atomic .nb unit in the dock ctx (it can never split mid-name)");
    window.__chain.open(JSON.parse(JSON.stringify(CHAIN_PHASE.prompt)), JSON.parse(JSON.stringify(CHAIN_PHASE.state)));
    const ctx2 = doc.querySelector('#dock .ctx');
    ok(!!ctx2 && ctx2.textContent.includes('エンド開始時'),
      "LF2-C8: a phase-start window is named as such (J4' phase label, real prompt)");
    window.close();
  }

  // ---------------------------------------------------------- engine behaviour
  const M = await factory();
  // A name counts as covered when it never occurs OUTSIDE a 《…》
  // span. (Occurrence-wise checking false-positives on a shorter
  // deck name nested inside a longer wrapped one — ゲート・
  // ガーディアン inside 《合体魔神－ゲート・ガーディアン》.)
  const covered = (line, name) => !line.replace(/《[^》]*》/g, '').includes(name);
  {
    const deckNames = new Set();
    for (const dk of ['ishizu', 'gg', 'monarch']) for (const c of [...data.decks[dk].main, ...data.decks[dk].extra]) {
      const n = data.names[c]; if (n && n.length >= 6) deckNames.add(n);
    }
    const bandClasses = /召喚|チェーン|攻撃|確認|表示形式が|破壊され|除外された|手札に戻った|デッキに戻った|墓地へ送られた|コントロールが|ドロー|受け|ライフ|回復/;
    const seen = { lines: new Set(), total: 0, bare: 0, noTrig: 0, emptyCtx: 0, kinds: {}, staleTurn: 0, chainLine: false };
    const pairs = [['ishizu', 'gg'], ['gg', 'ishizu'], ['ishizu', 'monarch'], ['monarch', 'ishizu'], ['gg', 'monarch'], ['monarch', 'gg']];
    let allOver = true, allRetries0 = true;
    for (let i = 0; i < pairs.length; i++) {
      installSeededCrypto((9100 + i * 137) * 2654435761 % 4294967296);
      const mems = [Engine.makeBotMemory(), Engine.makeBotMemory()];
      const wrap = (seat) => (prompt, state) => {
        if (seat === 0 && prompt.name === 'SELECT_CHAIN' && !prompt.context) {
          seen.emptyCtx++;
          if (!prompt.trigger) seen.noTrig++;
          else {
            seen.kinds[prompt.trigger.kind] = (seen.kinds[prompt.trigger.kind] || 0) + 1;
            if (prompt.trigger.turn !== state.turnCount) seen.staleTurn++;
          }
        }
        return Engine.botAnswer(prompt, state, data, mems[seat]);
      };
      const duel = new Engine.Duel(M, data, {
        seed: 9100 + i * 137, pace: { bot: 0, botChain: 0, batch: 0 }, sleep: () => Promise.resolve(),
        deckP0: data.decks[pairs[i][0]], deckP1: data.decks[pairs[i][1]], humanTeam: 0,
        onLog: () => {},
        onUpdate: (state) => { for (const l of state.log) seen.lines.add(l); },
        humanAnswerer: async (p, s) => wrap(0)(p, s),
        botAnswerer: (p, s) => wrap(1)(p, s),
      });
      const stats = await duel.run();
      if (!duel.over) allOver = false;
      if (!stats || stats.retries !== 0) allRetries0 = false;
    }
    ok(allOver && allRetries0, 'LF2-E0: coverage duels complete with no rejected answers');
    for (const line of seen.lines) {
      if (/^チェーン\d+：《.+》$/.test(line)) seen.chainLine = true;
      if (!bandClasses.test(line)) continue;
      seen.total++;
      for (const n of deckNames) if (line.includes(n) && !covered(line, n)) { seen.bare++; break; }
    }
    console.log('  [info] band lines checked:', seen.total, '| bare-name violations:', seen.bare,
      '| empty-ctx chain prompts:', seen.emptyCtx, '| without trigger:', seen.noTrig, '| kinds:', JSON.stringify(seen.kinds));
    ok(seen.total >= 200 && seen.bare === 0, "LF2-E1: every name in every name-bearing band line is 《》-wrapped (J2' engine side)");
    ok(seen.chainLine, "LF2-E2: chain band lines read チェーンN：《name》 end-to-end (the reported ラビリンス line shape)");
    ok(seen.emptyCtx >= 100 && seen.noTrig === 0, "LF2-E3: 100% of context-free chain windows carry a trigger antecedent (J4')");
    ok((seen.kinds.solved || 0) > 0 && (seen.kinds.phase || 0) > 0, "LF2-E4: the new antecedent kinds (solved / phase) actually occur");
    ok(seen.staleTurn === 0, "LF2-E5: no attached trigger is ever from another turn");
  }

  // ---------------------------------------------------------- the Xyz duel itself
  {
    // The scripted seat from the J1' investigation probe: rush two
    // Level-4 fairies, choose Baromett from the Extra, then answer
    // the material prompts the way the fixed UI does — toggle.
    const { i32resp, cancelResp, cardsResp, cmdResp, placeResp, sortResp, unselectToggleResp, POS, LOC } = Engine;
    const BAROMETT = 62967433, KELDO = 63542003, ZOLGA = 31525442, MUDRA = 99937011, KERBEK = 25926710;
    installSeededCrypto(1 * 2654435761 % 4294967296);
    const main = [];
    for (let i = 0; i < 10; i++) main.push(KELDO, ZOLGA, MUDRA, KERBEK);
    const deck = { name: 'lf2-xyz', main, extra: [BAROMETT], side: [] };
    const unsel = [];
    let baromettOnField = false;
    let prompts = 0;
    const human = (prompt, state) => {
      if (++prompts > 4000) throw new Error('budget');
      switch (prompt.name) {
        case 'SELECT_IDLECMD': {
          const bi = prompt.spsummon.findIndex(e => e.code === BAROMETT);
          if (bi >= 0) return cmdResp(1, bi);
          const myMons = state.players[0].mzone.filter(Boolean).length;
          if (myMons >= 1) {
            const ai = prompt.activate.findIndex(e => (e.code === KELDO || e.code === MUDRA) && e.loc === LOC.HAND);
            if (ai >= 0) return cmdResp(5, ai);
            const zi = prompt.spsummon.findIndex(e => e.code === ZOLGA);
            if (zi >= 0) return cmdResp(1, zi);
          }
          if (prompt.summon.length) return cmdResp(0, 0);
          if (myMons === 0) {
            const ai = prompt.activate.findIndex(e => (e.code === KELDO || e.code === MUDRA) && e.loc === LOC.HAND);
            if (ai >= 0 && state.players[0].hand.length >= 3) return cmdResp(5, ai);
          }
          if (prompt.toEP) return cmdResp(7, 0);
          if (prompt.toBP) return cmdResp(6, 0);
          return cmdResp(7, 0);
        }
        case 'SELECT_BATTLECMD': {
          if (prompt.toEP) return cmdResp(3, 0);
          if (prompt.toM2) return cmdResp(2, 0);
          return cmdResp(3, 0);
        }
        case 'SELECT_CHAIN': return cancelResp();
        case 'SELECT_EFFECTYN': case 'SELECT_YESNO': return i32resp(0);
        case 'SELECT_OPTION': return i32resp(0);
        case 'SELECT_POSITION': return i32resp(POS.FU_ATK);
        case 'SELECT_PLACE': case 'SELECT_DISFIELD': {
          const avail = (~prompt.flag) >>> 0; const zones = [];
          for (const s of [0, 1, 2, 3, 4]) { if (zones.length >= prompt.count) break; if (avail & (1 << s)) zones.push({ con: prompt.player, loc: LOC.MZONE, seq: s }); }
          for (let s = 0; zones.length < prompt.count && s < 5; s++) if (avail & (0x100 << s)) zones.push({ con: prompt.player, loc: LOC.SZONE, seq: s });
          return placeResp(zones.slice(0, prompt.count));
        }
        case 'SELECT_CARD': case 'SELECT_TRIBUTE': {
          if (prompt.cancelable && prompt.min === 0) return cardsResp([]);
          const picks = [];
          const order = prompt.cards.map((c, i) => i).sort((a, b) => {
            const rank = (c) => c.code === KERBEK ? 0 : c.code === ZOLGA ? 1 : 2;
            return rank(prompt.cards[a]) - rank(prompt.cards[b]);
          });
          for (const i of order) { if (picks.length >= Math.max(1, prompt.min)) break; picks.push(i); }
          return cardsResp(picks);
        }
        case 'SELECT_UNSELECT_CARD': {
          unsel.push(prompt);
          if (prompt.unselect.length >= prompt.min && prompt.finishable) return cancelResp();
          if (prompt.select.length) return unselectToggleResp(0);
          return cancelResp();
        }
        case 'SELECT_SUM': {
          const picks = [];
          for (let i = 0; i < prompt.cards.length && picks.length < prompt.min; i++) picks.push(i);
          return cardsResp(picks);
        }
        case 'SORT_CARD': return sortResp(prompt.cards.map((_, i) => i));
        case 'SORT_CHAIN': return cancelResp();
        case 'ROCK_PAPER_SCISSORS': return i32resp(1);
        case 'ANNOUNCE_RACE': case 'ANNOUNCE_ATTRIB': case 'ANNOUNCE_CARD': case 'ANNOUNCE_NUMBER': return i32resp(0);
        case 'SELECT_COUNTER': return Engine.counterResp(prompt.cards.map(() => 0));
        default: return i32resp(0);
      }
    };
    const duel = new Engine.Duel(M, data, {
      seed: 1, pace: { bot: 0, botChain: 0, batch: 0 }, sleep: () => Promise.resolve(),
      deckP0: deck, deckP1: data.decks.gg, humanTeam: 0, onLog: () => {},
      onMessage: (m) => { // raw core message bytes: [62]=SPSUMMONING, code u32 @1, con u8 @5
        if (m && m[0] === 62) { const r = new Engine.Reader(m, 1); const code = r.u32(); const con = r.u8(); if (code === BAROMETT && con === 0) baromettOnField = true; }
      },
      humanAnswerer: async (p, s) => human(p, s),
      botAnswerer: (p, s) => Engine.botAnswer(p, s, data, Engine.makeBotMemory()),
    });
    await duel.run();
    console.log('  [info] unselect prompts:', unsel.map(p => 'fin=' + p.finishable + '/can=' + p.cancelable).join(' '), '| baromett:', baromettOnField);
    ok(unsel.length >= 2 && unsel.every(p => p.finishable === false),
      "LF2-X1: the material choice really is finishable=false at every step (the 決定 button cannot exist — J1' root cause, measured)");
    ok(baromettOnField, 'LF2-X2: toggling through the two prompts completes the Xyz summon (Baromett reaches the field)');
  }

  console.log(failures ? ('\n' + failures + ' FAILURES') : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
