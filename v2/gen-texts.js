'use strict';
/* gen-texts.js — build the Japanese names/texts section of data.json.
   Sources (both on disk, both authoritative for this pool):
     - ../index.html  (retired client): def('slug', {...}) definitions with the
       official Japanese card texts, verified against the official DB.
     - ~/workspace/ocgcore-poc/passcodes.json: slug -> {passcode, name_jp, name_en}
   Output: data.json gains
     names: { passcode: "日本語名" }            (replaces the English names)
     texts: { passcode: { name, text } }        (Japanese effect text)
   Any pool card that cannot be resolved keeps its English name and is listed. */
const fs = require('fs');
const path = require('path');

const htmlPath = process.env.OLD_APP || path.join(__dirname, '..', 'index.html');
const pcPath = process.env.PASSCODES || path.join(process.env.HOME, 'workspace', 'ocgcore-poc', 'passcodes.json');
const dataPath = path.join(__dirname, 'data.json');

function extractDefs(html) {
  const defs = {};
  let i = 0;
  while (true) {
    const m = /def\('([^']+)',/.exec(html.slice(i));
    if (!m) break;
    const slug = m[1];
    let j = i + m.index + m[0].length;
    while (j < html.length && /\s/.test(html[j])) j++;
    if (html[j] !== '{') { i = j; continue; }
    let depth = 0, inStr = false, esc = false; const start = j;
    for (; j < html.length; j++) {
      const ch = html[j];
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { j++; break; } }
    }
    defs[slug] = JSON.parse(html.slice(start, j));
    i = j;
  }
  return defs;
}

const html = fs.readFileSync(htmlPath, 'utf8');
const defs = extractDefs(html);
const passcodes = JSON.parse(fs.readFileSync(pcPath, 'utf8'));
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const byCode = {};
for (const [slug, v] of Object.entries(passcodes)) byCode[v.passcode] = { slug, name_jp: v.name_jp, name_en: v.name_en };

const fallbacks = [];
const texts = {};
let jpNames = 0;
for (const code of Object.keys(data.cards)) {
  const e = byCode[code];
  const def = e ? defs[e.slug] : null;
  if (e && e.name_jp && def && def.text) {
    data.names[code] = e.name_jp;
    texts[code] = { name: e.name_jp, text: def.text };
    jpNames++;
  } else {
    fallbacks.push(code + ' (current name: ' + data.names[code] + ', slug: ' + (e ? e.slug : '?') + ')');
  }
}
data.texts = texts;
fs.writeFileSync(dataPath, JSON.stringify(data));
console.log('defs parsed:', Object.keys(defs).length);
console.log('Japanese names+texts applied:', jpNames, '/', Object.keys(data.cards).length);
console.log('fallbacks (English kept):', fallbacks.length ? fallbacks : 'none');
