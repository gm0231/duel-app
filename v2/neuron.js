'use strict';
/* neuron.js — Neuron deck import (Phase 1) + Genesis validator.
Pure logic, no DOM of its own: the HTML path receives a Document
built by the caller (DOMParser in the browser, jsdom in tests),
everything else is string work. Data comes from genesys-data.json
(bundled; built by tools-neuron/gen-genesys-data.py — official
GENESYS point list 202610, BabelCDB alias/type data, YGOPRODeck
release dates, ygo.sqlite cid map). See NOTES.md "Neuron import
Phase 1" for the dataset's provenance and known limits.

Import paths (Phase 0 verdict: the app can NEVER fetch the
official DB itself — CORS blocks it, verified in a real browser):
the user brings the data. Accepted inputs:
- the official deck page's HTML (text view, whole-page copy)
- a.ydk / passcode list (with or without #main/#extra/!side)
- a YDKE URL (ydke://...)
- a card-name list (名前 ×n lines)
Validation is the OCG GENESYS rules of the bundled list edition:
points (main+extra+side <= cap), same-name max 3, no Link /
Pendulum, deck sizes (main 40-60, extra 0-15, side 0-15), and the
list's release cutoff. Pool support (can this build actually run
the deck?) is a SEPARATE check with separate wording — a deck can
be Genesis-legal and still unplayable here until Phase 3. */
const NeuronLib = (() => {
const STORAGE_KEY = 'v2saveddecks';
let GD = null; // raw genesys-data.json
let points = new Map(), names = new Map(), alias = new Map(), cidMap = new Map();
let lpSet = new Set(), exSet = new Set(), lateSet = new Set(), ngSet = new Set();
let nameIndex = new Map(); // normalized Japanese name -> representative passcode

function normName(s) {
return String(s || '')
.replace(/[Ａ-Ｚａ-ｚ０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
.replace(/\s+/g, '')
.toLowerCase();
}
function setData(gd) {
if (!gd || typeof gd!== 'object' ||!gd.points ||!gd.names ||!gd.cid) return false;
GD = gd;
points = new Map(Object.entries(gd.points).map(([k, v]) => [+k, v]));
names = new Map(Object.entries(gd.names).map(([k, v]) => [+k, v]));
alias = new Map(Object.entries(gd.alias || {}).map(([k, v]) => [+k, +v]));
cidMap = new Map(Object.entries(gd.cid).map(([k, v]) => [+k, +v]));
lpSet = new Set(gd.lp || []); exSet = new Set(gd.ex || []);
lateSet = new Set(gd.late || []); ngSet = new Set(gd.ng || []);
nameIndex = new Map();
for (const [code, nm] of names) {
const key = normName(nm);
if (key &&!nameIndex.has(key)) nameIndex.set(key, code);
}
return true;
}
function dataReady() { return!!GD;}
// Pool display names (the app's own data.json) take precedence in
// the name index: their spellings are the ones the app shows.
function addPoolNames(poolNames) {
if (!poolNames) return;
for (const [code, nm] of Object.entries(poolNames)) {
const key = normName(nm);
if (key) nameIndex.set(key, normalizeCode(+code));
}
}
function normalizeCode(code) {
code = +code;
return alias.has(code)? alias.get(code): code;
}
function knownCode(rep) {
return names.has(rep) || points.has(rep) || lpSet.has(rep) || exSet.has(rep) || lateSet.has(rep) || ngSet.has(rep);
}
function displayName(rep, snapshot) {
if (snapshot && snapshot[rep]) return snapshot[rep];
return names.get(rep) || ('#' + rep);
}

// ------------------------------------------------------------ HTML
// Official deck page (text view). Each list table holds one row
// per distinct card: a hidden input.link_value carrying the card's
// cid, the display name in td.card_name, the copy count in td.num.
const HTML_SECTIONS = [['monster_list', 'main'], ['spell_list', 'main'], ['trap_list', 'main'], ['extra_list', 'extra'], ['side_list', 'side']];
function parseHtmlDeck(doc) {
const deck = { name: null, main: [], extra: [], side: [], names: {}};
const unknown = [];
let rows = 0;
for (const [tid, sec] of HTML_SECTIONS) {
const table = doc.getElementById? doc.getElementById(tid): null;
if (!table) continue;
for (const tr of table.querySelectorAll('tr')) {
const lv = tr.querySelector('input.link_value');
if (!lv) continue;
const m = /cid=(\d+)/.exec(lv.getAttribute('value') || '');
if (!m) continue;
rows++;
const nameSpan = tr.querySelector('td.card_name .icon > span') || tr.querySelector('td.card_name span');
let nm = nameSpan? nameSpan.textContent.trim(): '';
if (!nm) nm = (tr.getAttribute('title') || '').replace(/^【[^】]*】\s*/, '').trim();
const numEl = tr.querySelector('td.num span') || tr.querySelector('td.num');
const cnt = Math.max(1, parseInt(numEl? numEl.textContent: '1', 10) || 1);
const raw = cidMap.get(+m[1]);
if (raw == null) { unknown.push(nm || ('cid ' + m[1])); continue;}
const rep = normalizeCode(raw);
if (nm &&!deck.names[rep]) deck.names[rep] = nm;
for (let i = 0; i < cnt; i++) deck[sec].push(rep);
}
}
const og = doc.querySelector? doc.querySelector('meta[property="og:title"]'): null;
if (og) {
const t = (og.getAttribute('content') || '').split('|')[0].trim();
if (t) deck.name = t;
}
return { deck, rows, unknown};
}

// ------------------------------------------------------------ text formats
const SECTION_RES = [
[/^#\s*main/i, 'main'], [/^#\s*extra/i, 'extra'], [/^!\s*side/i, 'side'],
[/^(メインデッキ|メイン)\s*[：:]?\s*(\d+\s*枚)?\s*$/, 'main'],
[/^(エクストラデッキ|エクストラ|ＥＸデッキ)\s*[：:]?\s*(\d+\s*枚)?\s*$/, 'extra'],
[/^(サイドデッキ|サイド)\s*[：:]?\s*(\d+\s*枚)?\s*$/, 'side'],
];
function sectionOf(line) {
for (const [re, sec] of SECTION_RES) if (re.test(line)) return sec;
return null;
}
function splitByType(deck, loose) {
// no section markers: Extra-Deck monster kinds go to the Extra
// Deck, everything else to the Main Deck.
for (const rep of loose) (exSet.has(rep)? deck.extra: deck.main).push(rep);
}
function finishCodeDeck(deck, loose, unknownCodes) {
if (loose.length) splitByType(deck, loose);
if (unknownCodes.length) return { ok: false, errors: ['データに無いカードが含まれています：' + unknownCodes.map(c => '#' + c).join('、')], unknownCodes};
if (!deck.main.length &&!deck.extra.length &&!deck.side.length) return { ok: false, errors: ['カードが読み取れませんでした']};
return { ok: true, deck};
}
function parseCodeList(text) {
const deck = { name: null, main: [], extra: [], side: [], names: {}};
const loose = [], unknownCodes = [];
let sec = null;
for (const rawLine of String(text).split(/\r?\n/)) {
const line = rawLine.trim();
if (!line) continue;
const s = sectionOf(line);
if (s) { sec = s; continue;}
if (/^#/.test(line)) continue; // ydk comments (#created by...)
const nums = line.match(/\d+/g); // passcodes run 1-8 digits (e.g. 2511); longer digit runs are not codes
if (!nums) continue;
for (const n of nums) {
if (n.length > 8) continue;
const rep = normalizeCode(+n);
if (!knownCode(rep)) { unknownCodes.push(+n); continue;}
if (!deck.names[rep]) deck.names[rep] = displayName(rep);
(sec? deck[sec]: loose).push(rep);
}
}
return finishCodeDeck(deck, loose, unknownCodes);
}
function parseYdke(text) {
const m = /ydke:\/\/([^!\s]+)!([^!\s]*)!([^!\s]*)/.exec(text);
if (!m) return { ok: false, errors: ['YDKEの形式が読み取れませんでした']};
const deck = { name: null, main: [], extra: [], side: [], names: {}};
const unknownCodes = [];
const secs = ['main', 'extra', 'side'];
for (let gi = 0; gi < 3; gi++) {
let b64 = m[gi + 1].replace(/-/g, '+').replace(/_/g, '/');
while (b64.length % 4) b64 += '=';
let bin;
try { bin = atob(b64);} catch (e) { return { ok: false, errors: ['YDKEの形式が読み取れませんでした']};}
for (let i = 0; i + 4 <= bin.length; i += 4) {
const code = (bin.charCodeAt(i) | (bin.charCodeAt(i + 1) << 8) | (bin.charCodeAt(i + 2) << 16) | (bin.charCodeAt(i + 3) << 24)) >>> 0;
const rep = normalizeCode(code);
if (!knownCode(rep)) { unknownCodes.push(code); continue;}
if (!deck.names[rep]) deck.names[rep] = displayName(rep);
deck[secs[gi]].push(rep);
}
}
if (unknownCodes.length) return { ok: false, errors: ['データに無いカードが含まれています：' + unknownCodes.map(c => '#' + c).join('、')], unknownCodes};
if (!deck.main.length) return { ok: false, errors: ['カードが読み取れませんでした']};
return { ok: true, deck};
}
function parseNameList(text) {
const deck = { name: null, main: [], extra: [], side: [], names: {}};
const loose = [], unknownNames = [];
let sec = null;
for (const rawLine of String(text).split(/\r?\n/)) {
let line = rawLine.trim();
if (!line) continue;
line = line.replace(/^[■●◆※]\s*/, '');
const s = sectionOf(line);
if (s) { sec = s; continue;}
line = line.replace(/^[-・*>\s]+/, '').replace(/^\d+\s*[.、)]\s*/, '');
let count = 1;
const cm = /(?:[×xX*]\s*(\d+)|(\d+)\s*枚)\s*$/.exec(line) || /\s(\d+)\s*$/.exec(line);
if (cm) { count = Math.max(1, parseInt(cm[1] || cm[2], 10) || 1); line = line.slice(0, cm.index).trim();}
if (!line) continue;
const rep = nameIndex.get(normName(line));
if (rep == null) { unknownNames.push(line); continue;}
if (!deck.names[rep]) deck.names[rep] = line;
for (let i = 0; i < count; i++) (sec? deck[sec]: loose).push(rep);
}
if (loose.length) splitByType(deck, loose);
if (unknownNames.length) return { ok: false, errors: ['読み取れなかったカード名があります：' + unknownNames.join('、')], unknownNames};
if (!deck.main.length &&!deck.extra.length &&!deck.side.length) return { ok: false, errors: ['カードが読み取れませんでした']};
return { ok: true, deck};
}
function looksLikeCodeList(text) {
const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
if (!lines.length) return false;
let coded = 0;
for (const l of lines) {
if (sectionOf(l) || /^#/.test(l) || /^[\d\s,、]+$/.test(l)) coded++;
}
return coded === lines.length;
}
// parseImport(text, parseHtml) — parseHtml: (htmlString) => Document
function parseImport(text, parseHtml) {
text = String(text || '');
if (!text.trim()) return { ok: false, errors: ['何も貼り付けられていません']};
if (!GD) return { ok: false, errors: ['カードデータ（genesys-data.json）が読み込めていません']};
if (/ydke:\/\//.test(text)) return Object.assign(parseYdke(text), { format: 'ydke'});
if (text.includes('link_value') && text.includes('cid=')) {
if (typeof parseHtml!== 'function') return { ok: false, errors: ['HTMLの解析ができませんでした']};
const doc = parseHtml(text);
const { deck, rows, unknown} = parseHtmlDeck(doc);
if (!rows) return { ok: false, errors: ['デッキのカード行が見つかりませんでした。公式デッキページで「テキスト表示」を選んで、ページ全体をコピーしてください'], format: 'html'};
if (unknown.length) return { ok: false, errors: ['データに無いカードが含まれています：' + unknown.join('、')], format: 'html'};
return { ok: true, deck, format: 'html'};
}
if (looksLikeCodeList(text)) return Object.assign(parseCodeList(text), { format: 'codes'});
return Object.assign(parseNameList(text), { format: 'names'});
}

// ------------------------------------------------------------ Genesis validator
function countGroups(deck) {
// same-name groups: merge by representative AND by identical
// display name (variant printings under separate representatives
// still count together). "Treated as another name" cards are a
// documented gap (NOTES).
const parent = new Map();
const find = (x) => { while (parent.get(x)!== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x);} return x;};
const reps = new Set([...deck.main,...deck.extra,...deck.side]);
for (const r of reps) parent.set(r, r);
const byName = new Map();
for (const r of reps) {
const nm = displayName(r, deck.names);
if (byName.has(nm)) { const a = find(r), b = find(byName.get(nm)); if (a!== b) parent.set(a, b);}
else byName.set(nm, r);
}
const groups = new Map();
for (const sec of ['main', 'extra', 'side']) for (const r of deck[sec]) {
const g = find(r);
if (!groups.has(g)) groups.set(g, { rep: r, name: displayName(r, deck.names), count: 0});
groups.get(g).count++;
}
return [...groups.values()];
}
function validateGenesis(deck) {
const cap = GD? GD.cap: 100;
const violations = [];
const ptLines = [];
let totalPt = 0;
const ptCount = new Map();
for (const sec of ['main', 'extra', 'side']) for (const r of deck[sec]) {
const pt = points.get(r) || 0;
if (pt > 0) { ptCount.set(r, (ptCount.get(r) || 0) + 1); totalPt += pt;}
}
for (const [r, n] of ptCount) ptLines.push({ rep: r, name: displayName(r, deck.names), pt: points.get(r), count: n, sub: points.get(r) * n});
ptLines.sort((a, b) => b.sub - a.sub);
if (deck.main.length < 40 || deck.main.length > 60)
violations.push({ kind: 'count', text: 'メインデッキが' + deck.main.length + '枚です（40〜60枚にしてください）'});
if (deck.extra.length > 15)
violations.push({ kind: 'count', text: 'エクストラデッキが' + deck.extra.length + '枚です（15枚まで）'});
if (deck.side.length > 15)
violations.push({ kind: 'count', text: 'サイドデッキが' + deck.side.length + '枚です（15枚まで）'});
if (totalPt > cap)
violations.push({ kind: 'points', text: 'ポイント合計が' + totalPt + 'ptで、上限の' + cap + 'ptを' + (totalPt - cap) + 'pt超えています', items: ptLines.map(l => l.name + '（' + l.pt + 'pt）×' + l.count + '＝' + l.sub + 'pt')});
for (const g of countGroups(deck))
if (g.count > 3) violations.push({ kind: 'copies', text: '「' + g.name + '」が' + g.count + '枚入っています（同名カードはメイン・EX・サイド合計で3枚まで）'});
const lpNames = [...new Set([...deck.main,...deck.extra,...deck.side].filter(r => lpSet.has(r)).map(r => displayName(r, deck.names)))];
if (lpNames.length) violations.push({ kind: 'lp', text: 'リンク／ペンデュラムモンスターは使えません', items: lpNames});
const lateNames = [...new Set([...deck.main,...deck.extra,...deck.side].filter(r => lateSet.has(r)).map(r => displayName(r, deck.names)))];
if (lateNames.length) violations.push({ kind: 'cutoff', text: (GD.cutoff || '') + '以降に発売されたカードは使えません（ポイントリスト' + (GD.listVersion || '') + '）', items: lateNames});
const ngNames = [...new Set([...deck.main,...deck.extra,...deck.side].filter(r => ngSet.has(r)).map(r => displayName(r, deck.names)))];
if (ngNames.length) violations.push({ kind: 'ng', text: '公式のデュエルでは使用できないカードが含まれています', items: ngNames});
return { ok: violations.length === 0, totalPt, ptLines, violations};
}
// Pool support is separate from Genesis legality: only main+extra
// enter a duel (the app has no side deck), so only they gate play.
function poolCheck(deck, poolCodes) {
const unsupported = [];
const seen = new Set();
for (const r of [...deck.main,...deck.extra]) {
if (!poolCodes.has(r) &&!seen.has(r)) { seen.add(r); unsupported.push({ rep: r, name: displayName(r, deck.names)});}
}
return { ok: unsupported.length === 0, unsupported};
}

// ------------------------------------------------------------ storage
function loadSavedDecks(storage) {
try {
const raw = storage.getItem(STORAGE_KEY);
const arr = raw? JSON.parse(raw): [];
return Array.isArray(arr)? arr.filter(d => d && d.id && Array.isArray(d.main) && Array.isArray(d.extra)): [];
} catch (e) { return [];}
}
function storeSavedDecks(storage, list) {
try { storage.setItem(STORAGE_KEY, JSON.stringify(list)); return true;} catch (e) { return false;}
}
function makeRecord(deck, validation, pool, now) {
return {
id: 'sv' + (now || Date.now()),
name: deck.name,
main: deck.main.slice(), extra: deck.extra.slice(), side: deck.side.slice(),
names: Object.assign({}, deck.names),
pt: validation.totalPt,
poolOk: pool.ok,
unsupported: pool.unsupported.map(u => u.name),
savedAt: new Date(now || Date.now()).toISOString(),
};
}
return {
STORAGE_KEY, setData, dataReady, addPoolNames, normalizeCode, knownCode, displayName,
parseImport, parseHtmlDeck, validateGenesis, poolCheck, countGroups,
loadSavedDecks, storeSavedDecks, makeRecord, normName,
_sets: () => ({ points, names, alias, cidMap, lpSet, exSet, lateSet, ngSet}),
};
})();
if (typeof module!== 'undefined' && module.exports) module.exports = NeuronLib;
if (typeof window !== 'undefined') window.NeuronLib = NeuronLib;
