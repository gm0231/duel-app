#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""gen-genesys-data.py — build v2/genesys-data.json, the bundled dataset
for the Neuron-import Phase 1 Genesis validator (see v2/NOTES.md).

Sources (all fetched 2026-11-04, cached under
~/workspace/neuron-import-research/build-cache/):
  1. Official OCG GENESYS point list, 2026-10-01 applied edition
     https://www.yugioh-card.com/japan/howto/genesys/?list=202610
     -> official_points_202610.json (card name -> pt; verified identical
        to the hand-kept pt_by_name table in ygo.sqlite: 1,115 entries,
        zero diffs).
  2. ProjectIgnis/BabelCDB cards.cdb (ocgcore's own card universe:
     datas.alias = variant -> original passcode, datas.type = type bits).
  3. YGOPRODeck full dumps: cardinfo.json (EN, with misc ocg_date) and
     cardinfo_ja.json (language=ja&misc=yes).
  4. ~/workspace/yugioh/db/ygo.sqlite: cid -> passcode (official DB card
     ids, 14,409 rows) and a partial Japanese-name table.
  5. Yugipedia SMW ask API: resolves the point-list names the dumps
     miss (newer themes). Exact-match batches, then wildcard per name.
     Results are cached to resolved_points_extra.json so re-runs of
     this script are offline.
  6. v2/data.json itself for the 63 pool cards' display names.

Output: v2/genesys-data.json with
  points (representative passcode -> pt, pt>0 only), names (rep -> JA
  display name), alias (variant -> rep), cid (official cid -> raw
  passcode), lp (Link/Pendulum reps), ex (Extra-Deck monster reps),
  late (reps first released on/after the list's cutoff), ng (reps that
  cannot be used in official duels: Token / Skill / placeholder cards).

Known limits (also in NOTES.md): same-name counting groups by
representative passcode and by identical Japanese name; cards whose
name is *treated as* another card's name (e.g. Harpie Lady #1) are
not merged. ocg_date comes from YGOPRODeck misc info; cards without
an ocg_date (567 in the EN dump) are treated as pre-cutoff.
"""
import json, os, re, sqlite3, sys, time, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
V2 = os.path.dirname(HERE)
CACHE = os.path.expanduser('~/workspace/neuron-import-research/build-cache')
YGO_DB = os.path.expanduser('~/workspace/yugioh/db')
LIST_VERSION = '202610'
LIST_APPLIED = '2026-10-01'
CUTOFF = '2026-03-01'  # 202610 list: cards newly released on/after this date are unusable

TYPE_LINK = 0x4000000
TYPE_PENDULUM = 0x1000000
TYPE_FUSION = 0x40
TYPE_SYNCHRO = 0x2000
TYPE_XYZ = 0x800000

def load_json(p):
    with open(p, encoding='utf-8') as f: return json.load(f)

# ---------------------------------------------------------------- inputs
points_by_name = load_json(os.path.join(CACHE, 'official_points_202610.json'))
cardinfo_en = load_json(os.path.join(YGO_DB, 'cardinfo.json'))['data']
cardinfo_ja = load_json(os.path.join(CACHE, 'cardinfo_ja.json'))['data']
app_data = load_json(os.path.join(V2, 'data.json'))

cdb = sqlite3.connect(os.path.join(CACHE, 'cards.cdb'))
cdb_datas = {}   # id -> (alias, type)
cdb_names = {}   # id -> EN name
for i, a, t in cdb.execute('select id, alias, type from datas'):
    cdb_datas[i] = (a or 0, t or 0)
for i, n in cdb.execute('select id, name from texts'):
    if n: cdb_names[i] = n

ygo = sqlite3.connect(os.path.join(YGO_DB, 'ygo.sqlite'))
cid_map = {}     # cid -> raw passcode
sq_names = {}    # passcode -> JA name (partial)
for cid, pc in ygo.execute('select cid, passcode from cards where passcode is not null'):
    cid_map[cid] = pc
for pc, nj in ygo.execute("select passcode, name_jp from cards where passcode is not null and name_jp is not null and name_jp <> ''"):
    sq_names[pc] = nj

# ---------------------------------------------------------------- universe + representative normalization
universe = set(cdb_datas) | {c['id'] for c in cardinfo_en} | {c['id'] for c in cardinfo_ja} | set(sq_names) | set(cid_map.values())

en_name = {}
for i, n in cdb_names.items(): en_name[i] = n
for c in cardinfo_en: en_name.setdefault(c['id'], c.get('name'))
for c in cardinfo_ja: en_name.setdefault(c['id'], c.get('name'))

rep = {}
def find(x):
    # path-compressing representative resolution over cdb alias edges
    seen = []
    while True:
        a = cdb_datas.get(x, (0, 0))[0]
        if not a or a == x or a not in universe:
            break
        seen.append(x); x = a
    for s in seen: rep[s] = x
    return x
for i in universe: rep[i] = find(i)
# fallback: same EN name, no alias edge -> merge onto the group's
# smallest alias-free id (alt-art printings the cdb does not link).
by_en = {}
for i in universe:
    if en_name.get(i): by_en.setdefault(en_name[i], []).append(i)
fallback_merges = 0
for name, ids in by_en.items():
    roots = sorted({rep[i] for i in ids})
    if len(roots) > 1:
        target = roots[0]
        for i in ids:
            if rep[i] != target:
                rep[i] = target; fallback_merges += 1

alias_map = {str(i): rep[i] for i in universe if rep[i] != i}

# ---------------------------------------------------------------- flags per representative
def type_bits(i):
    if i in cdb_datas: return cdb_datas[i][1]
    return 0
ci_by_id = {c['id']: c for c in cardinfo_en}
lp_set, ex_set, ng_set = set(), set(), set()
for i in universe:
    r = rep[i]; tb = type_bits(i)
    ci = ci_by_id.get(i)
    tt = (ci.get('type') or '') if ci else ''
    if tb & (TYPE_LINK | TYPE_PENDULUM) or 'Link' in tt or 'Pendulum' in tt: lp_set.add(r)
    if tb & (TYPE_FUSION | TYPE_SYNCHRO | TYPE_XYZ | TYPE_LINK) or any(k in tt for k in ('Fusion', 'Synchro', 'XYZ', 'Link')): ex_set.add(r)
    if tt in ('Token', 'Skill Card') or (ci and ci.get('frameType') in ('token', 'skill')) or en_name.get(i) == '???':
        ng_set.add(r)

late_set = set()
no_date = 0
group_min_date = {}
for i in universe:
    ci = ci_by_id.get(i)
    mi = (ci.get('misc_info') or [{}]) if ci else [{}]
    dt = mi[0].get('ocg_date') if mi else None
    if not dt: continue
    r = rep[i]
    if r not in group_min_date or dt < group_min_date[r]: group_min_date[r] = dt
for r, dt in group_min_date.items():
    if dt >= CUTOFF: late_set.add(r)
no_date = sum(1 for r in {rep[i] for i in universe} if r not in group_min_date)

# ---------------------------------------------------------------- Japanese names -> representative
names = {}   # rep -> JA display name
def set_name(code, name, overwrite=False):
    if code is None or not name: return
    r = rep.get(int(code), int(code))
    if overwrite or r not in names: names[r] = name
# priority: app pool names > ygoprodeck-ja > sqlite > (yugipedia added later)
for c in cardinfo_ja: set_name(c['id'], c.get('name'))
for pc, nj in sq_names.items(): set_name(pc, nj)
for code, nm in app_data['names'].items(): set_name(int(code), nm, overwrite=True)

# name -> codes index across every source (for point resolution)
name2codes = {}
def index_name(name, code):
    if name and code is not None: name2codes.setdefault(name, set()).add(int(code))
for c in cardinfo_ja: index_name(c.get('name'), c['id'])
for pc, nj in sq_names.items(): index_name(nj, pc)
for code, nm in app_data['names'].items(): index_name(nm, int(code))
for nm, codes in list(name2codes.items()): pass

# ---------------------------------------------------------------- resolve the point list
extra_cache_path = os.path.join(CACHE, 'resolved_points_extra.json')
extra = load_json(extra_cache_path) if os.path.exists(extra_cache_path) else {}
# second cache: archseries harvest + official-DB lookups done outside
# this script (resolve_via_arch.py / resolve_via_db.py in the cache)
for extra_file in ('resolved_points_arch.json', 'resolved_points_db.json'):
    p2 = os.path.join(CACHE, extra_file)
    if os.path.exists(p2):
        for k, v in load_json(p2).items(): extra.setdefault(k, v)

def yugipedia_ask(query):
    url = 'https://yugipedia.com/api.php?action=ask&format=json&query=' + urllib.parse.quote(query)
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (genesys data build)'})
    with urllib.request.urlopen(req, timeout=60) as f: return json.load(f)

def clean_ja(s):
    s = re.sub(r'<ruby[^>]*>(.*?)</ruby>', lambda m: (re.search(r'<rb>(.*?)</rb>', m.group(1), re.S).group(1) if '<rb>' in m.group(1) else m.group(1)), s, flags=re.S)
    return re.sub(r'<[^>]+>', '', s).strip()

def resolve_via_yugipedia(want):
    """want: list of JA names. Fills `extra` name -> passcode."""
    todo = [n for n in want if n not in extra]
    # exact-match batches of 25
    for i in range(0, len(todo), 25):
        batch = todo[i:i + 25]
        q = '[[Japanese name::' + '||'.join(batch) + ']]|?Japanese name|?Password|limit=100'
        try: d = yugipedia_ask(q)
        except Exception as e:
            print('  ask batch failed:', e); continue
        res = d.get('query', {}).get('results', {})
        if not isinstance(res, dict): res = {}
        for page, info in res.items():
            po = info.get('printouts', {})
            ja = po.get('Japanese name', []); pw = po.get('Password', [])
            if ja and pw and str(pw[0]).isdigit():
                nm = clean_ja(str(ja[0]))
                if nm in batch: extra[nm] = int(pw[0])
        time.sleep(0.3)
    # wildcard pass for stragglers (ruby-marked stored values etc.)
    for n in [x for x in todo if x not in extra]:
        q = '[[Japanese name::~*' + n + '*]]|?Japanese name|?Password|limit=20'
        try: d = yugipedia_ask(q)
        except Exception: continue
        res = d.get('query', {}).get('results', {})
        if not isinstance(res, dict): continue
        for page, info in res.items():
            po = info.get('printouts', {})
            ja = po.get('Japanese name', []); pw = po.get('Password', [])
            if ja and pw and str(pw[0]).isdigit() and clean_ja(str(ja[0])) == n:
                extra[n] = int(pw[0]); break
        time.sleep(0.3)
    json.dump(extra, open(extra_cache_path, 'w'), ensure_ascii=False, indent=1)

unresolved = [n for n in points_by_name if n not in name2codes and n not in extra]
print('point names unresolved by dumps:', len(unresolved))
if unresolved:
    resolve_via_yugipedia(unresolved)
for nm, code in extra.items(): index_name(nm, code)

points = {}
still_unresolved = []
for nm, pt in points_by_name.items():
    codes = name2codes.get(nm)
    if not codes:
        still_unresolved.append(nm); continue
    reps = {rep.get(c, c) for c in codes}
    # a name should map to exactly one representative; if sources
    # disagree, prefer the rep that also carries a JA display name.
    target = sorted(reps, key=lambda r: (r not in names, r))[0]
    if len(reps) > 1: print('  note: multi-rep name', nm, '->', sorted(reps), 'chose', target)
    points[str(target)] = pt
    set_name(target, nm)  # official list spelling wins for pointed cards
print('points resolved:', len(points), '/', len(points_by_name), 'unresolved:', len(still_unresolved))
if still_unresolved: print('  UNRESOLVED:', still_unresolved)

# ---------------------------------------------------------------- name indexes (every printing)
# The shared deck pages (neuron.konami.net links land on the TCG
# database) render most card names in English, and both locales'
# visual-text import resolves names as printed on the page. A
# rep-level name map is NOT enough: "Harpie Lady 1" (91932350) is
# alias-merged onto "Harpie Lady" (76812113), so its own printed
# name exists only on the printing. Build name -> rep indexes from
# EVERY printing instead: JA from the YGOPRODeck JA dump + sqlite +
# app names (app spellings win), EN from en_name (BabelCDB texts
# with the YGOPRODeck EN dump as backfill -- the spellings the TCG
# database prints).
index_ja = {}
for c in cardinfo_ja:
    if c.get('name'): index_ja.setdefault(c['name'], rep.get(c['id'], c['id']))
for pc, nj in sq_names.items(): index_ja.setdefault(nj, rep.get(pc, pc))
for code, nm in app_data['names'].items(): index_ja[nm] = rep.get(int(code), int(code))
index_en = {}
for i, n in en_name.items():
    if n: index_en.setdefault(n, rep.get(i, i))
# Supplemental printed JA names, hand-verified against real
# official deck pages (2026-11-04): recent cards whose JA names
# appear in NO upstream dump yet (the JA cardinfo dump and sqlite
# both lag), while the official DB already prints them. Without
# these, the visual-text import of a page containing them fails
# its totals cross-check (honest error, never a wrong deck) and
# the URL/HTML path is unaffected. Grow this list only from real
# page evidence.
SUPPLEMENT_JA = {
    'ハーピィ・レディ－華麗なる分身－': 64972181,
    '香水戦術': 24672129,
    '絶望と希望の逆転': 25209168,
}
for nm, pc in SUPPLEMENT_JA.items():
    index_ja[nm] = rep.get(pc, pc)
    if pc not in names and rep.get(pc, pc) == pc: names[pc] = nm

# ---------------------------------------------------------------- emit
out = {
    'listVersion': LIST_VERSION,
    'listAppliedFrom': LIST_APPLIED,
    'cutoff': CUTOFF,
    'cap': 100,
    'points': points,
    'names': {str(r): n for r, n in sorted(names.items())},
    'indexJa': index_ja,
    'indexEn': index_en,
    'alias': alias_map,
    'cid': {str(cid): pc for cid, pc in sorted(cid_map.items())},
    'lp': sorted(lp_set),
    'ex': sorted(ex_set),
    'late': sorted(late_set),
    'ng': sorted(ng_set),
}
out_path = os.path.join(V2, 'genesys-data.json')
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
print('wrote', out_path, os.path.getsize(out_path), 'bytes')
print('names:', len(names), 'indexJa:', len(index_ja), 'indexEn:', len(index_en), 'alias:', len(alias_map), 'cid:', len(cid_map),
      'lp:', len(lp_set), 'ex:', len(ex_set), 'late:', len(late_set), 'ng:', len(ng_set),
      'fallback merges:', fallback_merges, 'reps without ocg_date:', no_date)
