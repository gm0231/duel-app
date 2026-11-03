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
     own no description (Trap, Luce, Labyrinth Wall Shadow).
   - everything else is ABSENT from fxmap.json: the client shows the
     full text with no effect number rather than risk a wrong one
     (collisions: Metaphys Horus, Pluto, Hyperion, Trilosukta, Heavy
     Magical Tank; undescribed effects: Minerva, Zorga, ...).
   "n" = how many DISTINCT described activatable indices the card
   has — a yes/no whose desc index equals n is the optional
   follow-up question inside the resolving effect.               */
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
  const starts = [...src.matchAll(/Effect\.CreateEffect/g)].map(m => m.index);
  const out = new Set();
  starts.forEach((s, i) => {
    const b = src.slice(s, i + 1 < starts.length ? starts[i + 1] : src.length);
    const sid = b.match(/SetDescription\(\s*aux\.Stringid\(id,(\d+)\)/);
    if (!sid) return;
    if (!/(SetTarget\(|SetOperation\(|SetCost\()/.test(b)) return;
    out.add(+sid[1]);
  });
  return out;
}
// Hand-audited overrides: script idx -> printed circled number.
// 墓守の罠: ① is continuous (no desc); idx0=QUICK_O search=②, idx1=TRIGGER_F declare=③.
// 宵闇のルーチェ: ① is continuous (no desc); idx0=IGNITION=②, idx1=TRIGGER_O=③.
// ラビリンス・ウォール・シャドウ: ① is continuous; idx0=IGNITION place=②, idx1=TRIGGER_O destroy=③.
const OVERRIDES = {
  98715423: { 0: 2, 1: 3 },
  45409943: { 0: 2, 1: 3 },
  34771947: { 0: 2, 1: 3 },
};

const out = {};
const report = [];
for (const code of Object.keys(data.cards)) {
  const set = describedBlocks(code);
  if (!set || set.size === 0) continue;
  const idxs = [...set].sort((a, b) => a - b);
  const gapless = idxs.every((v, i) => v === i);
  const entry = { n: set.size };
  if (OVERRIDES[code]) {
    entry.map = OVERRIDES[code];
    report.push(code + ' ' + data.names[code] + ': override ' + JSON.stringify(OVERRIDES[code]));
  } else if (gapless && idxs.length === circledCount(code)) {
    entry.id = 1;
    report.push(code + ' ' + data.names[code] + ': identity (k=' + idxs.length + ')');
  } else {
    report.push(code + ' ' + data.names[code] + ': NO NUMBERING (idxs=' + idxs.join(',') + ', circled=' + circledCount(code) + ')');
  }
  out[code] = entry;
}
fs.writeFileSync(path.join(__dirname, 'fxmap.json'), JSON.stringify(out, null, 1));
console.log(report.join('\n'));
console.log('fxmap entries:', Object.keys(out).length);
