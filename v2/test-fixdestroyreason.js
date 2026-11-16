'use strict';
/* test-fixdestroyreason.js — fix-destroyreason-1117: the destruction
   history line (and its band mirror) names the destroyer when the
   destroyer is mechanically certain — triage-1116-obs3's observation
   that a band of two history lines could not say WHY a card died.
   Same synthetic-GameState shape as test-movereason.js Part B
   (hand-built core messages into GameState.apply).
   Attribution rules pinned here:
   - effect destruction (R10/R24) and negated cards destroyed by
     the negating effect (R1/R2/R4): the destroyer is the card of
     the chain link currently solving (solvingLink > 0). The
     newest-link fallback is NOT an attribution.
   - battle destruction (R7): the destroyer is the other combatant
     — the attacker for the defender's line, the defender for the
     attacker's own line (mutual destruction) — from the ATTACK-time
     snapshot, so the order of the two MOVEs cannot matter.
   - a card destroyed by its own resolving effect is named 自身.
   - rule / lost-target destructions (R8/R9) never name a
     destroyer, even with a link solving: the link is not the cause.
   - when the destroyer is not known (no link solving / no attack
     on record) the wording is byte-identical to before — a reason
     is never guessed.
   The float move notices (fxMoveClsText) and the large destroy
   presentation are deliberately untouched: the history line is
   the durable record this round fixes (see RECORD.md). */
const fs = require('fs');
const path = require('path');
const E = require(path.join(__dirname, 'engine.js'));

let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };
const V2 = __dirname;
const data = JSON.parse(fs.readFileSync(path.join(V2, 'data.json'), 'utf8'));

const MON = (() => { for (const c of data.decks.ishizu.main) if (data.cards[c] && (data.cards[c].type & 1)) return c; })();
const MON2 = (() => { for (const c of data.decks.gg.main) if (data.cards[c] && (data.cards[c].type & 1)) return c; })();
const SPELL = (() => { for (const c of data.decks.ishizu.main) if (data.cards[c] && (data.cards[c].type & 2)) return c; })();
const THUNDER = 12580477; // サンダー・ボルト (GG main x2)
const SOLEMN = 40605147;  // 神の通告
const TRAPHOLE = 29401950; // 奈落の落とし穴
const u32le = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); return b; };
const li = (con, loc, seq, pos) => { const b = new Uint8Array(10); b[0] = con; b[1] = loc; const dv = new DataView(b.buffer); dv.setUint32(2, seq, true); dv.setUint32(6, pos || 0, true); return b; };
const cat = (...ps) => { const out = new Uint8Array(ps.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of ps) { out.set(p, o); o += p.length; } return out; };
const MZ = E.LOC.MZONE, SZ = E.LOC.SZONE, GR = E.LOC.GRAVE, RM = E.LOC.REMOVED;
const move = (code, f, t, reason) => cat(new Uint8Array([50]), u32le(code), li(f[0], f[1], f[2], f[3]), li(t[0], t[1], t[2], t[3]), u32le(reason));
const spsummoning = (code, con, seq) => cat(new Uint8Array([62]), u32le(code), li(con, MZ, seq, 1));
const spsummoned = (code, con, seq) => cat(new Uint8Array([63]), u32le(code), li(con, MZ, seq, 1));
const chaining = (code, con, loc, seq) => cat(new Uint8Array([70]), u32le(code), li(con, loc, seq, 5), new Uint8Array([con]), new Uint8Array([loc]), u32le(seq), new Uint8Array(8), u32le(0));
const solving = (n) => new Uint8Array([72, n]); // CHAIN_SOLVING link n
const attack = (a, t) => cat(new Uint8Array([110]), li(a[0], a[1], a[2], a[3]), li(t[0], t[1], t[2], t[3]));
const fresh = () => { const st = new E.GameState(data); st.events.length = 0; st.dlog.length = 0; st.log.length = 0; return st; };
const dlogHas = (st, sub) => st.dlog.some(e => e.s && e.s.includes(sub));
// The destruction line itself (the only dlog 's' entry in these
// scenarios) must carry no destroyer name at all.
const dlogDestroyLines = (st) => st.dlog.filter(e => e.s && e.s.includes('破壊され'));

ok(data.names[String(THUNDER)] === 'サンダー・ボルト' && data.names[String(SOLEMN)] === '神の通告'
  && data.names[String(TRAPHOLE)] === '奈落の落とし穴', 'D0: destroyer fixtures are the expected cards');

{ // D1: R10 with a solving link names the destroyer (history + band)
  const st = fresh();
  st.apply(chaining(THUNDER, 1, SZ, 1));
  st.apply(solving(1));
  st.apply(move(MON, [0, MZ, 0, 1], [0, GR, 0, 0], 0x41));
  ok(dlogHas(st, '剣神官ムドラ は《サンダー・ボルト》の効果で破壊され、墓地へ送られた'),
    'D1a: R10 history names the solving link as destroyer');
  ok(st.log.some(l => l.includes('《サンダー・ボルト》の効果で破壊され、墓地へ送られた')),
    'D1b: the band mirror carries the destroyer name too');
}
{ // D2: R10 with no link solving keeps the old wording exactly
  const st = fresh();
  st.apply(move(MON, [0, MZ, 0, 1], [0, GR, 0, 0], 0x41));
  ok(dlogHas(st, 'は効果で破壊され、墓地へ送られた'), 'D2a: R10 without a solving link keeps the old wording');
  ok(dlogDestroyLines(st).every(e => !e.s.includes('《')), 'D2b: no destroyer name is guessed');
}
{ // D3/D4: R7 — the attacker's name, and the no-attack fallback
  const st = fresh();
  st.apply(spsummoning(MON2, 1, 0)); st.apply(spsummoned(MON2, 1, 0));
  st.apply(spsummoning(MON, 0, 0)); st.apply(spsummoned(MON, 0, 0));
  st.apply(attack([1, MZ, 0, 1], [0, MZ, 0, 1]));
  st.apply(move(MON, [0, MZ, 0, 1], [0, GR, 0, 0], 0x21));
  ok(dlogHas(st, '剣神官ムドラ は《雷魔神－サンガ》との戦闘で破壊され、墓地へ送られた'),
    'D3: R7 history names the attacker');
  const st2 = fresh();
  st2.apply(move(MON, [0, MZ, 0, 1], [0, GR, 0, 0], 0x21));
  ok(dlogHas(st2, 'は戦闘で破壊され、墓地へ送られた'), 'D4a: R7 without an attack on record keeps the old wording');
  ok(dlogDestroyLines(st2).every(e => !e.s.includes('《')), 'D4b: no destroyer name is guessed');
}
{ // D5: R2 — the negating card is named in the DESTRUCTION clause only
  const st = fresh();
  st.apply(chaining(SPELL, 0, SZ, 1));
  st.apply(chaining(SOLEMN, 1, SZ, 0));
  st.apply(new Uint8Array([75, 1])); // link 1 (the spell) negated
  st.apply(solving(2)); // link 2 (Solemn) solving — it destroys the spell
  st.apply(move(SPELL, [0, SZ, 1, 5], [0, GR, 0, 0], 0x41));
  ok(dlogHas(st, 'の発動が無効化され、《神の通告》の効果で破壊されて墓地へ送られた'),
    'D5a: R2 history names the negating card as the destroyer');
  ok(!dlogHas(st, '《神の通告》の発動が無効化'), 'D5b: the negation itself is not attributed to the destroyer');
  const st2 = fresh(); // no solving link: old wording (cf. test-movereason B6b)
  st2.apply(chaining(SPELL, 0, SZ, 1));
  st2.apply(new Uint8Array([75, 1]));
  st2.apply(move(SPELL, [0, SZ, 1, 5], [0, GR, 0, 0], 0x41));
  ok(dlogHas(st2, 'の発動が無効化され、破壊されて墓地へ送られた'), 'D6: R2 without a solving link keeps the old wording');
}
{ // D7: R1 — negated summon destroyed by the negating card
  const st = fresh();
  st.apply(spsummoning(MON, 1, 2));
  st.apply(chaining(SOLEMN, 0, SZ, 0));
  st.apply(solving(1));
  st.apply(move(MON, [1, MZ, 2, 1], [1, GR, 0, 0], 0x41));
  ok(dlogHas(st, '特殊召喚が無効化され、《神の通告》の効果で破壊されて墓地へ送られた'),
    'D7: R1 history names the negating card as the destroyer');
}
{ // D8: R4 — cross-link: disabled by link 1, destroyed by link 2
  const st = fresh();
  st.apply(chaining(MON, 0, MZ, 0));
  st.apply(new Uint8Array([76, 1])); // link 1 (the monster) disabled
  st.apply(chaining(SOLEMN, 1, SZ, 0));
  st.apply(solving(2)); // link 2 (Solemn) solving — it destroys the monster
  st.apply(move(MON, [0, MZ, 0, 1], [0, GR, 0, 0], 0x41));
  ok(dlogHas(st, 'の効果が無効化され、《神の通告》の効果で破壊されて墓地へ送られた'),
    'D8: R4 history names the destroyer in the destruction clause only');
}
{ // D9: R24 — destroyed and banished
  const st = fresh();
  st.apply(chaining(TRAPHOLE, 1, SZ, 0));
  st.apply(solving(1));
  st.apply(move(MON, [0, MZ, 0, 1], [0, RM, 0, 0], 0x41));
  ok(dlogHas(st, 'は《奈落の落とし穴》の効果で破壊され、除外された（墓地へは送られていない）'),
    'D9: R24 history names the destroyer');
}
{ // D10/D11: redirected destructions (banish forms)
  const st = fresh();
  st.apply(spsummoning(MON2, 1, 0)); st.apply(spsummoned(MON2, 1, 0));
  st.apply(spsummoning(MON, 0, 0)); st.apply(spsummoned(MON, 0, 0));
  st.apply(attack([1, MZ, 0, 1], [0, MZ, 0, 1]));
  st.apply(move(MON, [0, MZ, 0, 1], [0, RM, 0, 0], 0x4000021));
  ok(dlogHas(st, 'は《雷魔神－サンガ》との戦闘で破壊され、墓地へは行かず除外された'),
    'D10: redirected R7 names the attacker');
  const st2 = fresh();
  st2.apply(chaining(THUNDER, 1, SZ, 1));
  st2.apply(solving(1));
  st2.apply(move(MON, [0, MZ, 0, 1], [0, RM, 0, 0], 0x4000041));
  ok(dlogHas(st2, 'は《サンダー・ボルト》の効果で破壊され、墓地へは行かず除外された'),
    'D11: redirected R10 names the destroyer');
}
{ // D12: a card destroyed by its own resolving effect
  const st = fresh();
  st.apply(chaining(MON, 0, MZ, 0));
  st.apply(solving(1));
  st.apply(move(MON, [0, MZ, 0, 1], [0, GR, 0, 0], 0x41));
  ok(dlogHas(st, 'は自身の効果で破壊され、墓地へ送られた'),
    'D12: self-destruction is named 自身, never the card name twice');
}
{ // D13: mutual destruction — the attacker's MOVE arrives FIRST,
  // so the defender's slot is still occupied, but the snapshot
  // must make the order irrelevant either way.
  const st = fresh();
  st.apply(spsummoning(MON2, 1, 0)); st.apply(spsummoned(MON2, 1, 0));
  st.apply(spsummoning(MON, 0, 0)); st.apply(spsummoned(MON, 0, 0));
  st.apply(attack([1, MZ, 0, 1], [0, MZ, 0, 1]));
  st.apply(move(MON2, [1, MZ, 0, 1], [1, GR, 0, 0], 0x21)); // attacker dies first
  st.apply(move(MON, [0, MZ, 0, 1], [0, GR, 0, 0], 0x21));
  ok(dlogHas(st, '雷魔神－サンガ は《剣神官ムドラ》との戦闘で破壊され、墓地へ送られた'),
    'D13a: the attacker\'s own battle-destruction line names the defender');
  ok(dlogHas(st, '剣神官ムドラ は《雷魔神－サンガ》との戦闘で破壊され、墓地へ送られた'),
    'D13b: the defender\'s line names the attacker');
}
{ // D14: R8/R9 never name a destroyer, even with a link solving
  const st = fresh();
  st.apply(chaining(THUNDER, 1, SZ, 1));
  st.apply(solving(1));
  st.apply(move(MON, [0, MZ, 0, 1], [0, GR, 0, 0], 0x241)); // DESTROY|EFFECT|LOST_TARGET
  ok(dlogHas(st, 'は対象を失い、破壊されて墓地へ送られた'), 'D14a: R8 keeps its wording even with a link solving');
  ok(!dlogHas(st, '《サンダー・ボルト》'), 'D14b: R8 names no destroyer — the solving link is not the cause');
  const st2 = fresh();
  st2.apply(chaining(THUNDER, 1, SZ, 1));
  st2.apply(solving(1));
  st2.apply(move(MON, [0, MZ, 0, 1], [0, GR, 0, 0], 0x441)); // DESTROY|EFFECT|RULE
  ok(dlogHas(st2, 'はルール処理で破壊され、墓地へ送られた'), 'D14c: R9 keeps its wording even with a link solving');
  ok(!dlogHas(st2, '《サンダー・ボルト》'), 'D14d: R9 names no destroyer');
}
{ // D15: hand-origin R2 (the inline wording, not _clsGraveVerb)
  const st = fresh();
  st.apply(chaining(SPELL, 0, 2, 0)); // hand-activated spell, link 1
  st.apply(chaining(SOLEMN, 1, SZ, 0));
  st.apply(new Uint8Array([75, 1]));
  st.apply(solving(2));
  st.apply(move(SPELL, [0, 2, 0, 0], [0, GR, 0, 0], 0x41));
  ok(dlogHas(st, 'の発動が無効化され、《神の通告》の効果で破壊されて墓地へ送られた（手札から発動）'),
    'D15: hand-origin R2 names the destroyer too');
}

console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURES');
process.exit(failures === 0 ? 0 : 1);
