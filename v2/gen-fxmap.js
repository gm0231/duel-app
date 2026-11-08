'use strict';
/* gen-fxmap.js — derive the desc-index -> printed-effect-number map
   for the which-effect identification (client.js: resolveEffect).
   Run manually when data.json changes; writes fxmap.json, which the
   client fetches at boot next to data.json.

   Why this exists: the core names the effect behind an activatable
   entry / yes-no question ONLY by its description string id
   (aux.Stringid(code, idx) = code<<20 | idx). idx is per-script and
   does NOT always equal (printed number - 1): scripts register one
   description per activatable effect but printed continuous effects
   carry none, so e.g. Gravekeeper's Trap idx 0 is printed ②.

   Derivation rules (each audited against the bundled Lua source and
   the official text — the audit trail is in NOTES.md):
   - "id": the mechanical identity. Granted only when the described
     activatable blocks (SetDescription + SetTarget/SetOperation/
     SetCost in the effect block) form the gapless prefix 0..k-1 AND
     k equals the number of circled effects in the official text —
     i.e. every printed effect is activatable and described, in
     order. Live-verified: 1330 entries, 0 mismatches.
   - "map": hand-audited overrides where printed continuous effects
     own no description (Trap, Luce, Labyrinth Wall Shadow) or the
     described indices otherwise skip/shift (pool-coverage round:
     Trilosukta, Horus, Pluto, Heavy Magical Tank, Corolla,
     both Vernusylph, Chaos Hunter, Marshmacaron... see OVERRIDES).
   - "pmap": the SAME desc idx names different printed effects in
     different prompt scopes (Masterflare Hyperion registers idx 0
     twice: its IGNITION copy effect — only ever an idle/battle
     command entry — and its EVENT_CHAINING quick effect — only
     ever a chain candidate). Scope is decided by the effect TYPE,
     which the script fixes, so the split is mechanical once
     audited.
   - "yn": a plain SELECT_YESNO whose desc is Stringid(code, idx)
     is the optional follow-up clause inside printed effect n's
     resolution (the script calls Duel.SelectYesNo with that idx
     in exactly one operation — that operation's effect). Granted
     per card by hand audit (Minerva, Heavy Magical Tank, Agido).
   - "bare": a card whose activatable effects own NO description
     at all can still be pinned when, for a given prompt scope and
     entry location, the script leaves exactly ONE activatable
     effect (Minerva's MZONE ignition, Pluto's GRAVE ignition,
     Zorga's HAND ignition / GRAVE trigger). loc is the engine LOC
     bit (HAND 2, MZONE 4, GRAVE 16); scope is "idle" (IDLECMD /
     BATTLECMD entries) or "chain" (SELECT_CHAIN candidates).
   - everything else is ABSENT from fxmap.json: the client shows
     the full text with no effect number rather than risk a wrong
     one (undescribed multi-scope effects, unnumbered old texts).
   "n" = how many DISTINCT described activatable indices the card
   has — a yes/no whose desc index equals n is the optional
   follow-up question inside the resolving effect.

   Described-block derivation also sees effects registered through
   helpers, not only literal Effect.CreateEffect blocks:
   - Vernusylph.AddSpSummonEffect(c, id, k, ...) creates the hand
     ignition WITH SetDescription(aux.Stringid(id, k)) (proven in
     cards_specific_functions.lua: CreateSpSummonEffect).
   - an effect variable assigned from Fusion.CreateSummonEff(...)
     takes its SetDescription from the following e:SetDescription
     line; the helper's product is the card activation itself.
   Any other SetDescription(aux.Stringid(id, k)) the derivation
   cannot account for is reported as UNACCOUNTED so a human looks
   (test-poolcov.js fails on unaccounted indices).            */
const fs = require('fs');
const path = require('path');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));

const MARKS = '①②③④⑤⑥⑦⑧⑨';
function circledCount(code) {
  const t = (data.texts[code] || {}).text || '';
  return (t.match(/[①②③④⑤⑥⑦⑧⑨]：/g) || []).length;
}
function describedBlocks(code) {
  const src = data.scripts['c' + code + '.lua'];
  if (!src) return null;
  const out = new Set();
  const starts = [...src.matchAll(/Effect\.CreateEffect/g)].map(m => m.index);
  starts.forEach((s, i) => {
    const b = src.slice(s, i + 1 < starts.length ? starts[i + 1] : src.length);
    const sid = b.match(/SetDescription\(\s*aux\.Stringid\(id,(\d+)\)/);
    if (!sid) return;
    if (!/(SetTarget\(|SetOperation\(|SetCost\()/.test(b)) return;
    out.add(+sid[1]);
  });
  // Helper-registered descriptions (see header).
  for (const m of src.matchAll(/Vernusylph\.AddSpSummonEffect\(\s*c\s*,\s*id\s*,\s*(\d+)/g)) out.add(+m[1]);
  for (const m of src.matchAll(/local\s+(\w+)\s*=\s*Fusion\.CreateSummonEff/g)) {
    const re = new RegExp(m[1] + ':SetDescription\\(\\s*aux\\.Stringid\\(id,(\\d+)\\)');
    const sid = src.match(re);
    if (sid) out.add(+sid[1]);
  }
  return out;
}
// Every SetDescription idx the script mentions (for the
// UNACCOUNTED report): an idx the derivation did not capture is
// either a non-activatable description (summon procedure,
// continuous hint) or a derivation gap a human must close.
function allDescIdxs(code) {
  const src = data.scripts['c' + code + '.lua'];
  if (!src) return new Set();
  return new Set([...src.matchAll(/SetDescription\(\s*aux\.Stringid\(id,(\d+)\)/g)].map(m => +m[1]));
}
// Hand-audited overrides: script idx -> printed circled number.
// 墓守の罠: ① is continuous (no desc); idx0=QUICK_O search=②, idx1=TRIGGER_F declare=③.
// 宵闇のルーチェ: ① is continuous (no desc); idx0=IGNITION=②, idx1=TRIGGER_O=③.
// ラビリンス・ウォール・シャドウ: ① is continuous; idx0=IGNITION place=②, idx1=TRIGGER_O destroy=③.
// マナドゥム・トリロスークタ: idx0=SPSUMMON trigger=①, idx1=IGNITION=② (idx2 is the
//   EX-summon restriction FIELD effect — part of ②'s own text, never an entry).
// メタファイズ・ホルス・ドラゴン: idx0/1/2 are the three material variants of the
//   single printed ① (immunity / negate / control), all SPSUMMON_SUCCESS triggers.
// 冥府の執行者 プルート: idx1=IGNITION (book-of-moon)=①; idx0 does not exist and
//   ② (GY ignition) owns no description (see BARE).
// 迷宮の重魔戦車: idx1=IGNITION=③ (①② are a summon procedure and a continuous
//   attack lock; the procedure's own idx0 description is not an activation).
// 春化精の花冠: idx0=FIELD replacement effect=② (① is the continuous typing).
// 森と目覚の春化精: idx0=MZONE IGNITION (ATK double)=②, idx1=hand ignition via
//   Vernusylph.AddSpSummonEffect(c,id,1)=①.
// 花と野原の春化精: idx0=hand ignition via Vernusylph.AddSpSummonEffect(c,id,0)=①
//   (its only described effect; ② is an undescribed continuous).
// 丘と芽吹の春化精: idx0=hand ignition via Vernusylph.AddSpSummonEffect(c,id,0)=①
//   (its only described effect; ② is an undescribed continuous — the
//   Vernusylph monsters' effect-destruction protection). Joined the
//   pool with the v11 recipe swap (2026-11-03); note its code is ALSO
//   the Vernusylph helper's shared string base (see client.js
//   foreignFollowFx).
// カオスハンター: idx0=EVENT_SPSUMMON trigger (hand special summon)=① (①'s
//   remaining blocks are the continuous ②, undescribed).
// 沼地の魔道王: idx0=HAND IGNITION=① (idx1 is the SINGLE name-substitute
//   continuous inside ①'s own text — never a prompt, left unmapped).
const OVERRIDES = {
  98715423: { 0: 2, 1: 3 },
  45409943: { 0: 2, 1: 3 },
  34771947: { 0: 2, 1: 3 },
  21368273: { 0: 1, 1: 2 },
  36898537: { 0: 1, 1: 1, 2: 1 },
  37706769: { 1: 1 },
  35026117: { 1: 3 },
  14108995: { 0: 2 },
  36745317: { 0: 2, 1: 1 },
  62133026: { 0: 1 },
  9350312: { 0: 1 },
  97940434: { 0: 1 },
  45223540: { 0: 1 },
  // Super Quant deck additions (2026-11-08), each hand-audited
  // against the bundled script's registration order:
  // 超量機獣グランパルス／エアロボロス／マグナライガー／ラスターレックス:
  //   printed ① is the continuous no-material attack lock (no desc);
  //   idx0=detach effect=②, idx1=attach ignition=③ (the idx0 effect's
  //   quick clone shares the same description — same printed effect).
  85252081: { 0: 2, 1: 3 },
  11646785: { 0: 2, 1: 3 },
  57031794: { 0: 2, 1: 3 },
  57450198: { 0: 2, 1: 3 },
  // エクシーズ・アーマー・フォートレス: idx1=detach-search IGNITION=①
  //   (② is the undescribed equip continuous; the alternative Xyz
  //   procedure owns no description).
  20145685: { 1: 1 },
  // FA－ダーク・ナイト・ランサー: ① is the continuous ATK gain;
  //   idx1=GY recovery=②, idx2=equip trigger=③.
  67630394: { 1: 2, 2: 3 },
  // 超量機神剣－マグナスレイヤー: idx0=attack-declaration effect=②
  //   (①③ are undescribed equip continuous effects).
  47819246: { 0: 2 },
  // 超量合神－マグナフォーメーション: idx0=battle-destruction
  //   trigger=② (① is the undescribed continuous ATK boost).
  1825445: { 0: 2 },
  // ヴィンゴルヴの祝福: idx0=the activation itself=① (its optional
  //   send is part of the activation), idx1=GY trigger=③ (② is the
  //   undescribed continuous ATK boost).
  75493362: { 0: 1, 1: 3 },
  // アーマード・エクシーズ: idx0=the spell activation=①; idx1=the
  //   second-attack trigger the activation GRANTS to the equipped
  //   Xyz monster — a clause of the same printed ①.
  73046708: { 0: 1, 1: 1 },
  // 超量士レッドレイヤー: idx0 is the self-summon procedure (see
  //   KNOWN_NON_ACTIVATABLE); idx1=summon trigger=②, idx2=to-GY
  //   trigger=③.
  59975920: { 1: 2, 2: 3 },
  // 超量機神王グレート・マグナス: registration order is SWAPPED vs
  //   print — idx0=EVENT_TO_GRAVE revival=②, idx1=QUICK_O detach
  //   bounce, which lives inside printed ① (the 2+-materials bullet).
  84025439: { 0: 2, 1: 1 },
};
// Prompt-scoped maps (see header): desc idx -> {idle, chain}.
// マスターフレア・ヒュペリオン: idx0 is registered by BOTH its IGNITION
// copy effect (idle entries only) and its QUICK_O EVENT_CHAINING
// effect (chain candidates only) — the types never cross scopes.
const PMAP = {
  63101468: { 0: { idle: 1, chain: 2 } },
};
// Plain-YESNO follow-up overrides (see header): desc idx -> the
// printed effect whose optional clause the question asks about.
// ミネルバ: SelectYesNo Stringid(id,0) sits in ②'s operation (the
//   optional destruction after the mill) — her ONLY SelectYesNo.
// 重魔戦車: SelectYesNo Stringid(id,2) sits in ③'s operation (the
//   optional destruction when a Labyrinth Wall card is present).
// (古衛兵アギド's yn {3:2} left the table with the card itself in
//   the v11 recipe swap; the classic 《アギド》 that replaced it has
//   an unnumbered text, so its resolution yes/no stays unpinned and
//   shows the full text, like the other unnumbered cards.)
const YN = {
  30100551: { 0: 2 },
  35026117: { 2: 3 },
};
// Desc-less entry pinning (see header): {loc, scope, n}.
// ミネルバ: her only IGNITION is ① (MZONE); her only chain-scope
//   activatable is ②, whose link forms in the GRAVE once she is
//   destroyed (live-verified prompt shape, see NOTES).
// プルート: his only GRAVE-ranged activatable effect is ②.
// ゾルガ: her only HAND activatable is ① (hand ignition); her only
//   GRAVE chain-scope activatable is ② (attack-announce trigger).
const BARE = {
  30100551: [{ loc: 4, scope: 'idle', n: 1 }, { loc: 16, scope: 'chain', n: 2 }],
  37706769: [{ loc: 16, scope: 'idle', n: 2 }],
  31525442: [{ loc: 2, scope: 'idle', n: 1 }, { loc: 16, scope: 'chain', n: 2 }],
};
// SetDescription indices that are described but knowingly NOT
// activatable indices (excluded from the UNACCOUNTED alarm):
// 重魔戦車 idx0 = its no-tribute summon procedure's description.
// カルダーン idx2 = the description of the EFFECT_TRAP_ACT_IN_SET_TURN
// grant its ① operation registers on the trap it sets — a client
// hint for the SET card, never a prompt desc of Kaldan itself.
const KNOWN_NON_ACTIVATABLE = {
  35026117: [0], 86605515: [2],
  // Super Quant deck additions (2026-11-08):
  // タイフーン idx0 = the description of its EFFECT_TRAP_ACT_IN_HAND
  //   grant (the hand-activation permission); the activation itself
  //   follows the no-description convention and stays unnumbered.
  14883228: [0],
  // 超量士レッドレイヤー idx0 = its self-summon procedure's
  //   description (a procedure, never an activation prompt).
  59975920: [0],
  // 第１９層 idx4 = the description of the EFFECT_TRAP_ACT_IN_SET_TURN
  //   grant its ① resolution registers on the trap it sets (same
  //   shape as カルダーン idx2) — a hint for the SET card, never a
  //   prompt desc of this card itself.
  98349765: [4],
};

const out = {};
const report = [];
for (const code of Object.keys(data.cards)) {
  const set = describedBlocks(code);
  const described = set || new Set();
  // UNACCOUNTED: SetDescription indices the derivation did not see
  // (checked for every card, entry or not).
  const known = new Set(KNOWN_NON_ACTIVATABLE[code] || []);
  for (const i of allDescIdxs(code)) {
    if (!described.has(i) && !known.has(i)) {
      report.push('UNACCOUNTED ' + code + ' ' + data.names[code] + ': SetDescription idx ' + i + ' not in the derived activatable set');
    }
  }
  const extra = PMAP[code] || YN[code] || BARE[code];
  if (described.size === 0 && !extra) continue;
  const idxs = [...described].sort((a, b) => a - b);
  const gapless = idxs.every((v, i) => v === i);
  const entry = { n: described.size };
  if (OVERRIDES[code]) {
    entry.map = OVERRIDES[code];
    report.push(code + ' ' + data.names[code] + ': override ' + JSON.stringify(OVERRIDES[code]));
  } else if (described.size && gapless && idxs.length === circledCount(code)) {
    entry.id = 1;
    report.push(code + ' ' + data.names[code] + ': identity (k=' + idxs.length + ')');
  } else if (described.size) {
    report.push(code + ' ' + data.names[code] + ': NO NUMBERING (idxs=' + idxs.join(',') + ', circled=' + circledCount(code) + ')');
  }
  if (PMAP[code]) { entry.pmap = PMAP[code]; report.push(code + ' ' + data.names[code] + ': pmap ' + JSON.stringify(PMAP[code])); }
  if (YN[code]) { entry.yn = YN[code]; report.push(code + ' ' + data.names[code] + ': yn ' + JSON.stringify(YN[code])); }
  if (BARE[code]) { entry.bare = BARE[code]; report.push(code + ' ' + data.names[code] + ': bare ' + JSON.stringify(BARE[code])); }
  out[code] = entry;
}
fs.writeFileSync(path.join(__dirname, 'fxmap.json'), JSON.stringify(out, null, 1));
console.log(report.join('\n'));
console.log('fxmap entries:', Object.keys(out).length);
