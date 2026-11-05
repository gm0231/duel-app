# v2 (ocgcore client) — Phase 1 architecture notes

## What this is
A human-vs-bot duel client on the proven ocgcore WASM build (edo9300/ygopro-core,
API v11). It replaces the PoC's player-0 bot with a human using a tap-based
phone UI; player 1 stays the PoC's simple bot. The current app at the repo root
is untouched; everything lives in `v2/`.

Files:
- `build/ocgcore.js`, `build/ocgcore.wasm` — copied unchanged from `poc/build/`.
- `data.json` — copied unchanged from `poc/data.json` (63 cards, 88 Lua scripts,
  Ishizu + Gate Guardian decks).
- `engine.js` — shared engine layer (browser + Node): message parsing, prompt
  parsing, response encoders, game-state mirror, bot policy, async duel driver.
- `client.js` — the browser UI (DOM). Loaded only by `index.html`.
- `index.html` — page + CSS (portrait, one screen, dark + antique gold).
- `test-node.js` — Node harness: full duel through engine.js with the bot
  policy standing in for the human. Verifies completion + 0 MSG_RETRY + card
  conservation at every prompt.
- `test-explore.js` — Node stress harness: pseudo-random-but-legal answers on
  both seats to exercise prompt types the conservative bot never reaches.

## How state sync works
The core (API v11) does not push UPDATE_DATA/UPDATE_CARD messages in this
embedding; the client mirrors the field from the event stream:
- `RELOAD_FIELD` (arrives at duel start) initializes LP and pile counts and
  zone occupancy.
- `MOVE` is the workhorse: every location change is accompanied by an explicit
  MSG_MOVE at the processor level. The mirror removes the card at the "from"
  loc_info (preferring exact sequence, falling back to first code match — hand
  order can shift silently in a few core paths) and inserts at the "to"
  loc_info. Moves to/from `LOCATION_OVERLAY` encode the host in the loc_info
  (host controller, host location | 0x80, host sequence, material index), so
  Xyz material counts per host are tracked exactly.
- `DRAW` (codes are broadcast), `SHUFFLE_HAND`/`SHUFFLE_EXTRA` (exact new
  order), `POS_CHANGE`, `SET`, `SUMMONING`/`SPSUMMONING`/`FLIPSUMMONING`,
  `SWAP`, `DECK_TOP`, `CONFIRM_CARDS` (reveal knowledge: opponent hand cards
  shown to player 0 are recorded) refine the mirror.
- LP comes from `LPUPDATE` (absolute) with `DAMAGE`/`RECOVER`/`PAY_LPCOST`
  applied as deltas (LPUPDATE follows and corrects).
- Chain state comes from `CHAINING` (push link), `CHAIN_SOLVING` (which link
  is resolving), `CHAIN_SOLVED`/`CHAIN_NEGATED`/`CHAIN_DISABLED` (per-link
  marks), `CHAIN_END` (clear).
- Card conservation (per player: deck+hand+extra+grave+removed+field+overlay
  materials == deck size) is asserted at every prompt boundary in
  `test-node.js`; it held for all 651 prompts of the verification duel.

Known mirror limits (Phase 1):
- On-field ATK/DEF shown are the printed values from `data.json`. The v11
  query API (OCG_DuelQuery*) is not exposed by the PoC WASM driver, so
  effect-modified ATK/DEF/counters on field cards are not reflected.
- Equip relations, card targets, and per-card effect states are not visualized
  (the messages are parsed only as log events where noted).

## Prompt protocol facts (from core sources, not docs)
- All layouts were taken from `playerop.cpp` / `operations.cpp` /
  `processor.cpp` / `field.cpp` of edo9300/ygopro-core and cross-checked
  against the PoC. Two traps worth remembering:
  - `SELECT_TRIBUTE` entries are 11 bytes (code, con, loc, seq u32,
    release_param) — they do NOT include the position u32 that
    `get_info_location()`-based entries have.
  - `ANNOUNCE_NUMBER`'s response is the INDEX of the chosen option, not its
    value (the PoC bot sent the value; it never fired in PoC duels).
- After an invalid response the core emits `MSG_RETRY` and waits for a new
  response to the SAME prompt — it does not re-send the prompt. The driver
  (`engine.js` Duel) therefore re-asks the answerer with `prompt.retryCount`
  incremented; the UI shows a "that selection was not accepted" notice and
  re-opens the prompt. Legal answers never trigger this (both Node harnesses
  run with 0 retries).
- Card-selection responses use the PoC-verified "type 2" encoding
  (i32 type=2, u32 count, u8 indices); cancel is i32 −1 where the core allows
  it. `SELECT_UNSELECT_CARD` uses the toggle encoding (i32 1, i32 index) and
  i32 −1 to finish/cancel. `SELECT_CHAIN` pass is i32 −1 (illegal when the
  core marks the prompt forced).

## Prompt → UI mapping
| Prompt | UI (EDOPro convention → phone adaptation) |
|---|---|
| SELECT_IDLECMD / SELECT_BATTLECMD | Actions live on the tapped card (action sheet listing exactly the core's legal actions for that card); phase advance is a persistent button; hand-shuffle etc. under a small menu button. Cards/piles with actions glow. |
| SELECT_PLACE / SELECT_DISFIELD | The actual board zones highlight; tap zones to choose (hard user requirement — no text lists). Chosen zones stay lit until the count is met. |
| SELECT_POSITION | Sheet with card-orientation previews (vertical/horizontal × face-up/down) for each position bit in the mask. |
| SELECT_CARD / SELECT_TRIBUTE | Bottom-sheet card grid with the shipped tray conventions: picked cards listed as chips (tap chip or card to unpick), confirm enabled only at a valid count/sum. Cancel button only when the core marks the prompt cancelable — mandatory prompts have no dismiss path at all. |
| SELECT_UNSELECT_CARD | Grid where tapping a card toggles it immediately (protocol is one toggle per response); selected cards shown tray-style; Finish (when finishable and min met) / Cancel (when cancelable). |
| SELECT_SUM | Same grid; must-select cards shown as locked chips; confirm enabled exactly when the core's own sum check (mirrored in `engine.js sumSelectionValid`) passes. |
| SELECT_COUNTER | Per-card steppers; confirm enabled when the allocated total equals the required count. |
| SORT_CARD / SORT_CHAIN | Ordered list with ↑/↓ per row; "keep order" (−1) always available. |
| SELECT_CHAIN | See "Chain interaction" below. |
| SELECT_YESNO / SELECT_EFFECTYN | Sheet with the source card name + location and large はい/いいえ (発動する/しない) buttons. |
| SELECT_OPTION | Numbered option buttons (see gaps: option description strings are core string-table IDs we cannot resolve yet). |
| ANNOUNCE_RACE / ANNOUNCE_ATTRIB | Toggle chips with JP race/attribute names; exactly N must be picked. |
| ANNOUNCE_NUMBER | Buttons showing the option values (response is the index). |
| ANNOUNCE_CARD | Scrollable grid of the 63 pool cards by name; if the core rejects the declaration (opcode filter), the prompt re-opens with the retry notice. |
| ROCK_PAPER_SCISSORS | ✌/✋/✊ buttons (values 1/2/3 = scissors/paper/rock per the core's win table). |
| anything else | Generic fallback sheet with an auto-answer button (bot policy) — no dead ends. |

## Chain interaction (binding design rules from the user)
- YGOPro/EDOPro conventions are the reference, not our inventions.
- The mid bar shows the chain as numbered links in chain order
  (① card, ② card, …). While the chain resolves, the link being solved is
  highlighted (from `CHAIN_SOLVING`), solved links get ✓, negated/disabled
  links are struck through — so resolution visibly proceeds link-by-link in
  reverse.
- The chain dock (bottom, above the hand — it never covers the player's own
  field) states what you are responding to: the current top link's card.
  Candidates are exactly the core's chainable entries, plus an explicit パス
  whenever the core allows passing. If the core offers no chainable card the
  dock does not appear (the driver answers pass directly); forced prompts
  show no pass button.
- Each candidate has a × ("このチェーンでは聞かない") toggle: an
  EDOPro-style ignore for the remainder of the current chain. This is a
  client-side presentation filter only — dismissed candidates are hidden and,
  if a later prompt in the same chain offers only dismissed cards, the client
  auto-answers pass (−1), which is a legal answer to SELECT_CHAIN whenever
  the prompt is not forced. Dismissals never apply to forced prompts, are
  shown greyed so they can be restored, and are cleared when the chain ends.
  Legality is unchanged: the client never answers anything the core did not
  ask, and never suppresses a prompt the core requires an answer to beyond
  answering "pass" where pass is legal.

## Phone adaptations / deviations from EDOPro (deliberate)
- Portrait one-screen board; opponent zones are NOT mirrored (sequences run
  left-to-right for both players, numbered) to keep tap→sequence mapping
  visually direct in this phase.
- Modal selections are bottom sheets (max ~62% height) instead of centered
  dialogs, so the opponent's field and the chain bar stay visible.
- The chain dock sits above the hand instead of as a center popup.
- No dialogue text for the opponent; the log line shows system events only.

## Audio wiring (Phase 1, minimal)
- Start screen BGM: `../assets/bgm/ishizu-upload.mp3` starts on the first
  pointer tap (autoplay policy), looped.
- Duel BGM: `../assets/bgm/ishizu-start.mp3` from duel start, looped.
- Click SE: `../assets/se/ui_click.mp3` on taps/buttons.
- Not wired yet: scene-based BGM switching, summon/attack/destroy SEs, VS SE.
  (All of these were wired in Phase 2 — see the Phase 2 section below.)

## Verification performed
- `node test-node.js` — full duel through engine.js (bot policy as the human
  seat): 72 turns, 651 prompts (299 human-seat / 352 bot-seat), winner P0 by
  deck-out — identical outcome to the proven PoC run. **0 MSG_RETRY.** Card
  conservation asserted at all 651 prompt boundaries: 0 violations; final
  totals 58/55 as expected.
- `node test-explore.js` — 3 pseudo-random legal-answer duels, all completed
  (LP finishes), **0 retries**, exercising SELECT_IDLECMD, SELECT_BATTLECMD,
  SELECT_CHAIN, SELECT_PLACE, SELECT_CARD, SELECT_TRIBUTE,
  SELECT_UNSELECT_CARD, SELECT_POSITION, SELECT_EFFECTYN, SELECT_YESNO,
  SELECT_OPTION, ANNOUNCE_CARD, ANNOUNCE_NUMBER.
  - This harness caught two real bugs during development, both fixed:
    the SELECT_TRIBUTE entry layout (11B, no position) and the driver's
    MSG_RETRY handling (re-answer the same prompt).
- Browser/UI layer: served statically (python http.server) with all
  referenced files returning 200. A jsdom smoke test loaded the real page,
  clicked デュエル開始, and auto-played the human seat purely through DOM
  clicks (action sheets, phase button, selection grids, chain dock, zone
  highlights): the duel completed — **49 turns, human seat won by LP
  (8000 vs −300), zero page errors**. (A first version of the auto-player
  timed out because it kept toggling the first grid card on/off; cycling
  through choices fixed the driver, not the UI.) jsdom is not a real
  browser — touch behavior, layout, and media playback on an actual phone
  remain unverified in this phase.
- NOT exercised by any harness (no card in these two decks triggers them in
  the test lines): SELECT_SUM, SELECT_COUNTER, SORT_CARD, SORT_CHAIN,
  SELECT_DISFIELD, ANNOUNCE_RACE, ANNOUNCE_ATTRIB, ROCK_PAPER_SCISSORS.
  Their parsers/encoders/UIs are implemented from the core sources and share
  the verified response primitives, but they are not yet proven in a live
  duel.

## Phase 2 (branch client-phase2)

### Item 1 — the "unexplained" ANNOUNCE_CARD at the opponent's draw phase: SOLVED
- Source: **Gravekeeper's Trap (98715423)**, the human's own face-up trap.
  Static audit of all 88 Lua scripts in the bundle: it is the ONLY script that
  calls `Duel.AnnounceCard`. Its ⑤ effect is a mandatory FIELD trigger
  (`EVENT_PREDRAW`, condition `Duel.IsTurnPlayer(1-tp)`): at the OPPONENT's
  pre-draw the trap's controller must declare a card name (filter: not an
  Extra-Deck-type card). On the opponent's rule draw the drawn card is shown
  to the controller; if it matches the declaration it is sent to the GY, then
  the opponent's hand is shuffled. The prompt is genuinely the human's — not
  a bot-seat leak.
- Reproduced exactly in Node (`test-investigate.js`): 7 events in one duel at
  turns 10/12/14/16/18/20/22 (the browser report said turns 12 and 14), every
  one phase=DRAW, turnPlayer=1, prompt.player=0, immediately preceded in the
  message stream by `CHAINING Gravekeeper's Trap by P0 @SZONE` — and card
  conservation held at every prompt boundary (0 violations), so the state
  mirror never desynced. The "unexplained" hand/GY/count changes in the
  browser run were real core events (this trap's draw-check GY send + hand
  shuffle, and other resolutions in the same window) that the Phase 1 UI
  applied silently.
- Fixes shipped regardless of cause:
  - **Prompt source context**: the driver now attaches `prompt.context` (the
    chain link being solved, else the newest link — sourced from the core's
    CHAINING stream) and every prompt UI shows it (selection grids, sort,
    counters, yes/no, options, announces, position, place hint, chain dock).
  - **Hand-change logging**: the state mirror now logs EVERY hand departure
    and arrival (discard, send to GY, banish, return to deck, add from
    GY/deck/field), every draw count, and every hand shuffle; also set and
    flip-summon lines that were missing.
  - **Declarable-only announce grid**: `isDeclarable()` in engine.js is a
    faithful port of the core's `is_declarable()` (playerop.cpp) running on
    exact BigInt opcodes (the parser now keeps u64 opcodes as BigInt). The
    announce grid offers only cards passing the prompt's own filter.
    Verified for all 63 pool cards against the real prompt opcode stream
    [TYPE_EXTRA=0x4802040, ISTYPE, NOT] (test-phase2 A/A2).

### Item 2 — live ATK/DEF via the core query API
- The driver (`poc/driver.cpp`, source kept at `build/driver.cpp`) now wraps
  `OCG_DuelQuery` (`poc_query_card`/`poc_query_ptr`/`poc_query_len`); the WASM
  was rebuilt with the existing `poc/build.sh` (wasm 1,334,518 bytes).
- `Duel.queryCard()` parses the core's TLV query records (card::get_infos
  format); `Duel.refreshFieldStats()` fills `curAtk/curDef/curLevel` on every
  occupied monster zone. The client refreshes at every prompt and every state
  update; board tiles show current values, printed values only until the
  first refresh lands.
- Verified (test-phase2 B): 2,649 occupied-zone observations across 2 explore
  duels — query code always matched the mirror, values always sane, and 517
  effect-modified sightings (e.g. Jirai Gumo 2100→1050 under Lost Wind).

### Item 3 — Japanese names and texts
- `gen-texts.js` extracts the old app's `def('slug', {...})` definitions from
  `../index.html` (official Japanese texts) and joins them via
  `~/workspace/ocgcore-poc/passcodes.json`. Result: `data.json` `names` are
  Japanese and a new `texts` section carries name+text for **63/63 cards —
  zero English fallbacks**. UI shows the text in action sheets, selection
  grids, and a read-only card-info sheet (tap a graveyard/removed/EX row).

### Item 4 — chain prompt fatigue (presentation only)
- Per-card **duel-long dismissal** ("このデュエル中は聞かない") on chain
  candidates, keyed like the existing per-chain dismissal. Implemented
  strictly as auto-answering pass (−1) when EVERY candidate of a
  SELECT_CHAIN belongs to dismissed classes; any other candidate (or a
  forced prompt) shows the dock normally. Never touches legality.
- Visible indicator: an amber chip flashes "自動パス：<card>" when an
  auto-pass fires, and persists as "自動パス設定中：N件（タップで管理）"
  while any dismissal is active. The management sheet (tap the chip, only
  when no prompt is open) and the dock's own "自動パス設定中" section both
  allow re-enabling. The per-chain × dismissal is unchanged.

### Item 5 — start choices
- Start screen: own deck (Ishizu / Gate Guardian), opponent deck, and
  先攻/後攻/ランダム. The core's first player is always seat 0, so a
  second-player human is seated at core seat 1 with the decks swapped
  (standard ygopro approach); all rendering, labels, piles and the result
  screen follow the human seat (`HP`). Engine support: `Duel` opts
  `deckP0/deckP1/humanTeam`, `GameState` takes per-seat decks and a
  `humanPlayer` for log wording. Verified at engine level (test-phase2 D:
  seat-swapped duel completes, per-seat totals 55/58 at all 220 prompts,
  retries 0) and in the jsdom click-through run 2.

### Item 6 — audio
- BGM: start = ishizu-upload; duel scenes from the state mirror's advantage
  signal — score = LP difference + face-up field ATK difference (live query
  values) — mapped to neutral/advantage/big-advantage/disadvantage/
  big-disadvantage (the last a random pick from voice-note-2 + mystical,
  as assigned), win → big-advantage track, loss → big-disadvantage pool.
  Hysteresis bands + 8 s minimum dwell + never switching while a prompt is
  open, so the signal cannot flap. A sound ON/OFF toggle sits on the start
  screen.
  [SUPERSEDED 2026-11-03: the advantage-score scene system above was
  replaced by the user's 3-stage decision — see "## BGM 3-stage" below.]
- SE: an event queue on the state mirror (set/summon/spsummon/flipsummon/
  activate/attack/damage/destroy/banish/recover/negate) is drained by the
  client into the user's files: set_card, activate_card, ui_click,
  vs_start (duel start), summon_circle/big/land, attribute attack sounds
  (atk_earth/water/fire/wind/light/dark, sword fallback), hit_big/
  hit_critical by damage size, destroy_blast (battle) / destroy_stone
  (effect), banish_warp, recover, negate_shield. Same-file cues are
  throttled to one per 150 ms. No generated audio anywhere.
- Caveat: jsdom/Node cannot play audio — wiring is code-level only; actual
  playback still needs a real-browser/phone check.

### Phase 2 verification
- `node test-node.js` — unchanged Phase 1 scripted duel: 72 turns, 651
  prompts, winner P0 deck-out, **0 MSG_RETRY**, conservation 651/651.
- `node test-explore.js` — PASS (0 retries).
- `node test-investigate.js` — item 1 evidence above (exit 0).
- `node test-phase2.js` — ALL CHECKS PASSED (declarable filter A/A2, live
  query B0–B4, announce context C, seat swap D1–D4).
- jsdom click-through (`test-ui.js`, needs jsdom via NODE_PATH): two full
  duels played purely through DOM clicks on the real page. Run 1 (defaults,
  先攻): 61 turns, deck-out finish, result screen reached, Japanese names
  rendered, the duel-dismissal control was exercised once and the auto-pass
  chip appeared. Run 2 (自分=Gate Guardian / 相手=Ishizu / 後攻, human on
  core seat 1): 72 turns, deck-out finish, result screen reached. In both
  runs the retry warning never appeared in any prompt container
  (MSG_RETRY proxy = 0) and nothing stalled. No ANNOUNCE_CARD prompt
  occurred in either clicker duel (the trap never stayed face-up under
  generic clicking) — its context/filter behavior is covered by
  test-investigate/test-phase2 instead. Note: an early version of this
  test false-flagged a retry by scanning document.body, which includes
  the client.js source text itself; the scan is now scoped to the prompt
  containers, and the same duel trajectories pass clean.

## Fix round 1 (branch client-fixes-1)

### Issue 1 — decks were never shuffled: PROVEN, FIXED
Browser verification reported spell/trap-only hands across sessions, with
monsters arriving only via search effects. Investigation:
- No shuffle existed anywhere: `engine.js` registered each deck with the
  core in `data.json` array order (same in the PoC driver, `duel.js`).
  In the ygopro family the deck order at registration is the client's
  responsibility; the core deals it verbatim, from the END of the list
  (last registered = top of deck).
- `data.json` stores both main decks grouped by type (monsters first,
  then spells, then traps) — so the dealt opening was always the array's
  spell/trap tail.
- Proof: a Node probe recording MSG_DRAW for both seats over 4 fresh
  module loads with 4 different duel seeds produced byte-identical draw
  sequences every time — e.g. the Ishizu seat opened 転生の予言 /
  巨神封じの矢 / 光の護封霊剣 / 運命の抱く爆弾 x2 and had drawn 墓守の罠 x3
  by turn 3 (the array tail, verbatim). The duel seed had no effect on
  deck order.
Fix (`engine.js`): `Duel.run()` now registers Fisher-Yates-shuffled
COPIES of both main and extra decks, fresh per duel. The RNG is
`crypto.getRandomValues` with unbiased rejection sampling
(`Math.random` fallback). `data.decks` is never mutated, so rematches
re-shuffle. `shuffledCopy` / `randBelow` are exported for tests.
Verification: the same probe now yields unrelated draw sequences per
run, with monsters throughout the opening hands; the full-duel Node
harness still completes with 0 retries and conservation intact.

### Issue 2 — chain 「パス」 appeared not to advance: mechanism found
The reported prompt (set メタバース during the opponent's turn, with a
パス button and a × dismiss control) was SELECT_CHAIN — only uiChain
renders those controls. Findings:
- Encodings are correct: the dock's pass sends i32 -1 (same as the bot's
  pass for SELECT_CHAIN); EFFECTYN/YESNO declines send i32 0. Both match
  the core protocol.
- Reproduction (Node; scripted Gate-Guardian human who sets S/T and
  passes every chain): across 6 full duels, MSG_RETRY total was 0 with
  empty retry attribution — a pass is NEVER rejected, so there is no
  retry/re-prompt loop, and the click path is not at fault either
  (the jsdom clicker presses #chain-pass through whole duels).
- The real mechanism: once the human has a set activatable card, the
  core issues a NEW SELECT_CHAIN at every fast-effect timing of the
  opponent's turn. In the reproduction duels the human received
  74–173 chain prompts during bot turns alone; 74–172 of them had a
  candidate set identical to the previous prompt (the same single set
  card, re-asked at DRAW — twice — STANDBY, MAIN1, END, ...). Each pass
  DID advance the game — to the next timing, which asked the same
  question again. uiChain rendered every one of those prompts
  identically (its context line falls back to 「効果への応答」 whenever
  the chain is empty and carried no turn/phase information), so two
  passes looked like "nothing changed". The duel-long dismissal
  appeared to "fix" it only because it auto-passes ALL such re-asks.
Fix (`client.js`, `index.html`): every shown chain dock now displays
the timing — turn owner + phase (e.g. 相手のターン・スタンバイ) — and a
per-turn confirmation counter （このターンN回目の確認） that increments
with each new prompt, and the dock plays a short arrival animation on
each NEW prompt (first draw only; dismissal redraws don't replay it).
The yes/no and effect-yes/no sheet received the same timing + counter
line (their decline path was audited as above: same recurring-timing
pattern is possible there, encoding is correct). Dismissal mechanics
are unchanged.

### Fix round 1 regression
- `node test-node.js` — PASS (full duel completes; 554 conservation
  checks, 0 violations; retries 0).
- `node test-explore.js` — PASS (0 retries).
- `node test-phase2.js` — ALL CHECKS PASSED (seat-swap duel included,
  retries 0).
- `node test-investigate.js` — PASS (exit 0).
- jsdom click-through (`test-ui.js`, NODE_PATH jsdom) — ALL UI CHECKS
  PASSED (run 1: 52 turns, deck-out win, duel-dismissal exercised once;
  run 2 seat-swap: 72 turns, deck-out; retry warning never seen in
  either run). Cautionary tale: the FIRST stock run of this round timed
  out in both duels. Root cause was in this round's own Issue 2 change —
  the dock's arrival animation was first implemented by appending an
  `arrive` class, which broke the exact `className === 'on'` contract
  the clicker (and potentially other tooling) uses to detect the open
  dock; a pace-0 probe showed the game blocked on a dock reading
  `className "on arrive"`. The animation now uses the Web Animations
  API (`element.animate`, guarded) and the class contract is restored;
  the unmodified stock suite then passed both runs within budget.


## Genesis format restrictions (branch client-genesis)

The duel now runs under the user's Genesis-equivalent restrictions on an
MR5 base. The flags live in `engine.js` (`FLAGS_GENESIS`) and are passed
verbatim to `OCG_DuelOptions` via `poc_create` in `v2/build/driver.cpp`
(the driver takes flags as a JS parameter, so no driver/WASM rebuild was
needed — `v2/build/ocgcore.wasm` is unchanged):

- `DUEL_EMZONE` (0x2000) removed -> no Extra Monster Zones. Core-side
  proof: without the flag, `field::get_tofield_count` always sets MZONE
  bits 5/6 in the unusable mask, so SELECT_PLACE never offers them and
  Extra-Deck summons route to main zones 0-4 (`get_useable_count_fromex`
  falls back to the non-rule4 path).
- `DUEL_PZONE` (0x800) removed -> no Pendulum Zones.
- `DUEL_1ST_TURN_DRAW` (0x200) stays absent -> the starting player does
  not draw on turn 1 (core `processor.cpp`: turn-1 draw only happens when
  this flag is set). All other base flags unchanged (incl. DUEL_FSX_MMZONE,
  so Fusion/Synchro/Xyz use main monster zones).

Measured before (MR5 flags) vs after (Genesis flags), `test-genesis.js`
(exploratory policy on both seats; deck order is crypto-shuffled per duel,
so figures are aggregates over independent duels):

- Turn-1 draw: starting player's hand at their first MAIN1 prompt was 5
  and their turn-1 maximum was 5 in all 15 complete baseline duels and
  all 6 Genesis duels; first-prompt hands were [5,5] every time. The restriction
  was ALREADY satisfied before this change (the PoC flag set never
  included DUEL_1ST_TURN_DRAW) and remains satisfied — measured, not
  assumed.
- Extra Monster Zones: baseline — 39 of 43 observed Extra-Deck monster
  appearances landed in seq 5/6, and 39 of 580 SELECT_PLACE/DISFIELD
  prompts offered an EMZ bit. After — 218 place prompts with 0 EMZ offers,
  13 Extra-Deck appearances, ALL in main zones (seqs {0:4, 1:3, 2:3,
  3:2, 4:1}), 0 in EMZ. MSG_RETRY 0 in every duel, all duels completed.
- UI: `client.js` renders only monster zones 0-4 for both players (the
  state mirror keeps its 7-slot arrays because RELOAD_FIELD always
  serializes 7; seq 5/6 can now never be offered or occupied). The dead
  `.slot.emz` styling was removed. Zone-tap mapping is unchanged (core
  sequences for main zones are 0-4 with or without the flag).

Card-pool audit (no deck changes): all 63 pool cards checked in
`data.json` — 0 Link (TYPE_LINK), 0 Pendulum (TYPE_PENDULUM), no nonzero
lscale/rscale, no link markers. Extra decks are Fusion 18 / Synchro 5 /
Xyz 6 (counting duplicates across both decks). Script audit of all 63
card scripts: no reference to linked zones, link markers, or an Extra
Monster Zone; no hardcoded seq 5/6. One non-issue hit:
`c36898537.lua` （メタファイズ・ホルス・ドラゴン） reads TYPE_PENDULUM only
as a flag on its Synchro materials (an optional bonus effect if a
Pendulum monster was used as material — impossible in this pool, and the
card functions fully without it).

Pre-existing issue found during verification (NOT caused by this
change; FIXED later in fix round 2 — see the "Fix round 2" section):
the state mirror's Xyz-material accounting dips during inherent Xyz
summons. Wire
evidence: materials move to loc 0xc0 (EXTRA|OVERLAY) with seq = the
host's Extra-Deck index while the host is still in the Extra Deck;
`engine.js` `_insertAt` credits OVERLAY units only to a host already in
`mzone[seq]`, so the materials go uncounted until they detach (loc
0x84/0x90), which restores the count. Consequences are display-side
only: the mirror's running total dips by the material count (and an Xyz
monster's materials badge under-reports) until detachment; if a duel
ends while an Xyz monster still holds materials, the mirror's final
total stays dipped (observed once: 57/58). The core state is always
consistent — duels complete with correct winners and MSG_RETRY 0. The
same artifact makes `test-phase2.js` check B2 (query code vs mirror
code) fail intermittently: it failed on unmodified main in 2 of 2
observed runs as well, so it is not a regression of this branch.

Regression on this branch: `test-node.js` PASS (644 conservation
checks, 0 violations, retries 0, final totals 58/55), `test-explore.js`
PASS, `test-genesis.js` PASS (6 duels), `test-phase2.js` all checks
pass except the pre-existing intermittent B2 above, `test-ui.js`
(jsdom click-through, NODE_PATH=/tmp/jsdomtest/node_modules) — ALL UI
CHECKS PASSED (both runs reached the result screen; run 2 seat-swapped
72 turns, deck-out; retry warning never shown, no stalls).

## Fix round 2: Xyz overlay-material mirror accounting (branch client-fixes-2)

The pre-existing issue flagged in the Genesis section is FIXED. Root
cause, in two layers:

1. Overlay units have no location of their own on the wire. A unit's
   loc_info is (controller, host_location | LOCATION_OVERLAY, host_seq)
   — it always names its host's CURRENT location, and when the host
   changes location the core sends only the host's own MOVE (verified:
   zero per-unit follow-up MOVEs across 40+ Xyz summons). The mirror
   credited units only to a host already in `mzone[seq]`, so units
   attached during an inherent Xyz summon (host still in the Extra
   Deck) were dropped from all counts.
2. The mirror's Extra-Deck order is deck-list order; the shuffle before
   registration is never reported to the client, so the entry sitting
   at the core's host index may carry a different code. Crediting by
   index (correct) but removing the host by code (also correct) split
   the count across two entries: the host left with 0 and the phantom
   count stayed behind on an unrelated entry (observed: a Synchro
   monster's Extra entry holding `materials: 2`, final total 60/58).

Wire evidence (deterministic duels — seeded shuffle via a fake
`crypto.getRandomValues`, fixed core seed; message indices from one
such duel):
- attach: `#73 MOVE material MZONE[3] -> EXTRA|OVL[4] reason=0x200008`
  (seq = host's Extra-Deck index), one per material
- host:   `#78 MOVE host EXTRA[4] -> MZONE[2] reason=0x800`, followed
  by SPSUMMONING/SPSUMMONED; NO unit re-emission (0xc0 -> 0x84 count 0)
- detach from a live field host: `MOVE unit MZONE|OVL[3] -> GRAVE
  reason=0x80` (seq = host's zone)
- host destroyed: `MOVE host MZONE[2] -> GRAVE reason=0x1a`, then each
  unit `MOVE GRAVE|OVL[0] -> GRAVE reason=0x600` (seq = the host's
  index in the graveyard — the unit encoding follows the host even
  there)

Fix (mirror layer only, `engine.js`; answers to the core untouched):
- Extra-Deck entries now carry `materials`, and `_hostEntry()` resolves
  an overlay loc_info against mzone OR extra by stripped base location
  (other bases — grave/removed hosts — hold no count; the core releases
  those units with their own MOVEs, counted at their destination).
- A host's own MOVE carries its count to the destination entry
  (mzone/extra). For Extra-Deck departures the count is claimed BY
  INDEX from the entry at the core's seq before the host's entry is
  removed by code — this is what keeps the count attached to the host
  despite the unknowable Extra-Deck order.
- `SHUFFLE_EXTRA` rebuilds preserve per-copy counts (matched by code);
  `totalCards` counts units held by Extra-Deck hosts too.

Verification — new `test-overlay.js` (deterministic; an independent
per-host wire model rebuilt from MSG_MOVE alone is cross-checked
against the mirror's per-entry `materials` at every prompt):
- HUNTER batch (seat 0 forces Xyz lines, no spell activations): 8
  duels, 15 Xyz summons, 30 attaches, 2 grave-releases — per-prompt
  conservation EXACT per seat (0 violations; before the fix these same
  duels produced 70–402 violations each and finals as low as 54/58),
  wire model == mirror at every prompt, final totals 58/55 in all 8,
  MSG_RETRY 0.
- ACTIVATOR batch (Xyz effects activated; exploratory opponent): 6
  duels, 10 summons, 10 detaches from live hosts, 10 grave-releases —
  wire model == mirror at every prompt, combined conservation exact at
  every prompt, final per-seat totals exact in all 6, MSG_RETRY 0.
  Per-seat zone counts deviate mid-duel (1014 prompt observations) only
  while a control-changing effect (Monster Reborn on the opponent's
  graveyard, etc.) holds a card in the other seat's zones — a property
  of the metric, not a miscount; the cards settle back to their
  owner's piles and the finals are exact.
- Full regression: `test-node.js` PASS (570 checks, 0 violations),
  `test-explore.js` PASS, `test-overlay.js` ALL PASS, `test-genesis.js`
  PASS (its metric counters still show deviations in some explore
  duels — control changes per above, plus final-total anomalies that
  reproduce identically on unmodified main; pre-existing, unrelated),
  `test-phase2.js` — B2 result below, `test-ui.js` ALL UI CHECKS
  PASSED (run 1: 62 turns, deck-out win; run 2 seat-swapped: 72 turns,
  deck-out; retry warning never shown, no stalls).

B2 determination (was suspected to share this root cause — it does
NOT): B2 still fails intermittently after this fix, with an unchanged
signature — mirror code exactly 0 on a main-deck monster, materials 0,
no Xyz involved. Deterministic trace (seeded duel): the monster's
MOVE into its zone carries the true code and the mirror records it;
the following MSG_SPSUMMONING carries code 0 (the core zeroes the
code for a face-down special summon) and `GameState.apply` case 62
unconditionally overwrites the known code with 0; MSG_POS_CHANGE
later carries the true code again but case 53 only fills the code
when it is `null`, so 0 sticks. Two independent live signatures
(Medusa Worm, Keldo the Sacred Statue; both `mirror=0, mats=0`).
This is a separate mirror defect in the summoning/pos-change paths;
it is NOT fixed by this branch (out of scope) and is recorded here
for a later fix round.

Adjacent findings from the reproduction work (not fixed here):
- `botAnswer`'s SELECT_UNSELECT_CARD fallback toggles index 0
  unconditionally; when the prompt is neither finishable nor
  cancelable this ping-pongs forever (the stock bot never Xyz
  summons, but an effect-driven unselect prompt to the bot seat
  would hang a real duel). `test-overlay.js` uses a terminating
  handler (finish once min are toggled on).
- `test-genesis.js` explore duels occasionally end with combined
  mirror totals ABOVE 113 (e.g. [64,63]) on unmodified main as well;
  mechanism not identified — recorded as a pre-existing anomaly of
  long exploratory duels, separate from the overlay accounting.
## Layout phase (branch client-layout)

User decision (2026-11-02, after playing the Phase 2 build on his phone:
"the lower half is dead space"): **"fit the board to the screen, and if
space remains, a persistent card-detail preview."** Previously every
element was fixed-size (slots 47×60, S/T slots even smaller at 40×52,
hand 56×72) and nothing stretched, so tall screens kept a dead band
under the hand.

### Fit once, then freeze
`applyLayout()` (client.js) runs exactly once per duel, inside the
start-button handler, and publishes sizes as CSS vars on `:root`
(`--sw/--sh/--hw/--hh/--pv`) plus `window.__layout` for tests. There is
no resize listener; a new duel (page reload via もう一度 → start) is the
only recompute. The freeze is structural, not just "we don't recompute":
- dock / sheet / autopass chip / start & result overlays were already
  absolutely positioned and stay that way;
- `#chainbar` now always reserves its 21px row (visibility toggles
  instead of display) — a chain appearing mid-duel used to grow the mid
  bar and push the player's field down;
- `#placehint` was in-flow (it pushed the whole board down during
  SELECT_PLACE); it is now an absolute banner under the top bar;
- `#app > *` is `flex:0 0 auto`, so flex shrink can never compress a
  row if a real browser's font metrics differ by a pixel.

### Sizing formula
Every bar carries an explicit px height in index.html, so the stack is
exact arithmetic (constant `LAYOUT_FIXED = 217` in client.js):
topbar 44 + 2 fields × (padding 5 + pilebar block 23) + zone-row
margins 16 + midbar 78 (chainbar 21 + logline 15 + phasebar 34 +
padding/borders 8) + handbar extras 23 (label 13 + padding 10).
On top of that: 4 × slotH + handH + previewH, where
slotH = round(W×1.22) + 15 (image + ATK/DEF strip) and
handH = round(handW×1.22) + 14, handW = round(W×56/47).
W starts at the width cap — the widest row is the S/T row: 6 slots +
5×4 gaps + 12 field padding ≤ app width (≤430) — and is decremented
until the stack fits the viewport height (floor 40px; at the tested
heights it never binds). The board is never shrunk below the old
47×60 baseline to force a preview: at 660 the slot is 58×86.

Slack distribution, in order: preview up to 56px (a fully usable
strip), then hand growth up to 1.3× its standard height, then any
rest to the preview. A computed preview under 24px is not shown
(the sliver becomes the dead band, which is then < 24px by
construction).

Measured at width 390 (test-layout.js, jsdom — see caveat below):

| vh | tile W | slot H (image) | hand W×H | preview | dead band |
|----|--------|----------------|----------|---------|-----------|
| 660 | 58 | 86 (71 img) | 69×98 | 1 → hidden | 1px |
| 720 | 59 | 87 (72 img) | 70×99 | 56 shown | 0px |
| 800 | 59 | 87 (72 img) | 70×129 (grown) | 106 shown | 0px |

### Card display spec, now actually applied to tiles
- All zones share ONE size: the `.slot.small` variant is gone (S/T
  zones used to render smaller than monster zones).
- ATK/DEF moved OUT of the tile: a `.slotstats` strip at the slot
  bottom shows `ATK n / DEF n` with labels, using the live query
  values (`curAtk/curDef`) exactly as before; the tile image shrinks
  inside the slot when the strip is present (`.slot.hs`). Hand cards
  got the same structure (`.himg` image area + `.hstats` strip).
  Names stay single-line with ellipsis; no state text on tiles.
- test-ui.js's live-stat sampler was repointed from `.tile .st` to
  `.slotstats` in the same commit (observational only — no assertion
  depends on it; neither clicker duel happened to surface a modified
  face-up monster at a sampling tick, so samples stayed empty; the
  engine-level live-value proof remains test-phase2 B).

### Preview strip
`#preview` sits between the player's field and the hand bar, height =
`--pv` (0 ⇒ display:none). Content: art thumb, name, meta line
(attribute/race/level), ATK/DEF, and the full effect text scrolling
inside the strip only. Under 56px it switches to compact mode (name +
stats on one line; tap opens the full card-info sheet — tapping the
strip always opens that sheet). It follows the most recent tap:
hand cards, field zones (face-up or own cards), action sheets, and
pile-list card info all call `setPreview()`; field-sourced previews
refresh their live stats on every render (signature-guarded, no DOM
churn). Default before any tap: the first card of the opening hand.

### Verification
- `test-layout.js` (new): ALL LAYOUT CHECKS PASSED — per-height fill
  (dead band 1/0/0px), baseline floor respected, preview shown +
  tap-updated at 800 (tapped 花と野原の春化精）, sizes byte-identical
  with a pile sheet open/closed, after a mid-duel resize event, and
  with the chain dock open (click-play reached a dock at both 660
  and 800).
- `test-ui.js`: ALL UI CHECKS PASSED, run twice (before and after the
  sampler repoint): run 1 — 62 then 72 turns, deck-out win, dismissal
  exercised; run 2 — 72 turns, deck-out loss (seat swap); retry
  warning never shown in any run, no stalls.
- `test-node.js`: PASS (699 conservation checks, 0 violations).
- `test-genesis.js`: PASS (retries 0, EMZ offers 0, EX-in-EMZ 0; the
  mid-duel total dips are the known pre-existing Xyz-overlay mirror
  artifact documented in the Genesis section, being fixed on
  client-fixes-2 — engine.js is untouched by this branch).
- Caveat: jsdom has no layout engine, so the measurements are the px
  inputs (CSS vars / `window.__layout`) that fully determine every
  box height in a real browser (all bars have explicit heights). A
  real-device visual pass is still the parent's browser check. Very
  short viewports (< ~620px, e.g. landscape) solve W down to the
  40px floor and may scroll — portrait phones are the target.

## Fix round 3: face-down summon identity in the mirror (branch client-fixes-3)

Two distinct mechanisms made the mirror lose (or mis-record) the identity
of face-down special-summoned monsters. Both are mirror-layer only;
answers to the core are untouched, and face-down cards still render as
card backs — this is about the mirror's internal identity record.

### Mechanism 1 — SPSUMMONING code 0 overwrote the known code (the B2 defect traced in fix round 2)

For a face-down special summon the core writes code 0 in MSG_SPSUMMONING
(operations.cpp, group-summon step 24 and rule-summon step 5: face-up →
`target->data.code`, face-down → 0). The monster's MSG_MOVE into the zone
just before carries the true code and the mirror records it — but
`GameState.apply` case 62 then overwrote the entry's code unconditionally
with the announced 0, and case 53 (POS_CHANGE) only filled the code when
it was `null`, so when the monster later flipped face-up and POS_CHANGE
carried the true code again, the 0 stuck forever.

Fix (`engine.js`, one invariant for every identity write: **0 on the wire
means "hidden/unknown" — it never erases a known code, and a stored 0 is
unknown exactly like `null`**):
- case 62 group (54 SET / 60 SUMMONING / 62 SPSUMMONING / 64
  FLIPSUMMONING): an existing entry's code is overwritten only by a
  non-zero announcement; the position still updates unconditionally.
- case 53 (POS_CHANGE): fills the code when the stored code is `null`
  OR 0, and only from a non-zero incoming code.
- Audit of every other code write in `apply`, same pattern fixed
  consistently: case 55 (SWAP — the entries themselves change slots, so
  identity travels with them; the corrective writes of c1/c2 are now
  non-zero-guarded) and case 31 (CONFIRM_CARDS hand reveal — now
  non-zero-guarded). Checked and left as-is, with reasons: case 50 MOVE
  (already skips code 0 wholesale; `_insertAt` writes the moving card's
  true code into a fresh entry), case 90 DRAW / 33 SHUFFLE_HAND /
  39 SHUFFLE_EXTRA (construct entries from authoritative wire lists; no
  known code is overwritten by an announcement), case 162 RELOAD_FIELD
  (creates `null`-code entries only in empty slots), `queryCard` parsing
  (reads the core's query buffer, never writes the mirror).

Deterministic reproduction — new `test-facedown.js` (seeded shuffle +
fixed core seed; the same explore policy as test-phase2 B; an independent
wire model tracks every monster zone's true code from raw messages, and
the live query is cross-checked at every prompt):
- Before the fix: 3 face-down SS with code-0 SPSUMMONING where the wire
  already knew the code （風魔神－ヒューガ 62340868, 古衛兵アギド
  62320425, 剣神官ムドラ 99937011 — all face-down Defense), **135
  wire-vs-mirror violations and 135 query-vs-mirror mismatches** over
  14,812 occupied-zone observations.
- After the fix: identical trajectories (same turn counts, same events),
  **0 violations, 0 mismatches**; 32 face-down→face-up transitions of
  wire-known monsters all carry the true code. MSG_RETRY 0, all duels
  complete.

### Mechanism 2 — Morphing Jar #2's set shuffle permutes identities (found during this round's verification)

With mechanism 1 fixed, test-phase2's B2 still failed intermittently
(~1 in 3 randomized runs). Wire captures (frozen at the failing prompt)
showed a different signature: a zone's MOVE-in code and SPSUMMONING(0)
name monster X, but the core query — and, in one capture, the monster's
own later POS_CHANGE — name monster Y (pairs observed: Vernusylph of
the Flowering Fields ↔ Morphing Jar #2, Keldo the Sacred Protector ↔
Vernusylph of the Flourishing Hills, Zolga the Earthbound Knight ↔
Morphing Jar #2; in each pair both monsters came from the same
excavation). Cause: Morphing Jar #2's script ends with
`Duel.ShuffleSetCard(g)` — the core physically permutes the just-set
monsters among their zones and emits MSG_SHUFFLE_SET_CARD (36), which
`apply` did not handle at all (fell to `default`). The message names the
affected slots, but the permutation itself is deliberately withheld:
in the core's writer (libduel.cpp `ShuffleSetCard`; same layout in the
group-set path in operations.cpp) the second loc_info list is an EMPTY
loc_info for every card except Xyz-material hosts — neither player is
meant to track which set card is which after the shuffle.

Fix: case 36 now records exactly what the wire discloses. Cards whose
post-shuffle slot IS disclosed (material hosts) are moved exactly;
every other affected slot's code is voided to 0 and flagged `shuffled`
(the physical permutation among them is unknown, so keeping the old
pairing would assert identities the core has permuted). Counts,
positions and entries are unchanged. `Duel.refreshFieldStats()` then
re-identifies flagged slots (monster and spell/trap zones) from the
live core query at prompt boundaries — the same sanctioned channel
Phase 2 introduced for live ATK/DEF — and clears the flag. A later
POS_CHANGE/SPSUMMONING naming the card also refills it via mechanism
1's rule. test-facedown's wire model applies the same honest rule
(permutation → unknown) and counts the messages: its deterministic
batch contains 1 SHUFFLE_SET_CARD and stays at 0 violations / 0 query
mismatches with the handling in place.

### test-phase2 B2 sampling note

test-phase2's B-section duels shuffle with real crypto, so whether a
given run's trajectories include a face-down SS or an MJ2 set shuffle
is duel-dependent — B2 is a sampling check, and a single quiet run
proves little either way. Baselines: B2 FAILED 4/4 runs on unmodified
main; with mechanism 1 fixed but mechanism 2 open it still FAILED in
4 of 12 runs. With both fixed: **B2 PASSED 10/10 runs** (2,508–9,213
occupied-zone observations per run). The deterministic guarantee lives
in test-facedown.js (non-vacuity gates: the batch must contain code-0
face-down SS events and face-down→face-up flips, and fails as vacuous
otherwise). Occasional remaining test-phase2 failures are sampling
vacuity in OTHER checks — B4 (no effect-modified ATK/DEF sighting in a
short run), C (no ANNOUNCE_CARD occurred), A2 (depends on C's captured
opcode stream) — and reproduce on unmodified main as well (B4 seen
there directly).

### Regression (MSG_RETRY 0 everywhere)

- `test-facedown.js` — PASS (see above; 14,812 observations, 0/0).
- `test-phase2.js` — B2 10/10 (see sampling note for other checks).
- `test-node.js` — PASS (620 conservation checks, 0 violations, final
  totals 58/55).
- `test-explore.js` — PASS.
- `test-genesis.js` — PASS (its `endDippedDuels` metric read 1 in 2 of
  5 runs here and ≥1 in 4 of 10 runs on unmodified main — the
  pre-existing exploratory-duel anomaly recorded in fix round 2, not a
  regression; the test's own gates pass on both).
- `test-overlay.js` — ALL PASS.
- `test-layout.js` — ALL PASS.
- `test-ui.js` (jsdom) — ALL UI CHECKS PASSED (both runs reached the
  result screen; retry warning never shown; no stalls).
## Layout fix round (branch client-layout-fix)

Real-browser verification of the layout phase found the duel stack
slightly EXCEEDING the visible height: the hand cards' ATK/DEF strip
was clipped by a few tens of px at the bottom edge, and the page does
not scroll, so it was unreachable. The jsdom arithmetic (test-layout)
had reported a dead band of 0–1px at 390×660/720/800, i.e. the model
believed the stack fit exactly.

### Root cause (with evidence)
The formula's per-element constants were NOT off. `LAYOUT_FIXED = 217`
was re-derived element by element from the CSS (all boxes are
border-box with explicit px heights): topbar 44 (incl. its 1px border)
+ 2 × (field padding 5 + pilebar 21+2 margins) + midbar 78 (padding 6
+ borders 2 + chainbar 21 + logline 15 + phasebar 34) + handbar extras
23 (label 13 + padding 10) + zone-row margins 16 = 217 exactly. The
only divergence available to a real browser goes the other way:
vertical margin collapsing inside `.field` (pilebar↔zrow,
zrow↔zrow) can make the real fields up to ~3px each SHORTER than the
model — the model is conservative there.

The wrong assumptions were on the height side, two of them:
1. **Zero tolerance by construction.** Whenever the preview strip is
   shown, the slack distribution consumes EVERY leftover px, so
   contentH == the height the formula budgeted against (dead band
   exactly 0 at 720/800/900 in the old model; 1px at 660). Any
   real-world shortfall translates 1:1 into clipped px at the bottom
   of the stack — and the last element in the stack is the hand bar,
   whose 14px ATK/DEF strip is the first thing eaten.
2. **`window.innerHeight` == visible height.** applyLayout read
   innerHeight once at duel start. In the verification browser (and
   in app webviews / mobile browser chrome states generally) the
   actually-visible height can be a few tens of px less than
   innerHeight — 100dvh semantics diverge the same way. That delta is
   precisely the observed clip ("a few tens of px").

### Fix: budget honestly, then measure and step down
Still entirely inside the duel-start click — no resize listeners, no
mid-duel changes; the freeze invariants are untouched.
- Budget height = **visual viewport height** (`window.visualViewport
  .height` when available, else `innerHeight`), floored, minus a
  **4px safety margin** (`LAYOUT_SAFETY`), so bottom strips are never
  flush with the screen edge.
- After the vars are applied, `measureStackBottom()` reads the real
  rendered bottom of the six in-flow sections (topbar, both fields,
  midbar, preview, handbar — absolute children like dock/sheet are
  excluded by construction) from `offsetTop + offsetHeight`. If it
  exceeds the allowed height, the budget is stepped down by the
  measured excess and the layout recomputed (shrinking order is the
  distribution's own: preview first, then hand growth, then the tile
  unit), re-measuring after each step, at most 16 steps. The loop also
  stops the moment a step can no longer shrink contentH — that is the
  minimum layout (W floor 40, no preview; formula stack 546px): if a
  viewport's visible height were below ~550px, even that cannot fit,
  the minimum layout is kept and `__layout.fit` reports `false`
  (nothing more can shrink; portrait phones are far above this).
- Where measurement does not exist (jsdom: all offsets are 0), the
  loop is inert and the corrected formula stands — `fit` reports true
  with `measured: 0` meaning "unmeasurable here".

`window.__layout` now also carries `budget`, `measured`, `fitSteps`,
`fit`, and `vh` is the height actually budgeted against (the visual
viewport height).

### Measured before / after (formula model, px)
Before: dead band 1 @390×660, **0 @390×720, 0 @390×800, 0 @500×900** —
zero tolerance, so the real-browser clip equalled the environment's
visible-vs-innerHeight delta.
After (dead = budgeted height − contentH; fit guaranteed against the
visual height + measurement):

| case | tile W | hand H | preview | contentH | dead |
|------|--------|--------|---------|----------|------|
| 390×660 | 57 | 97 | hidden | 654 | 6 |
| 390×720 | 59 | 99 | 52 | 716 | 4 |
| 390×800 | 59 | 129 | 102 | 796 | 4 |
| 500×900 (430 col) | 66 | 143 | 152 | 896 | 4 |
| 390, inner 800 / visual 760 | 59 | 129 | 62 | 756 | 4 (vs 760) |
| 390×800, rendered +28 phantom | 59 | 129 | 74 | 768 | measured 796 = allowed, 1 step |

The 40px visual shortfall and the 28px phantom overshoot both came
entirely out of the preview slack; the tile unit (59) never moved.

### Verification
- `test-layout.js`: ALL LAYOUT CHECKS PASSED — updated accounting
  (safety margin in [4,24) dead band) at 390×660/720/800 AND 500×900;
  freeze checks (sheet open/close, mid-duel resize event, chain dock
  open via click-play) byte-identical sizes; preview tap-update at
  800; new LAY-e (visualViewport honoured) and LAY-f (phantom +28px
  step-down converges in 1 step, measured fits exactly).
- `test-ui.js`: ALL UI CHECKS PASSED — run 1: 62 turns, deck-out win,
  duel-dismissal + autopass chip exercised; run 2 (seat swap, 後攻）:
  72 turns, deck-out; retry warning never shown in either run
  (MSG_RETRY proxy 0), 0 stalls.
- `test-node.js`: PASS (561 conservation checks, 0 violations).
- `test-genesis.js`: PASS (all seeds retries 0, EMZ offers 0,
  EX-in-EMZ 0, final totals exact).
- Caveat unchanged: jsdom cannot measure real rendering, so the
  step-down's real-browser behaviour is proven by construction + the
  stubbed-measurement case (LAY-f); a real-device visual pass remains
  the parent's browser check.

## CPU phase: a competent baseline bot (branch client-cpu)

The legality-only PoC bot is replaced by a heuristic policy in
`v2/engine.js` (`botAnswer` / `makeBotMemory` + helpers), written fresh
for this client in the spirit of the ygopro AI: it only ever chooses
among the current prompt's legal options and never touches legality.
Driver integration is unchanged for the human seat; the only driver
change is that `Duel.run` now refreshes live field stats
(`refreshFieldStats`) right before a bot-seat answer, so the policy
values monsters by their CURRENT atk/def (the human path already did
this from client.js). `GameState` now also retains the two decklists
(`state.deckLists`) for the policy's remaining-deck estimates.

### Fair information (structural, not by discipline)

The core's local message stream leaks hidden identities: playerop.cpp
writes `pcard->data.code` into MSG_SELECT_CARD unconditionally
(including opponent hand and face-down candidates), and MSG_DRAW /
MSG_MOVE feed real codes for face-down cards into the shared mirror.
So the policy never reads the raw state. Every decision goes through
`botView(state, me, data)`, which contains: own hand/extra in full;
opponent hand as count only (codes null); opponent field cells with
code null while face-down; graves/removed (public) verbatim; LP, deck
counts, phase/turn, the chain (codes of links are public once
activated) and live ATK/DEF from the core query. Prompt candidates are
masked the same way (`maskEntry`) before evaluation. The one exception
is principled: when an effect itself reveals a hand (Hand Destruction),
the candidates of THAT selection are the revealed cards. Decklist
knowledge used: the bot's own full list (a player knows their deck),
and for the opponent only public-zone accounting (what a human who
knows the fixed opposing decklist could infer) — used by
ANNOUNCE_CARD to name a feared card that can still be in the
opponent's deck. `test-cpu.js` asserts the masking on a captured live
state (6 checks).

### Behaviour summary

- Valuation: printed stats corrected by live query values; board value
  weighs battle power, Extra-Deck type, overlay units and boss
  monsters; hand value is a per-card table for the 63-card pool on top
  of a stat-based monster formula; discard cost discounts cards that
  profit from the graveyard (Kelbek/Agido mills, grave-trigger spells)
  and duplicates.
- Main phase order: board-reset flip (Chaos Pod) when clearly behind →
  best-scored activation (search/revival/removal/draw per-card gates,
  threshold-scored) → Medusa flip → special summons whose result beats
  their material cost (Xyz/Synchro material costing, contact-fusion
  piece accounting, Dark Guardian's three pieces; never trade a
  stronger board for a weaker result) → normal summon strongest
  sensible monster (set flip cards; set instead of summoning only when
  clearly outclassed AND the set is a real wall) → repositioning →
  set traps/quick-plays → battle only with a profitable or lethal
  attack plan.
- Battle: attack plans are scored per attacker/target pair (no suicide
  unless a full lethal line exists; weakest sufficient attacker first;
  face-down targets only for strong attackers); the chosen target is
  remembered and honoured at the follow-up target SELECT_CARD.
- Chains: pass by default. Respond at value ≥ threshold only:
  negations vs big monster effects / summon-negation windows / chain
  wars, Grave Hole vs hand/grave/banished monster effects, battle
  traps (Spiritual Swords / Blast Held / Moon) when the computed
  damage or monster loss justifies the cost and the LP cost is
  survivable, targeted protection (Gate Guardian fusions, Hyperion).
  Newly appeared opposing face-up monsters are detected by
  snapshot-diffing the public field between prompts.
- Selections: discards/costs cheapest-first by discard cost; targets
  biggest threat (face-down = judged by position only); tributes
  weakest loss per release point; searches are context-keyed (guardian
  pieces complete the trio, Foolish Burial Goods prefers Exchange of
  the Spirit / grave-profit spells, etc.); graveyard-return effects
  prioritise the opponent's grave resources; positions follow the same
  attack/defense logic; EFFECTYN/YESNO accept net-positive effects
  with deck-out guards on self-mills.

### Termination safety

Every prompt type has a bounded strategy: SELECT_UNSELECT_CARD moves
monotonically toward a desired set (toggle-on only when neither
finishable nor cancelable, so the selection size strictly grows to
max; symmetric difference strictly shrinks otherwise), plus a
per-signature streak guard in bot memory. SELECT_SUM runs a
node-capped DFS whose candidate order rotates with the driver's retry
count. IDLECMD activations/summons pass an attempt gate (max 2 per
turn per card) so a play whose selection sub-prompt gets cancelled
cannot be re-picked forever. The whole policy is wrapped: any internal
error degrades to a minimal legal completion for that prompt type
instead of throwing into Duel.run.

Two real defects were found and fixed during verification:
1. `discardCost` called `.includes` on a `Set` (GRAVE_PROFIT) and
   threw on EVERY discard/cost selection; the error fallback answered
   "first min cards" instead, and for Dark Guardian's cancelable
   material UNSELECT it answered -1 = "cancel the summon", which
   looped IDLECMD↔UNSELECT indefinitely. Fixed the call (`.has`); the
   attempt gate above is the structural backstop for that loop class.
2. The mirror-match harness initially gated final conservation
   per-seat; a control-changed card (Monster Reborn) legitimately
   ends some duels in the other seat's zones, so the gate is now the
   combined total (per-seat exactness reported: 38/40).

### Measured (test-cpu.js, deterministic seeded shuffles)

- Mirror matches, NEW vs OLD policy, 40 duels ({new seat 0/1} ×
  {decks normal/swapped}, 10 each): **NEW wins 37–3 (92.5%)**.
  Blocks: seat0/normal 10–0, seat0/swapped 8–2, seat1/normal 9–1,
  seat1/swapped 10–0. Average turns 16.7 (new-policy wins 13.0;
  the 3 old-policy wins are 62-turn marathons — the new GG seat
  losing long games is the known residual weakness).
- Activity per duel: NEW summons 9.00, attacks declared 4.80,
  activations 6.33 — OLD: 0.88 / 0.00 / 0.00 (the old policy summons
  at most one level≤4 per duel and takes toEP before battle).
- Max prompts in any duel: 672 (harness budget 6000; no stalls),
  MSG_RETRY 0 across all 40 duels, combined card conservation exact
  in 40/40.
- Full regression: test-node, test-explore, test-genesis,
  test-facedown, test-layout, test-ui, test-cpu all pass. Two
  documented exceptions: (a) test-overlay's HUNTER exercise
  thresholds were recalibrated (see the comment in that file: the
  GG deck has no Xyz and no level-4 monster, so all Xyz production
  is the hunter's, and a competent seat-1 policy contests it —
  measured 4 summons / 8 attaches, deterministic; the ACTIVATOR
  batch still exercises 10 Xyz / 20 attaches / 10 detaches and all
  correctness gates are unchanged); (b) test-phase2 has a
  pre-existing flake (B4/C/A2 depend on trajectories from the
  unseeded client shuffle): 4/20 runs fail on unmodified main a28cf9d
  with the same signatures.

### Known limits / fallbacks (not faked)

- SELECT_OPTION: answered with index 0. The prompts carry no usable
  context to rank options for the pool's option effects (the client
  has the same gap for the human UI — options are unlabelled there
  too until a strings table exists).
- ANNOUNCE_NUMBER: picks the largest offered value ≤ 8 (the response
  is an index into the options; no pool card's outcome hinges on it).
- Battle-target SELECT_CARD is recognised by phase + empty chain +
  the remembered attacker; if that signature misses (e.g. an attack
  declared during a chain-heavy battle step), it falls back to the
  generic biggest-threat target pick.
- The synchro material search enumerates subsets of the first 8
  candidates; larger candidate sets fall back to cheapest-first
  materials.
## Layout fix round 2 (branch client-layout-fix2)

Real-browser verification AFTER the layout fix round STILL showed the
hand cards' bottom ATK/DEF strip clipped at the screen's bottom edge —
the strip's upper half faintly visible, cards flush against the edge,
no dead band — while round 1's measurement had reported a fit. So the
round-1 step-down converged to a target the painted screen disagreed
with. This round re-does the measurement, not the distribution
(slack order, preview rules, freeze invariants and the card spec are
unchanged from the layout phase / fix round).

### Diagnosis: round 1 steered by document coordinates
Round 1's `measureStackBottom()` accumulated
`app.offsetTop + el.offsetTop + el.offsetHeight` over the six in-flow
sections. That sum is a **document-coordinate** bottom: the distance
from the document's top edge to the stack's bottom edge. It does not
move with scroll, and it knows nothing about where the visual
viewport sits. Round 1 compared it against a **viewport-coordinate**
budget, `visualViewport.height − 4`. The comparison is only sound
when the visible region in document coordinates is exactly
`[0, vv.height]` — i.e. when `scrollY == 0`,
`visualViewport.offsetTop == 0`, and `vv.height == innerHeight ==
documentElement.clientHeight`. Round 1 never read `offsetTop`,
`scrollY` or `clientHeight`, so it had no way to notice the identity
failing. The visible bottom in document coordinates is
`scrollY + vv.offsetTop + vv.height`; round 1 silently used
`vv.height` in its place.

Contributing structure on the CSS side: `#app` carries
`min-height:100dvh`, and 100dvh is the dynamic (largest,
chrome-hidden) viewport height in several webviews, so the document
box is routinely TALLER than the painted visible region while the
page does not scroll — document coordinates extend below the visible
bottom by construction, and a loop keyed to them certifies where the
stack ends *in the document*, never where it *paints*. Symptom
match: the formula content sat within `vv.height − 4` (fit, 4px
margin on paper) while the painted strip was still clipped by more
than that margin, flush at the edge. The delta between the modeled
target and the painted visible bottom is exactly what a
document-space loop cannot observe. (Which single environment quirk
supplied the delta in the verification browser — offset visual
viewport, a height signal disagreeing with the others, an overlay
band — cannot be separated from here; the point is that round 1's
loop was blind to all of them by construction.)

### Fix: steer by the painted rect, budget by the most conservative height
Still entirely inside the duel-start click — the mid-duel freeze is
untouched, there are no listeners and no re-fit.
- `viewportHeights()` collects every height signal once:
  `innerHeight`, `documentElement.clientHeight`,
  `visualViewport.height` / `visualViewport.offsetTop`. The formula
  budget starts from `baseH` = the SMALLEST positive signal (a 0
  reading means "no signal" — jsdom reports clientHeight 0 — and is
  ignored, never allowed to zero the budget). The safety margin is
  raised 4 → 6px (`LAYOUT_SAFETY`).
- The step-down now measures the stack's real bottom with
  `getBoundingClientRect()` over the same six in-flow sections
  (`measureStackRectBottom()`; a display:none section reads an
  all-zero rect and drops out of the max) and steps the budget down
  by the rect excess until
  `rect.bottom ≤ vv.offsetTop + vv.height − 6` (without a visual
  viewport, `innerHeight − 6`). Rect coordinates are the system the
  browser paints in, so the loop's target and its measurement now
  live in the same frame: any offset/overlay/accounting delta is
  inside the loop instead of outside it. Same bounds as round 1
  (≤16 steps, stop when a step can no longer shrink contentH; the
  minimum layout is then kept and the fit reports false).
- `measureStackBottom()` (document coordinates) is still computed,
  but as a record only — nothing steers by it anymore.

### What `window.__layout` now reports
So a real-browser check can read the numbers directly instead of
inferring them from a screenshot: the three height signals
(`innerHeight`, `clientHeight`, `vvHeight`), `vvOffsetTop`,
`visibleBottom` (rect-coordinate visible bottom,
`vv.offsetTop + vv.height`), the `budget` used, BOTH measured
bottoms (`measured` = document-coordinate, `rectBottom` = painted
rect-coordinate, null when unmeasurable), `fitLog` — one entry per
step with `{step, budget, contentH, measured, rectBottom}` — and
`fitSteps`. Fit semantics changed: `fitVisible` is true/false on
rect evidence (null when unmeasurable) and `fit` is now `true` ONLY
on a rect-verified visible fit, `false` on a measured non-fit, and
the string `'unmeasurable'` where no rect layout exists (jsdom) —
round 1 reported `fit: true` there on the formula's say-so.

### Verification
- `test-layout.js`: ALL LAYOUT CHECKS PASSED. The harness model was
  rebuilt on rect accounting: jsdom's all-zero rects make the plain
  cases assert the new honest semantics (LAY-a3: `fit ===
  'unmeasurable'`, `fitVisible === null`, formula stands; LAY-a4: the
  recorded signals + step log). Dead band is 6px at 390×660/720/800
  and 500×900 (margin raised to 6). Freeze checks (sheet open/close,
  mid-duel resize, chain dock via click-play), preview tap-update,
  hand scaling and LAY-e (visual 760 vs inner 800: pv 100 → 60, tile
  unit 59 unmoved) all still pass. New LAY-g simulates the round-1
  failure shape: innerHeight 800, vv.height 740, vv.offsetTop 30
  (visible bottom 770), painted bottom stubbed at
  `offsetTop + contentH + 48` — the first measurement reads 812,
  which a document-coordinate loop would have certified as fitting
  (contentH 734 ≤ 740 − 4) while 48px painted below the visible
  edge; the rect loop steps the budget 734 → 686 in 1 step and the
  painted bottom lands at 742 ≤ 764, `fit: true`, every step on
  record in `fitLog`.
- `test-ui.js`: ALL UI CHECKS PASSED — run 1: 62 turns, deck-out
  win, dismissal + autopass chip exercised; run 2 (seat swap, 後攻）:
  72 turns, deck-out; retry warning never shown in either run
  (MSG_RETRY proxy 0), 0 stalls.
- `test-node.js`: PASS (594 conservation checks, 0 violations).
- `test-genesis.js`: PASS (all seeds retries 0, EMZ offers 0,
  EX-in-EMZ 0). Its end-dipped-duel counter is a harness metric over
  crypto-shuffled decks and fluctuates between runs on unmodified
  main as well (0 in the baseline run taken alongside this round);
  the suite does not load client.js and its pass criteria are met.
- Not claimed: real-device success. jsdom cannot paint, so the rect
  loop's browser behaviour is proven by the stubbed-rect case (LAY-g)
  plus construction; the parent's real-browser pass reads
  `__layout`'s recorded numbers (fitLog / rectBottom /
  visibleBottom) and eyeballs the hand strip.

## Layout fix round 3 (branch client-layout-fix3)

Round 2's rect loop still certified a clip in the parent's real
browser (window ~1080 tall; hand flush at the bottom edge, the
ATK/DEF strip's lower half cut, no dead band, no scroll). This round
changed the evidence base first: a real browser engine was stood up
in the VM (headless Chromium 156 via the cached Puppeteer Chrome,
driving the actual page over a local HTTP server), and the round-2
code was measured in it before anything was changed.

### Reproduction (round-2 code, Chromium 156)

| scenario | signals ih/ch/vvH/vvTop | fit-recorded rectBottom | painted stack bottom (post-render) | hand bottom | preview rect vs --pv |
|---|---|---|---|---|---|
| 430×1080 | 1080/1080/1080/0 | 685 | 1069 | 1069 | 330 = 330 |
| 390×844 | 844/844/844/0 | 485 | 833 | 833 | 144 = 144 |
| 390×720 | 720/720/720/0 | 361 | 709 | 709 | 50 = 50 |
| 390×696 (compact pv) | 696/696/696/0 | 337 | 685 | 685 | 26 = 26 |
| 430×1080, vv faked 1067 @ offsetTop 13 | 1080/1080/1067/13 | 672 | 1056 | 1056 | 317 = 317 |

Findings:
- **The fit loop measured a skeleton.** applyLayout runs inside the
  start-button click, before the duel's first render: the four zone
  rows are empty divs, so the loop's recorded rectBottom understates
  the painted stack bottom by exactly the four zone rows (384px at
  430×1080 = 4 × slotH 96; 348px at 390 widths = 4 × 87). `fit:
  true` was certified against a stack ~⅓ shorter than the real one;
  no overshoot smaller than that blind spot could ever engage the
  step-down. This — not the formula — is why two rounds of
  formula-side fixes did not converge in the real environment.
- **In honest Chromium no signal overstates**: innerHeight =
  clientHeight = vv.height everywhere, and the painted bottom is
  formula contentH − 5 (margin collapsing), i.e. the formula itself
  is honest and the strip is fully visible in every honest scenario
  (screenshot pixel check: strip text present). The parent's
  environment must supply a delta honest Chromium does not have.
- **The offset target overstates by exactly offsetTop**: with vv
  faked to height 1067 / offsetTop 13 in a 1080 window, round 2's
  target (visibleBottom = offsetTop + height = 1080) sits 13px
  below the rect-coordinate visible bottom (1067) — with the 6px
  margin, a stack painted to 1074 passes the loop while ~7px of it
  (half the 14px strip) is past 1067. Matches the observed symptom.
- **Preview min-content growth: ruled out.** The preview's rendered
  height equals its --pv budget exactly in every state tested
  (330 full / 144 / 50 compact / 26 compact). No cap was added —
  there was nothing to cap. Fonts likewise cannot grow the stack
  (no webfonts; every in-flow text sits in a fixed-height box).

### Fix (client.js only; distribution order, preview rules, card
spec, DOM contracts unchanged)

- **Post-render settle.** The fit pass runs once more after the
  duel's first render: armed by the start click, fired from the
  duel's first `onUpdate` (engine order: state updates are
  delivered after each message batch, strictly before the first
  prompt is answered; a fallback at the head of the first
  humanAnswerer call covers any engine path that skips it). It
  continues from the standing budget — sizes only ever shrink —
  and records `settleRectBefore` (the painted bottom the start
  pass was blind to). One-shot, no listeners: this is part of the
  duel-start sizing, and the mid-duel freeze is untouched
  (test-layout freeze checks snapshot AFTER the settle point).
- **Conservative target.** `visibleBottom` is now the minimum of
  the rect-coordinate candidates {vv.height, vv.offsetTop +
  vv.height, clientHeight, innerHeight} (positive readings only) —
  when the signals disagree, the largest is distrusted. The safety
  margin is 8px (was 6). Distrust costs at most a larger dead band;
  it cannot clip.
- `window.__layout` additionally records `handRectBottom`,
  `settled`, `settleRectBefore`, and fitLog entries now carry a
  `pass` tag ('start' / 'settle'); `fitSteps` accumulates across
  both passes.

### Diagnostic readout (?layoutdebug=1)

With `?layoutdebug=1` in the URL, a small fixed-position text block
(bottom-left, monospace, dismissible via its ×) shows the final fit
state as TEXT: all height signals + vv offsetTop, baseH, target,
budget, contentH, rectBottom, handBottom, fit, fitSteps, settled +
settleRect. Rendered at each fit pass; absent entirely without the
parameter (no DOM change — test-layout LAY-i2). Verified in
Chromium at 430×1080: block at (4, 984)–(272, 1076), text matches
`__layout`, × dismisses it. This exists because the parent's
verification harness cannot evaluate JS in the page — `__layout`
was unreachable there; now the numbers are on the screen.

### Verification (round-3 code, Chromium 156)

| scenario | target | budget | settleRectBefore | final rect / hand bottom | fit |
|---|---|---|---|---|---|
| 430×1080 | 1080 | 1072 | 1067 | 1067 | true — on the settle's post-render measurement |
| 390×844 | 844 | 836 | 831 | 831 | true |
| 390×720 | 720 | 712 | 707 | 707 | true |
| 390×696 | 696 | 688 | 683 | 683 (preview 24 = budget) | true |
| vv 1067 @ +13 | 1067 | 1059 | 1054 | 1054 — clears the conservative bottom by 13 | true |

fitLog now shows both passes (start: skeleton 683 → settle: real
1067 at 430×1080), so `fit: true` is backed by a measurement of
the rendered stack for the first time. Screenshot pixel checks:
the strip's text row is present in every scenario.

- `test-layout.js`: ALL LAYOUT CHECKS PASSED — updated accounting
  (8px margin; LAY-g converges to ceiling 732 / budget 654 with the
  settle entry on record; new LAY-a5 settle bookkeeping, LAY-h
  target rule, LAY-i diagnostic readout). Freeze checks unchanged
  and passing.
- `test-ui.js`: ALL UI CHECKS PASSED (both runs; retry warning
  never shown — MSG_RETRY proxy 0).
- `test-genesis.js`: PASS (all seeds retries 0, EMZ offers 0,
  EX-in-EMZ 0, final totals exact).
- `test-node.js`: PASS with 0 retries in the majority of runs —
  with two pre-existing, trajectory-dependent failure classes
  recorded below (both reproduced on unmodified main).
- Not claimed: the parent's browser. What changed there is
  measurable by the parent directly: open `/v2/?layoutdebug=1`,
  start a duel, and compare `handBottom` against `target` on the
  readout — the settle guarantees the painted stack was measured
  after rendering, and the target now distrusts the largest signal.

### Pre-existing issues observed during this round (NOT regressions)

`test-node.js` intermittently fails (~1 in 3–6 runs for the first
class, ~1 in 2–5 for the second; deck order is crypto-shuffled per
duel, so trajectories differ run to run). Two distinct classes,
BOTH reproduced on UNMODIFIED main with identical signatures, and
this round touches no engine code (client.js + test-layout.js +
this file only), so neither can be an effect of this round:
1. Conservation signature: at some SELECT_CHAIN the mirror totals
   read P0 59 / P1 54 (expected 58/55) — one card counted for both
   seats / missing from one — persisting across prompts, then
   recovering; final totals exact (58/55), retries 0. A
   mirror-accounting defect around a card moving between the two
   players' control/zones; display-side only (the core's state
   decides the duel). Reproduced on main, run 5 of a capture loop.
2. Answer-rejection signature: the harness's own bot policy
   answers a SELECT_CARD the core rejects, 13 retries, stopReason
   "answer rejected repeatedly (SELECT_CARD)"; conservation
   violations 0, duel aborts without a winner. A defect in the
   shared bot-answer policy (engine.js) for some selection state.
   Reproduced on main, run 2 of a capture loop.
Both are flagged for a future fix round; neither is addressed
here (out of this round's layout-only scope). The remaining
suites above are deterministic in this environment and pass.

## Layout fix round 4 (branch fix/layout-short-height)

Trigger: on the user's phone (iPhone, in-app webview, ~650–700px
usable height) BOTH ATK/DEF strips — the hand strip (.hstats) and
the board strip (.slotstats) — read as clipped, after three layout
rounds had certified the stack in a real browser at 998px visible.
The parent's own real-browser pass at 1919×998 (?layoutdebug=1,
turn 5) reproduced the contradiction exactly: fit=true,
settled=true, budget 990 / contentH 990 / rectBottom 985 /
handBottom 985 — yet both strips visibly cut. Board symptom: the
"ATK DEF" labels read fine, the numbers' lower half is hidden, as
if covered by the next zone row. Hand symptom: turn 1 the numbers
sit at the screen's bottom edge cut in half; turn 5 (6 hand cards)
the numbers row is gone entirely, names only, with a horizontal
scrollbar at the bottom.

### Root cause (measured, headless Chromium 156, pre-fix code)

Not a stack-height defect at all, and NOT height-dependent. At
390×{620,700,998}, fit=true throughout, every measured stat span
was **28px tall inside a 14px (.hstats) / 15px (.slotstats) strip**:

- The strips were one flex ROW of two spans. One-line content:
  "ATK 3750" = 41.6px, "DEF 3400" = 42.8px (measured, 9px label /
  10px bold digits) — a pair needs ~83px; strip inner widths are
  53px (slot at W=59) to 64px (hand at handW=70). It cannot fit on
  one line at ANY viewport size.
- flex-shrink narrowed each span to 24–33px; the text wrapped at
  the label/number space into two ~14px lines ("ATK" over "3750").
- The 28px span, centered in the strip, protruded ~7px above and
  ~7px below. Below the strip lies the slot's / card's own bottom
  edge (overflow:hidden) → the number line's lower half is clipped
  exactly as reported; the upward protrusion crowds the tile above
  it ("rows look packed / covered by the next row").
- The fit loop measures BOX bottoms (handbar, stack). Every box
  was inside the target while the glyphs inside the strips were
  cut — three rounds of stack work were treating a healthy
  quantity because the instrument never looked inside the strips.

Aggravator (hand, classic-scrollbar environments only): at 6+
hand cards #hand scrolls horizontally; a classic horizontal
scrollbar renders INSIDE #hand's fixed height and eats the bottom
~15px of every card — the whole strip — matching the parent's
turn-5 observation. iOS overlay scrollbars consume no space, so
the phone symptom is fully explained by the wrap alone.
Hypotheses considered and set aside: (b) WKWebView text
inflation — not needed to explain any observation (the wrap
reproduces the full symptom set in honest Chromium at 998px with
all signals in agreement); the standard text-size-adjust:100%
hardening was still applied (below). (c) in-app webview chrome
overstating every height signal — likewise unnecessary; the
round-3 conservative target (minimum of the signals) stays as
defense in depth.

### Fix

- CSS (index.html): the strips are now two STACKED lines (ATK
  line over DEF line), each `white-space:nowrap` with an explicit
  11px line-height inside a 22px strip (flex-direction:column),
  label 8px / digits 9px bold, letter-spacing −.5px. Measured
  worst line "DEF 3400" = 38.3px at these sizes, ≈35.8px with the
  letter-spacing — inside even the minimum tile's 36px inner
  width (W=40, padding 0 2px), so the wrap cannot recur; a
  pathological 5-digit value can now only graze horizontally
  inside its own line, never fold vertically. .slot.hs .tile
  bottom offset 16px → 23px to match. #hand's scrollbar is hidden
  (scrollbar-width:none + ::-webkit-scrollbar) so a classic
  scrollbar can never eat the strip; touch/wheel scrolling is
  unaffected. html gets text-size-adjust:100%.
- Model (client.js): layoutParts budgets the strip at 22px for
  both slot and hand (slotH = imgH + 22; handH = handImgH + 22).
  Fallback CSS vars updated (--sh 79px, --hh 90px).
- The fit loop now measures the strips themselves
  (measureStripClip: strips whose scrollHeight exceeds
  clientHeight) and fit requires zero clipped strips wherever
  strip layout is measurable — this failure class is inside the
  guarantee from now on, and the ?layoutdebug readout prints
  stripClip. The start+settle-only timing is unchanged (no
  listeners added; the board still never resizes mid-duel).
- test-layout.js: added the 390×620 and 390×600 boot cases, the
  LAY-s0..s6 strip-contract checks, and scoped the 47×60 baseline
  (LAY-a2) to vh ≥ 660 — at 600/620 the two full strip lines cost
  real tile size (this is the round's one deliberate trade: tiles
  shrink at the shortest heights so the numbers fit whole). The
  chain-freeze click play (b3) runs at 660/800 only (height-
  independent path, proven there; bounds suite time). LAY-g6's
  expected standing bottom moved 732 → 727: with 22px strips the
  step-down arithmetic lands the standing stack at 30 + 649 + 48
  (verified in the test's own printed record).

### Verification (Chromium 156, fixed code, real duels)

- 390×998 (the parent's condition): stripClip=0, tile 59×94,
  contentH 990 = budget, rectBottom 985, handBottom 985,
  fit=true. Crop of a board monster's strip: "ATK 2400 /
  DEF 2400", both lines complete.
- 390×700: stripClip=0, tile 57×92, handH 105, contentH 690,
  rectBottom 685, handBottom 685, fit=true.
- 390×660 (start): stripClip=0, tile 51×84, handH 96, contentH
  649, rectBottom 644 — the opening hand's strip reads "ATK 1400 /
  DEF 1000" complete in the screenshot.
- Short heights (confirmation run, start + mid-duel): 390×600 —
  tile 42×73, handH 83, contentH 592 = budget, dead band 8,
  rectBottom/handBottom 587, fit=true; 390×620 — tile 44×76,
  handH 85, contentH 606 vs budget 612, dead 14, bottoms 601,
  fit=true; 390×660 mid-duel — tile 51×84, handH 96, bottoms
  644, fit=true. At every one of these heights, every measured
  span (hand + board, up to 14 strips per snapshot) is a single
  11px line with 0 spans outside their strip box. (stripClip
  reads 0 in the on-page readouts — see the 660/700/998
  screenshots; a __layout snapshot can also read null when the
  settle lands before the first hand render, the same
  "unmeasurable" convention as the rect channel. The direct span
  geometry above is the verification instrument at 600/620.)
- Every measured span at every height is a single 11.5px line
  inside its 22px strip (was: 28px in 14/15px). Screenshots:
  ~/workspace/duel-app-fix-layout/shots/ (before-*, before2-*,
  after-* per height, start + mid-duel).
- Full suite, all passing: test-node, test-explore, test-phase2,
  test-investigate, test-ui, test-genesis, test-overlay,
  test-facedown, test-layout (incl. the new cases), test-cpu,
  test-cpu-tune, test-cpu-tune2, test-ggfusion, test-swap.
  Not measured here: iOS/WKWebView itself (no such engine in this
  VM) — the two iOS-specific hypotheses are addressed by the
  conservative signal target (unchanged) and text-size-adjust,
  and the defect class itself is engine-independent CSS.

## CPU tuning round (branch client-cpu-tune)

Trigger: a real-browser game (human Ishizu vs CPU Gate Guardian) in which
the CPU set one face-down monster on turn 2 and then never summoned
face-up and never attacked in 5 turns, while its deck fell 40→24.
Question posed: (a) hand composition, (b) policy thresholds, or
(c) defect? Answer: all three occur, but the dominant cause was (c) —
four defects, each measured at the wire/score level — on top of a deck
whose early game is genuinely thin (a).

Method: `v2/test-cpu-tune.js` — 12 seeded duels of this exact matchup
(GG = seat 1 with the shipped policy, Ishizu = seat 0 with the shipped
policy), per-turn logging of the GG bot's own hand (diagnostic harness
only; the shipped policy still decides from the fair masked view), its
IDLECMD offers and choices, and a classification of every bot turn 1–5
that produced neither a face-up body nor an attack.

Deck facts (v2/data.json, recipe_gg.txt): the GG main deck has 18
monsters, of which only 4 are level ≤4 (メデューサ・ワーム ×1,
沼地の魔道王 ×3 — all ATK 500), 3 are level 5 (シャドウ・グール) and 11
are level 7+ needing two tributes or a cheat-out. Its real early game
is: 迷宮の重魔戦車 (no-tribute summon, cannot attack the turn it is
summoned), 融合派兵, Wall Shadow ② / Heavy Tank ③ piece placement, and
シャドウ・グール. A no-monster opening hand is common (seed 91035's
opener was six spells/traps); turns with literally nothing summonable
offered are the deck, not the bot.

Classification (bot turns 1–5, 12 duels), before → after fixes:
OFFERED_BUT_NO_BODY 17 → 9, NOTHING_OFFERED 4 → 8. The residual
no-body turns after the fixes are mostly placement turns (the deck's
setup line) or genuinely empty offers.

### Defects found and fixed (all in v2/engine.js, bot policy only)

1. **Wall Shadow ② never fired.** `activationScore`'s first
   `case CC.WALL_SHADOW` matched every activation entry for the card —
   including the face-up field spell's own piece-placement effect —
   and returned `fieldUp ? 0 : 1050`, so the placement scored 0 at
   every traced prompt. A second, correct case existed later in the
   switch but was unreachable (first match wins). Fix: SZONE entries
   route to a new `guardianPlaceScore()`; hand entries keep the
   field-activation score; the HEAVY_TANK case uses the same helper.
2. **Tribute sets liquidated the board (largest effect).**
   `pickSummon`'s set branch compared only the set card's own value
   while the core charges SELECT_TRIBUTE for level 5+ sets. Measured:
   Suijin set tributing a face-up 2400 Tank plus Swamp King; Sanga set
   tributing Tank plus a face-down Kazejin — the bot repeatedly
   destroyed its only attackers to set a wall. Fix: the set branch now
   charges tributes exactly like the summon branch (Heavy Tank = 0
   tributes) before comparing gains.
3. **SELECT_CARD retry-loop stall (shared policy code, Ishizu seat).**
   After Castel's Xyz summon, the same-turn detach prompt (OVERLAY
   candidates, min = max = 1) matched the pendingSummon Xyz-material
   branch, which answered 2 picks → rejected → deterministic retry
   loop → driver abort (seed 91063: 13 retries, duel lost). Fix: that
   branch now requires min ≥ 2 and all-MZONE candidates, and clamps
   the pick count to the prompt's max.
4. **Placement picks duplicated pieces.** The deck-search selection
   branch (which captures all-DECK candidate lists before any later
   branch) ranked placement candidates by hand value, so Wall Shadow
   placed Sanga, then Sanga again, while Kazejin/Suijin sat in the
   deck. Fix: a dedicated placement branch for the WALL_SHADOW /
   HEAVY_TANK contexts, placed *before* the deck-search branch,
   prefers a piece name not already face-up on our field, deck copies
   before hand copies.
   Also in `pickSpsummon`: face-up S/T-zone pieces now count as field
   materials in the fusion valuation (previously monster-zone only).

### Finding: contact fusions are never offered in this build

With all three distinct pieces face-up in the S/T zone, across dozens
of MAIN1 IDLECMDs the core offered no special summon at all; a control
rig with two distinct pieces face-up in the *monster* zone was
likewise never offered the two-piece fusion. The shipped card scripts
are byte-identical to the edo repo's, so this is core/script-stack
behaviour, outside the bot policy: the bot cannot take a summon the
core never offers. Consequences: fix (4)'s S/T-zone material
accounting is correct-by-text but currently inert for the two-piece
fusions, and the deck's working boss routes in this build are
ダーク・エレメント and 闇の守護神－ダーク・ガーディアン's procedure.
Worth a separate engine-side investigation.

### Measured (test-cpu-tune.js, same 12 seeds, before → after)

- Duels completed: 11/12 (seed 91063 aborted on defect 3) → **12/12**,
  MSG_RETRY 0.
- GG attack by bot turn 5: 9/12 (75%) → **10/12 (83%)**.
- Attacked at all during the duel: → **12/12**; average first-attack
  bot turn 4.64 → **3.25**.
- Face-up summon at all: 12/12 → 12/12; average first-face-up turn
  1.42 → 2.08 (slightly later on average: the bot now builds the
  placement line and no longer throws bodies away as set fodder —
  attacks, the metric that matters, start earlier).
- GG wins in the sample: 7/12 after the fixes.

### Re-verification

- test-cpu.js mirror suite: new policy **40–0** vs the old policy
  (CPU-phase baseline was 37–3), MSG_RETRY 0, activity per duel
  6.40 summons / 5.33 attacks / 6.78 activations.
- Stall hunt: 20 fresh-seed matchup duels (seeds 31000+i·13), 20/20
  completed, 0 retries.
- Regression: test-node / test-explore / test-genesis / test-overlay /
  test-facedown / test-layout / test-ui all pass, MSG_RETRY 0.
- Harness note (not policy): the Duel driver's `botAnswerer` must be
  synchronous, as in every shipped harness — an async one feeds
  promises to the core as responses and every duel stalls at the first
  SELECT_CHAIN.

## GG contact fusions: root cause and fix (branch engine-gg-fusion)

Resolves the CPU tuning round's open finding ("contact fusions are
never offered in this build"). Verdict: **(a) a defect in our own
setup layer** — not the core, not the scripts, not the rig's game
state.

### Root cause (each link measured)

1. `Duel.run`'s `addDeck` registered Extra Deck cards with `pos = 1`
   (POS_FACEUP_ATTACK), the same value used for main-deck cards.
2. `OCG_DuelNewCard` (core ocgapi.cpp, duelist-0 path) stores
   `info.pos` verbatim, and nothing later resets an Extra Deck card's
   position. Direct core query (`poc_query_card`, QUERY_POSITION) at
   the first IDLECMD: all five GG Extra Deck cards sat at **pos 1 —
   face-up in the Extra Deck**.
3. The contact procedure is an `EFFECT_SPSUMMON_PROC` whose condition
   is `Fusion.ContactCon` (proc_fusion.lua):
   `res = c:IsFacedown() and c:CheckFusionMaterial(m, nil, chkf)`.
   For a face-up Extra Deck card the first conjunct is false forever,
   so the offer never reaches the IDLECMD spsummon list — silently:
   no Lua error is raised anywhere (stderr clean throughout).
4. Materials were never the problem: the same rig queries showed
   Sanga (25955164) and Kazejin (62340868) face-up on the field with
   correct codes/stats while the spsummon list stayed empty.
5. Why only contact fusions died: the Xyz/Synchro/Link procedure
   conditions do not gate on `IsFacedown()` (grep over the shipped
   proc_*.lua), and the deck's other boss routes (Dark Element,
   Dark Guardian's own procedure) summon by card effect, not by
   SPSUMMON_PROC. Everything else in the app was unaffected.

Ruled out with evidence: all 25 global scripts in data.json are
byte-identical to the ProjectIgnis/CardScripts snapshot in
~/workspace/ocgcore-poc (as are the GG card scripts, per the tuning
round), and the piece constants (CARD_SANGA_OF_THE_THUNDER 25955164,
CARD_KAZEJIN 62340868, CARD_SUIJIN 98434877,
CARDS_SANGA_KAZEJIN_SUIJIN) are defined with the correct values.

### Fix

One registration value in `v2/engine.js` (`Duel.run` addDeck): Extra
Deck cards are now registered face-down, `POS.FD_DEF` (0x8) — the
position the core itself maintains for deck/extra cards. Main-deck
registration is deliberately left at pos 1: no failing consumer of a
main-deck card's stored position was found (core move operations
assign positions as cards leave the deck), and this round changes
only what the evidence indicts. (The retired PoC copy in `poc/duel.js`
has the same registration pattern; it is not the shipped client and
was left alone.)

### Proof — v2/test-ggfusion.js (new)

Labeled cheat rig: pieces injected with `poc_new_card` just before
`poc_start` (not played from hand); assertions use direct core
queries, not the JS mirror. Before the fix: **zero spsummon offers in
every variant** (pieces MZONE, pieces SZONE, all three pieces across
MZONE+GY). After the fix, 12/12 assertions pass:

- Extra Deck fusion queries pos 8 (face-down) at the first IDLECMD.
- Two-piece 雷風魔神 (34904525) is offered with the pieces face-up in
  the monster zone AND with the pieces face-up in the S/T zone (the
  deck's real Wall Shadow / Heavy Tank line).
- Taking it completes: materials banished, fusion on the field,
  MSG_RETRY 0.
- 合体魔神 (8505920) is offered with Sanga+Kazejin on the field and
  Suijin in the GY, and taking it banishes all three (GY included).

### Effect on the GG matchup (test-cpu-tune.js, same 12 seeds)

The shipped policy now takes the fusion route when pieces assemble —
verbose log shows `1:合体魔神` / `1:水雷魔神` / `1:風水魔神` /
`1:雷風魔神` spsummon choices and fusion monsters face-up on the GG
field across the sample. Distribution vs the tuning round's
post-fix numbers: GG attack by bot turn 5: 10/12 → **12/12**; average
first-attack bot turn 3.25 → **1.67**; GG wins 7/12 → **11/12**;
no-body classifications 9 → 5. The tuning round's fix (4) — S/T-zone
pieces counting as fusion materials — is live now rather than inert.
Balance note: the matchup has become one-sided in the GG seat's
favour in this sample; that is a policy/balance question, not a
correctness one.

### Regression (all on this branch)

test-node ✓, test-explore ✓, test-genesis ✓, test-layout ✓,
test-ui ✓ (ALL UI CHECKS PASSED), test-cpu ✓ (mirror 40/40),
test-cpu-tune ✓, test-phase2 ✓ (all checks, this run),
test-investigate ✓ (completes, conservationOk), test-ggfusion ✓.
MSG_RETRY 0 everywhere. Two harness gates needed correction for
trajectory changes caused by the (correct) new behaviour — the
correctness gates in both files are untouched:

- **test-overlay ACTIVATOR final totals**: seed 22 now ends with the
  GG seat's Labyrinth Heavy Tank (35026117) under seat 0's control
  (per-seat 59/54, combined 113 exact, wire model exact, retries 0) —
  the documented control-change-at-end phenomenon. The gate now also
  accepts a per-seat mismatch fully explained by a foreign-pool card
  present at duel end (the two pools are disjoint, so the detection
  is exact); it reports `endCtlChanged` alongside `endExact`.
- **test-facedown non-vacuity**: the original four seeds stopped
  producing face-down special summons entirely under the new GG lines
  (fdss 0; every correctness check still 0 violations — Morphing
  Jar 2 simply never flips in those games now). Seed 7 was added to
  the batch (fdss 4, SHUFFLE_SET_CARD 2, 35 fd→fu transitions);
  original seeds and all gates unchanged.
## CPU tuning round 2 (branch client-cpu-tune2)

Trigger: a second real-browser game (human Ishizu vs CPU Gate
Guardian) on the round-1 build. Progress there was real (turn 2:
Swamp King face-up, Wall Shadow placed, one backrow set), but across
CPU turns 2/4/6/8/10 the CPU never attacked — on turn 10 the human
field was completely empty and it still did not declare a direct
attack with its face-up ATK-500 monster — and turns 4/6/8 were
draw-only while its hand grew 4 → 5 → 6. Round 1's harness (both
seats = shipped policy) could not reproduce this: its Ishizu seat
plays real lines, while the browser human played a passive shape.

Method: `v2/test-cpu-tune2.js` — seat 0 is a SCRIPTED PASSIVE HUMAN
(summon the strongest monster face-up in attack position, attack the
CPU's monster, pass every chain, never activate, never set; only
mechanical sub-selections are delegated to the shipped answerer),
seat 1 is the shipped GG policy going second. Every GG IDLECMD /
BATTLECMD / POSITION prompt of the first 6 bot turns is traced with
the bot's own hand (diagnostic harness only — decisions still go
through the fair masked view), the offers, and each offer's score
from the policy's own scorers, exposed read-only as `Engine.debug`
(additive, inert; also used to run the identical yardstick against
the pre-fix engine for before/after counts). Scan: 120 seeded duels,
560 traced bot turns. NOTE: this branch is based on main 72f86b6,
which predates the engine-gg-fusion fix (Extra Deck registered
face-down, contact fusions offered). All numbers below are measured
on that base; the fusion fix lands separately and the suites should
be re-run on the merged tree.

### Classification of the 202 no-attack bot turns (before fixes)

- CANNOT_ATTACK_THIS_TURN 57 — named legal restrictions, not
  defects: 迷宮の重魔戦車 cannot attack on its summon turn (its own
  text), and — found by tracing seed 70195 turn 5 down to the core —
  the bot's OWN face-up 《ラビリンス・ウォール・シャドウ》 ① bars any
  monster of printed level ≤ 4 from attacking on the turn it is
  summoned / flip summoned / special summoned. A flip-summoned
  メデューサ・ワーム (lv 3) was flipped by the new stand-up line,
  entered the battle phase, and the core correctly offered it no
  attack entry that turn (it attacked from the next turn). The same
  ① is what killed the browser human's attackers (③ destroys an
  opposing monster with ATK < 1600 at the start of their battle
  phase — Straton/Kelbek/Kerudo/Karbon all qualify).
- NO_ATKPOS_MONSTER 141 — the deck's thin early game (no monster /
  set-only) plus the actual defect below.
- DECLINED_UNPROFITABLE 3, PLAN_BELOW_240 1 — judgment calls into
  opposing monsters by the unchanged attackScore / 240-bar rules.

The defect, isolated with strict event definitions (monster already
on the field at turn start, repositioning actually offered, and
standing it up profitable by the policy's own attackPlans measure):

- DEF_LOCK 10 turns, FREE_DIRECT_DECLINED_DEFONLY 8 turns (all
  沼地の魔道王, face-up DEF 500/1100, opposing field empty): the bot
  summons Swamp King in face-up DEFENSE (positionAnswer: DEF 1100 >
  ATK 500, and the opposing 1500 attacker made ATK position wrong at
  summon time). After that, `idleAnswer`'s reposition branch only
  ever stood a face-up defender up when its ATK was ≥ 1600 — a
  500-ATK defender therefore stayed in defense for the whole game,
  `hasProfitableAttack` only counts attack-position monsters, the
  battle phase was never entered (the MAIN1 tail checks toEP before
  the toBP fallback), and the free direct attack never happened.
  FREE_DIRECT_DECLINED_ATKPOS was 0 throughout: with a ready
  attack-position attacker the planner already always attacked.

### Draw-only turns: 24 of 560 (4.3%), every card gate-attributed

- WAITING_FOR_TRIO 38 card-instances: guardian pieces and
  ダーク・エレメント held for the trio payoffs. In seed 70130 the
  trio was complete across hand + placed S/T pieces yet the core
  offered no payoff — on this base that is the (separately fixed)
  Extra-Deck registration issue, not policy passivity; the policy's
  patience is correct once the offers exist, so it is kept.
- NOT_OFFERED_BY_CORE 72 card-instances: core legality, not policy —
  テラ・フォーミング with no field spell left in deck to search;
  闇の護封剣 with no face-up opposing monster to flip; traps not in
  the sset offers because the S/T zone was full (placed guardian
  pieces occupy it — the cost of the placement line itself).
- ACT_SCORE_LT_500 20 card-instances, all correct declines:
  シャドウ・グール's hand effect scored 0 with Wall Shadow already
  face-up (×13; it also was not summon-offered in those turns — no
  tribute on the field), and a duplicate Wall Shadow scored 0 with
  the field spell already up (×7). No activation gate was changed.

### Fixes (v2/engine.js, bot policy only; fair view unchanged)

1. `profitableAttackIfStood()` (new): would standing / flipping a
   given monster up create an attack worth making, judged by the
   same attackPlans / lethalPlan evaluation the battle phase uses
   (any ATK > 0 against an empty opposing field; the usual 240 bar
   into monsters)?
2. `idleAnswer` reposition loop: a face-up DEF monster below the
   old 1600 line is now stood up in MAIN1 when (1) says yes — except
   a working wall (its DEF currently holds the opponent's strongest
   attacker: DEF ≥ oppPow > ATK). A face-down monster (never Chaos
   Pod — its flip is a board reset with its own branch) is flip
   summoned to attack under the same test and guard, with one named
   exception: under our own face-up Wall Shadow, a printed-level ≤ 4
   monster cannot attack on its flip-summon turn anyway (① above),
   so the flip-for-attack is skipped (its flip effect is still
   judged by the dedicated branches).
3. `hasProfitableAttack`: an empty opposing field plus any ready
   attack-position attacker (ATK > 0) now counts as profitable — a
   direct attack can only gain, the attacker survives it by
   definition — so the battle phase is entered.
4. `battleAnswer`: with an empty opposing field and no plan above
   the 240 bar, the weakest direct attacker is sent anyway (same
   reasoning), instead of ending the phase.

Not changed: attackScore and the 240 bar for attacks INTO monsters,
positionAnswer (the summon-time DEF choice was correct when made),
any activation gate, and all fusion / material patience.

### Measured (same 120 seeds / yardstick, before → after)

- DEF_LOCK 10 → **0**; FREE_DIRECT_DECLINED_DEFONLY 8 → **0**;
  FREE_DIRECT_DECLINED_ATKPOS 0 → 0.
- Empty-opposing-field MAIN1 situations attacked that turn:
  241/303 → **251/303** (the remainder are turns whose only monsters
  sat under the named summon-turn restrictions, or no monster at
  all). Duels with a GG attack by bot turn 5: 107/120 → 108/120;
  average first-attack turn 2.73 → 2.60.
- Draw-only turns: 24 → 24, same gate composition (no activation
  gate moved; the residue is core legality + trio waiting).
- test-cpu.js mirror suite: **40–0** vs the old policy (unchanged
  from round 1), MSG_RETRY 0, activity 6.55 summons / 5.42 attacks /
  6.65 activations per duel (round 1: 6.40 / 5.33 / 6.78).
- test-cpu-tune.js matchup: attack by bot turn 5 10/12 → 9/12,
  average first-attack turn 3.25 → 2.91, total GG attacks in the
  sample 56 → 57. The one duel that stopped attacking (seed 91007)
  was starved in both versions — first face-up body on bot turn 7
  either way; the old policy landed a single attack on turn 8 of a
  19-turn loss, the new-policy Ishizu seat closes the same duel in
  17. Not a new passivity: no body, no attack, in both.
- Stall hunt: 20 fresh-seed passive-shape duels (41500+i·37), 20/20
  completed, 0 retries, 0 failure events; attacks in 19/20 duels,
  18/20 by bot turn 5, average first-attack turn 1.95.
- Regression: test-node / test-explore / test-genesis / test-overlay
  / test-facedown / test-layout / test-ui all pass, MSG_RETRY 0.

### Could not fix / left as-is

- The GG bot still cannot attack with what it does not have: with
  only 4 level ≤ 4 monsters in the deck and the trio payoffs needing
  all three pieces, starved openings (no face-up body until turn 7,
  seed 91007 in both versions) are the deck, not the policy.
- hasProfitableAttack still cannot see summon-turn attack
  restrictions (they are not in the fair view), so the bot
  occasionally enters a battle phase the core then offers no attack
  in (Heavy Tank / Wall Shadow ① cases). Harmless — it proceeds to
  MAIN2 and plays on — and left as-is rather than teaching the view
  card-text exceptions.

## Mirror totals investigation: three signatures, classified (branch mirror-totals)

The long-standing "totals drift" anomaly (mid-duel totals off, finals
exact, MSG_RETRY 0) was hunted with batch-level and prompt-level
instrumentation plus a per-prompt CENSUS of the core itself
(`Duel.queryCard` scans of every pile, compared against the mirror).
Three distinct signatures exist; each is classified below. A 120-duel
deterministic sweep (seeded client shuffle, exploratory policy) went
from 38 duels with batch-level dips and 1 duel ending over the pool to
**0 / 0** after the fixes; the only remaining deviations are
control-change skews.

### Signature 1 — per-seat skew [59,54], combined exact: (c) correct mirror, mis-specified harness gates

The mirror counts cards by CONTROLLER (`totalCards` sums the buckets of
the player currently controlling each card), while several suites
asserted per-seat equality with the OWNER's deck size. Any control
change breaks that equality for as long as it lasts — e.g. Monster
Reborn reviving the opponent's monster. Reproduced repeatedly, always
with the same wire event, e.g.:

```
MOVE 沼地の魔道王 P1:GY#1 -> P0:MZ#3 rsn=0x800   (seed 3, turn 6)
MOVE 風魔神－ヒューガ P1:GY#2 -> P0:MZ#0 rsn=0x800  (seed 8; still held at duel end -> final [59,54])
```

17 of 120 sweep duels showed prompt-level skews of exactly this shape
(±1, combined 113, recovering when the stolen card leaves to its
owner's grave). This is also the mechanism behind test-node's
intermittent failures (~1 in 3–6 runs): not a mirror defect.
Fix (harness side): test-node.js and test-phase2's D3 now assert the
rule that is actually invariant — combined total == pool AND each
seat's deviation == its foreign-card balance (cards of the other pool
in its zones minus the reverse; pools are disjoint, overlay units
counted through their host entry). test-genesis.js gained the same
combined gate as a hard failure plus a final-totals foreign-explanation
check; its per-seat 'violations' remain a metric. test-overlay's
ACTIVATOR batch already used this reasoning; test-investigate.js only
ever compared violation counts relatively, so it needed no change.

### Signature 2 — combined total EXCEEDS the pool, permanently: (a) mirror defect — MSG_SWAP_GRAVE_DECK unhandled

Root cause: `GameState.apply` had no case for MSG 35
(MSG_SWAP_GRAVE_DECK). When 《現世と冥界の逆転》 (Exchange of the
Spirit, the only pool card using `Duel.SwapDeckAndGrave`) resolves,
the core swaps the player's deck and graveyard wholesale and reports
it as ONE message per player — no per-card MOVEs. Core semantics
(field::swap_deck_and_grave): payload = player u8, u32 extra-size,
u32 bitmap length, bitmap over the post-swap deck list (= the old
graveyard in grave order); a set bit marks an Extra-Deck monster,
which the core pulls OUT of the new deck into the Extra Deck. The
mirror ignored the message, so deckCount kept the pre-swap value and
the grave kept the old identities.

The swap itself preserves each seat's total (deck+grave+extra sum is
invariant) — the damage is a wrong SPLIT that turns into inflation
later: the stale deckCount is smaller than the real deck, and once it
drains to 0 it clamps (`Math.max(0, …)`) while real draws/mills keep
arriving in hand/grave. Deterministic reproduction (seeded shuffle,
exploration duel, seed 99): census at turn 31, first prompt after the
resolution —

```
core:   P0 deck=19 grave=14 extra=14 | P1 deck=15 grave=12 extra=14
mirror: P0 deck=13 grave=22 extra=12 | P1 deck=12 grave=15 extra=14
wire segment: MSG72, MSG35, MSG32 (SHUFFLE_DECK), MSG35, MSG32,
              MSG73, MOVE 現世と冥界の逆転 P0:SZ#0 -> P0:GY#13, MSG74, MSG16
```

i.e. P0's deckCount was 6 low and P1's 3 low; the duel ended
[59,58] (+1 of P0's latent +6 realised, +3 of P1's). This — not
control changes — is what produced the historical "totals exceed the
pool" readings such as [64,63].

Fix (engine.js, root): case 35 handler — new deckCount = old grave
count − extracted (bitmap) count; extracted cards join the extra pile
with their known codes; the new grave becomes unknown placeholders of
the old deck count and `graveResync` marks the player;
`Duel.refreshFieldStats` refills the grave identities from the core
query at the next prompt boundary (the grave is public — same
re-identification pattern as MSG_SHUFFLE_SET_CARD). `deckTop` is
cleared (deck replaced and shuffled). Regression: test-swap.js duel A
replays seed 99 with a full core census at all 1552 prompts — old code
fails with exactly the divergence above (final [59,58]); fixed code is
exact everywhere, grave identities included.

### Signature 3 — combined total dips below the pool for a few batches: (a) mirror defect — overlay units in flight to entry-less piles

When an Xyz host leaves the field for the grave/removed/deck/hand, the
core sends the host's MOVE first and the units' release MOVEs a few
`poc_process` batches later, encoded against the host's NEW location
(e.g. `MOVE 賢瑞官カルダーン P0:GY+OVL#5 -> P0:GY#6 rsn=0x600`, one
batch after `MOVE 鳥銃士カステル P0:MZ#2 -> P0:GY#5`). The mirror's
carry logic dropped the units' count at the host's MOVE (entry-less
piles hold no `materials`), so batch-boundary totals dipped by the
unit count until the releases landed. The dip never survived to a
prompt boundary in 120 duels (it lives inside one resolution), so the
rendered UI at decision points was never wrong; it is nevertheless a
real accounting gap at the batch boundary the driver itself exposes
via onUpdate.
Fix (engine.js): the dropped carry is parked in `state.transit[p]`
and drained by `_removeAt` as each unit's release MOVE arrives
(overlay removal whose host location is entry-less). `totalCards`
includes transit. Regression: test-swap.js duel B asserts combined ==
pool at EVERY batch (3107 batches; old code dipped in 2), and the
120-duel sweep's dip count went 38 → 0.

### Not reproduced / left open

No other signature was found: across 70 unseeded + 120 seeded
exploration duels and the full suite, every deviation observed is one
of the three above. MSG_REFRESH_DECK (34) and MSG_REVERSE_DECK (37)
are also unhandled by the mirror, but no pool card uses them
(grep of data.json scripts: only c17484499.lua calls
SwapDeckAndGrave); they are noted here rather than fixed blind.
One test-phase2 run during this round reported 2 failed checks whose
labels were not captured; 11 other runs pass in full (D3 passes in
every captured run) — consistent with the previously documented
sampling flake, left as-is.

## BGM 3-stage (branch feat/bgm-3stage, 2026-11-03)

The user replaced the advantage-score BGM scenes (see Item 6, marked
superseded) with the MD-style 3-stage system, after listening to preview
clips of the exact assignment and approving it ("その割り振りでいいよ").
All tracks are the user's own assigned files in assets/bgm; nothing was
substituted.

### Spec (as implemented in v2/client.js)
- Start screen: `ishizu-upload.mp3`, starts on the first tap, LOOPED,
  plays only while the start screen is up (unchanged from before).
- Duel stages climb Normal → Keycard → Climax and NEVER go back down
  (latched per duel; reset at the start button).
  - Normal pool: `ishizu-start.mp3` (way-of-egypt), `ishizu-caravan.mp3`
  - Keycard pool: `ishizu-advantage.mp3` (dunes-distortion),
    `ishizu-big-advantage.mp3` (pyramid)
  - Climax pool: `ishizu-voice-note-2.mp3`, `ishizu-mystical.mp3`
- Within a stage the track is picked at random. Stage tracks do NOT
  loop: on the element's `ended`, the next track is drawn from the same
  stage EXCLUDING the one that just finished (a 2-track pool therefore
  alternates). The start track (and the win track) keep looping.
- Triggers: Keycard = either player summons a key card; Climax = either
  player's LP reaches 2000 or below (boundary included, tested at 2000).
- Result: win → `ishizu-big-advantage.mp3` (pyramid, looped);
  loss → a random draw from the Climax pool.
- Guards kept from the old system: never switch while a human prompt is
  open (the stage-up is latched and applies at the next update), audio
  OFF pauses and ON resumes the current scene/track, switching is the
  same src-swap on a single Audio element.

### Key cards (KEYCARD_CODES / KEYCARD_ACTIVATE_CODES in client.js)
Derived from v2/data.json deck lists; criterion = each deck's boss
class (the cards MD's "key card" BGM stage exists for). FINAL FORM
(user revision 2026-11-03, branch feat/bgm-keycards-2): 10 cards,
five per deck.
Summon trigger (KEYCARD_CODES):
- GG deck, extra: 8505920 合体魔神－ゲート・ガーディアン (Lv12/3750),
  97783338 水雷魔神－ゲート・ガーディアン (Lv9/2550),
  34904525 雷風魔神－ゲート・ガーディアン (Lv9/2500),
  61398234 風水魔神－ゲート・ガーディアン (Lv9/2450)
- GG deck, main: 26746975 闇の守護神－ダーク・ガーディアン (Lv12/3800,
  the main deck's top monster)
- Ishizu deck: 45409943 宵闇のルーチェ (Lv8/3500, extra),
  46148485 転輪のスフィンクス (Lv8/2500, main — first kept as a
  borderline candidate, then INCLUDED by the user's revision),
  36898537 メタファイズ・ホルス・ドラゴン (Lv10/2800, extra — the
  "ホルス" the Ishizu extra runs two of)
Activation trigger (KEYCARD_ACTIVATE_CODES) — traps have no summon,
so these latch when ACTIVATED (user decision 2026-11-03, "イシズ
少なすぎない？" — the first list had only two Ishizu cards):
- Ishizu deck: 98715423 墓守の罠 (permanent trap; stays face-up once
  flipped), 17484499 現世と冥界の逆転 (the deck's signature reversal)
REMOVED by the user's decision (2026-11-03): 63101468 マスター
フレア・ヒュペリオン (Lv10/3200) was in the first list and was taken
OUT — it must not trigger the stage (asserted in test-bgm BGM-21).
Borderline candidates still NOT included (the remaining three, left
as a decision for the parent/user): the Gate Guardian pieces
25955164 サンガ / 62340868 ヒューガ / 98434877 スーガ (Lv7 parts, not
the combined bosses), 99551425 迷宮の魔戦車 (Lv7 fusion), 37706769
冥府の執行者プルート (Lv5). Adding any of them is a one-line Set
change.

### Trigger implementation
Two paths, both feeding the per-duel latch `bgmWantedRank`:
1. Events — engine.js presentation events for MSG_SUMMONING /
   MSG_SPSUMMONING carry `{kind: 'summon'|'spsummon', code, con}`
   (engine.js lines ~712-713), and drainSeEvents sees every event
   before draining the queue, so `noteBgmEvent` latches a key card the
   moment it is summoned, even if it leaves the field before the next
   render. Either player counts (con is not filtered).
   The two key TRAPS ride the same path on a different event kind:
   MSG_CHAINING pushes `{kind: 'activate', code, con, loc}` (engine.js
   case 70, line ~735), so an activation carries its code the same
   way, and `noteBgmEvent` latches on `activate` for
   KEYCARD_ACTIVATE_CODES. (Grounds for choosing the event route over
   a state diff: the code IS on the event.)
2. Field scan — updateBgm (called on every onUpdate) checks both
   players' LP (Climax) and scans both mzones for key-card codes not
   yet seen this duel (Keycard). This covers a key card that reaches
   the field without a summon event passing the queue (revival edge
   cases, control changes). The scan also covers the key traps: a
   trap FACE-UP in either szone has been activated (the permanent
   墓守の罠 stays face-up after its flip), while a merely SET
   (face-down) trap has not and is excluded by the face-up test.
The actual track switch happens only in updateBgm, after the
currentPrompt guard, from the latched rank — so a stage-up demanded
during a prompt is deferred, never dropped.
Design decision — the old 8-second minimum dwell does NOT apply to
stage-ups: the dwell existed to stop the two-way advantage scenes from
flapping, stages never go down so there is nothing to flap, and the
cue belongs to the summon/LP moment itself (MD cuts at the moment).
Delaying it up to 8 s would detach it from the play it marks.

### Verification — v2/test-bgm.js (new, jsdom)
Seeded-LCG Math.random; Audio stub records the BGM element. 17 checks,
ALL PASSED: start-scene wiring via the real start flow (pointerdown →
upload looped; start button → Normal pool, not looped); updateBgm
inert before a duel; opponent-side key card climbs to Keycard;
non-key piece + plain states never lower the stage; `ended` re-draws
the same stage's other track (both Keycard and Climax); LP exactly
2000 climbs to Climax and stays latched after LP rises; win → pyramid
looped; loss → Climax pool.
Regression on this branch (all PASS): test-node, test-explore,
test-phase2 (passed on the first run this time; its sampling flake is
a known main-branch property and did not occur), test-ui, test-layout,
test-genesis, test-overlay, test-facedown, test-ggfusion, test-swap,
test-investigate, test-cpu, test-cpu-tune, test-cpu-tune2, test-bgm.
NOT verified: how any of this SOUNDS — jsdom/Node cannot play audio;
stage timing and track feel are for the user's ears on the real app.

Revision (branch feat/bgm-keycards-2, 2026-11-03): the key list was
revised to the final 10 above — two Ishizu traps added on the
ACTIVATION trigger, スフィンクス and メタファイズ・ホルス・ドラゴン
added on the summon trigger, ヒュペリオン removed (all user
decisions). test-bgm grew from 17 to 26 checks (BGM-17..25): human
activation of 墓守の罠 latches then applies at the next update; a
non-key trap activation (40605147 神の通告) is ignored; opponent
activation of 現世と冥界の逆転 climbs; ヒュペリオン no longer
triggers; ホルス and スフィンクス climb from the field scan; a SET
(face-down) 墓守の罠 does not trigger while the same trap face-up
does. ALL BGM CHECKS PASSED. The __bgm test surface gained a
`note(ev)` driver (the same noteBgmEvent the drain loop calls) so the
event path is exercised directly, not only via field scans.
Regression on this branch (all PASS, exit 0, no FAIL lines):
test-node, test-explore, test-phase2 (first run again), test-ui,
test-layout, test-genesis, test-overlay, test-facedown, test-ggfusion,
test-swap, test-investigate, test-cpu, test-cpu-tune, test-cpu-tune2,
test-bgm.

## FX round A — presentation grammar foundation (branch feat/fx-round-a, 2026-11-03)

Implements part 1 of the approved presentation
(goals/simple-phone-duel-app/files/v2_presentation_effects.md +
supplement A/B) as a READ-ONLY overlay layer. Nothing here touches
the engine, prompts, sounds, or layout: all effects live in #fxlayer
(absolutely positioned over #app, pointer-events:none, out of the
in-flow stack, so the frozen applyLayout board cannot move and zone
re-renders — slot DOM is rebuilt per batch — cannot kill an
in-flight overlay). client.js onUpdate copies state.events BEFORE
drainSeEvents consumes them, captures own-hand geometry pre-render
(FLIP), renders, then fxProcess diffs consecutive state snapshots
(zones / grave / removed / extra / deck counts / hand / phase
family) and spawns overlays from painted rects — the same rect
discipline as the layout fit loop. The processor is try/catch
wrapped; window.__fx.error must stay null (a presentation bug can
never break a duel) and window.__fx.log records every spawn for
tests.

Grammar as implemented:
- Summon portals (3-1): the destination zone glows first, then a
  method portal — fusion = segmented blue-violet conic vortex with
  a counter-rotating inner ring; Xyz = cyan galaxy ring with star
  dots; Synchro = green ring that converges (scale 1.7 -> 1);
  ritual/other special summons = soft gold portal over the zone
  glow. (The task brief grouped "other special summons" as zone
  light; presentation 3-1 names the synchro ring explicitly, so
  synchro keeps its ring.) Fusion/Xyz materials glow red, shrink
  and converge into the summon point before the portal peaks.
  Normal summons and sets get only a 430ms placement puff — the
  pace never stops for them.
- Xyz materials (3-2): tiles with materials gain stacked inset
  edges (.mats1/.mats2) on top of the existing xN badge. A detach
  (material count drops in place) peels one layer off the tile;
  an attach pulses the zone glow.
- Movement grammar (3-5 + supplement A): the DESTINATION is what
  reads. Field/hand -> grave, removed, extra deck: a card ghost
  flies there and the pile flashes on landing (pile counts tick
  with a flash too). Revival / return from grave or banished: NO
  flight — the zone lights and the card appears inside a gold
  revive portal. Deck returns vanish in place (no flight, no
  shuffle show). Control changes slide across the board, swelling
  slightly mid-way. Draws/searches fly deck-or-pile -> hand;
  opponent draws fly as card backs. Own-hand gains/losses settle
  with a FLIP slide (survivors glide to their new spots, 280ms).
- Phase banner (3-8): family changes (draw/standby/main1/battle/
  main2/end) sweep a translucent band across mid-field for ~0.8s;
  the battle family is red-tinted. Damage-step sub-phases fold
  into the battle family so the banner cannot strobe.
- Stat changes (3-7): when a standing monster's live ATK/DEF
  moves, its outside strip flashes once. In the detail preview,
  values differing from the printed ones are tinted light blue
  (.pv-stats .mod) — only the changed value.
- Counters (3-7): tileHTML renders one icon+number badge (.ctrs)
  when a mirror entry carries counters. STATED GAP: the 63-card
  pool has NO counter-using card and the mirror does not track
  counters, so this is a render hook with no live case today; it
  activates unchanged if such a card joins the pool.
- Result screen (part 1 item 5): the existing overlay (winner,
  win reason in words, turns, final LP, もう一度) already matched
  the grammar; left as-is here, round B adds the finisher wash.

Screenshot review caught a real bug the rect math could not: the
first 390x620 fusion capture showed the portal half a size
up-left of the summoned monster and reading as a soft disc —
.fx-portal carried a CSS translate(-50%,-50%) on top of fxNode's
rect centering (double centering), and the fusion ring's mask
ramp (32%->68%) was too soft to read as a vortex. Fixed (portal
scale-in + segmented vortex blades + counter-rotating inner
ring; duplicate fxspinrev keyframes removed) and re-shot: the
vortex now sits exactly on the summoned Gate Guardian at both
390x620 and 390x700, ATK/DEF strips fully readable everywhere.

Verification: test-fx.js (new) — Part 1 drives __fx.process with
synthetic state pairs and asserts every grammar deterministically
(fusion/xyz/synchro portals, convergence x2, peel, grave flight,
destroy flash, revive-without-flight, phase banner, stat flash,
control slide, deck-return vanish, draw flight, normal-summon
puff, fxError null); Part 2 plays two full clicked duels (live
tallies: flights 34, phase banners 84, placements 18, portals 7
across the pair) and asserts duels complete with fxError null.
Full suite green on the merged tree (test-phase2's known sampling
flake failed once inside the batch run and passed twice
standalone, same as on main). Screenshots (agent-viewed):
~/workspace/duel-app-fx/shots/h620-mix/ and .../h700-mix/
(fx-portal-fusion.png, fx-phase-banner.png, fx-flight.png,
fx-portal-generic.png, 99-end.png).

Known limits after round A: overlays are timed to the batch that
commits the state; when a summon and its materials' departure
share one batch the converge->portal sequence is staged with
delays to stay readable. Revival portals and Xyz/Synchro portals
are covered synthetically; the two live clicker duels happened to
produce fusion + generic portals only. Attack lines, chain pops,
ace cut-ins, defense rotation, set-flip presentation and the
settings toggles are round B.

## Known gaps for later phases
- CPU intelligence: DONE in the CPU phase (see "CPU phase" above) —
  player 1 is now a heuristic policy (fair-view masked, per-card
  gates for the 63-card pool). It is a baseline, not an expert:
  long-game resource races with the Gate Guardian seat are its
  measured weak spot.
- Effects/presentation polish: FX rounds A and B landed (see "FX
  round A" / "FX round B" above) — summon/movement/phase grammar,
  ace cut-ins, battle lines, chain pops, defense rotation, settings.
  No damage numbers (deliberate — MD-style grammar shows no formula).
  (Printed-only ATK/DEF was fixed in Phase 2 — board values are live
  from the core query.)
- SELECT_OPTION buttons are numbered placeholders — the core sends string
  table IDs (descriptions); a strings table is needed to label them.
- Genesis point limits: NOT applied — the format restrictions (no
  EMZ/PZONE, no first-turn draw, pool excludes Link/Pendulum) are in
  (see the Genesis section above), but per-card Genesis point costs and
  the 100-point deck budget are not enforced anywhere.
- Xyz materials mirror accounting: FIXED in fix round 2 (see the
  "Fix round 2" section above) — overlay units are tracked against
  their host in the Extra Deck and on the field, through detach and
  the host leaving the field. The separate code-0 SPSUMMONING mirror
  defect (test-phase2 B2) is FIXED in fix round 3 (see the "Fix
  round 3" section above), which also covers the Morphing Jar #2
  set-shuffle permutation (MSG_SHUFFLE_SET_CARD).
- Save/resume: none. Reloading restarts from the start screen.
- Turn timer, surrender, side decking: none. (Deck and first/second choice
  were added in Phase 2.)
- Opponent hand is shown as a count (backs in the top bar); revealed cards
  are tracked in state but only own-hand is rendered as tiles.
- jsdom click-through drives clicks generically (first available action);
  it proves reachability/completion of the UI paths, not usability quality.
- Phase 2 leftovers: audio playback itself is unverifiable in jsdom/Node
  (wiring only); BGM scene switching is driven by the LP+ATK score and has
  not been ear-checked on a phone [the LP+ATK score system was superseded
  by the 3-stage ladder on 2026-11-03 — see "## BGM 3-stage"; how the new
  stages SOUND is likewise not ear-checked]; the chain duel-dismissal is keyed per
  candidate (code+location+sequence+effect desc), so the same card in a
  different zone is a separate dismissal entry.

## FX round B — set pieces (branch feat/fx-round-b, 2026-11-03)

Part 2 of the approved presentation (sections 3-3..3-8, 3-11,
supplement A) on the round-A foundation. The division of labour is
unchanged: attack/cut-in/chain visuals live in the read-only FX
layer; the chain-bar states, defense rotation and LP counter are
presentation-only render changes. Nothing touches the engine, the
legal answer set, or the frozen layout. test-fx.js grew Part 1B
(FXB0..FXB10 + FXB4b/c); its Part 2 run 2 now plays a whole duel
in response mode 'off'. window.__fx additionally exposes
`settings` (the object the prompt UI reads), `cutinOn()` and
`lpShown(con)`.

- Ace cut-in (B6, 3-3): roster = the eight SUMMON-trigger cards
  of the BGM key-card list (KEYCARD_CODES, read directly so the
  two lists cannot drift): the five GG bosses （合体魔神ゲート・
  ガーディアン / 水雷・雷風・風水の各魔神 / ダーク・ガーディアン）
  and the Ishizu three （宵闇のルーチェ / 転輪のスフィンクス /
  メタファイズ・ホルス・ドラゴン). DEVIATION, with reason: the
  two key TRAPS （墓守の罠 / 現世と冥界の逆転） are NOT in the
  cut-in roster — they latch the BGM stage on ACTIVATION, while
  a cut-in is a summon presentation whose banner carries
  ATK/DEF; a trap has neither a summon nor ATK/DEF. Trap
  activations keep the chain presentation (and the B9 tilt pop
  from the szone). Type: the round-A portal fires on the zone,
  the #fxcutin scrim dims the field (translucent — LP and the
  HUD stay readable), the card scales in large with a name +
  ATK/DEF banner. ~4.7 s including the fade. #fxcutin is z-35
  (below the dock 40 and the sheet 50) and pointer-events:none,
  so the duel never waits and a prompt is never covered; any
  tap dismisses it early via a capture-phase pointerdown
  listener that does NOT consume the tap (installed lazily —
  GUI tests count window listeners per boot). A second ace
  replaces a running cut-in. The big card is the current shared
  placeholder art, enlarged (no per-card art exists yet —
  decision item 1); only its background changes if art lands.
- Battle (B7, 3-4): attack declarations never move the card.
  The attacker's zone glows, a thin cyan line (.fx-line) draws
  from attacker to target (geometry from state.lastAttack, with
  a snapshot search as fallback), and an attribute-coloured
  radial impact lands on the target. Direct attacks run the
  line to the defender's LP plate under a "DIRECT ATTACK"
  band placed at the attack line's height. Destruction stays
  round A's restrained white flash. No formula, no floating
  damage numbers: LP changes count on the LP counter itself
  (fxLpCount animates toward the state value, 220..850 ms,
  ease-out; render defers to a running count via fxLpBusy so
  batches cannot stomp it, and the first sighting of a seat
  never animates), and a heal is the only floating number
  (blue, at the counter). FINISHER: when the winner becomes
  known, if a hit (an 'attack' or 'damage' event) landed
  within the last 5 s, a full-screen attribute wash fires
  （光 = white-out, 闇 = dark veil, 水 = blue, ...). Two
  implementation findings shaped this: (1) the core often
  delivers MSG_WIN in its own trailing batch, a beat AFTER
  the lethal damage — keying the wash on "same batch carries
  the blow" never fired in live duels, so the trigger is
  winner-transition + recent hit (a deck-out win has no hit
  and gets no wash, matching the grammar); (2) the wash is a
  body-level position:fixed overlay at z-65 — inside #fxlayer
  (z 25) the result overlay (z 60), shown in the same task as
  the win, would have covered it for its entire life. The
  result text stays readable through the translucent wash,
  which fades over 1.3 s.
- Chain (B8, 3-6 + supplement A): every new link pops large in
  the foreground (.fx-chainpop: card name + the big cyan link
  number on its lower edge), then shrinks toward the chain
  bar. MERGE with B9 (first live capture drove this): when
  the new link IS a set S/T activation, the tilted card is
  the pop and carries the number on itself (.setno) —
  stacking a panel over the tilted card buried both. On the
  bar: 2+ links show a CHAIN label chip from the moment they
  stack (counted only links render it); the newest link
  rides enlarged (.newest) while stacking, cleared when
  resolution begins; the solving link's chip glows yellow
  (border + shadow, not just a colour swap); solved links
  dim (.done, in addition to the existing ✓ and the negated
  strike-through). The numbered chips, pass button and the
  per-card "don't ask" machinery are untouched.
- Set activation / flips / defense (B9, 3-12 as revised by the
  MD-first rule + supplement A): an activation from the
  SZONE tips a presentation copy into the centre — tilted
  −14°, white rim — the card itself never flips inside its
  zone; activations from hand/grave keep the existing
  showcase side. A face-down card flipping face-up (in-place
  snapshot diff) gets a white flash + an edge-on scaleX flip
  of its tile. Defense position is MD-style 90° rotation:
  tileHTML now wraps art + name band in an .art layer inside
  .inner, and .tile.def rotates it 90° at scale .82
  (= 1/1.22, so the rotated card — imgH = 1.22 × tile width
  wide — fits the portrait tile exactly instead of being
  shaved by the slot's overflow:hidden). The .mats/.ctrs
  badges stay upright in the tile corners; the ATK/DEF strip
  stays outside the tile, upright, two lines (round-4 spec),
  and gains .defmode in defense: the DEF line is tinted
  light blue and its value enlarged (.defline), so the form
  also reads off the numbers. All zones keep one size.
  tileHTML still emits .nm as a DIRECT child of .inner (the
  round-A FX layer sizes ghost name bands off it) and .art
  keeps the same computed line-height — two non-obvious
  couplings found while landing this (FXA21 / stripClip).
- Advance summons (B10, supplement A): no seniority
  ceremony. A level ≥ 5 normal summon — or a monster set
  whose set event carries the code — keeps the round-A
  placement puff, gains a stronger zone glow, and its
  tributes leave the way fusion/Xyz materials do: glow,
  shrink, converge into the summon point instead of flying
  to the graveyard (the fusion branch's own pattern: same
  batch, same controller, MZONE departures are consumed as
  tributes).
- Settings (B11, 3-11): fxSettings {cutin, resp}, persisted
  to localStorage ('v2fx', best-effort — private-mode
  failures are swallowed). Controls live on the start screen
  (seg-cutin / seg-resp, initialised from the persisted
  values) and mid-duel in a sheet opened from the small
  演出設定 button in the phase bar (inert while a prompt is
  open; an arriving prompt reclaims the sheet — same
  pattern as the menu). Response modes act ONLY on prompt
  presentation: 'off' answers every non-forced SELECT_CHAIN
  with a pass without opening the dock (passing is always
  a legal chain answer; forced prompts still show); 'on'
  disables the per-chain and per-duel dismissals inside
  uiChain, so every timing is confirmed and nothing
  auto-passes; 'auto' is the previous behaviour exactly.
  The engine's legal set is never filtered. The start
  overlay may scroll vertically at short heights now that
  it carries two more rows (the duel board still never
  scrolls).

Verification: test-fx (Parts 1 + 1B synthetic, two live duels) plus the whole existing suite — node / explore / phase2 / ui / layout (104) / genesis / overlay / facedown / ggfusion / swap / investigate / bgm (26) / cpu / cpu-tune / cpu-tune2 — exit 0 with zero FAIL lines on this branch's final code; test-phase2 passed on its first solo run (its known sampling flake did not appear). Live round-B tallies from test-fx
Part 2 (two duels): cutin 4, chainpop 11, setactivate 9,
attackline 7, directattack 7, lpchange 7, portal:fusion 4;
fxError null in both. Screenshots the agent viewed with its
own eyes (worktree shots/): h620-mix-b/ (cut-in on 水雷魔神 —
scrim, big card, banner, HUD readable through it),
h620-nocutin/ (clean direct-attack line + DIRECT ATTACK
band with the attacker glowing; the chain pop panel with
its big number; the merged tilt pop carrying its number;
the start screen with both setting rows and the persisted
OFF selection), h700-gg-c/ (the finisher's water wash over
the result), defprobe/ (face-up defense: measured
rotate(90deg) scale(.82) on the tile inner, DEF line
rgb(143,216,255) at 10 px, strip upright and readable;
face-down backs measure the striped pattern on both tile
and art layers), setprobe/ (the mid-duel settings sheet;
flipping 応答モード to Off persisted to localStorage and
reflected on the start-screen segment; sheet closes
cleanly).

NOT visually captured — stated honestly:
- The CHAIN label chip on the bar in a live frame: across
  4+ clicker duels (including a chain-first clicker that
  answers every offered candidate) every chain that formed
  had exactly one link. The label is a three-line render
  branch reviewed in place; link-2 pops are asserted
  synthetically (FXB5, FXB5b) and the label logic follows
  the same state the pops read — but no screenshot of the
  label itself exists.
- The 'flip' / 'poschange' / 'advance' beats fired 0 times
  in the jsdom live duels: a battle flip that is destroyed
  in the same batch diffs as a departure rather than a
  change, in-place position changes are rare with these
  decks, and neither bot tribute-summoned in those two
  games. All three beats are asserted synthetically
  (FXB8, FXB9, FXB10). The defense ROTATION state they
  lead to is screenshot- and probe-verified above.
- On a lethal hit the LP counter may still be counting
  (≤850 ms) when the result overlay appears; the result
  text carries the final LP and the counter settles on the
  exact value behind it (asserted by FXB3/FXB4's landing
  checks).
- Sound remains unverifiable by the agent (as with every
  round): the BGM stage latching and SE wiring were not
  touched by round B beyond sharing the key-card roster
  constant.

## V3 integration — Stage 1: FX foundation (branch feat/v3-s1-foundation)

Integrating the approved v3 quality proposal
(~/workspace/goals/simple-phone-duel-app/files/v3_quality_proposal.md)
in four stages. Stage 1 builds ONLY the foundation the later scenes
stand on: one FX clock, a scene engine, signature easings, a sprite
particle system, a hit-stop mechanism, and a single layer-order
table. No scene is rebuilt in this stage; existing round A/B scenes
must look and behave exactly as before (regression is a failure).

### Requirements for this stage (why pros build it this way)

1. ONE CLOCK. Commercial presentation runs every layer off a single
   timeline so picture, numbers and sound cues can share designed
   sync points. The round A/B code gives every effect its own timer
   (WAAPI animations, setInterval LP counter, setTimeout kills):
   sync points cannot be designed on top of that, only hoped for.
   Requirement: every scene is a function of one shared FX clock;
   layers are scheduled against scene-local time on that clock.
2. HIT-STOP FREEZES THE WORLD, NOT ONE EFFECT. The "weight" of an
   impact reads because everything stops except the impact pop; if
   only the line froze while particles kept drifting, the stop would
   not read. Requirement: hit-stop = freeze the shared FX clock
   (all scenes + particles). The GAME never waits: the engine, the
   prompts and the board are outside the FX clock entirely.
3. PARTICLES ARE SPRITES, CAPPED. A pro effect budget is predictable
   on the weakest target: pre-rendered sprites blitted with
   drawImage, a hard cap on live particles, no shadowBlur (the main
   GPU cost driver). Requirement: <= 90 live particles across all
   scenes, sprite-only rendering, canvas at DPR <= 2.
4. LAYER ORDER IS A SINGLE TABLE. The finisher defect (wash z-65
   over result z-60) happened because the wash was created OUTSIDE
   the table, at body level. Requirement: every presentation layer
   has exactly one row in one ordering table (below); a full-screen
   effect lives INSIDE the table, and separation from the result
   display is achieved by TIME (a gate), not by stacking above it.
5. MOTION WRITES TRANSFORM/OPACITY ONLY. The board is frozen for
   the whole duel; layout-affecting animation in the FX layer risks
   reflowing the one thing that must never move. Requirement: scene
   rendering writes transform/opacity (+ canvas pixels) only.

### Layer order table (the single ordering authority from now on)

| z | layer | owner / contents |
|---|-------|------------------|
| (flow) | board, hand, midbar | the frozen duel layout |
| 25 | #fxlayer | round A/B grammar FX, board-particle canvas (#fxcv), chain pops, phase banner |
| 30 | #placehint | placement instruction banner |
| 35 | #fxcutin | ace / finisher scene host, top-particle canvas (#fxcvTop) |
| 40 | #dock | chain response dock (a control: FX never covers it) |
| 45 | #autopass | auto-pass chip (a control) |
| 50 | #sheetwrap | sheets (controls) |
| 60 | .overlay | start / result overlays |
| 65 | .fx-finishwash | KNOWN EXCEPTION — round B finisher wash, body-level. To be removed in Stage 3 when the finisher is rebuilt inside #fxcutin and the result is gated by time. |

Rule: no new presentation element may be created outside #fxlayer /
#fxcutin; any future exception must be added as a row here FIRST.

### Stage 1 acceptance criteria (fixed BEFORE implementation)

- S1-C1 All pre-existing tests pass with zero regressions:
  test-node / explore / phase2 / ui / layout / genesis / overlay /
  facedown / ggfusion / swap / investigate / bgm / cpu / cpu-tune /
  cpu-tune2 / fx (synthetic + 2 live duels).
- S1-C2 Clock freeze: with a 300 ms hit-stop injected, __fx.now()
  advances <= 17 ms while >= 290 ms of wall time passes, and a
  running scene's rendered frame is identical at stop start/end.
- S1-C3 Particle budget: emitters requesting 120 particles never
  let the live count exceed 90 (__fx.particles()).
- S1-C4 Sprite discipline: no 'shadowBlur' anywhere in client.js
  FX paths (grep = 0 hits in the FX sections); particles render via
  pre-rendered sprite drawImage only.
- S1-C5 FPS reference (Chromium on this VM, software rendering —
  REFERENCE ONLY, not a device measurement): during a live duel
  with a 90-particle stress scene running, mean rAF interval
  <= 17.5 ms and p95 <= 25 ms over >= 4 s.
- S1-C6 The layer table above exists (this section) and the CSS
  carries the same table as a comment; canvases #fxcv / #fxcvTop
  exist inside #fxlayer / #fxcutin.
- S1-C7 No visual regression: frame strips of a live attack scene
  (and the phase banner / flight grammar) captured before vs after
  stage 1 at matched moments show the same elements.
- S1-C8 fxError stays null in live duels (covered by test-fx live).
Unmeasured residuals carried forward (counted, not passed):
real-device (WKWebView) FPS and appearance; audio sync feel.

### Stage 1 results (measured 2026-11-03, this branch)

- S1-C1 PASS: all 16 pre-existing test files pass on the stage-1
  code (node/explore/phase2/ui/layout/genesis/overlay/facedown/
  ggfusion/swap/investigate/bgm/cpu/cpu-tune/cpu-tune2/fx incl. its
  2 live duels), zero FAIL lines; the same 12 headless files also
  passed on the unmodified base as a baseline.
- S1-C2 PASS: hitStop(300) during a live stress scene — FX clock
  advanced 0 ms across the stop window, then exactly the post-stop
  remainder (150 ms of a 450 ms sample); the particle canvas
  dataURL was identical at stop start/end; two full screenshots
  300 ms apart inside a 600 ms stop were byte-identical.
- S1-C3 PASS: two emitters requesting 120 particles total — the
  sampled live count peaked at exactly 90, never above.
- S1-C4 PASS: no shadowBlur usage in code (the only grep hit is the
  comment that prohibits it); particles render via pre-rendered
  sprite drawImage only.
- S1-C5 PASS (REFERENCE ONLY — Chromium on this VM, software
  rendering; NOT a device measurement): rAF intervals with a
  90-particle stress scene — start screen mean 16.63 ms / p95
  16.8 ms; live duel with stress re-spawned mean 16.83 ms /
  p95 16.8 ms; fxError stayed null.
- S1-C6 PASS: the layer table above + the same table as a CSS
  comment in index.html; #fxcv inside #fxlayer, #fxcvTop inside
  #fxcutin. The canvases re-create themselves if the round A/B
  innerHTML clears wipe them (fxCanvasEl).
- S1-C7 PASS: frame strips before/after (v3shots/s1-before-attack,
  s1-after-attack, in the worktree) — the same presentation elements
  (attack line + DIRECT ATTACK banner; ace cut-in; phase banner;
  LP resolution) with no visual regression. The foundation is
  invisible by design in this stage.
- S1-C8 PASS: fxError null across the live verification duels.
Residuals carried forward (counted, not passed): (1) real-device
WKWebView FPS + appearance, (2) audio sync feel — both unmeasurable
from this environment. New audit candidates found while working:
the phase-info midbar text wraps to 2-3 lines and crowds the log
line (already audit B-08; re-confirmed in this stage's own frame
strips — stage 4), and the round-B cut-in's ~4 s static hold is
directly visible in the s1-after-attack strip (f00 == f02) — that
is stage 3's L-hold-motion requirement, not a new item.
Implementation notes: legacy round A/B effects intentionally keep
their WAAPI/interval timers in this stage; scenes from stage 2
onward run on the FX clock. The engine exposes a test surface
(__fx.now/scenes/particles/hitStop/stress/spawnBurst) so later
stages verify numbers, not just wiring.

## V3 integration — Stage 2: battle + chain scenes (branch feat/v3-s2-battle-chain)

Both scenes rebuilt on the stage-1 foundation (shared FX clock,
scenes, sprite particles, hit-stop). Numbers are proposal 1.2 / 1.4
unless a deviation is recorded below with its reason.

### Requirements for this stage (why pros build it this way)

ATTACK. (1) The collision instant must EXIST: round B scheduled the
impact with a fixed 240 ms delay unrelated to the line's arrival, so
line, impact, LP and SE each flowed on their own and the hit never
"landed". Requirement: every layer of the scene is scheduled
against ONE impact point (t=280) on the shared clock. (2) The line
is a SIGNAL, not a journey: MD draws it for a few frames at
declaration. A line that slowly grows for 560 ms becomes the main
actor and inverts the reading. Requirement: the line arrives in
180 ms with an accelerating curve and then gets out of the way.
(3) Cause before effect: the LP counter starts AFTER the impact
(t=400) so the eye reads hit -> number; the damage number is an
accent AT the counter, never a replacement for it (the counter is
the primary readout — this refines proposal L10's placement note,
which already anchors the number at the LP plate). (4) Sound marks
the REAL damage moment: SE is information. The spec's "impact SE at
280 ms" holds when declaration and damage are one beat; when a
chain response window separates them, a guessed 280 ms cue would
lie about when damage happened. Deviation (recorded, deliberate):
battle-damage SE that arrives in the SAME batch as its attack is
held and fired at the scene's 280 ms cue; damage arriving in a
later batch fires immediately, because that arrival IS the
resolution moment. (5) The board never moves: the target "shake"
(L8) is applied to a ghost overlay, never to the real tile.

CHAIN. (1) A chain is a STACK YOU CAN READ: every link's number
stays visible on the bar chips at all times; the foreground pop is
a presentation of the CARD ITSELF (round B's name-only panel is
replaced by the card ghost), never a substitute for the stack.
(2) The pop never fights the response prompt: it is pure
presentation on the FX clock; the dock owns input and is never
covered (layer table). (3) Solving must read at board centre, not
only as a chip colour change: the solving link returns to the
foreground with a gold ignition; a negated link must READ as
negated (grayscale exit), because "was it negated?" decides the
next play. (4) The shrink landing (pop -> chip) is what ties the
foreground card to its stack slot: FLIP-style travel to the chip,
and the chip swells on landing.

### Stage 2 acceptance criteria (fixed BEFORE implementation)

- S2-C1 All 16 pre-existing test files pass, zero regressions.
- S2-C2 Attack frame strip at FX-local ~0/120/290/360/500/750/1000:
  attacker emphasis + line mid-flight (~120); line arrived + impact
  core popped at the hit-stop (~290); the line/particles FROZEN at
  ~360 vs ~290 (hit-stop proof in a real duel, not a harness
  injection); rings + attribute particles (~500); damage number at
  the LP plate + counter mid-count (~750); settled (~1000).
- S2-C3 LP coordination: after an attack-driven LP drop of N, the
  damage number showing -N exists inside the 420-1000 window and
  __fx.lpShown lands exactly on the state value by attack+1000 ms
  (FX clock). Non-attack LP changes still count over 600 ms.
- S2-C4 Chain strip: the pop is the card ghost with a slamming
  number (60-220), holds, then travels to its chip by 950 ms; a
  2-link chain shows the dashed connector + CHAIN label beat.
- S2-C5 Solving: on a solving transition the link foregrounds
  (scale-in 200 ms), gold frame ignites at 120-270 ms with rising
  gold particles, exits dimmed by 450 ms; negated links exit in
  grayscale. Verified by frame strip if a live chain solves on
  camera, else by a synthetic __fx.process drive + DOM assertions
  (stated honestly either way).
- S2-C6 fxError null in live duels; total live particles during an
  attack scene + a simultaneous burst stay <= 90 (budget clip).
- S2-C7 The old fixed-delay impact path is gone: no 240 ms delay
  constant remains in the battle path; fxAttackLine/fxImpact are
  replaced by the scene (records 'attackline'/'impact' kept for
  the existing test surface).
Residuals: SE *feel* (timing is structural per the deviation
above); real-device appearance/FPS (carried from stage 1).

### Standing focus (user instruction, 2026-11-03 — applies to all stages, centred on stage 4)

SELECTION / CANCELLATION SCENES are a named priority group: zone
placement, position selection, target selection, chain response
(respond / pass / per-card "don't ask"), grid selections (search /
materials / discards), count specification, reordering, yes/no, and
every cancel / back path. For each scene, the requirement question
is what the user must know AT THAT MOMENT:
  (a) what am I choosing right now (what is this prompt asking)?
  (b) what happens if I confirm (what becomes true, what moves)?
  (c) what happens if I cancel / go back (what state do I return to)?
  (d) is it reversible once confirmed?
  (e) how many are left to choose (count / remaining)?
  (f) is this mandatory or optional (can I decline, and at what cost)?
Any scene whose current presentation/copy/flow fails one of these
gets an audit entry with concrete replacement copy and a concrete
flow fix; stage 4 works this group FIRST, before other audit items.
Every stage report carries a section on what was learned / added
for this group. Stage-2 contact point: the chain pop must never
fight the response dock (already a stage-2 requirement above);
the dock's own copy is a stage-4 target in this group.

### Stage 2 results (measured 2026-11-03, this branch)

- S2-C1 PASS: all 16 test files pass, zero FAIL lines (incl.
  test-fx synthetic + 2 live duels). FXB2c's 1100 ms LP landing
  holds under the new schedule (attack+400 start, 600 ms count).
- S2-C2 PASS: attack strip (v3shots/s2-after-attack, FX-local
  167/284/350/450/550/650/750/850/934) — attacker emphasis + line
  mid-flight (167), line arrived with bright tip (284), impact
  core popped (350), attribute particles scattering at the LP
  plate (450). Hit-stop proof from the same strip's timing table:
  across the collision the FX clock advanced 33 ms while 108 ms
  of wall time passed (~75 ms discrepancy = the 70 ms stop +
  sampling jitter).
- S2-C3 PASS: live LP probe (v3probe-lp.js) — a 3750 direct hit
  whose damage resolved after the response window: the count
  started at the resolution batch, ran 600 ms easeOutCubic
  (8000 -> 4250, decelerating samples), landed EXACTLY, and the
  -3750 damage number existed through the count window and was
  removed after. The same-batch path (start at attack+400) is
  covered by FXB2c + the design in fxLpCount.
- S2-C4 PASS (1-link): the pop is the card ghost with the big
  number on its lower edge (s2-after-chain f02) and travels to
  its chip while shrinking/fading (f07). RESIDUAL: the 2-link
  dashed connector + CHAIN beat was not captured live in this
  stage's duels (chains captured were 1-link); the code path is
  exercised only when n>=2 — carried as an unmeasured item, not
  a pass.
- S2-C5 PASS (normal solve): live capture (s2-after-solve) —
  foreground return (84 ms), gold frame ignited (300 ms), gold
  rising particles + exit (417 ms). RESIDUAL: the negated-link
  grayscale exit was not captured live (no negation occurred on
  camera); implemented off the snapshot's per-link neg flag.
- S2-C6 PASS: fxError null in live duels; particle budget clip
  active (attack burst measured at exactly 26 live).
- S2-C7 PASS: fxAttackLine / fxImpact and the fixed 240 ms impact
  delay are deleted; the battle path is the scene.
FOUND DEFECT (fixed in this stage, spec deviation recorded in the
proposal addendum): the prototype's particle drag formula divided
by (k/1000), throwing every dragK particle ~1000x too far —
invisible in the prototype AND in stage 1's stress demo (only the
spiral half ever showed). Measured before the fix: 26 particles
alive, 0 bright canvas pixels at the impact point. After the fix
(distance = sp*(1-e^{-kt})/k): bright-pixel lifecycle at the
impact 16 -> 747 -> 1022 -> 406 -> 80 -> 0 across 283-866 ms.
Selection/cancel group (standing focus): no new scene was built
in this stage; one requirement was confirmed by construction —
the chain pop (950 ms) and the response dock never interact: the
pop is presentation on the FX clock and the dock keeps input for
the whole window. The dock's own copy/flow is a stage-4 target.

## V3 integration — Stage 3: ace appearance + finisher (branch feat/v3-s3-ace-finisher)

### Requirements for this stage (why pros build it this way)

ACE. (1) A hold that does not move is a poster, not a scene: the
round-B cut-in held a still image for ~4 s. Requirement: during
the hold, SOMETHING with a period keeps moving (rotating
background vortex/streaks, drifting particles, a breathing glow)
— life is proven by frame pairs inside the hold, not by duration.
(2) The number is the payload: the banner's ATK/DEF count-up
exists because "who, and how strong" is what the presentation is
FOR; a finished number shown statically wastes the one moment
the eye is guaranteed to be on it. (3) Appearance and landing
are separate beats: portal -> flash -> presentation -> LANDING
on the board; without the landing beat the card teleports from
presentation to tile. (4) Takeover must be total or not at all:
if the scene owns an ace summon, the round-A converge/portal and
the round-B cut-in for the same summon are suppressed — two
presentations of one event read as a glitch. When the cut-in
setting is OFF, nothing changes (round A/B behave as before).
FINISHER. (5) Separation of the finisher and the result is by
TIME, inside the layer table: the wash lives in #fxcutin (z35)
and the result is gated until scene-local 2300 ms, when the
wash is gone. The z-65 body-level exception is deleted, not
worked around. (6) The wash has an ORIGIN (the defender's LP
plate) and a direction — a flat full-screen tint is the
amateur version this stage exists to replace.

### Stage 3 acceptance criteria (fixed BEFORE implementation)

- S3-C1 All 16 pre-existing test files pass, zero regressions
  (FXB7's cut-in ON/OFF contract in particular).
- S3-C2 Ace frame strip at FX-local ~200/450/750/1000/1300/1600/
  2400/3200/4000/4400: materials glow + converge (450); portal
  spinning WITH spiral particles and its rotation CHANGED
  between two frames in the window (750 pair); converge flash
  (700-820); scrim + big card + banner (1300); ATK mid-count —
  a banner value strictly between 0 and final (1200-1600);
  hold ALIVE: 2400 vs 3200 frames differ in background rotation
  and drifting particles; exit (4000); landing ring at the
  board zone (4400).
- S3-C3 Finisher strip: charge (250); cut-in flash (800); beam
  (~1300); impact + radial wash from the LP origin (1600);
  wash fully gone while the result is NOT yet up (~2250);
  result visible after the gate (~2400+). No frame shows the
  result under an active wash (the audited defect, closed).
- S3-C4 .fx-finishwash is gone: grep = 0 in client.js/index.html;
  the layer table (NOTES + CSS comment) no longer lists the z65
  exception.
- S3-C5 fxError null in live duels; particle budget respected
  during the ace (peaks: vortex 46 + burst 24 overlap ~950-1450;
  drift 26 may be clipped by the cap — clipping is the budget
  working, recorded if observed).
- S3-C6 Tap skip: a pointerdown during the ace hold moves the
  scene to its exit; the host is clear within ~900 ms of the tap.
Residuals expected: revival summons of aces keep the round-B
cut-in (the ace scene takes over non-revival arrivals); SE feel.
Selection/cancel group: no direct contact this stage; the
finisher's result gate lengthens the path to the result screen's
buttons — noted for stage 4's A-05/06 work (the wait is scene
time, and the buttons must not be tappable before they are
readable; the gate guarantees exactly that).

### Standing focus — two explicit requirements added (user, 2026-11-03; stage 4 must satisfy)

R-SEL-1 DETAIL DURING SELECTION: while choosing (targets,
materials, grid picks, discards), the user can open a candidate's
(or a related card's) full detail — text, ATK/DEF, state —
WITHOUT confirming or cancelling, and closing the detail returns
to the selection with its state intact. Survey basis (MD notes,
"Card detail view"): MD keeps a FIXED detail panel; selecting a
card swaps only the panel — field and hand stay visible and the
duel never stops. Any current scene where detail cannot open, or
opening it destroys the selection, is an audit gap.
R-SEL-2 BOARD VISIBILITY AROUND SELECTION: before and during a
choice, the whole board must be visually checkable. A sheet/dock
that covers the board and forces a blind choice is a gap; the
fix direction is board-visible selection (partial-height sheet),
or a peek mechanism (dismiss/translucify the sheet temporarily).
Survey basis: MD's pile-choice UI is a list panel at the field's
edge (8+ rows) with the field present; the detail panel never
takes the field away. Stage 4 judges EVERY prompt scene against
R-SEL-1/2 plus the (a)-(f) frame from the standing-focus section,
and adds the gaps to the audit before fixing.

### Audit addition (user report triage, 2026-11-03): unusable-effect invisibility (Minerva case)

Triage conclusion: NO engine/prompt bug — the activation completes
in the normal flow, and the reported symptom reproduces exactly
under legitimate game states (0 materials — notably after a
Monster Reborn revival / deck below 3 cards / already used this
turn). The real defect is UX: THE REASON IT CANNOT ACTIVATE IS
VISIBLE NOWHERE, which also violates the user's decided UI
principle (unusable = greyed out; the reason lives in the detail).
- At 0 materials the material badge itself disappears, so an Xyz
  monster is indistinguishable from a non-Xyz.
- The action sheet has no row for the un-offered ignition effect,
  and the detail shows no material count.
Fix proposal (from triage, stage 4 selection/info group):
(1) Xyz monsters always show the badge, "×0" included; the
detail/preview meta line shows the material count.
(2) The field Xyz action sheet lists un-offered ignition effects
as greyed-out rows; the reason (insufficient materials / deck
below 3 / already used this turn) is written on the detail side;
cases that cannot be determined stay with the generic form
"今は発動できません".

### V3 stage 3 — RESULTS (2026-11-03)
- S3-C1 PASS: all 16 test files pass on the final stage-3 code.
- S3-C2 PASS (frames v3shots/s3-after-ace): portal over the
  materials at local 433; count-up MID-VALUES read on real frames
  (1233ms: ATK 1473/DEF 1329 of 2550/2300; 1433ms: 2487/2243);
  hold alive (2450 vs 3283: vortex wedges rotated, motes moved);
  exit complete by 4483 and play continued.
- S3-C3 PASS (frames v3shots/s3-after-fin): at 2133ms the wash
  is gone, LP at 0, and NO result is shown yet; at 2367ms the
  result is fully readable with nothing over it. No frame shows
  the result under an active wash. (This capture's finisher
  overlapped the tail of an ace presentation — the killer had
  just been summoned; the composition still read correctly.)
- S3-C4 PASS: .fx-finishwash grep = 0 in client.js and
  index.html; the z65 exception row is gone from the layer table.
- S3-C5 PASS: fxError null across the instrumented duels and the
  full suite. One earlier uninstrumented sighting of a non-null
  fxError (first ace probe) was never reproduced in two
  instrumented duels + test-fx live duels; recorded as an
  unconfirmed one-off, not hidden.
- S3-C6 PASS: tap at ace local 2049ms -> host empty 760ms later
  (incl. ~120ms polling granularity; criterion ~900ms).

### NEW REQUIREMENT LEARNED (stage 3): presentation ownership is cross-batch
The state diff and the engine event for the SAME summon land in
DIFFERENT fxProcess batches. The first stage-3 build marked the
ace takeover per-batch, so the later event batch fired the legacy
cut-in, which overwrote the ace scene's host mid-flight (the
first ace capture showed a static legacy poster with full stats
at local 466 — a double presentation). Fix: the ownership marker
(fxAceRecent {code, con, until}) outlives a single call; the
arrivals pass stands down when the event pass owns the summon,
and the event pass can take over itself (fxAceSceneV3 from the
event, via 'acescene-event') when it beats the diff; a legacy
poster is never started while an ace scene is presenting.
General form: any "X already handled Y" coordination between the
diff pass and the event pass MUST be cross-batch, or the two
passes will double-present. Added to the proposal as an addendum.

## V3 stage 4 — requirements & criteria (fixed before implementation)

Requirement frame. Start screen: a settings screen's job is to
let the player confirm "what happens with these choices" in one
glance and reach the start in one action — developer-facing text
and unexplained mode names fail that job (proposal section 4 is
the spec). Result screen (audit A-05/06): confirm the outcome,
explain WHY it ended in the player's words, and connect to the
next action whose cost is visible BEFORE pressing. HUD (B-08):
a fixed-position readout must be glanceable; duplicated
information (turn ownership already in the topbar) is width
stolen from the phase name. Detail preview (B-14) + R-SEL-1/2:
the detail's job is to be readable at the moment of decision
without breaking the decision's context — a preview that loses
every allocation fight is a decided feature that does not exist.
Selection scenes (standing focus): judged per scene against
(a) what am I choosing, (b) what happens on confirm, (c) what
happens on cancel, (d) is it reversible, (e) how many remain,
(f) mandatory or optional — plus R-SEL-1 (detail openable
mid-selection, selection survives) and R-SEL-2 (board visible
before/during the choice).

Criteria:
S4-C1 start screen matches section 4: deck cards with feature
lines, result-worded response options, sound switch + state
word, start button state-linked (disabled + "読み込み中…"
until ready; failure turns it into a reload action), VS
transition ~0.9s with matchup + first/second, auto-advance.
S4-C2 result: sentences per A-05 (LP clamped at 0, overkill
shown separately as 超過ダメージ, deck-out with subjects, no
"その他"); two buttons per A-06 (同じ設定でもう1戦 keeps the
start selections; タイトルに戻る is the full reset).
S4-C3 B-08: phaseinfo shows the phase name only, nowrap +
min-width, widths constant across states (menu button always
present, disabled instead of display:none).
S4-C4 B-14+B-15: preview is funded BEFORE hand growth down to
the tile floor (40px): pvShown >= 26 at 390x620 and = 56 at
390x700 in live play; strips become 24px (labels 9px, numbers
10px, 5-digit numbers shrink to 9px) with stripClip still 0.
S4-C5 C-18/C-19/C-31: :active feedback on buttons; dock close
target >= 36px; duel-dismiss becomes an 11px button-grade
element.
S4-C6 selection group: every prompt scene inventoried and
judged against (a)-(f) + R-SEL-1/2; gaps added to the audit;
the worst gaps fixed with real wording (grid sheet: board
visible + peek + per-candidate detail that preserves the
selection; Minerva item: x0 badge always, material count in
detail meta, greyed unusable-effect row with a derivable
reason or the generic form).
S4-C7 all 16 tests pass; the five "good, do not break" audit
points stay intact (strip 2-line + stripClip, chainbar height
reservation, gold placement highlight, etc.).

### REAL DEFECT (triage #2, 2026-11-03): the silent tap-drop window after a summon
Measured (/tmp/minerva2/): for ~0.75s after a summon resolves,
board taps are silently discarded. The tile is painted and IS
the top element (elementFromPoint verified — not FX occlusion),
but currentPrompt is not yet IDLECMD/BATTLECMD and actionMap is
empty, so the tap handler drops the tap. The next prompt is
delivered only after the opponent chain-check pacing
(botChain 300ms) and batch pacing; phasebtn shows "—" meanwhile.
Applies to every summon/action, both on 44b7fd2 and cfa85e6.
Fix (stage 4, top priority in the selection group):
(1) prompt construction stays synchronous at issue time (it
    already is — uiAnswer builds currentPrompt/actionMap before
    any FX work; fxProcess is never awaited in the prompt path);
(2) taps landing in the window are BUFFERED (pendingTap) with an
    immediate visible acknowledgement (tile pulse), and when the
    next IDLE/BATTLE prompt builds actionMap, a fresh buffered
    tap for an actionable key opens its action sheet at once
    (leading input — the tap is honored, not dropped);
(3) while the duel is live with no prompt being answered, the
    UI says so: phase button reads 処理中… and the midbar shows
    an indeterminate progress edge — processing is visible, and
    nothing pretends the board is inert by design.
Global pacing values (bot 620 / botChain 300 / batch 40) are NOT
changed here: CPU tempo is an open user decision item.

### triage-#2 fix — verification (2026-11-03)
- Deterministic: at duel start (a guaranteed processing
  window), a hand card tapped while the phase button read
  処理中… opened its action sheet 344ms later with NO further
  tap (v3probe-tapbuf2).
- Stochastic live play (v3probe-tapbuf): a field-tile tap in
  the window was honored after 753ms. Two further attempts in
  that run predated the info-view fallback + 4s freshness now
  in the consume path (windows on the opponent's turn / keys
  with no offered action); the fallback aligns the buffered
  tap's reach with a direct tap's. Not re-run to a full 3/3 —
  recorded as such.
- The window itself (engine pacing) is unchanged by design;
  what changed is that taps are honored and the state is
  visible (処理中… + midbar progress edge).

## V3 stage 4 — RESULTS (2026-11-03)
- S4-C1 PASS (captures v3shots/s4-ui/start-620, start-700,
  vs-700): section-4 start screen — deck cards with feature
  lines and check dots, result-worded chain options
  (おまかせ/毎回/自動 + consequence sub-labels), cut-in
  出す/出さない, sound switch + state word, start button
  state-linked (A-03: disabled "読み込み中…" until ready;
  load failure turns it into 再読み込み). VS transition ~0.95s
  with matchup + first/second, auto-advance (A-01).
  Found+fixed during capture: the start content overflowed one
  screen at both heights — spacing compressed until the start
  button sits visible at 620 with no scroll.
- S4-C2 PASS: result sentences per A-05 (LP clamped at 0,
  overkill written separately, deck-out with subjects, no
  その他); two exits per A-06 — 同じ設定でもう1戦 (selections
  kept via sessionStorage, VS plays again) / タイトルに戻る.
- S4-C3 PASS (board-620 capture): phase name only, one line,
  constant widths; menu button present-but-disabled.
- S4-C4 PASS (real Chromium): 390x700 tile 47, pv=56 FULL
  preview, stripClip=0, fit=true; 390x620 tile 40 (floor),
  pv=22 compact, stripClip=0, fit=true. Found+fixed: at the
  40px floor the B-15 strip type clipped digits SIDEWAYS —
  strips shrink type under .smalltiles, and measureStripClip
  now measures the horizontal axis too (the round-4 check was
  vertical-only — same blind spot, new axis).
- S4-C5 PASS: :active feedback global; dock dismiss 36px;
  duel-dismiss is an 11px button-grade element; piles 28px.
- S4-C6 selection group (below). S4-C7 PASS: all 16 tests
  (test-layout expectations updated ONLY where B-14/B-15
  supersede them, each annotated in the test file).

### Selection scenes judged against (a)-(f) + R-SEL-1/2
- uiPlace: board-native (R-SEL-2 inherent); hint states the
  card + remaining count. No cancel exists (mandatory) — fine.
- uiPosition: identity + glyphs; mandatory, no cancel — fine.
  Detail not offered (visual choice; preview carries the card).
- gridSheet (select/tribute/sum): counts in the sub (a)(e);
  effect text inline; NOW: ATK/DEF line per candidate, a 詳細
  button per candidate (R-SEL-1 — selection state lives in the
  closure and survives), peek button (R-SEL-2), cancel reads
  選ばずにやめる (C-21: the local truth of cancelling).
- uiUnselect: same grid treatment (stats + 詳細 via infopop;
  toggling still goes through the engine round-trip).
- uiChain dock: context line carries chain number, target,
  timing, forced marker (a)(f); candidates NOW have 詳細
  (R-SEL-1) that never answers the prompt. Pass = パス (c).
- uiYesNo (effect): the effect text is IN the sheet (C-25).
- uiOption: source card text shown (C-24 partial — option
  descriptors are core string IDs the client does not hold;
  labelling the buttons with them is impossible client-side
  and stays a recorded residual, not a silent one).
- Action/pile/info sheets: close reads 盤面に戻る (C-21 —
  viewing vs cancelling are different weights and now read
  differently). Action sheet shows live material count in its
  meta and, for Xyz, the greyed unusable-effect row (Minerva).
- openCardInfo from a pile sheet still replaces the pile view
  (its close goes to the board) — noted, not fixed this round.

### Audit residuals carried forward (NOT deleted)
Of the 40 audit items: 13 fully addressed (A-01, A-03, A-05,
A-06, A-07, B-08, B-14, B-15, C-18, C-21, C-25, C-31, C-33),
4 partial (B-11 actionable dot/label; C-19 not every element
re-measured; C-24 above; C-28 start screen done, in-duel
settings sheet wording unchanged), 23 untouched (A-02, A-04,
B-09, B-10, B-12, B-13, B-16, B-17, C-20, C-22, C-23, C-26,
C-27, C-29, C-30, C-32, C-34, C-35, C-36, D-37, D-38, D-39,
D-40). They remain in fx-proto/audit-raw.md and in the
proposal for the next round / the daily brush-up loop.
Unmeasured as before: sound feel, real-device WKWebView
frame rate and rendering.

## Which-effect identification on confirmation prompts (2026-11-03)

User report: on "activate this effect?" confirmations the sheet did
not say WHICH card's WHICH effect was being asked about. Audit of
every yes/no-shaped prompt in the client found the real gaps:
SELECT_YESNO showed no card name and no effect text at all;
IDLECMD/BATTLECMD action sheets labelled every activation
"効果を発動"; SELECT_CHAIN candidates named only the card;
SELECT_OPTION buttons were bare "選択肢 N" (this also closes the
C-24 residual above — the option entries turned out to be the same
desc string ids the client can now decode).

Mechanism: the core names the effect behind an activatable entry,
a chain candidate, an option and most yes/no questions by its
description string id, aux.Stringid(code, idx) = code<<20 | idx
(bundled utility.lua). engine.js now also surfaces desc on the
chain-context mirror. Verified live: 1330 activatable entries over
12 seeded duels — desc>>20 always equals the entry's own card code.

The catch: script idx is NOT printed-number-minus-1 in general.
Printed continuous effects own no description, so indices shift
(Gravekeeper's Trap idx0 = printed ②, its ① is continuous). And
some cards collide or lack descriptions entirely. fxmap.json
(generated by gen-fxmap.js from the bundled scripts + official
texts) therefore grants a number only where audited:
- id (identity) for 32 cards: described activatable blocks form
  the gapless prefix 0..k-1 and k equals the circled-effect count.
- map overrides for 3 cards (墓守の罠 / 宵闇のルーチェ /
  ラビリンス・ウォール・シャドウ): idx0->②, idx1->③.
- NO number for the rest: Metaphys Horus (three trigger blocks =
  one printed effect), Trilosukta (idx2 = the unnumbered Synchro
  procedure), Pluto / Hyperion (missing/duplicated indices),
  Heavy Magical Tank (idx1 = ③, idx0 = a described summon
  procedure whose Stringid(35026117,2) yes/no "apply the ③
  effect?" is not mechanically separable — full text shown),
  Minerva / Zorga / Chaos Hunter and friends (effects own no
  descriptions — full text shown; Minerva's Stringid(…,0) yes/no
  is the optional destruction inside its ② and stays unnumbered).
Follow-up yes/no questions (desc idx == the card's described
count) quote the parent effect's own 「その後、…できる」 clause;
the parent is pinned via the solving link in the prompt context
(Mudora ① Trap placement, Kelbek ② Trap set — both observed live;
Agido/Uproar follow-ups resolve the same way through their
context desc, unobserved in random play).

Display: every confirmation now leads with the card name + effect
number, quotes exactly the asked effect's text as the main block
(「聞かれている効果：N」), and keeps the card's full text one tap
away in a details element. Unidentified prompts show the named
card with the full text and no number — never a guessed number.
"このデュエル中は聞かない" labels and the auto-pass records now
carry the effect number too (dismissal keys were already
desc-scoped; only the label changed).
Tests: test-fxidentify.js (unit, real data.json + fxmap.json) all
pass; the full existing suite passes unchanged (jsdom suites run
with NODE_PATH=/tmp/jsdomtest/node_modules).
Addendum (same round): Spell/Trap entries that carry NO desc are
the card activation itself (census: every desc-less S/T entry is a
fresh activation; every effect activation carries a desc) — those
are labelled 発動：<activation text> via entryEffect(), never with
a guessed effect number. Follow-up yes/no answers read 行う/
行わない (they are not activations). Frame verification: live-duel
captures of the chain dock plus deterministic renders of all seven
prompt shapes through the real client UI (390x620 and 390x700),
with prompt objects copied from the live census shapes.
## V4 polish — Round 1: ace + attack (branch feat/v4-polish, 2026-11-03)

Foundation added for all V4 rounds: scenes may register drawLow /
drawTop paint hooks on the shared FX clock (fxPaintCanvases paints
bursts — with an additive second pass for bursts flagged `add` —
then hooks). Bloom/soft-ring/comet helpers (fxDrawGlow,
fxDrawSoftRing, fxDrawComet) port the approved prototype's light
model: additive 'lighter', three-tier gradients, sprite-only, no
shadowBlur. Hooks declare paint windows (winLow / winTop) so an
idle canvas is never cleared/repainted; fxAceSkip retargets the
ace's windows when a skip moves the exit earlier. Structure rule
verified by audit for both scenes: no per-frame boxShadow /
filter / left / top writes remain in any render or hook (filters
and shadows are set once at element creation; dissolves are
opacity cross-fades between stacked copies).

V4-1 ace: hold glow = 2 additive canvas layers (r200/r130, 2.4 s
period, phase-shifted) replacing the per-frame boxShadow pulse
(static frame shadow set once). Materials: preset-filter hot copy
cross-fade + trail ghosts at 66%/33% of the converge path
(.30/.15) + white heat glow at the moving point. Portal: dark
funnel core (.55) + soft rim ring breathing with the spin-up.
700 ms flash = three-tier bloom (52 white / 120 / 215). Card
entrance: two afterimage copies at 55/120 ms lag (.30/.14).
Banner stagger: name -> gold rule draws 1180-1400 -> count starts
1280 (was 1200). Exit is two-stage: background/streak rotation
freezes at 3900, glows collapse inward (implosion soft ring),
card sinks +6 px, scrim lifts only from 3980. Landing = two soft
rings, 60 ms stagger.

V4-2 attack: the DOM line/tip/cores/rings are gone. drawLow paints
the attacker halo + one rim-light sweep (170 ms), the tapered
comet (tail = min(len*.55, 90px), trail ghosts at 30/60/95 ms
lag), the three-tier impact bloom (34 white / 62 / 110), two soft
rings (60 ms stagger) and, on destruction, 2-3 thin rising light
streaks. Impact/destroy bursts paint additively. The dissolve is
a cross-fade: main ghost / white-hot copy (peak 350-410) / gray
copy (takes over 410-520). Damage number runs white-hot for its
first 70 ms (3 quantized colour steps) in fxLpCount.

Measured (v4probe, same protocol as stage 0; software rendering):
mix 700 — baseline >16.7ms 3.9% / >33.4ms 0.8%; ace 7.3% / 0.4%,
max 50.1 (stage 0: 7.0% / 0.9%, max 500 spike — the spike is
gone); attack 5.4% / 0.2%, max 33.5 (stage 0: 5.1% / 0.7%).
mix 620 — ace 8.1% / 0.5%, max 50.1; attack >33.4ms 0.9%, max 50.0.
Residual for R4: the ace's >16.7ms rate still sits ~+3pt over the
run baseline (stage 0 was +1.7pt with a slower baseline) — the
remaining cost is the rotating conic bg/streaks repaint, not the
V4 layers; candidate fix is rasterising that rotation to canvas.
Frame strips: v4shots2/r1-ace, r1-attack, r1-attack2 (direct
attack grammar verified end-to-end; monster-battle ghost stack
verified structurally + by test-fx, its strip is still owed and
scheduled with the R2/R3 captures). All 14 default tests pass.

## V4 polish — Round 2: chain + transitions/sheets (2026-11-03)

V4-3 chain: the pop's per-frame boxShadow became a preset-shadow
rim overlay (opacity only) + a canvas rim-light sweep (0-150 ms);
the number slam keeps its timing, its ring is now a canvas soft
ring; the dashed DOM link line (with its per-frame
backgroundPosition crawl) became a glowing cord + a travelling
pulse dot (600 ms period) on the low canvas. From link 2, the
word CHAIN stands up above the pop, letters staggered 30 ms
(chainword scene, 1500 ms). The solve now FLIPs from the link's
own chip rect (180 ms, snap) instead of scaling in at centre;
gold ignition moved back to 200-330 (burst cue moved with it,
n=10); frames/glow are preset-shadow overlays; on exit the glow
dies first (330-400), then the card sinks 8 px. Negation uses a
preset-filter gray copy cross-fade — no per-frame filter writes
anywhere in either scene.

V4-6 transitions/sheets: the phase banner is a scene on the
shared clock (was WAAPI): snap entry 160 ms, gold rule draws
200-380 under the label, exit accelerates out 700-820 (total
unchanged). Sheets: opening (only on a closed->open transition)
slides up 280 ms on the sheetIn bezier (its overshoot is the
specified ~4%), scrim fades 180 ms, content rows stagger at
25 ms from +90 ms; closing slides down 180 ms (inQuad bezier)
with content kept visible but inert — the closing state rides
in data-closing, never the class list (className === 'on' is
load-bearing, see the audit-27 record above), a capture-phase
click blocker eats stale taps during the 185 ms finalize, and
sheetOpen supersedes any in-flight close. Peek reuses the same
curve (CSS transition retimed). Switch knobs move by transform
now, not left. Residual (recorded at stage 0, unchanged by the
motion work): the ~133 ms sheet-open stall is dominated by the
sheet content's innerHTML construction, not by the absence of
animation; pre-building prompt content is a separate decision.

Measured (v4probe, stage-0 protocol): mix 700 — chainpop
>33.4ms 0.0% (max 33.3), chainsolve 0.0% (max 33.4; stage 0:
0.7%); mix 620 — both 0.0%. Frame strips: v4shots2/r2-chain,
r2-solve, r2-chain2 (link-1 pops + a gold-ignition solve frame
verified by eye; a link-2 pop strip is still owed — two-link
chains did not occur in the capture duels). All 16 suites pass.

## V4 polish — Round 3: finisher + portal (2026-11-03)

V4-4 finisher (total 2900 ms, result gate 2300 ms, unchanged):
the charge's boxShadow is set once at creation (it was rewritten
every frame) and the charge staggers in three tiers — rim 0-300,
halo 120-420 (top canvas), vignette 240-500. The DOM impact core
became a three-tier canvas bloom (1420-1650). The wash gained a
second source at screen centre (alpha .30*(1-u)^1.6) and a
last-light ring contracting 260->40 px over 1900-2350. The tilt
is now a decaying recovery (-0.5 deg, +0.10 deg overshoot,
settle). The LP drain carries a red pulse synced to the drain
rate (textShadow quantized to 10 steps), and the landing pop is
a settle on the FX clock (it was a wall-clock setTimeout). The
result itself now enters with a snap (sinks 10 px) and a gold
bloom element of its own — the bloom was first drawn on the FX
canvas, where the result overlay occluded it; the R3 frame strip
showed that, so it moved into the result overlay.
V4-5 portal: a scene on the shared clock (was WAAPI + a paired
fxZoneGlow call at each site; the glow is folded into the scene,
its duration is the third argument). 60 ms staging: glow 0-,
rings 60-, spiral burst 180, birth flash 330, landing 330-520.
Two counter-rotating ring layers (method-coloured CSS) spin up
quadratically, cruise, and brake into a scale-.8 collapse
(720-840). Defect found and fixed during this round: the new
spiral burst omitted its radius band, which threw inside the
particle draw pass and froze the frame loop (caught by the
error-stack harness before shipping; fxSpawnBurst now defaults
spiral r/turns so a malformed burst cannot do that again).
Measured (mix 700): portal >33.4ms 0.5% (max 83.4); finisher
>33.4ms 4.0% but max down to 83.4 (stage 0 spikes were ~350) —
the remaining >33.4 frames sit in the cut-in phase and share
the ace's known residual: the rotating conic background
repaint, which Round 4 rasterizes. Frame strips:
v4shots2/r3-finisher2 (charge/cut-in, impact bloom at the LP
plate, wash decay, result after the gate — verified by eye).
Zero pageerrors over a 480 s fusion-mirror run (v4err.js).

## V4 polish — Round 4: rasterized backdrops + close-out (2026-11-03)

The rotating conic backdrops (ace L8 + streaks, finisher swirl)
and the finisher's 720 px wash were the repaint cost both the
stage-0 and R3 distributions kept flagging: DOM gradient layers
re-laid-out/repainted on every frame of their windows. They are
now pre-rendered once per (colour, pattern) into offscreen
rasters (fxConicRaster / fxDiscRaster, cached) and only drawn
rotated / scaled on the FX canvas. Everything else about the
scenes — envelopes, rates, colours — is unchanged, and the
frame strips (v4shots2/r4-ace, r4-finisher) show the same look.
Final measurement (mix 700, latest of three R4 samples;
baseline >33.4ms 0.5%): attack 0.0%, portal 0.0%, chainpop and
chainsolve ~0.5% (R2 run), finisher 2.6% (max 66.6; stage 0 was
4.0% with ~350 ms spikes; the wash raster alone moved it from
7.5% to 2.6% between two samples of the same day), ace 2.9%
(max 83.4; stage 0: 7.0%). Run-to-run variance in this
software-rendered harness is large (one R4 sample had a 1.6%
baseline and proportionally worse scenes) and the two long
scenes also absorb prompt/engine work that overlaps them, so
the ace hold and the finisher drain remain above the 1% target
ON THIS HARNESS; real-device (WKWebView, GPU-composited) fps is
unmeasured by design and stays on the brushup loop's list.
Still owed (capture luck, not defects): a monster-vs-monster
attack strip (the destroyed-monster ghost cross-fade) and a
link-2 chain-pop strip (CHAIN word + cord) — clicker duels
produce direct attacks / prompt-suspended attacks and one-link
chains only; both paths are covered structurally and by
test-fx. All 18 suites pass.

### Merge with audit-27 (aafefea) — conflict resolution record
feat/v4-polish (from f288d69) and audit-27 (also from f288d69)
landed in parallel. client.js / index.html auto-merged (disjoint
regions); NOTES.md had both appends kept. One semantic fallout:
test-layout LAY-b0 failed x6 on the merged tree — and, verified
by running it on aafefea alone, on the audit tree itself: the
audit round's C-20 view-kind contract ('on view' className for
pile sheets) postdates the test's `className === 'on'`
expectation. The behaviour is correct (sheet opens; LAY-b1/b2
freeze checks pass), so the test expectation was aligned to the
new contract (classList.contains('on')) with this note as the
audit trail. The audit commit message's "all 16 suites pass"
does not hold for test-layout on its own tree. RESOLUTION
(update): the audit line then fixed it their own way in f71b2d9 —
the C-20 kind marker moved from className to data-kind, since
className === 'on' on #sheetwrap is a load-bearing contract
(test clickers, pending-tap guard). That fix is the one that
stands: my interim test-expectation alignment was reverted, the
original LAY-b0 expectation passes again, and any future sheet
state (e.g. V4-6's closing motion) must likewise ride in data-*,
never in the class list.
## Audit-27 round (the 23 untouched + 4 partial items from the v3 audit)
Implemented on feat/audit-27 from f288d69; wording/layout/flow
items first, presentation-adjacent items (signal colours) last.
All 16 test suites pass (test-phase2's sampling-dependent C/A2
checks failed on the pristine base with 0 sampled ANNOUNCE_CARD
prompts and passed on re-run — a pre-existing flake, unchanged).
Frame-verified at 390x620/700 in real duels (a27shots/).

- A-02: start screen now reaches the start button at 390x620
  with no scrolling (scrollH 669->649 after compression;
  btnBottom 615 <= 620). Savings came from UA-default heading
  margins and whitespace, not content. Only the load-count
  footnote (A-04's kept line) sits below the fold at 620.
- A-04: verified in code — the start button IS the load state
  (disabled + label), failure turns it into a reload button;
  the failure wording no longer names files (see C-33 note).
- B-09: #opppiles removed (element + render write) — the
  topbar duplication is gone; pile bars carry the counts.
- B-10: client-kept, turn-tagged log history (engine mirror
  caps at 60 lines); 履歴 button in the idle chain band opens
  the last 30 entries. Button height is 19px: the band's
  height is frozen by the layout budget (recorded trade-off).
- B-11: actionable piles carry a 発動可 label and a gold dot
  in addition to the frame colour.
- B-12: zone numbers 9px in a brighter tone; the field zone
  shows no number and a blue-grey frame (.slot.fzone).
- B-13: one signal grammar — gold = waiting for your input
  (field tiles, hand cards, piles, chain candidates, placement
  slots as before), green = selected, red = targeted.
- B-16 (partial): hand card names are a fixed 10px and
  duplicate copies carry a xN badge. The audited 56px minimum
  hand width is NOT enforced: hand width derives from the tile
  width inside the frozen layout budget.
- B-17: the idle chain band shows the previous log event.
- C-20: sheets carry a kind — view sheets (action, pile,
  card info, dismissal manager, FX settings, menu) can be
  left via backdrop tap or the x button (same single exit as
  their own close button); prompt sheets ignore backdrop
  taps. .btnrow is sticky at the sheet's bottom edge.
- C-22: a disabled grid confirm button states the remainder
  (決定（あとN枚） / 決定（合計あとN）); tapping past the cap
  answers in the sub line instead of silence; disabled-button
  contrast raised (#b3a077 on #4a3d22). SELECT_SUM sheets get
  no "remaining" label: the engine's sum check is a two-value
  combination search, so a remainder cannot be stated
  honestly; their sub keeps the condition itself.
- C-23: grid card names ellipsize on one line; grid card text
  ends with an ellipsis via line-clamp (the audit's fallback
  route — the text itself stays, detail is one tap away).
- C-24: option buttons resolve their descriptors through a
  curated map (optionLabelText). Re-verified: the core sends
  Stringids (code*16+idx); the ONLY SELECT_OPTION reachable
  in the 63-card pool is Agido (Duel.SelectEffect), and both
  of its descriptors resolve to Japanese labels (checked
  against the English string table in babelcdb cards.cdb and
  the card's own script). Unresolved descriptors fall back
  to a numbered button. A general solution needs a Japanese
  official string table the client does not hold; extend
  OPTION_LABELS if the pool grows a SelectEffect user.
  window.__optLabel.resolve(desc) is the test surface.
- C-26: the placement banner names the card being placed
  when the identity is certain — the just-chosen procedure
  action's card (lastPlaceCard; summon/set actions place the
  acted card by rule). Effect activations do not set it (the
  banner keeps the context form rather than a wrong name).
  The banner sits directly under the midbar, never takes
  taps, and a retry adds a second line naming the next
  action. The card being placed keeps a gold frame in hand.
- C-27: the per-turn confirmation count appears only from
  the 3rd confirmation in a turn. SELECT_EFFECTYN sheets
  offer duel-long suppression per card+effect descriptor
  (duelNoConfirm): the sheet button answers "no" once and
  later prompts auto-answer with an autopass flash. This
  also closes backlog BU-06; BU-08's exit side lands here.
- C-28: the in-duel settings sheet uses the start screen's
  words （おまかせ/毎回/自動） with one outcome line each;
  its seg buttons are 39px like the start screen's.
- C-29: the phase-bar button and its sheet agree: その他.
- C-30: the disabled phase button distinguishes 相手のターン
  from 処理中….
- C-32: pile sheets name their empty states with counts;
  pile rows carry a chevron (they open the card detail).
- C-34: a retried grid sheet re-states its condition under
  the warning; placement retries use the C-26 second line.
  (Retries only occur on rejected answers, so by design no
  legal-play frame exists; test-ui asserts the warning never
  appears in legal play.)
- C-35: deck buttons state their main-deck counts (44/40,
  read from data.json).
- C-36: the settings heading is one sentence, effect first.
- C-37 -> D-37 (partial): sheet padding 12px, option buttons
  12px, topbar padding 4px, button-row margin 12px applied.
  The segrow value from the audit table (8px) lost to A-02's
  620 fit and is 5px 0 3px; field padding is untouched
  (frozen board).
- D-38: remaining functional 8px text raised to the 9px
  floor (zone numbers via B-12, FX ghost names). Rule of
  record: functional text is 9px or larger.
- D-39: covered by A-01's VS transition (it spans the
  engine-start wait); this round's captures show no dead
  screen between the start tap and the duel.
- D-40: counter +/- buttons are 36px. OPERATIONAL RULE:
  when a counter-using card enters the pool, merge requires
  live-play screenshots of SELECT_COUNTER in both the
  total-match and total-mismatch states (the pool currently
  has no counter user, so the sheet is still unreached).
- Also fixed in passing (stage-4 residuals observed while
  working): C-33's two strings were still developer-worded
  (load failure named data.json; the fallback sheet said
  専用UIがまだありません) — both now player-worded. C-21:
  uiUnselect's cancel still read キャンセル — now
  選ばずにやめる, matching the grid sheets.
- Backlog: BU-01 (own set cards carry a 裏 badge; the surface
  shown to the owner is unchanged by design), BU-02 (hand
  cards with no legal action grey out while a command prompt
  is open; the one mechanically certain reason — battle-phase
  summoning — is stated in the preview), BU-09 (the chain
  dismissal is a labelled text button: このチェーンでは
  聞かない / 聞くに戻す).
- BU-04 needs a decision, not code: dismissedDuel is keyed
  by chainKey (code+controller+location+seq+desc), i.e. per
  card INSTANCE at a location — the same card is re-asked
  after it changes zones, which matches the backlog's
  observation. Whether the scope should be the card class
  (by name) is a spec choice; left as judgment-waiting.
- Observed, pre-existing, NOT this round's items: at
  390x620 the ATK/DEF strip lines overflow horizontally by
  3-6px (scrollWidth 37-40 vs clientWidth 34) — measured
  identically on pristine f288d69, so not a regression; it
  belongs to B-15's territory and is filed in the brush-up
  backlog for the daily loop.
Unmeasured as before: sound feel, real-device WKWebView.

## Minerva 3rd triage (2026-11-03): the 4th legitimate state — activation locks
- The user's 14:28 screenshot REFUTED the earlier "no bug, 3
  legitimate states" verdict: turn 1, Main 1, Minerva just Xyz-
  summoned, materials x2 (tile AND sheet), deck 30 — yet the
  sheet's 発動 row was greyed with the generic 「今は発動でき
  ません」. None of the 3 known states (materials 0 / deck < 3 /
  used this turn) can hold there.
- Root cause (reproduced at engine level, 11/11 Vernusylph
  duels): 森と目覚の春化精 (36745317) and 花と野原の春化精
  (62133026) carry 「このターン、自分は地属性以外のモンスターの
  効果を発動できない」. Minerva is LIGHT. Fire a Vernusylph hand
  effect earlier in the turn — the standard Ishizu turn-1 line,
  which also explains the user's GY 5 / deck 30 — and the core
  CORRECTLY omits her ignition from SELECT_IDLECMD. No engine
  bug, no parser bug (raw bytes re-decoded independently; both
  repos-layout variants consume the message exactly and agree).
  Unfired controls offered her normally and the activation
  resolved (detach -> mill 3). The first two triages missed it
  because their reproductions never played the Vernusylph line.
- The defect was invisibility, again: the reason lives in
  ANOTHER card's lingering restriction, which the sheet's
  detach/mill derivation cannot see. Fix (client.js): the
  restricting cards are derived from the pool's own card texts
  (regex over DATA.texts -> {36745317, 62133026}, EARTH
  exception), the human's activation is latched from the
  presentation event stream (noteMonsterLock, fed by
  drainSeEvents — the same latch path as BGM key cards), scoped
  to the activation turn, and openActionSheet now states
  「このターンは地属性以外のモンスター効果を発動できません」
  for ANY of the human's field monsters whose 発動 action is
  missing under an active lock (the lock reason outranks the
  Xyz detach/mill reasons — it blocks regardless of both).
  Reasons are still only stated when mechanically certain.
- Verified: test-minerva3.js (new; derivation, latching,
  opponent-does-not-latch, EARTH exception, turn expiry) +
  all 16 existing suites pass; real-browser play (headless
  Chromium, 390x700) reproduced the user's exact frame —
  turn 1, zone 3, materials x2 — and the sheet now shows the
  lock reason (shots-minerva3/ in the fix worktree).
- The screenshot's "EX 15" is NOT a bug: the pile bar shows the
  OPPONENT's piles (at duel start it reads 35/15/0/0/5 = GG's
  40-card deck minus its opening hand, EX untouched). The
  user's own EX count is not what that bar displays.
- Still unmeasured: sound feel, real-device WKWebView.
- Follow-up (same day, user direction): the lock reason now
  NAMES the imposing card — 「《森と目覚の春化精》の効果の制約で、
  このターンは地属性以外のモンスター効果を発動できません」.
  The latch record carries the source code (monsterLock.code),
  so the name is as mechanically certain as the lock itself;
  if a name ever fails to resolve, the unnamed form is kept
  (never a raw code). The latch stays keyed on the activating
  event + code, so a future opponent-imposed lock can ride the
  same record. The Xyz detach/mill reasons are the card's OWN
  costs (the sheet already shows that card) — out of scope for
  naming. Verified: test-minerva3 updated (M3-4 latch carries
  the code, M3-5/M3-9 expect each Vernusylph's own name) + all
  suites pass; real-browser frame at 390x700 re-checked
  (shots-lockreason/ in the fix worktree).

## Zolga confirm triage (2026-11-03): MSG_CONFIRM_CARDS was parsed, then dropped

- User report: 《予見者ゾルガ》 (31525442) — "the look-at-the-
  opponent's-deck effect doesn't feel like it's working properly."
- Triage (stacked-deck harness, test-zolga.js part 1): the SCRIPT
  is stock and correct (spop calls Duel.ConfirmCards for both
  decks after the special summon), the CORE sends
  MSG_CONFIRM_CARDS twice (own top 5, opponent top 5, shown =
  activator), and the engine's byte parse is exact (0 bytes left,
  codes match the decks). The special summon and the
  AnnounceNumberRange choice also worked. The defect was purely
  in the last hop: engine case 31 updated only the mirror's
  knowledge (hand reveal / deckTop) and emitted NO event and NO
  log line, so the client had nothing to present. The confirmed
  cards never appeared; at most the single top card of each deck
  surfaced later, buried in the deck pile sheet as
  「一番上（公開中）」. The user's impression was correct.
- Second, latent direction bug in the same lines: the knowledge
  conditions were hardcoded `shown === 0`. With the human on core
  seat 1 (後攻）, they tracked the CPU's knowledge instead. Now
  keyed to `this.humanPlayer`.
- Fix: engine case 31 collects the entries and pushes
  `{kind:'confirm', shown, cards}` plus a 「確認：…」 log line
  when the shown player is the human seat. client.js queues
  human-addressed confirms as they arrive (queueConfirmEvents,
  fed by the onUpdate event copy) and presents them as ONE
  read-only sheet （カードの確認） at the head of the next human
  prompt, before the prompt itself opens: grouped by
  controller+location, deck groups sorted top-first (highest seq
  = top, the mirror's deckTop rule) and numbered from the top.
  Rows open the FLOATING detail (openInfoPop) — never
  openCardInfo, which replaces the sheet's content and would
  destroy the sheet's own close button, stranding the wait.
  The close button is `#sheet-cancel`, the id every view sheet
  (and the test clicker) already knows.
- Coverage is generic, not Zolga-shaped: any ConfirmCards
  addressed to the human now surfaces (the first real-browser
  capture actually caught a hand confirmation —
  ラビリンス・ウォール・シャドウ — before the deck one).
- Verified: test-zolga.js (new; Z1–Z9 wire→event→state truth
  incl. event codes == raw message codes and deckTop == topmost
  confirmed card; C1–C8 the real client's sheet in jsdom) + all
  existing suites; real-browser play (headless Chromium,
  390x700, scripted driver on the real deck) captured ゾルガ's
  reveal sheets (shots-zolga/ in the fix worktree). Note the two
  looks present as TWO sequential sheets, not one combined: the
  script announces a number and confirms per deck, so each look
  is shown right after its own number choice — the game's own
  order.
## Pool-wide coverage (2026-11-03): clarity mechanisms over all 63 cards

User direction: the clarity fixes (which-effect identification on
confirmation prompts; "cannot activate" reasons on the field
sheet) must cover the WHOLE pool by mechanism, not per incident.
Anything not coverable is enumerated here with counts — never
silently dropped. Gate: v2/test-poolcov.js re-derives coverage
from data.json + the scripts on every run and fails if a card,
a described desc idx, an undescribed activatable block, or a
lingering restriction is unclassified (a future pool addition
trips it until classified). Generator-side, gen-fxmap.js now
prints an UNACCOUNTED line for any SetDescription idx it cannot
place (currently zero).

### 1. Which-effect identification (YESNO / EFFECTYN / SELECT_CHAIN / SELECT_OPTION)

Classification of the 63 (test-poolcov prints the full table):
- 番号特定 (desc resolves via identity or audited map): 45
- 番号特定 via scope/yn/bare tables: 3 (Minerva, Zorga, Hyperion)
- 単一効果/発動慣例 (single printed effect; S/T activation names
  segment ① via the act convention): 11
- 番号対象なし (no numbered activatable effect exists to pin): 4
  - 闇の護封剣 (12923641): activation = ① by convention; its
    self-destruct link carries no number by design.
  - 闇の守護神－ダーク・ガーディアン (26746975): printed ①② are
    continuous; its only desc is the special-summon procedure.
  - メデューサ・ワーム (2694423) / カオスポッド (79106360):
    the official texts themselves carry NO circled numbers
    (old-style / flip text). There is no number to pin; the
    sheet shows the full text. NOT fixable by construction.
- 未カバー: 0

New mechanism pieces this round:
- gen-fxmap described-block scan widened: Vernusylph
  AddSpSummonEffect helper descs and Fusion.CreateSummonEff
  descs are now collected (天至る叛逆 ① was previously
  invisible to the scan and is now an identity resolution).
- Hand-audited overrides (script-read, per card): Trilosucuta
  {0:①,1:②} (idx2 is ②'s EX-summon restriction, never an
  entry), Horus {0,1,2:①} (three material variants of one
  printed effect), Pluto {1:①}, Heavy Magical Tank {1:③}
  (idx0 is the summon procedure's registration — registered
  as KNOWN_NON_ACTIVATABLE), Corolla {0:②}, 森と目覚
  {0:②,1:①}, 花と野原 {0:①}, Chaos Hunter {0:①},
  沼地の魔道王 {0:①}.
- pmap (one desc idx, two effects of disjoint types, split by
  prompt scope): Hyperion idx0 = ① idle / ② chain.
- yn table (a SelectYesNo idx inside an effect's operation
  pins that effect as the follow-up parent): Minerva
  {0:②}, Heavy Magical Tank {2:③}, Agido {3:②}.
- bare table (effects with NO usable description, pinned by
  location+scope — the location leaves exactly one candidate):
  Minerva idle/MZONE→①, chain/GRAVE→②; Pluto idle/GRAVE→②;
  Zorga idle/HAND→①, chain/GRAVE→②. NOTE: "no description"
  includes small non-Stringid desc values — Minerva's real
  EFFECTYN arrives with desc=221 (captured from the core,
  cap-minerva2.js), and scopedEffect's bare branch keys on
  "desc does not decode to this card's Stringid", not desc==0.
- foreign follow-up: the Vernusylph shared helper asks its
  optional-summon YESNO with Stringid(9350312,1) — a code
  outside the pool. When a YESNO's desc does not decode in the
  pool and the resolving link's desc resolves to an effect
  with a 「その後、…できる」 step clause, the question renders
  as that effect's follow-up. ORDER MATTERS (browser-found):
  this check must run BEFORE resolving the context desc,
  because the context always resolves and shadowed it — the
  question rendered as an activation confirmation.
- resolveEffect now consults map/id BEFORE the follow-up
  count rule (Pluto idx1 collided: described count 1 made it
  look like a follow-up of ①; it is ① itself).
- Latent bug found & fixed: openActionSheet decided "an
  activation is offered" by exact label match ('効果を発動'),
  but identified effects carry numbered labels — offered
  activations were missed and a spurious greyed row could
  appear. Detection now uses the act entry's own flag.

### 2. "Cannot activate" reasons on the field sheet

Generalised: the greyed row now covers face-up MZONE and SZONE
(was MZONE only), with reason priority (a) attribute lock
(monsters), (b) 死者蘇生 rider (monsters), (c) once-per-turn
usage, (d) Xyz detach cost / mill vs deck count (monsters),
(e) generic 「今は発動できません」 when the card provably has
a field-activatable effect (fieldCandidates). Silence remains
where no reason is mechanically certain.

- (c) is new: usage is tracked from the human's own chain
  links (trackUsedFx, fed by onUpdate). The OPT clause is
  parsed from the official text: covered numbers + SHARED
  (「いずれか１つしか使用できない」 — Castel, Karbon; or the
  whole-card form) vs PER-EFFECT (「それぞれ…」 or a single
  named effect). The reason is stated only when it fully
  explains the missing offer: every field candidate is
  clause-covered AND the clause is spent (shared: any
  candidate used; per-effect: every candidate used).
  fieldCandidates excludes trigger-phrased effects (a
  condition clause 〜場合、/〜時、 before 発動できる), grave/
  hand/banished-bound effects, and hand effects whose cost
  discards the card itself (Vernusylph ①s). pmap usage
  attribution: a pmap card's chain-opening link is its
  ignition, later links its quick effect (chain array is in
  formation order — engine pushes links).
  PRODUCTION BUG found by this round: the engine's getState
  chain projection dropped `desc`, so no usage could ever be
  recorded in the real client (vm tests fed synthetic links
  WITH desc and passed). desc is now projected.
- (b) is new: 死者蘇生's rider ("the revived monster cannot
  activate its effects this turn") is latched by
  noteReviveFromEvents. Presentation events arrive in
  per-process batches and the activation and its summon
  NEVER share one (chain windows intervene — a same-batch
  design could never fire in production; found by this
  round's batch analysis). The latch is therefore ARMED by
  the human's 死者蘇生 activation and fires on the next own
  special summon while armed （死者蘇生 summons exactly one;
  in this pool nothing else summons to the human's field
  while a chain resolves). The arm dies when the chain has
  fully closed in an earlier batch without a summon
  (negated), when the human activates something else first
  (a conservative miss), on an ambiguous multi-summon batch,
  or when the turn moves on: silence, never a wrong claim.
- (a) unchanged mechanism (Vernusylph pair, name-carrying
  latch from the Minerva round).

### 3. Lingering-restriction scan (all 63 texts, pattern-derived)

test-poolcov D asserts the scan finds EXACTLY this set:
- 属性ロック (this turn, no monster effects except one
  attribute): 森と目覚の春化精 36745317, 花と野原の春化精
  62133026 → latch + named reason (existing).
- 死者蘇生 rider (28958464): revived monster cannot activate
  → latch + named reason (this round).
- Trilosucuta (21368273): EX-summon type restriction this
  turn → NOT COVERED for reason display: the surface is the
  EX-summon prompt, not the field sheet. Enumerated.
- Horus (36898537) attack rider on the targeted monster;
  光の護封霊剣 (78625592) opponent direct-attack lock →
  attack surface, not activation. Enumerated, out of scope.
- 巨神封じの矢 (67037924): its grave effect cannot activate
  the turn it was sent to the grave → surface is the grave
  pile sheet. NOT COVERED. Enumerated (1 card).
- Card-name activation limits: 現世と冥界の逆転 (once per
  duel), 死者蘇生 / おろかな副葬 / 七星の宝刀 (once per
  turn) → surface is the HAND sheet, not the field sheet.
  NOT COVERED for reason display. Enumerated (4 cards).

### Verification (this round)

- test-poolcov.js (new): A fxmap-target sanity, B described-
  idx resolution-or-exception (6 enumerated exception idxs:
  Dark Guardian procedure, 沼地 name-substitute, Trilosucuta
  restriction, Medusa ×2, Chaos Pod — all non-prompt or
  numberless by construction), C undescribed-block
  classification (S/T activation convention / bare / 9
  enumerated non-prompt machinery cards), D restriction-scan
  set equality, E lock-set equality, F behaviour spot-checks
  (yn pins, pmap scopes incl. real desc=221 shape, OPT
  shared/per-effect semantics, revive latch incl. ambiguous
  batch). ALL PASS.
- test-fxidentify: FX8d/FX17c/FX17d expectations updated to
  the newly PROVEN facts (Horus/Pluto now pin; Heavy Tank
  YESNO pins ③; Minerva YESNO pins ②) — same strictness,
  audited values. ALL PASS. All other suites (node/explore/
  phase2/genesis/overlay/facedown/cpu/cpu-tune/cpu-tune2/
  ggfusion/swap/investigate + jsdom ui/bgm/fx/layout/
  minerva3) pass.
- Engine-level capture (cap-minerva2.js, rigged decks):
  Minerva ② prompt = SELECT_EFFECTYN, code 30100551,
  loc GRAVE, desc 221 — matches the bare assumption exactly.
- Real-browser render probes (probe-render.js, 390x620,
  live page, real uiYesNo): (A) the Vernusylph follow-up
  shape captured from live play renders as 「…の効果の続き
  です。次も行いますか？」 with ① pinned and 行う/行わない;
  (D) the Minerva EFFECTYN shape renders title の効果② with
  only ②'s text pinned. Screenshots in the worktree
  (spotshots/probe-a.png, probe-d.png), eyeballed.
- Real-browser play (spot-poolcov.js, live duels vs the CPU):
  (B) Castel used ①, then tapping Castel the same turn shows
  the greyed row 「このターン既に使用済みです」 (390x700,
  screenshot eyeballed) — the full chain-desc projection →
  usage tracking → shared-clause path works in production.
  (D, opportunistic) Minerva destroyed on the opponent's
  turn produced the real EFFECTYN (loc GRAVE, desc 221) and
  the sheet pinned ② in situ, twice.
  (A) The Vernusylph follow-up shape was captured from live
  play (desc Stringid(9350312,1)); its rendering is verified
  by probe (above). A fully natural in-duel capture of the
  follow-up sheet after the ordering fix was attempted but
  the line is draw-dependent; the shape's provenance is the
  live capture and the helper source (spop).
  (C) A natural Reborn line did not materialise in 10
  attempts (1 copy in 44; the Minerva half completed in 2 of
  them). The revive reason is instead verified through the
  production path itself (probe-revive.js, 390x620): the
  engine's real event shapes pushed into the real GameState
  queue in two separate drains, real drainSeEvents →
  noteReviveFromEvents → real tile tap — the sheet shows
  「《マジックカード「死者蘇生」》の効果で特殊召喚されたため、
  このターンは効果を発動できません」 (screenshot eyeballed).
- Still unmeasured: sound feel, real-device WKWebView.

## Brushup program R0-R2 (2026-11-03, branch feat/brushup-program)

### R0 — two P0 fixes from the care-axis audit
- Confirm sheet (MSG_CONFIRM_CARDS) settled only via its own close
  button; as a view sheet it also closes via x / backdrop (C-20),
  which stranded the awaited promise in humanAnswerer and froze
  the duel. sheetClose() now settles the wait (settleConfirmSheet).
  Tests: test-zolga C9/C10.
- SELECT_UNSELECT_CARD: 「決定」 and 「選ばずにやめる」 both sent
  -1, which the core reads by state (playerop SelectUnselectCard;
  operations SelectTribute case 3): finishable + selection >= min
  FINISHES with the selection, empty selection cancels. The cancel
  button is now offered only while -1 truly cancels; a
  mid-selection state shows the remainder instead. Tests:
  test-zolga C11-C14b via window.__unselect. (No pool script calls
  Group.SelectUnselectCards — tribute selection is the only
  producer, verified in data.json scripts.)

### R1 — presentation (FX audit: audit-fx.md in the worktree)
- The two long-missing strips are captured deterministically
  (audit-fx-shots/, event-level replay via auditcap.js, disclosed
  as synthetic in the audit): monster-vs-monster attack with the
  destruction ghost, and a link-2 chain build (CHAIN label + gold
  frame + cord present at BUILD time, matching the MD supplement).
- FX-1a: attack ghost dissolve — the colour copy's fade moved
  from 470-600 to 500-660. At the old timing the colour copy sat
  at ~0.42 mid-dissolve and the gray copy carried the read (the
  dying card was nearly invisible in stills); after the change
  the colour copy stays readable through the dissolve's middle.
  Before/after at the same offset: audit-fx-shots/attack-700-s545
  vs r1shots/attack-700-s545 (eyeballed).
- FX-1b (measurement, supersedes the v4 gate's reading): the v4
  frame gate (>33.4ms <= 1% of ALL frames in the window) mixed two
  populations. Decomposition with PerformanceObserver longtask
  attribution (audit-decompose.js, 3 samples/scene, v4probe
  conditions): ace total 2.87% (34/1184) but scene-attributed
  0.25% (3 frames); finisher total 2.68% (14/523), scene 0.19%
  (1 frame). The rest is engine work overlapping the window —
  process() bursts up to 567 ms self time, parseMessages 483 ms.
  GATE GOING FORWARD: scene-attributed >33.4ms <= 1% (ace and
  finisher PASS); totals keep being reported alongside, never
  alone. The engine bursts are a separate responsiveness defect
  class, filed as backlog BU-12 — not a scene-smoothness item.
- FX-2 (finisher trail-ghost cap) DROPPED: its premise (snapshot
  cost drives the finisher overage) is disproven by the same
  decomposition, and the named spawner does not exist in the
  shipped code (proposal-stage name).
- Still unmeasured: SE sync / audio feel (headless), real-device
  WKWebView fps. The direct-attack banner overlapping the ghost
  window (~1.6 s in live flow) is recorded in the audit as a
  product-shape observation, not changed here.

### R2 — care axis (audit-care.md): wording & prompt clarity
Attack sheet/log name attacker + target; place/disfield/position/
option sheets state immediate-commit; SELECT_SUM current total
(range-honest) + remainder label; ANNOUNCE_CARD two-step declare
with details; ANNOUNCE_* sheets name the declaring card and append
its text; SORT meaning + keep-label; EFFECTYN per-location
sentences; confirm tag from the 1st; chain dock pass consequence,
response-target detail link, dismissal scope label; repos action
names its destination; grid retry de-duplicated; developer
language removed (title, loading lines, fallback sheet, 未収録);
response-mode seg labels made truthful on both faces; audio
on/off persists (localStorage v2audio). Suites green on the R2
tree: test-ui, test-node, test-zolga, test-poolcov,
test-fxidentify, test-layout.
Enumerated, NOT done in R2 (with counts): SELECT_CARD purpose
labels beyond the attack case (hand-limit discard etc. — no
engine purpose tag exists; client heuristics not yet trusted),
W-27 phase-name granularity, W-28 close-label unification,
BU-08 per-duel confirmation counting (no client counter exists),
SELECT_COUNTER row details (prompt unreachable in this pool).

### R3 — design axis (audit-design.md), scoped by ground truth
- DS-01 FIXED: deck names wrapped mid-word, orphaning 「ン」 on
  its own line (audit frames 01-start-620/700, eyeballed). .dn is
  now 12px, one line, ellipsis backstop — the card-name rule
  applied to deck names. Verified: all four .dn single-line,
  scrollWidth == clientWidth at both heights (r3shots/start-*).
- DS-04 FIXED (with R2's W-22 labels): seg sub-labels reserve two
  lines (.seg button small min-height), so a seg row keeps one
  height — measured 52/52/52 px on #seg-resp at both heights.
- DS-03 REJECTED by direct observation: the audit inferred a
  scroll-folded result screen from a structure (.rin) that does
  not exist in the shipped markup, and took no frame of it. A
  clicker duel driven to the result overlay at 390x620 shows the
  title, reason, final LP and BOTH buttons fully inside the
  screen (r3shots/result-620.png, eyeballed). No change.
- DS-05 NOT REPRODUCIBLE: the named off-palette hexes (#2e7d4f /
  #31567d) exist nowhere in the shipped code; the sort sheet uses
  the standard .bigbtn / .bigbtn.sub. No change; recorded so the
  claim is not re-audited from scratch.
- DS-10 (placehint): already 12px in the shipped CSS — the
  audit's 9.5px figure is stale. No change.
- Enumerated, not done: DS-06 start-screen palette unification
  (internal-only benefit, shade-shift risk — left for a dedicated
  pass), DS-09 hand-sheet row unification (the audit's referent
  sheet could not be identified unambiguously from its text),
  DS-07 VS overlay see-through (audit itself left it
  unseparated), DS-11 log modal reachability (product decision),
  DS-02/DS-08 keep-as-is per the audit's own call.
- R3b (from the design child's formal report, which the summary
  had dropped): the phase button's label wrapped to two lines and
  its second line was clipped by the fixed 32px height — frame-
  reproduced at both heights. #phasebtn is now nowrap at 12.5px,
  and the width is funded by the phasebar itself (#phaseinfo
  min-width 96->72, menubtn/fxbtn padding 8->6): measured
  scrollWidth == clientWidth == 124 for 「エンドフェイズへ」 and
  eyeballed fully readable (r3shots/duel-phasebtn-620). Result
  buttons likewise keep one line (both labels wrapped before).
  .gcard .itext 9px -> 10px (D-38: it is reading text, not a
  badge). BU-03's measured state (620 preview is compact 22px
  with text/image/meta hidden; 700 preview shows ~1 line with an
  unaffordanced scroll) is a genuine allocation fork — options
  A/B/C in audit-design.md; NOT decided here, left for the user.

## Log-history button triage (2026-11-03): the 履歴 button was dead under any open prompt

User report (real device): 履歴のログが見れない — the button is
pressed and NOTHING happens; the modal never gets a chance to open.

Reproduction (cap-loghist.js, real Chromium, 390x700, own main
phase): the button is rendered in the idle chain bar,
elementFromPoint at its centre IS #loghistbtn (nothing covers
it), logHist.length > 0, sheet/dock closed — and a real
touchscreen tap changes nothing. probe-guard.js isolates the
single variable: openLogHistory() with a prompt open -> sheet
stays closed; the same call in a no-prompt gap -> sheet opens
with all rows.

Root cause: openLogHistory() opened with
`if (currentPrompt || !logHist.length) return;`. uiAnswer sets
currentPrompt for EVERY human prompt, and SELECT_IDLECMD /
SELECT_BATTLECMD stay open for the player's whole turn — so the
guard silently swallowed the tap at every moment the button
would actually be used. It only ever worked in the brief
processing gaps between prompts, which is how the B-10 round
verified it (test clickers run in gaps) while the real-device
path was dead ~always. It is the only view sheet with such a
guard: pile sheets and the menu sheet open over a live prompt.

Fix (client.js):
- openLogHistory no longer gates on currentPrompt. A view sheet
  is read-only, overlays the board and never answers the pending
  prompt; an arriving sheet prompt reclaims the sheet via
  sheetOpen. Still blocked: no log entries yet, a sheet already
  open, or the dock open (those prompts live there).
- Tap target: the button alone is 40x19 px inside the frozen
  21 px band. The whole log strip now opens the history — the
  履歴 button, the previous-event text (.prevlog) in the idle
  chain bar, and the latest log line (#logline). No layout
  change (the band height is frozen by the board-fit contract).

Regression: v2/test-loghist.js (jsdom) boots the real client,
holds the human's first SELECT_IDLECMD with a non-empty log —
the exact dead state — and asserts: button click opens the
history sheet with rows; 盤面に戻る closes it; the idle prompt
is still pending afterwards; the log line opens it too; the
view-sheet x closes it; the duel continues. ALL PASS.
Frame evidence (real Chromium, real taps): shots-logfix/ —
repro-700-* (before fix: tap, nothing), fixed-700-* /
fixed-620-* (after fix), deep2-700-* (11 rows, sheet eyeballed:
title, 直近 11 件, turn-tagged rows newest-first, 盤面に戻る).
Scroll proof at 620 (probe-scroll.js): 17 rows held at
SELECT_IDLECMD, sheet scrollHeight 553 > clientHeight 382,
scrollTop reaches the 171 max and the oldest row (自分：5枚
ドロー) is reachable — scroll620-top.png / scroll620-bottom.png,
both eyeballed.
Still unmeasured: real-device WKWebView tap behaviour.
## S/T rotation triage (2026-11-03): every spell/trap tile rendered rotated 90 degrees

User report (real device): 「魔法罠の画像が90度曲がる」. Reproduced —
the report was exact, and the defect was unconditional, not situational.

- Root cause: `tileHTML` derived the `def` class purely from the
  position bitmask, `(card.pos & POS_DEFENSE) !== 0`. In the core's
  position encoding a spell/trap is 0x5 face-up / 0xa face-down —
  both ALWAYS intersect POS_DEFENSE (0xC). So every S/T tile, set or
  face-up, carried `def`, and the round-B CSS
  `.tile.def .inner{transform:rotate(90deg) scale(.82)}` (the
  MD-style monster defense rotation) rotated its art + name band
  90 degrees. tileHTML did not even receive the zone location.
- Measured pre-fix on the real page (390x700, live duel): own set
  《おろかな副葬》 and the opponent's face-up field spell
  《ラビリンス・ウォール・シャドウ》 both sat in the S/T zone with
  class "tile def" and computed transform
  matrix(0, 0.82, -0.82, 0, 0, 0) = rotate(90deg) scale(.82).
  Engine-level measurement agrees: activated face-up Swords of
  Revealing Light pos=0x5, set S/T pos=0xa.
- Fix: `tileHTML(card, con, actKey, loc)` — the def class is now
  gated on `loc === E.LOC.MZONE`, the same guard the
  position-change animation (fxPosChange) already used. Monster
  behavior is bit-for-bit unchanged; S/T tiles can no longer
  rotate in any state.
- Verification: new test-strot.js (jsdom, real duel by clicking)
  asserts no S/T tile ever carries `def` while defense monsters
  do, with non-vacuity gates (S/T tiles AND a defense monster must
  be observed). It FAILS on the pre-fix code (violations:
  おろかな副葬 "tile def") and passes after. Live-page probes
  post-fix (390x620 + 390x700): set trap / own set spell / face-up
  spell / field spell all transform:none; the opponent's face-down
  defense monster still matrix(0, 0.82, -0.82, 0, 0, 0).
  Frames: shots-strot/ in the fix worktree.
- Note: one test-fx run under heavy parallel load reported 10
  timing failures; back-to-back re-runs on pristine main and on
  the fixed tree both pass all 56 checks. Not related to this
  change (tileHTML def gating only).

## Brushup round 2 (2026-11-03): BU-11 strip overflow, reasons on the remaining surfaces, sheet-open cost

Integration round over the brushup backlog (the user's standing
direction: do not wait for the next daily loop). Worktree
duel-app-brushup2 (feat/brushup-round2); evidence in b2shots/.

### 1. BU-11 — the ATK/DEF strip overflowed sideways at the tile floor

Root cause: the round-4 width budget was wrong twice, plus a
third contributor. (a) The -.5px letter-spacing the budget
assumed was never actually in the CSS — both strip rules stood
at letter-spacing:0. (b) The "36px inner width of a 40px tile"
was miscounted: a 40px slot leaves 34px for the line (40 − 2
border − 2x2 strip padding). (c) The defmode rule
(.slotstats.defmode span.defline b, specificity 0,3,2) kept DEF
digits at 10px, above the smalltiles 9px rule (0,2,1) — defense
lines were the widest of all. Live measurement before the fix
(390x620, tile 40px, real duel): every 4-digit line 3-6px over
(worst "DEF 1100" = 40px of text in 34px); at 390x700 (tile
47px) even regular lines were +1px and 5-digit lines +4/+7px.
Fix is CSS-only in index.html (tile sizes, zone geometry and
the mid-duel freeze are untouched): letter-spacing:-.5px on
.slotstats/.hstats at every size (the value the budget always
assumed); big5 digits 9px -> 8px, and 7.5px at the floor
(defline included, via a .big5.defmode rule); smalltiles
defline digits brought down to the smalltiles 9px. Verified:
Chromium width rigs (normal / defmode / big5 / defmode+big5
strips) at 40px and 47px — every line fits; real duels after
the fix at 390x620 and 390x700 — worst strip overflow over a
full duel = 0px at both heights (before: 6px); a defense-
position ATK 2600 / DEF 2200 at 620 reads in full, last digits
intact (b2shots/board620-4digit.png, eyeballed; hand strips
likewise, b2shots/s4-preview-620.png). Boundary: 6+-digit
values are not accommodated — no in-pool line produces them
(the builder's big5 threshold is >= 10000).

### 2. Cannot-activate reasons on the remaining surfaces

Covers the three groups the pool-coverage section 3 enumerated
as NOT COVERED. Same discipline as before: sets derived from
the pool's own texts, reasons only on mechanically certain
evidence, silence otherwise. Gate: test-poolcov sections G/H/I
(derivations asserted equal to the enumerated sets; behaviour
spot-checks); section D's handling strings updated to match.

(4) Card-name activation limits (「このカード名のカードは
１ターンに１枚しか発動できない」: 死者蘇生 28958464 /
おろかな副葬 35726888 / 七星の宝刀 45725480; 「デュエル中に
１枚しか発動できない」: 現世と冥界の逆転 17484499) — derived
by nameLimitCards(). Usage evidence is the chain-link record
itself: turn scope reads usedFxByCode (any link of the code),
duel scope a new usedNamesDuel set fed by the same tracker
(cleared at duel start). Surfaces: the hand card's own action
sheet gains the greyed 「効果を発動」 row with the reason when
its activation is spent (openActionSheet HAND branch; the
check also joins the field-sheet reason chain, so a set
七星の宝刀 answers on the field sheet too), and the preview
reason line states it when the card has no offered action at
all (the BU-02 dim-tap path). A rendering gap found on the
way: at 390x620 the preview is compact (~22px) and the stacked
reason line was clipped by the strip's fixed height — the
reason now rides the title line in compact mode (name/stats
never shrink; the reason truncates first), stacked as before
at taller sizes. Probes (real builders, production-shaped
records, eyeballed): hand sheet at 620 and 700
(b2shots/s2-hand-*.png); preview via a real battle-command
tap (probe-b2s4) and the compact/stacked render check
(probe-b2s4b, b2shots/s4b-preview-*.png).
(5) Grave-sent timing (「このカードが墓地へ送られたターン
には発動できない」, 巨神封じの矢 67037924 segment ②) —
derived by graveSentCards(). Arrival evidence: trackGrave-
Arrivals diffs the human's own grave (code multiset) across
state updates and stamps arrivals with the turn. Deliberate
silences: no stamp across an observation containing identity-
less (null) entries, so the deck/grave swap of 《現世と冥界
の逆転》 can never mint a claim; stamps are per CODE (with
several copies in the grave the note marks the code, not the
copy), and if any copy of a code leaves, that code's stamps
drop entirely — counts cannot say which copy went, and an
ambiguous record stays silent. Surface: the grave pile
sheet puts 「このターンに墓地へ送られたため、②の効果は
発動できません」 under the card's row on its arrival turn
(probes b2shots/s1-grave-620.png / -700.png, eyeballed).
(6) EX-summon type lock (「このターン、自分は○モンスター
しかEXデッキから特殊召喚できない」, Trilosucuta 21368273
segment ② -> Synchro only) — derived by exLockCards() with a
token->type-bit table (S/シンクロ, X/エクシーズ, 融合,
リンク). The lock is live when the restricting effect's own
number sits in this turn's chain-link record (exSummonLock —
①'s use does NOT raise it; test I3). Surface: the EXTRA pile
sheet, where EX summons are launched — each own EX monster of
a blocked type that carries no offered summon action gets
「《マナドゥム・トリロスークタ》②の効果の制約で、この
ターンはSモンスターしかEXデッキから特殊召喚できません」
under its row (probe b2shots/s3-extra-620.png / -700.png:
Luce x3 and Pluto carry it, the Synchro Horus does not).
Boundary kept, by construction: selection grids only ever
contain engine-offered cards, so a blocked monster has no row
there to annotate — the pile sheet is the surface that lists
the whole EX deck. The activation record has the same known
edge as optUsedReason: a negated activation still counts in
the record; in this matchup no card negates these activations.

### 3. Sheet-open stall — re-profiled; the recorded cause does not hold

The v4 record said the ~133ms sheet-open stall "is dominated
by the sheet content's innerHTML construction". Re-profiled
in the live page (390x620, software rendering, bench-b2.js):
the parse of the heaviest sheet markup in the app (16-card
grid with full texts, 5.6KB) costs 0.1ms in a detached
template; the real builders' synchronous cost is <= 0.7ms
median (28-row grave sheet, 16-card grid). The cost that WAS
measurable at open is the LAYOUT of long sheet lists: a
forced layout after opening the grid measured 4.3ms median /
7.3 max, and the open+layout pair spiked to 52.7ms on first
opens (bench2-b2.js). Fix: sheet list rows skip layout/paint
while below the fold — content-visibility:auto with
contain-intrinsic-size on #sheet .gcard (auto 104px) and
#sheet .sortrow (auto 34px); rendered rows are unchanged.
After: grid forced layout 0.9ms median / 1.5 max, reopen of
the same markup 0.9 / 1.0, grave sheet 1.0 / 1.4.
The 133ms figure itself was a whole-frame gap under the v4
stage-0 live-play protocol. In this round's live-play frame
recordings (gaps-b2.js, full duels), frames containing a
sheet open measured 16.6-16.7ms with 0 of 3 over 33.4ms,
before and after alike; whole-frame spikes (to ~183ms) still
occur in play but do NOT coincide with sheet opens — they
belong to FX-scene frames, the v4 programme's territory. The
residual is returned to the brushup backlog with these
numbers (BU-12). Still unmeasured: sound feel, real-device
WKWebView frame rates.

### Verification (this round)

- All 20 suites pass on the integrated tree (node: node /
  explore / phase2 / genesis / overlay / facedown / cpu /
  cpu-tune / cpu-tune2 / ggfusion / swap / investigate /
  poolcov; jsdom: ui / bgm / fx / fxidentify / layout /
  minerva3 / zolga).
- Real-browser frames eyeballed at 390x620 and 390x700 for
  every surface above (paths inline). BU-11's worst-case
  strip (defense position, 4-digit, 40px tile) is among them.

## Ishizu recipe v11 (2026-11-03): the deck becomes the user's MD build

The user rebuilt Ishizu in Master Duel and pointed out the app
still ran the v10 recipe (44 cards / EX 14). decks.ishizu is now
the decided build (saved verbatim in
~/workspace/yugioh/recipe_ishizu_v11.txt): main 45, extra 15,
deck name MILLENNIUM PROPHECY (start screen + VS caption).
Diff vs v10 — main: +丘と芽吹の春化精 x1, +死者蘇生 (classic) x1,
+アギド (classic) x1, シルキィ 1->2; -聖座天嗣ストン x1,
-古衛兵アギド x1, -マジックカード「死者蘇生」 x1. Extra:
カステル 2->3, プルート 1->2, バロメット 2->1. The side deck
(9 cards incl. the four classic prints) is record-only; the app
has no side deck.

Two interpretation calls, both grounded in the MD screenshots:
- The main-deck row reading just 「アギド」 (between ゾルガ and
  カルダーン, where every remake sibling shows its full name) is
  the CLASSIC 《アギド》 (16135253), not 《古衛兵アギド》 — the
  side deck proves the user owns/uses the classic prints, and
  the v10 recipe file also wrote plain 「アギド」.
- 「死者蘇生」 is the classic print (83764718), NOT the
  マジックカード retrain: the classic carries NO card-name
  activation limit and NO cannot-attack/activate rider on the
  revived monster. Gameplay changes accordingly.

New full implementations (official text, verbatim Lua, passcodes):
- 丘と芽吹の春化精 (9350312): its ① runs through the shared
  Vernusylph helper (string base 9350312), ② is a continuous
  destruction shield. fxmap: override {0:1} (the helper registers
  the real effect at idx 0; the only SetDescription is the shield
  marker). It carries the EARTH-lock sentence, so the derived
  lock set is now the Vernusylph TRIO (poolcov D/E updated).
  Client follow-up recognition: the YESNO the three Vernusylph
  sisters ask during resolution lives under string base 9350312,
  so with 9350312 itself in the pool, foreignFollowFx now treats
  its descs as the family follow-up even when they decode — but
  never for 9350312's own activations (F10 guards the foreign
  side, F11b the own side).
- アギド (16135253, classic): mandatory battle-destroyed trigger,
  dice roll, level-matched Fairy revival. Its text is the
  unnumbered old format; fxmap records one YESNO prompt ({n:1})
  under the NO-NUMBERING classification, and poolcov registers
  the '16135253|0' exception (no printed numbers exist).
- 死者蘇生 (83764718, classic): plain target-and-summon, no
  SetDescription (activation convention).

Mechanisms de-hardcoded by the swap:
- The revive-rider latch (client) keyed on the retrain's code
  (28958464). It now DERIVES the rider card from card texts
  (the "...攻撃できず、その効果は発動できない" sentence), so on
  the current pool it never arms — correct, since the classic
  has no rider. The latch itself is still exercised in
  test-poolcov F20-F25 against a fixture DATA carrying the
  retrain text.
- OPTION_LABELS held only the old Agido's mill options; emptied
  (the generic mechanism stays).
- CPU bot: CC.AGIDO repointed to the classic (its value logic
  rewritten — a battle-destroyed dice revival is not a mill),
  CC.STONE removed, CC.REBORN repointed to the classic, and
  丘と芽吹の春化精 joined the Vernusylph enabler valuations.

Test maintenance: test-swap Duel A re-seeded 99 -> 17 (the
trajectory is deck-dependent; the swap still resolves for both
players — found by seed scan). test-phase2 D3 totals now derive
from the deck data instead of hardcoding 113/55/58.
test-minerva3 M3-1 expects the lock trio (+M3-10: Hills latches
the lock and the reason names her). New test-recipe-v11.js:
composition card-for-card, Hills search+summon in a rigged duel,
Agido battle-destruction dice (R6a) and the full revival flow
(R6), classic Reborn flow, bot duels on the new decks, and the
client-side no-rider assertion (R10).

Dice-sequence note (found while verifying Agido, pre-existing,
NOT introduced by this swap): the PoC driver fixes core seed
components 1..3 (67890/24680/13579), so the first six rolls of
every duel land 1,1,1,3,x,1 regardless of the duel seed (the
xoshiro state is dominated by the fixed components early on);
rolls diverge from the 7th. Any future dice/coin card inherits
this. Fixing it means changing the driver's seed expansion and
rebuilding the WASM, which recalibrates every seeded test in
the suite — its own round, not this one.

Verification: all suites pass on this branch (23 files incl.
the new test-recipe-v11 and the recalibrated swap/minerva3/
phase2). Real-browser captures at 390x620 and 390x700:
~/workspace/recipe-v11-shots/ (deck select shows MILLENNIUM
PROPHECY / 45枚 for both seats; a live duel on the new deck
shows deck 40 after the opening draw, EX 15, recipe cards in
hand). Card faces in those local captures show the fallback
tablet art — the image host is not reachable from the capture
sandbox; production image delivery is unchanged.
## Set-card visuals (2026-11-03): double-draw defects + own-set ghost + user card back

User reports (real device): (1) face-up DEFENSE tiles kept an
upright copy of the artwork behind the rotated card; (2) face-down
DEFENSE tiles read as two overlapping cards (chevron moire);
(3) own set cards should show the back pattern veiled over the real
face, ghosting through with a slow light/dark breath, instead of a
plain back / 「裏」 badge. Later the same day the user supplied a
new card-back design (golden hieroglyph vortex on black) and ruled
it replaces the CSS stripe back on EVERY face-down surface.

Root cause of (1)+(2): the card face / back pattern was drawn
TWICE — as the .tile element's own background (never rotates) and
inside .inner .art (the layer that rotates in defense position).
Face-up DEF: upright art showed around the rotated inner.
Face-down DEF: upright stripes + 90°-rotated stripes crossed into
a herringbone that read as two cards. The position-change
animation had the same residue (it rotates .inner over the tile's
own art). Fix: .tile's background is plain #3a2f1d and .tile.back
paints nothing of its own; .art is the single drawing layer for
both face and back.

Own-set design: tiles for the human's face-down cards carry
.setown (tileHTML: con === HP && !faceUp && code known). The 「裏」
setbadge is gone. Inside .inner, a .veil layer over .art carries
the card-back image and breathes: @keyframes setbreath, opacity
0.58 <-> 0.86, 4.6s ease-in-out infinite alternate (opacity only —
no per-frame shadow/filter writes). The veil sits inside .inner,
so a face-down DEFENSE tile carries face+veil sideways as ONE
card. Opponent face-down tiles keep .back (image only, no veil):
information asymmetry preserved. Detail/info views unchanged.

User card back: source ~/workspace/duel-assets/
card-back-user-20261103.jpg (1024x1536) -> distribution copy
assets/card-back-s.jpg (320x480, q82, 62KB; same width policy as
card-art-placeholder-s.jpg). Applied via center/cover (the
vortex centre lands on the tile centre) at every face-down
surface: .tile.back .inner .art, .hcard.back .himg (opponent
hand), .posbtn .glyph.back, .fx-ghost.back, .fx-peel, and the
.setown veil. The old repeating-linear-gradient stripe back is
removed everywhere.

Verification: new v2/test-setvis.js (SV1–SV12 + SV3b/SV3c per
surface) — CSS single-draw contract, keyframes animate opacity
only, DOM classes/veil per owner and position, asymmetry gates.
Real-browser frames (cap-setvis.js, parked duel + fabricated
board, 390x620/700): shots-setvis/before-* reproduce both defects
(chevron on opp face-down DEF, upright residue behind DEF
tiles); after2-* show one sideways back for face-down DEF, clean
slots behind face-up DEF, opponent backs in the new design, and
own set tiles ghosting — after2-h700-t0 (veil near opacity min,
ghost strongest) vs after2-h700-t2 (near max, ghost faintest)
bracket the breath.

## Per-card illustrations (decided + first delivery, 2026-11-03)

Decision (user): instead of one shared placeholder for all 63
cards, the user supplies an image per card and each is applied as
it arrives. Unlisted cards keep the placeholder — the fallback IS
the default and their markup stays byte-identical.

Mechanism (client.js): `CARD_ART` maps passcode -> art slug.
`cardArtFile(code, big)` resolves `../assets/card-art-<slug>-s.jpg`
(small surfaces) or `../assets/card-art-<slug>.jpg` (the big
cut-in card); `artInline` / `artCss` / `artApply` stamp it as an
inline background on: board tile art (face-visible states ONLY —
an inline image would outrank the .back stylesheet rule and leak
an opponent's face-down card), hand cards, the resident preview,
selection-grid cards, face-up FX ghosts, and all three bigcard
builders (finisher, ace scene + afterimages, legacy cut-in).
`preloadCardArt(deckKeys)` warms both sizes for every listed card
in the chosen decks: called at boot, on deck-seg changes and on
the start click (deck-select-time preload, no blank/'?' flash).

Cropping rule (user, 2026-11-03, ALL cards): when the art does not
fit a window, keep the TOP and cut from the bottom — never crop
the head. Implemented twice over: the delivered files are
top-anchored crops, and every stamp pins
background-position:center top.

First delivery: 《剣神官ムドラ》 99937011 (x3 in the Ishizu deck).
Source: ~/workspace/duel-assets/mudora-user-20261103.jpg
(1040x1513 full-body illustration). Small file = crop x100-990 /
y0-890 -> 320x320 (37KB): face, crown, shoulder armour and the
right-hand ring blade stay identifiable at tile size. Big file =
full width x y0-1434 (the bigcard 250x345 ratio) -> 640x882
(158KB): nearly full body; only the feet tips fall off, per the
rule. Verified in real play (cap-cardart.js, shots-cardart/):
Mudora drawn in the opening hand -> hand art + resident preview,
then normal-summoned through the real sheet -> board tile art,
at 390x620 and 390x700; the head is never cropped. The cut-in
frame was captured via fxCutinShow(99937011) directly (declared
substitution: Mudora is not a keycard, so no real-play path
reaches a cut-in with her; the bigcard art path itself is the
same code the finisher/ace scenes use).

Regression: v2/test-cardart.js (CA0-CA19) — mapping, top-pin,
fallback emptiness, preload contents, DOM contract on a
fabricated board incl. the opponent-face-down no-leak case.

## Brushup round 3 (backlog leftovers: BU-12 / BU-13 / DS-07 / DS-09)

### BU-12 — engine processing bursts: localized, NOT force-fixed

The FX audit's figures (process() self 567 ms, parseMessages
483 ms) do not reproduce in isolation. Measured three ways:
(a) Node driver probe over 30+ duels (threshold 8 ms, matchup
rotation): worst single poc_process() = 56 ms; (b) the same
probe inside a Chromium page: worst 37 ms; (c) a full in-situ
UI duel under the CDP profiler: total WASM self time for the
WHOLE duel ≈ 0.1–0.2 s, and the only long task ≥ 100 ms was
276 ms at duel start, attributed mainly to the initial layout
pass (viewportHeights / getBoundingClientRect), not the
engine. GameState.apply (message application — the audit's
"parseMessages"; no such function exists in the shipped code)
is < 1 ms per batch in every measurement.
The burst that does exist is one class: the single
poc_process() call that completes a chain resolution and
advances to the next command prompt (batches carrying only
SELECT_IDLECMD / SELECT_BATTLECMD right after a SELECT_CHAIN
answer; 8 of the 9 slowest calls in the 24-duel run). It is a
single synchronous WASM call, proportional to chain size and
board complexity; JS cannot split or yield inside it. The
only structural cure is moving the engine to a Web Worker —
an architecture change, returned to the backlog as an
integration decision with these numbers, not taken here.
Taken here, the one safe concession: Duel.run awaits sleep(0)
after respond(bytes), so the tap feedback and the closing
sheet get a paint before the heavy call. Uses the
harness-provided sleep (stubbed test sleeps unchanged);
processing order and results untouched.
The 567/483 ms numbers were recorded under screenshot-burst
capture on a shared VM; treat them as contention-inflated
until a real-device profile says otherwise (still unmeasured:
WKWebView on device).

### BU-13 — care leftovers

1. SELECT_CARD purpose (hand-limit discard): inferSelectPurpose
   in client.js labels ONLY the provable case — END phase, no
   chain, no asking effect, not cancelable, all candidates the
   asked player's hand cards, min == max == hand − 6. The sheet
   then reads 手札の上限 / 手札が上限（6枚）を超えています。
   捨てるカードを N 枚選んでください / 捨てる（あとK枚） /
   このカードを捨てる. Guards pinned by test-purpose.js (12
   cases; every guard has a negative). Effect-driven selections
   (costs, targets, materials) keep the generic title by
   design. Driven proof (real Chromium, hoard duel, both
   heights): sheet fired at turn 5 end phase with hand 7,
   hand landed exactly 6 after answering
   (shots-r3/handlimit-620.png / handlimit-700.png).
2. Phase granularity (W-27): timingText now uses
   phaseJaContext — BATTLE_START / BATTLE_STEP / BATTLE ->
   バトルフェイズ; DAMAGE / DAMAGE_CAL -> ダメージ計算の確認;
   others unchanged. The mid-bar phase READOUT keeps the fine
   phaseJa names (display, not a context line; B-08 stands).
   Driven proof: 相手のターン・バトルフェイズ｜効果への応答
   (shots-r3/w27-context-700.png); unit pins in test-purpose.
3. Close labels (W-28): 盤面に戻る is gone from every close
   button. Selection-serving sheets (card actions, menu) say
   選択に戻る; pure viewers （履歴， card info, dismiss manager,
   settings, confirm sheet already) say 閉じる; the pile sheet
   and the detail pop follow what closing does — pileActs
   present / a prompt open -> 選択に戻る, else 閉じる.
   Driven proof: shots-r3/w28-actionsheet-700.png (選択に戻る),
   w28-pilesheet-700.png (閉じる). test-loghist updated.
4. SELECT_COUNTER: re-verified unreachable in the current
   pool — no pool card text mentions カウンター; the only two
   scripts matching /ounter/ are 融合派兵 (activity counter,
   internal) and 闇の護封剣 (turn counter), neither places or
   removes card counters, so MSG_SELECT_COUNTER cannot be
   issued. Left as a counted non-item; uiCounter stays as-is.

### DS-07 — VS overlay see-through: REPRODUCED and fixed

Root cause: the VS curtain was faded in as a whole element
(WAAPI opacity 0->1, 220 ms) while the start screen was still
displayed underneath, so the start screen bled through the
"opaque" #070503 background for the whole fade. Transition
burst frames (shots-r3/pre-*): start content legible at
+218 ms (620) / +226 ms (700); opaque only from ~+299 ms.
Fix: the curtain never fades — it is opaque from the first
painted frame; the matchup line (.vss) takes the small fade
instead, and the beams / VS text keep their own entrances.
Post-fix burst frames (shots-r3/post-*): deck-band mean abs
diff vs the settled VS frame = 0.00 from the first frame at
both heights; composition unchanged. Source pin in
test-purpose (D1).

### DS-09 — hand-sheet row unification: referent NOT identifiable

Returned unimplemented, with the reason on the backlog: the
design audit's §5 text (the item's only definition) is lost —
the local audit-design.md is truncated mid-§4 and was never
committed; the prior round reached the same wall. Candidate
surfaces re-enumerated against the shipped code: pile /
confirm / sort / dismiss rows all share .sortrow, action rows
share .optbtn, selection grids share .gcard, and the hand
pile sheet renders no rows at all (count only). No divergent
row style remains among identifiable candidates. If the
intended referent was the hand pile sheet (rows like the
other piles), say so and it becomes a fresh, specified item —
the own hand is already fully rendered on the board, so this
was not guessed into existence.

Second delivery: 《古衛兵アギド》 62320425 (x1 in the Ishizu
deck). Source: ~/workspace/duel-assets/agido-user-20261103.jpg
(1024x1536 — red sphere with the Eye of Horus, axe arms, temple
hall). Small file = sphere-centred square crop x70-960 /
y205-1095 -> 320x320 (30KB): the sphere sits at the window's
centre with both axe blades and the bottom spike inside; the
crop keeps the subject whole (the "top" of this subject IS the
sphere — only ceiling background is sacrificed). Big file =
full width x y0-1411 -> 640x882 (141KB), top-anchored as usual.
One line in CARD_ART; test-cardart gained CA0c/CA7b/CA7c/CA11b.
Real-play frames (cap-agido.js, shots-agido/): Agido drawn and
normal-summoned at 390x700 (tile + preview carry the sphere,
centred), a fabricated both-arts board at 390x620 (Mudora and
Agido side by side on field and in hand), and the big-card
cut-in via fxCutinShow (same declared substitution as Mudora).

Third delivery: 《古尖兵ケルベク》 25926710 (x1 in the Ishizu
deck). Source: ~/workspace/duel-assets/kelbek-user-20261103.jpg
(1024x1536 — the body descends in the UPPER two-thirds under a
storm sky; temple and soldiers fill the bottom). The top-anchor
rule works in this art's favour: small file = top-anchored
square crop x37-981 / y0-944 -> 320x320 (43KB) keeps the spiked
head with the Eye, the blue torso, the wing blades and most of
the great claw (claw tips are the sanctioned bottom cut). Big
file = full width x y0-1411 -> 640x882 (180KB). One line in
CARD_ART; test-cardart gained CA0d/CA7d/CA7e/CA11c (34 checks).
Real-play frames (cap-kelbek.js, shots-kelbek/): Kelbek drawn
and normal-summoned at 390x700 (tile + preview read clearly at
tile size), a fabricated three-arts board at 390x620 (Mudora /
Agido / Kelbek side by side on field and in hand), cut-in via
fxCutinShow as before.

Fourth delivery: 《宿神像ケルドウ》 63542003 (x3 in the Ishizu
deck). Source: ~/workspace/duel-assets/keldo-user-20261103.jpg
(1024x1536 — gold/teal guardian statue whose wing shields carry
red eyes, temple hall). Small file = top-anchored full-width
square crop x0-1024 / y0-1024 -> 320x320 (44KB): the statue's
head sits at top centre with BOTH red shield-eyes inside the
window; only the lower skirt and floor are cut, per the rule.
Big file = full width x y0-1411 -> 640x882 (194KB). One line in
CARD_ART; test-cardart gained CA0e/CA7f/CA7g/CA11d/CA14b
(40 checks). Real-play frames (cap-keldo.js, shots-keldo/):
Keldo drawn and normal-summoned through the real sheet at
390x700 (tile + resident preview read clearly), a fabricated
four-arts board at 390x620 (Mudora / Agido / Kelbek / Keldo on
field and in hand), cut-in via fxCutinShow as before.

## Merge note (recipe v11 x card-art round, 2026-11-03)

The per-card illustration round landed while this branch was in
flight and keyed the 2nd user delivery to 《古衛兵アギド》
(62320425) — the card recipe v11 removes. The CARD_ART entry is
left in place but dormant: preload follows deck membership, so
the art is never loaded or shown, and the classic 《アギド》
(16135253) shows the standard card image. Whether the 古衛兵 art
should be retired or the user supplies art for the classic is
the user's call (flagged in the round report, not decided here).
test-cardart adapted accordingly: CA0c (deck composition), CA7c
(Agido art is NOT preloaded now), and the fabricated board's
fourth tile is Keldo instead of the departed Agido (CA11b);
the mechanism checks (map/inline/asymmetry/ghost) are unchanged.
Fifth delivery: 《予見者ゾルガ》 31525442 (x1 in the Ishizu
deck). Source: ~/workspace/duel-assets/zolga-user-20261103.jpg
(1024x1536 — blue-masked seer in white robes, visions of the
future floating around him). Small file = top-anchored
full-width square crop x0-1024 / y0-1024 -> 320x320 (30KB):
the blue mask sits large at top centre with the gold collar
and the glowing core inside; the robe's lower swirls are the
sanctioned bottom cut. Big file = full width x y0-1411 ->
640x882 (124KB). One line in CARD_ART; test-cardart gained
CA0f/CA7h/CA7i/CA11e/CA14c/CA16b (48 checks). NOTE: Zolga was
the test suite's unlisted exemplar (fallback checks CA6/CA11/
CA15/CA17); that role moved to 《転輪のスフィンクス》 46148485
(UNLISTED), so the fallback contract is still pinned on a real
pool card. Real-play frames (cap-zolga.js, shots-zolga/):
Zolga drawn and normal-summoned through the real sheet at
390x700 (tile + resident preview — the mask reads at tile
size), a fabricated five-arts board at 390x620 (all five
deliveries on field and in hand), cut-in via fxCutinShow as
before.

Sixth delivery: 《賢瑞官カルダーン》 86605515 (x3 in the Ishizu
deck). Source: ~/workspace/duel-assets/cardan-user-20261103.jpg
(1024x1536 — ibis-headed priest with purple magic in one hand
and a serpent staff topped by a glowing orb, temple hall).
Small file = top-anchored full-width square crop x0-1024 /
y0-1024 -> 320x320 (41KB): the golden ibis head sits at top
centre-left with the purple magic hand and the staff orb both
inside the window; only the robe's lower half is cut, per the
rule. Big file = full width x y0-1411 -> 640x882 (158KB).
One line in CARD_ART; test-cardart gained CA0g/CA7j/CA7k/
CA11f/CA14d (55 checks). Real-play frames (cap-cardan.js,
shots-cardan/): Cardan drawn and normal-summoned through the
real sheet at 390x700 (the tile and the resident preview read
clearly at tile size; his ① is an on-summon optional effect,
so the capture answers 発動しない / パス through the real UI
before shooting the field), a fabricated six-arts board at
390x620 (all six deliveries on field and in hand), cut-in via
fxCutinShow as before.

## Engine Web Worker separation (BU-12, 2026-11-03, feat/engine-worker)

The ocgcore engine now runs off the main thread. Architecture:
- v2/engine-worker.js (new): hosts Engine.Duel + the WASM module.
  Browser: classic Worker via importScripts('build/ocgcore.js',
  'engine.js'); the MODULARIZE factory is called with a locateFile
  that prefixes 'build/' (the worker script lives in v2/, the wasm
  in v2/build/). Node worker_threads is the second host (used by
  test-worker.js): same file, require()d glue, parentPort transport.
  engine.js and build/* are UNCHANGED.
- v2/duel-worker.js (new): WorkerDuel proxy + createClientDuel
  factory. state is one canonical object on the main thread;
  worker snapshots (GameState own props minus names/cardData —
  re-attached from local DATA — and graveResync) are merged into
  it key-by-key, so client-held references stay live. The worker
  wrapper refreshes field stats BEFORE posting each update and
  each prompt (the exact points the client used to refresh after
  onUpdate / before dispatch), and drains state.events into the
  update post (the client's per-update drain semantics, preserved).
  Prompts cross as {prompt, state}; answers return as Uint8Array.
  refreshFieldStats() is an RPC only while a prompt is waiting
  (the worker is idle then); at any other time the latest snapshot
  is already refreshed worker-side, so it resolves immediately.
- Fallback: where Worker is unavailable (jsdom suites), the
  factory returns the in-process E.Duel exactly as before.
- client.js changes are two hunks: duel construction via
  createClientDuel, and uiAnswer awaiting the (possibly async)
  refreshFieldStats() before dispatchPrompt. index.html gains
  the duel-worker.js script tag; ocgcore.js stays for the fallback.

Identity (the migration's hard requirement): v2/test-worker.js
runs the same duel in-process vs through a real worker_threads
Worker (same seed, same seeded shuffle-RNG stub on both sides,
fast pace) and asserts byte identity of (1) the FNV-1a digest +
count over every core message, (2) stats, (3) the final-state
summary. 3 cases pass, including one where seat 0 is the "human"
seat answered through the prompt transport with a refresh
round-trip before every answer (the browser's exact path).

Browser verification (headless Chromium, local static server):
- Real UI: the page constructs Worker('engine-worker.js');
  auto-played duels reach the result screen (turn 4 and turn 6
  finishes observed), no page errors.
- Longtask profile during real-paced UI play: pre-migration main
  showed a 234 ms main-thread spike (duel start, in-process
  engine) and 54-76 ms tasks; the worker build's worst in-duel
  task was 86 ms, with the remaining 50-86 ms tasks clustered in
  FX-heavy passages (client rendering/FX work, present in both
  builds). No engine burst remains on the main thread during
  play. Posting the 752 KB DATA bundle to the worker is a
  one-time start cost inside the "preparing" phase (~53 ms task
  observed in the real-UI run).

Test-harness finding (NOT a product change): test-fx FXL2 /
test-ui run 1 intermittently failed on live duels. Frozen-state
capture showed the auto-play driver looping forever on a
DISABLED .optbtn in a card action sheet (the sheet is a
legitimate, closable UI state; the driver's selector matched
disabled options and never fell through to #sheet-cancel).
The freeze reproduces identically on a tree with the synchronous
uiAnswer restored, i.e. it predates the migration's timing; it
is a duel-development/timing race in the harness. Driver fix
applied to the four suites sharing that playDuel loop
(test-fx/test-ui/test-layout/test-strot): the option selector is
now '.optbtn:not(.disabled)'. After the fix, test-fx and
test-ui pass in full on the integrated tree. test-cardart /
test-setvis (landed from main during this work) gained the same
duel-worker.js script injection the other jsdom suites use.
test-strot's ST3/ST4 non-vacuity reach gates remain
duel-development luck (they fail intermittently on unmodified
main too; the substantive ST5 check passes throughout).

Full suite on the integrated tree (main 4eb7e51 + this branch):
all suites pass (test-worker included). Remaining unmeasured:
real-device WKWebView profiling.
## Log detail (2026-11-03, user report: 履歴ログが詳細でない)

The history log carried headlines only — which effect activated,
what processing happened and what the outcome was (destroyed /
banished / damage / returned) was written nowhere, so a duel
could not be re-read from the log. The mirror now keeps a
STRUCTURED detailed stream next to the headline log and the
history sheet renders it as the duel's story.

### Engine: GameState.dlog (structured; headline state.log untouched)

- pushDLog stamps every entry with turn / turn player / phase;
  chain activations additionally carry a chain-episode id (cid,
  bumped per MSG_CHAINING that starts a new chain) and outcome
  lines produced while a link resolves carry its number (sol).
  Cap 600, trimmed from the head.
- CHAINING (70): activation entries are stored STRUCTURED
  ({k:'act', link, con, code, desc, loc, tgt}) — the printed
  effect NUMBER is resolved client-side (fxmap lives there) at
  capture time. Target naming: the wire's target fields name
  the activating card itself when the effect has no target
  (observed on every non-targeting activation in the pool), so
  self-reference is dropped as "no target"; a real target is
  named only when public (face-up on the field, grave/banished
  piles, or the human's own card).
- CHAIN_SOLVING (72) emits {k:'solve'} headers; CHAIN_NEGATED /
  CHAIN_DISABLED emit neg/dis lines with the link number.
- MOVE (50): every public move becomes an outcome line —
  battle vs effect destruction told apart by the reason bits
  (0x1 / 0x20), banish, deck-from mill, grave send, returns to
  hand/deck (incl. Extra Deck), recoveries from grave/banish/
  Extra, control change, Xyz material attach/detach, discards
  (0x4000), hand-to-grave sends, deck shuffles reported by the
  core. Arrival-side field/hand/deck moves are owned by the
  summon/set/draw lines and stay unlogged here (no duplicates).
- DAMAGE / RECOVER / PAY_LPCOST carry LP before -> after.
  LPUPDATE (94) is deliberately not logged (would duplicate).
- SET (54) names the human's own set card with its position;
  the opponent's stays "カードをセット". Summons (60/62/64)
  carry the position; an opponent's face-down summon stays
  unnamed even when a preceding MOVE disclosed the code.
- POS_CHANGE (53) names the position transition; the wire also
  uses the face-up/face-down MASKS (0x5 / 0xA — a set card
  announces 0xA), all six forms are named. An opponent's
  face-down -> face-down change is suppressed (identity leak).
- DRAW (90) names the human's drawn cards; the opponent's
  draws stay count-only. CONFIRM_CARDS (31) groups what the
  human was shown per (controller, location), deck top-first.
- refreshFieldStats diffs effective ATK/DEF of known face-up
  monsters and logs the delta (first sighting is a silent
  baseline; face-down stats stay hidden). Attribution is by
  prompt boundary, so these lines do not carry a chain link.
- SWAP (55), SHUFFLE_HAND (33), SWAP_GRAVE_DECK (35),
  SHUFFLE_SET_CARD (36), WIN (5) each add their line.

### What the stream cannot say (counted, not faked)

- Battle vs effect damage is not separable from MSG_DAMAGE
  alone; inside a resolution the episode grouping shows it,
  outside it the attack declaration precedes the damage line.
- Xyz material COUNTS are not logged (the count is not final
  at summon-message time).
- Stat-change lines carry no resolving link (see above).

### Client: capture + rendering

- captureDLog (render) prefix-diffs the stream by entry
  identity (append-only; the anchor survives the head trim
  between renders) and bakes each entry's text at capture time:
  act/solve/neg/dis lines go through the audited fx resolver —
  numbered effects render 効果①-⑯, spell/trap card activations
  render の発動, single-effect cards render の効果 (the
  pool-coverage convention: the card itself is the identifier).
- openLogHistory renders the detailed stream chronologically
  (oldest first; opens scrolled to the newest entry), grouped
  by turn headings （ターンN（自分／相手のターン）), phase
  sub-headings, and chain-episode boxes; resolution headers are
  styled as sub-headings, their outcome lines indented, and
  negation lines tinted. Last 240 entries shown; the subtitle
  states the total. The headline rendering remains as fallback
  when no detailed entries exist. Rows carry content-visibility
  like the other long sheet lists (round-2 performance rule).
- The board's one-line log strip is unchanged (headlines).

Tests: test-logdetail.js (node; full duels assert act<->solve
correspondence, outcome kinds, LP arrows, opponent secrecy,
no placeholder garbage), test-logdetail-ui.js (jsdom; sheet
structure with the real fxmap, incl. a deterministic numbered-
effect stamp probe). Frame evidence: shots-logdetail/ beside
cap-logdetail.js (390x700/620, cut-in off + response auto via
the app's own settings).

## Test-clicker wedge (found landing recipe v11, 2026-11-03)

The live-duel clickers in test-fx / test-ui / test-layout /
test-strot clicked `.optbtn` before `#sheet-cancel`. On a field
monster's action sheet whose only effect button is DISABLED
("今は発動できません" — e.g. a just-summoned Mudora), the clicker
then clicked the dead button forever and the duel never advanced
(FXL timeouts with single-digit fx records; a human just taps
選択に戻る — not a product bug). The new deck's longer, Mudora-
heavier trajectories made the wedge likely instead of rare. All
four clickers now skip `.optbtn.disabled`. No assertion changed.
Seventh delivery: 《転輪のスフィンクス》 46148485 (x1 in the
Ishizu deck; also a KEYCARD_CODES member — her summon raises
the BGM to the Keycard tier and fires the ace cut-in). Source:
~/workspace/duel-assets/sphinx-user-20261103.jpg (1024x1536 —
gold-and-purple sphinx with two floating stone tablets over a
sunset desert). Small file = the standard top-anchored
full-width square crop x0-1024 / y0-1024 -> 320x320 (42KB),
no start-position adjustment: her face sits small near the
top, but a tile-aspect simulation (center/cover, ~55px wide)
still reads unmistakably — gold headdress, purple torso,
rainbow shield and both tablets fill the centre column, a
combination no other pool card has. Big file = full width x
y0-1411 -> 640x882 (191KB). One line in CARD_ART;
test-cardart gained CA0h/CA7l/CA7m/CA11g/CA13b/CA14e/CA16c/
CA20 (66 checks). NOTE: Sphinx was the test suite's unlisted
exemplar (fallback checks CA6/CA11/CA15/CA17); that role
moved to 《森と目覚の春化精》 36745317 (UNLISTED, x3 in the
Ishizu main deck), so the fallback contract stays pinned on a
real pool card. Real-play frames (cap-sphinx.js,
shots-sphinx/): Sphinx drawn in a real opening hand and
tapped to the resident preview at 390x620/700 (the art reads
in the hand card). Declared substitutions: the field tile is
painted via render() inside the real session (she is level
10 and cannot be tribute-summoned from an opening hand) on a
fabricated seven-arts board, and the cut-in is shot via
fxCutinShow(46148485) — the exact function the real
keycard-summon path calls — rather than staging a full
tribute summon; the big card shows the full illustration
with both tablets and the shield.

Eighth + ninth deliveries (the first SPELLS with individual
art): 《太陽の書》 38699854 and 《月の書》 14087893 (x1 each in
the Ishizu deck). Sources: ~/workspace/duel-assets/
taiyou-user-20261103.jpg (1024x1536 — golden book on an
altar, Anubis statue behind) and tsuki-user-20261103.jpg
(1024x1536 — blue book in a night temple, crescent moon and
Eye of Horus on the cover). Both books sit in the lower half
of their frames, but the standard top-anchored full-width
square crop x0-1024 / y0-1024 -> 320x320 (44KB / 37KB) needs
NO start-position adjustment and does NOT break the crop
rule: each cover's signature — the winged eye and the
sun-wheel (Taiyou) / the crescent-and-eye medallion (Tsuki)
— sits inside the top square, and tile-aspect simulations
read instantly (warm gold vs deep blue tell the two apart
at a glance). Big files = full width x y0-1411 -> 640x882
(216KB / 170KB). Two lines in CARD_ART; test-cardart gained
CA0i/CA0j/CA7n/CA7o/CA7p/CA7q/CA11h/CA11i/CA13c/CA14f/
CA14g/CA16d/CA16e/CA21. Spell surfaces pinned by a dedicated
fabricated board: own face-up S/T tile shows the art, own
SET S/T carries the art UNDER the setown veil (CA11i), and
opponent set S/T gets no art and no veil (CA13c). Real-play
frames (cap-books.js, shots-books/): each book drawn in a
real opening hand, tapped to the preview, then set through
the real action sheet at 390x620/700 — the set tile ghosts
the book's face under the breathing veil (styles.json pins
the art URL + veil at both heights), plus a fabricated
both-books board (face-up pair + set Taiyou + both in hand).

Tenth delivery: 《カオスポッド》 79106360 (x2 in the Ishizu
deck). Source: ~/workspace/duel-assets/
chaospod-user-20261103.jpg (1024x1536 — the grinning pod
among canopic jars). The face is large at centre frame, so
the standard top-anchored full-width square crop x0-1024 /
y0-1024 -> 320x320 (34KB) puts the green eye and the teeth
squarely in the tile's centre column — the tile simulation
reads instantly. Big file = full width x y0-1411 -> 640x882
(136KB). One line in CARD_ART; test-cardart gained CA0k/
CA7r/CA7s/CA11j/CA14h/CA16f (92 checks in total). Real-play
frames (cap-chaospod.js, shots-chaospod/): the Pod drawn
and normal-summoned face-up through the real sheet (tile +
resident preview, eye and grin unmistakable at tile size),
and — the surface a FLIP monster actually shows — drawn and
set face-down through the real sheet, its face ghosting
under the breathing setown veil, rotated with the tile.

Tenth delivery, REPLACEMENT (user, 2026-11-03: "カオスポッド
のイラストこれに変更"): new source ~/workspace/duel-assets/
chaospod-user-20261103-v2.jpg (853x1844 — the pod on a
middle shelf between canopic jars, taller frame than the
first delivery). Only the two delivered files were rebuilt;
the CARD_ART registration is unchanged and the first source
stays in duel-assets. Small file: the standard top-anchored
square (y0-853) puts the pod low-left and the tile's centre
cover-crop clips it, so the crop start was adjusted to
y350-1203 -> 320x320 (25KB) — the pod's top is still kept
whole (nothing of the subject is cut; only the empty upper
shelves are excluded), and the tile simulation plus the
real-play tile show the green eye and the teeth centred.
Big file = standard top-anchored full width x y0-1176 ->
640x882 (98KB); the pod (y~540-905) sits fully inside, so
no adjustment there. test-cardart: ALL PASSED. Real-play
frames (cap-chaospod.js, shots-chaospod-v2/): drawn and
normal-summoned face-up (tile + resident preview read
instantly — eye and grin between the two jars) and set
face-down under the breathing veil, at 390x620/700.

Eleventh to thirteenth deliveries (user, 2026-11-03): the
Vernusylph trio — 《丘と芽吹の春化精》 9350312 (oka),
《花と野原の春化精》 62133026 (hana), 《森と目覚の春化精》
36745317 (mori); sources ~/workspace/duel-assets/
{oka,hana,mori}-user-20261103.jpg (1024x1536 each).
MAPPING CORRECTION (user, 2026-11-03): the first assignment
had Oka and Hana swapped — Oka is the pink-haired fairy,
Hana is the white rabbit. The duel-assets files were
content-swapped before this round ran; md5s were re-verified
and both images eyeballed before generation, so the
delivered files were built from the corrected sources.
Standard top-anchored crops for all three, no start
adjustment: small = y0-1024 -> 320x320 (35-39KB), big =
full width x y0-1411 -> 640x882 (161-177KB). The tile
simulation (cover, centre top, 62x88 box) keeps every face
whole: the fairy's face upper-centre, the rabbit's head
upper-centre, the forest boy in the upper half with the
sleeping beast below. Three lines in CARD_ART.
test-cardart: the unlisted fallback exemplar moved
Mori -> 《地久神－カルボン》 15079028 (x3 in the deck, no
art), and the trio gained CA0l-CA0o / CA7t-CA7y /
CA11k-CA11m / CA13d / CA14i-CA14k / CA16g-CA16i / CA22 —
119 checks in total, ALL PASSED. Full suite on the branch:
green except the known test-strot ST4 reachability flake
(ST5 passed) and one load-related test-fx FX1 failure that
passes on an isolated rerun (ALL FX CHECKS PASSED).
Real-play frames (cap-shunka.js, shots-shunka/): each
sister drawn, tapped (resident preview) and normal-summoned
face-up through the real sheet at 390x620/700 — tile,
preview and hand all carry her own art, and the name/stat
lines confirm the corrected mapping (Oka 200/2000 = pink
fairy, Hana 600/1600 = rabbit, Mori 900/1800 = forest boy).

## Deck-scoped illustrations (user decision, 2026-11-03)

A card can now carry a different illustration while it belongs
to a specific deck — the mechanism the future Neuron-ID deck
import will build on. The user's shape: 《森と目覚の春化精》
wears an Egyptian illustration ONLY inside the Ishizu deck;
anywhere else she uses the regular forest art. A second entry
arrived the same day (《花と野原の春化精》, same rule).

### The map and the resolution order
`DECK_ART` in client.js, next to CARD_ART:
deck id (the data.json `decks` key) -> passcode -> slug.
```
DECK_ART = { ishizu: { 36745317: 'mori-ishizu', 62133026: 'hana-ishizu' } }
```
`cardArtFile(code, big, deckKey)` resolves: DECK_ART[deckKey]
[code] when a deck context is supplied, else CARD_ART[code],
else null (shared placeholder). No per-card branches anywhere:
new decks/cards are data. Delivered files keep the standard
shape and the user's crop rule (keep the top, cut the bottom):
assets/card-art-mori-ishizu{-s}.jpg and
assets/card-art-hana-ishizu{-s}.jpg, standard top-anchored
crops with NO start adjustment (small = y0-1024 -> 320x320,
47KB / 42KB; big = full width x y0-1411 -> 640x882, 223KB /
201KB; both faces sit upper-centre and read whole in the
tile simulation).

### Where the deck context comes from
Judged by the deck the card belongs to, never by the viewing
seat (user decision): `seatDeckKeys = [seat0's key, seat1's
key]` is recorded at duel start, and every surface derives
its context from the seat that owns the instance:
- board tiles: the zone's seat (con); hand: the human's seat;
  selection grids / unselect grid: the candidate entry's con;
- resident preview: captured into previewState at setPreview
  time (the ref's con; a bare code falls back to
  deckKeyOfCode — the deck key when exactly one of the two
  duel decks contains the code, else base art);
- the name-declaration catalogue: deckKeyOfCode (code-only
  surface, same rule as a ref-less preview);
- FX ghosts and cut-ins ride the same resolution: flights
  take the departing seat, vanish/slide derive it from the
  zone key, attack ghosts from the target's key, chain and
  set-activation pops from the link/event con, the ace scene
  from the summoner's con (materials from their own keys),
  the finisher big card from the attacker's key.
Attribution follows the client's state model (cards live in
a player's zones/piles); there is no separate owner field,
and control changes slide with the zone they occupy.

### Preload
preloadCardArt warms, for each selected deck, BOTH the base
file and that deck's scoped variant for every listed card —
so the Ishizu Mori/Hana paint their Egyptian art from the
first frame, and the base files stay warm for surfaces whose
context resolves the other way. The deck-select screen
itself has no per-card art surface (both deck buttons carry
the shared placeholder thumbnail), so nothing changes there.

### Neuron-imported decks (future)
An imported deck gets its own deck id; unless DECK_ART gains
an entry under that id, every card in it resolves to the
base CARD_ART art automatically. Mori in an imported deck
shows the plain forest art — the Egyptian variant cannot
leak into a deck it was not granted to.

### Information asymmetry (unchanged)
An opponent's face-down card receives NO art of either kind:
tile art is only stamped when the face is visible, and FX
face-down ghosts stay bare. The override binds exactly like
the base art (pinned by CA13d/CA13e/CA13f).

### Tests + frames
test-cardart extended: delivered-file entries for both
scoped pairs; CA7z1-CA7z10 (map, resolution both ways,
preload); the Vernusylph board now expects the scoped art
on the Ishizu seat (CA11l/CA11m/CA14j/CA14k/CA16h/CA16i);
a flipped-seat fixture (seat keys swapped) pins the other
direction — GG-context Mori/Hana fall back to the plain art
on tile/hand/preview (CA11n/CA11p/CA14l/CA14m/CA16j/CA16l),
Ishizu-context copies on the opponent's seat show the
Egyptian art (CA11o/CA11q/CA16k/CA16m), and face-down
Ishizu-context copies stay bare (CA13e/CA13f). Real-play
frames (cap-deckart.js, shots-deckart/): Mori and Hana
drawn, previewed and normal-summoned in a real Ishizu-deck
duel at 390x620/700 — tile and preview styles pin
card-art-mori-ishizu-s.jpg / card-art-hana-ishizu-s.jpg,
and the frames were eyeballed (names and stats match).

Third entry (same day): 《丘と芽吹の春化精》 9350312 ->
'oka-ishizu' — the Vernusylph trio's Ishizu-scoped set is
complete. Source ~/workspace/duel-assets/
oka-ishizu-user-20261103.jpg (1024x1536 — the pink-haired
fairy with a lotus basket before an Egyptian temple).
Standard top-anchored crops, no start adjustment (small
46KB / big 220KB; her face is upper-centre and whole in the
tile simulation). One more value in the same DECK_ART map —
no code path changed. test-cardart gained CA0 file entries,
CA7z11-CA7z14, the scoped expectations on the Ishizu seat
(CA11k/CA14i/CA16g), the flipped-seat fallbacks (CA11r/
CA14n/CA16n plain, CA11s/CA16o scoped) and the face-down
pin CA13g. cap-deckart.js now runs all three sisters;
shots-deckart/ holds the trio's real-play frames at
390x620/700 (tile + preview styles pin the scoped files).

## Card-kind colors — variant A shipped (2026-11-03)

User pick after the two-variant prototype (branch proto/type-color,
typecolor-report.md): variant A — the whole name band takes the
card-kind color — adopted; the accent variant B was removed, not
kept as a toggle. Kinds are derived mechanically from the core
type bitmask in data.json (client cardKind()/kindCls(); priority
spell > trap > fusion > synchro > xyz > ritual > normal > effect);
all 63 pool cards classify, 0 unclassified, unknown codes get no
class and keep the default #000a band. The palette is the original
frame hues (--k-*) with a deepened set (--k-*-d) for band
backgrounds so cream text stays readable; synchro keeps the
original silver with dark text. The class rides every name band
that is visible under the normal rules: board tiles, hand,
resident preview (name pill), the three selection grids
(gridSheet / unselect / announce), FX ghosts, the finisher and
ace-appearance big cards and the cut-in big card — the FX spots
were out of the prototype's scope and were folded in here via the
same helper. Face-down visibility is unchanged: an opponent's
set card renders no .nm at all, and the owner's set card keeps
its name + veil treatment (its band takes the kind color like
any owner-visible band). Board TILES still show no band (the art
layer covers it) — coloring the tiles themselves is a separate
user decision with its own prototypes (branch proto/tile-color).
Pinned by test-typecolor.js (33 checks: pool-wide agreement with
an independent derivation, DOM classes on a fabricated board,
opponent face-down nameless, stylesheet contract). Capture:
cap-typecolor-a.js -> shots-typecolor-a/ (fabricated mixed board
via render(), real gridSheet, computed colors in styles.json).
Merged over the DECK_ART line (ac90e65): the eight same-line
collisions were resolved by keeping BOTH changes — deck-scoped
art resolution (artInline/artCss/artApply deck arguments) and
the kind class on the band.

## Per-card illustrations, 14th delivery (2026-11-03): Vernusylph Flower Crown — plain art AND a deck-scoped variant

《春化精の花冠》 14108995 — passcode verified against
data.json (names/cards), NOT from memory: a Continuous Spell,
1 copy in the Ishizu main deck, none in GG. The first card to
arrive with BOTH paintings at once:

- plain art 'kakan' in CARD_ART — the forest painting (the
  pink-haired fairy placing a golden ring over the white
  rabbit). Source ~/workspace/duel-assets/
  kakan-user-20261103.jpg (1024x1536).
- deck-scoped 'kakan-ishizu' in DECK_ART under ishizu — the
  same composition in Egyptian dress (gold collars and ankh,
  river and temple behind). Source ~/workspace/duel-assets/
  kakan-ishizu-user-20261103.jpg (1024x1536). The 4th
  DECK_ART entry, and the first SPELL with an override; it
  rides the existing map unchanged — one value in CARD_ART,
  one value in DECK_ART, no new code path.

Files keep the standard shape and the user's crop rule
(keep the top, cut the bottom): assets/card-art-kakan{-s}.jpg
(small 34KB / big 161KB) and assets/card-art-kakan-ishizu{-s}
.jpg (small 44KB / big 219KB). Standard top-anchored crops,
NO start adjustment for either painting: in both, the fairy
sits upper-right/centre with her face at ~y25-35% and the
62x88 tile simulation (cover, centre-top) shows her face
whole and unmistakable; the rabbit's head enters at the
tile's lower edge, as with the sisters' paired compositions.

Surfaces behave like the books (the spell precedent): own
face-up S/T tile shows the art, own SET S/T carries it under
the breathing setown veil, the opponent's set card gets
neither art nor veil, and preload warms both paintings for
the Ishizu deck (the plain file stays warm for contexts that
resolve the other way).

Tests (test-cardart, 183 checks): CA0 delivered-file entries
for both pairs; CA0p/CA0q (deck membership: 1 copy in Ishizu,
none in GG — code-only surfaces resolve Kakan's membership
unambiguously); CA7aa/CA7ab (base map + preload);
CA7z15-CA7z18 (DECK_ART entry, resolution both ways,
preload); a fabricated Kakan board on the default seats
(CA24/CA11t/CA11u/CA13h/CA14o/CA16p — Ishizu-context face-up
tile, set-under-veil, opponent-set blank, hand, preview all
pin kakan-ishizu); a flipped-seat fixture (CA25/CA11v/CA11w/
CA13i/CA14p/CA16q/CA16r — GG-context tile/hand/preview fall
back to the plain forest art, the Ishizu seat's face-up copy
keeps the Egyptian art, its SET copy stays bare). Impact
suites green: setvis, facedown, layout, overlay, poolcov,
fx, swap, strot, phase2, ui.

Frames (cap-kakan.js, shots-kakan/): real play at 390x620/
700 — Kakan drawn in the opening hand (hand frames show the
Egyptian art in the hand tile), tapped (action sheet), then
SET through the real action sheet; the set frames show the
fairy ghosting under the card-back veil, and styles.json
pins card-art-kakan-ishizu-s.jpg + veil on the real set tile
at both heights (seat decks ishizu/gg). A declared
fabricated board adds the face-up S/T tile beside the set
one (field frames). Eyeballed: names, text and art agree —
the preview header reads 《春化精の花冠》 over the Egyptian
thumbnail. The plain forest painting never appears in a real
duel today (no non-Ishizu deck runs Kakan); its fallback is
pinned by the flipped-seat fixture, and it will surface for
real the day a Neuron-imported deck runs the card.
WKWebView on a real device remains unmeasured, as ever
(capture environment is Chromium-class).

Fifteenth delivery (user, 2026-11-04): 《地久神－カルボン》
15079028 (carbon); source ~/workspace/duel-assets/
carbon-user-20261103.jpg (1024x1536, the stone giant
standing over the Earth). Standard top-anchored crops, no
start adjustment: small = y0-1024 -> 320x320 (38.6KB), big =
full width x y0-1411 -> 640x882 (175.7KB). The tile
simulation (cover, centre top, 62x88 box) keeps the giant's
face whole at upper centre, with the halo ring and the stone
wings in frame. One line in CARD_ART — a plain registration,
no DECK_ART entry.
test-cardart: Carbon WAS the unlisted fallback exemplar, so
the role moved Carbon -> 《生きる偲びのシルキィ》 55702233
(x2 in the deck, no individual art; the classic Agido
16135253 x1 was passed over so the exemplar stays clear of
the dormant-Agido-art question). Carbon gained CA0p /
CA7z15-CA7z16 / CA11x / CA13j / CA14q / CA16s / CA26 (the
labels were renumbered at the merge with the 14th-delivery
line, whose Kakan board already held CA11t/CA13h/CA14o/
CA16p/CA24; both boards kept). Integrated tree: 193
test-cardart checks, ALL PASSED. Affected suites on the
branch: setvis / facedown / typecolor / layout / overlay /
fx / swap / poolcov / recipe-v11 ALL PASSED; test-strot
24/25 with only the known ST4 reachability flake (ST5
passed).
Real-play frames (cap-carbon.js, shots-carbon/): drawn,
tapped (resident preview) and normal-summoned face-up
through the real sheet at 390x620/700 — tile and preview
carry the new art, name/stat lines read 地久神－カルボン
1200/1200.

The same delivery also brought an Ishizu-scoped variant
(user, 2026-11-04): 《地久神－カルボン》 wears gold-and-
hieroglyph regalia ONLY inside the Ishizu deck — the 5th
DECK_ART entry and the first for a MONSTER. Source
~/workspace/duel-assets/carbon-ishizu-user-20261103.jpg
(1024x1536, the same giant in Egyptian regalia). Standard
top-anchored crops, no start adjustment: small = y0-1024
-> 320x320 (43.9KB), big = full width x y0-1411 -> 640x882
(212.4KB). The tile simulation keeps the face whole at
upper centre, the hieroglyph ring in frame. One line in
DECK_ART (ishizu: 15079028 -> 'carbon-ishizu'); the plain
'carbon' stays in CARD_ART for every other deck context.
test-cardart: CA7z21-CA7z24 pin the map and both
resolutions; the seat-0 board (CA11x/CA14q/CA16s) now
expects the scoped art, and a flipped-seat fixture
(CA27 / CA11y / CA11z / CA13k / CA14r / CA16t / CA16u)
pins the plain fallback under a non-Ishizu context, the
regalia on the Ishizu seat, and no art on a face-down
Carbon even in Ishizu context — 206 checks in total on
the integrated tree, ALL PASSED (setvis / typecolor /
facedown also green). Real-play frames (cap-carbon.js,
shots-carbon-ishizu/): the same flow in the Ishizu deck
now resolves tile and preview to card-art-carbon-ishizu;
the plain stone art remains what any non-Ishizu context
sees (fixture-pinned, as with the sisters).

## Per-card illustrations, 16th delivery (2026-11-04): 《生きる偲びのシルキィ》 — plain art AND a deck-scoped variant

User art for 《生きる偲びのシルキィ》 55702233 (Ishizu deck
x2, ATK 800 / DEF 0), in BOTH forms at once:

- Plain art 'silky' — source
  ~/workspace/duel-assets/silky-user-20261103.jpg (1062x1481,
  translucent girl in a white dress holding a broom, in a
  warm room).
- Ishizu-scoped variant 'silky-ishizu' — source
  ~/workspace/duel-assets/silky-ishizu-user-20261103.jpg
  (1062x1482, the same girl in an Egyptian white dress with
  a gold sash, at a temple). The 6th DECK_ART entry.

Standard top-anchored crops for all four files, NO start
adjustment: plain small = y0-1062 -> 320x320 (27.7KB),
plain big = full width x y0-1464 -> 640x882 (122.6KB);
ishizu small = y0-1062 -> 320x320 (36.6KB), ishizu big =
full width x y0-1464 -> 640x882 (179.0KB). Both tile
simulations (62x88, cover / center top) keep the face whole
at upper centre — pink hair and purple eyes for the room
painting, the gold collar and sash reading clearly for the
temple one — and the real-play frames below confirm the
bright translucent subject stays legible on the dark board
(no wash-out into the tile background).

One line in CARD_ART (55702233 -> 'silky'), one line in
DECK_ART (ishizu: 55702233 -> 'silky-ishizu'). test-cardart:
CA0s/CA0t pin the deck membership (Ishizu x2, GG none);
CA7z25-CA7z30 pin the maps, both resolutions and both
preloads; the seat-0 board (CA28 / CA11aa / CA13l / CA14s /
CA16v) expects the scoped art on tile / hand / preview and
NONE on an opponent face-down Silky; a flipped-seat fixture
(CA29 / CA11ab / CA11ac / CA13m / CA14t / CA16w / CA16x)
pins the plain fallback under a non-Ishizu context, the
Egyptian art on the Ishizu seat, and no art on a face-down
Silky even in Ishizu context.

Registering Silky retired the fallback exemplar AGAIN —
she had held the role since Carbon's delivery. The role
now sits with the deck's CLASSIC 《アギド》 16135253: the
ONLY unlisted Ishizu main-deck monster left (verified by
enumeration over data.json). The dormant CARD_ART 'agido'
entry stays keyed to Ancient Guard Agido (62320425), a
different card, so 16135253 itself resolves to the shared
placeholder on every fallback surface (CA0o now counts its
single copy; CA6 and the main fabricated board exercise it
as before).

230 checks in total, ALL PASSED. Affected suites on the
integrated tree: setvis / facedown / layout / overlay /
poolcov / fx / swap / strot / phase2 / ui / typecolor all
green in one batch; logdetail-ui dropped 2 checks inside
that batch under load and passed cleanly on a solo re-run
(known load-flake pattern, not this change — the delivery
touches only the art maps). Real-play frames (cap-silky.js,
shots-silky/): Silky drawn in the opening hand, tapped
(resident preview) and normal-summoned face-up through the
real sheet at 390x620/700 — tile, hand and preview all
resolve to card-art-silky-ishizu in the Ishizu deck, name /
stat lines read 生きる偲びのシルキィ 800/0; the plain
'silky' remains what any non-Ishizu context sees
(fixture-pinned, as with Kakan / Carbon before her).

## Zero-option chain prompts auto-pass (2026-11-04, user report: 何も発動できるものなくても聞いてくるのは不毛)

Measured first (probe, bot duels, both deck assignments): the core
sends MSG_SELECT_CHAIN at every timing window unconditionally
(playerop.cpp writes the message even when select_chains is
empty), and **983 of 1692 chain prompts to the human seat carried
0 entries (58%)** — passing is the only legal answer there.
Prompts whose every candidate is dismissed (per-chain or duel)
are the same shape after the client's own presentation filter.

The decision now lives at the uiAnswer choke point, next to the
response-mode 'off' auto-pass, as `chainPassDecision(prompt,
state)`:
- 'pass' — zero live options (no entries at all, or every
  candidate chain-dismissed / mixed chain+duel dismissed):
  uiAnswer resolves i32 -1 immediately. No prompt cycle at all:
  currentPrompt is never set, no stats refresh round-trip, no
  dock. (uiChain already auto-passed these deep in its own flow;
  the guarantee is now structural and tested, and on the Worker
  path the zero-option majority no longer pays a prompt cycle.)
- 'flash' — every candidate duel-dismissed: unchanged, uiChain's
  visible auto-pass owns it (自動パス flash + 450 ms), so the
  player sees their dismissal setting fire.
- 'show' — at least one live candidate, and ALL forced prompts
  (passing is illegal there; mandatory responses, including the
  spe_count/0x7f flows, are always shown). Response mode 'on'
  （毎回） keeps ignoring dismissals exactly as before; mode 'off'
  still passes every non-forced prompt earlier in uiAnswer.

Answers are byte-identical to the old flow in every case (pass
where pass was already the answer), so game progression cannot
change; uiChain's internal guards remain as a backstop.

Pinned by test-chainpass.js: Part A unit-tests the decision
matrix (14 checks: zero entries / forced / live / each dismissal
kind / mixed / resp 'on' / the per-chain dismissal reset).
Part B runs 5 real engine duels with the REAL uiAnswer/uiChain
answering every SELECT_CHAIN (bot plays the rest): 510 prompts,
222 'pass' / 288 'show', decision-vs-display agreement for every
prompt, 0 MSG_RETRY, all duels completed. Frames
(cap-chainpass.js, shots-chainpass/, declared fabrication through
the real code paths over a live board): dock with a live
candidate + パス at 390x700/620; the 自動パス chip flash for a
duel-dismissed candidate; a zero-entry prompt leaving the board
untouched. test-logdetail-ui keeps its known load-flake on the
pristine base too (0–9 failing checks across runs there, same
failure modes; not this change).
## Per-card illustrations, 17th delivery (2026-11-04): 《メタファイズ・ホルス・ドラゴン》 — the first EXTRA-deck monster

User art for 《メタファイズ・ホルス・ドラゴン》 36898537
(Ishizu EXTRA deck x2, Synchro, Lv6, ATK 2300 / DEF 1600) —
source ~/workspace/duel-assets/horus-user-20261103.jpg
(1024x1536, the silver mechanical dragon with three heads
and spread wings, hovering over the moonlit Nile). Plain
registration 'horus' in CARD_ART; NO DECK_ART entry.

Standard top-anchored crops, no start adjustment: small =
y0-1024 -> 320x320 (43.2KB), big = full width x y0-1411 ->
640x882 (191.9KB) — the same numbers as Carbon's delivery
(identical source dimensions). The tile simulation
(62x88, cover / centre top) keeps the central head whole at
mid-frame with both wings spanning the width and the moon
in the top corner; the two side heads sit at the frame
edges and are cover-cropped on the narrow tile, as with
any wide subject. NO crop adjustment: the user's rule
(keep the top, cut the bottom) is followed as-is and the
head at ~30% height is never at risk.

test-cardart: CA0u/CA0v pin the deck membership (Ishizu
EXTRA x2, GG none); CA7z31-CA7z34 pin the map, both
resolutions, the boot preload (EXTRA-deck membership warms
the art from deck-select time) and the absence of a
deck-scoped override; a fabricated post-summon board
(CA30 / CA11ad / CA11ae / CA13n / CA16y) pins the new art
on an own face-up tile, on an opponent FACE-UP tile
(public), on the resident preview — and NO art on an
opponent FACE-DOWN Horus (asymmetry binds EX monsters
too). 243 checks in total, ALL PASSED. Affected suites:
setvis / facedown / layout / overlay / poolcov / fx /
swap / phase2 / ui / typecolor all green (strot dropped
one sampling check on the first run and passed cleanly
on two re-runs — the known duel-flow flake, not this
change; the delivery touches only the art map and the
two new asset files).

Real-play frames (cap-horus.js, shots-horus/): a real
duel as the Ishizu deck — the own EXデッキ pile sheet
lists Horus x2 among the 15; tapping a Horus row opens
the card info (メタファイズ・ホルス・ドラゴン, 光属性／
幻竜族／レベル6／攻2300／守1600, full official text) and
sets the resident preview, whose strip shows the dragon
painting with the silver Synchro name band and
ATK 2300／DEF 1600, at 390x620/700. The post-summon field
tile is fixture-pinned (CA11ad), as the deck-scoped
deliveries pinned their non-Ishizu surfaces by fixture.

## Face-down selection leak fixed (2026-11-04, user report: 相手の裏側セットが選択画面で見えた)

The user found in real play that a target-selection sheet
showed the opponent's face-down set cards WITH name and art —
and they could be picked. Root cause: the core writes real
codes into every SELECT_* message unconditionally (correct
engine behavior — the bot path already masked them through
maskEntry/botView), but Duel.run handed the RAW prompt to
the human answerer. The board renderer guarded its own
tiles, so the leak lived only in prompt rendering:
gridSheet (SELECT_CARD / SELECT_TRIBUTE / SELECT_SUM via
uiSelectCards and uiSelectSum) rendered name, art, stats,
full text, tray chips, must chips and a 詳細 button reaching
openInfoPop for every candidate — including the opponent's
face-down ones. uiUnselect (the un-select grid) and the
uiSort / uiCounter name labels had the same hole.

Reproduction (before the fix, real duel): a crafted deck
(太陽の書 x20 + メドゥーサのワーム x20 vs an all-Worm CPU that
always sets) reached 太陽の書's target prompt with the
opponent's face-down Defense monster (con=1, loc=4, pos=8)
inside — the prompt delivered to the human UI carried the
real code 2694423 and the card name. Five such leaked
candidates were recorded in one duel.

Fix, two layers:
1. engine.js — maskPromptForHuman(prompt, state), applied
   in Duel.run immediately before humanAnswerer. Same view
   semantics as the bot (view {me: prompt.player}, context
   code from prompt.context so 《墓穴の道連れ》 16435215 keeps
   the revealed hand visible — its effect reveals both hands
   BY RULE). Candidate lists masked: cards / select /
   unselect / must / entries / summon / spsummon / repos /
   mset / sset / activate / attack. Entries whose pos is
   null/0 recover the true position from the GameState
   mirror (SELECT_TRIBUTE ships pos=0). Face-down EXTRA
   entries are masked too (maskEntry had no EXTRA rule).
   Selection legality is untouched: indices, counts and the
   candidate set are identical; only identity fields of
   hidden opponent cards become null. The stored prompt is
   never mutated (copy semantics — a retry re-masks).
2. client.js — defense in depth at render time.
   selCardHidden(e, prompt): an opponent's face-down field
   card, set S/T, hand card, deck card or face-down EXTRA
   card renders as the card back with a generic label
   (「裏側のモンスター（守備表示）」/「裏側のカード」/…) — no
   art, no stats, no text, no 詳細 button — even if a real
   code reaches the renderer. gridSheet, uiUnselect,
   uiSort, uiCounter all route through it. New CSS:
   .gcard.back paints the standard card-back art.

Audit of the other surfaces (no leak found): pile sheets
(grave/removed are public; opponent EXTRA and hand list
counts only; deck shows only a revealed top card),
contextLineHTML (the asked-about card is public at
activation time), the chain dock (own entries only),
ANNOUNCE_CARD catalog (a declaration list drawn from the
public card DB by design), FX ghosts (face-down judged
from position), board tiles and the resident preview
(faceUp / ownership guards), dlog target names (face-up
check in engine.js).

test-facedown-select.js (22 checks): Part A engine unit
pins — the mask matrix (opponent face-down field/set/hand/
EXTRA lose their code; face-up, grave, and the HUMAN's OWN
face-down keep theirs), con/loc/seq/pos preserved, copy
semantics, the Hand Destruction exception, TRIBUTE pos
recovery. Part B two real duels — 太陽の書 scenario (the
masked candidate stays selectable and actually flips),
墓穴の道連れ scenario (revealed hand stays named and
selectable; no other leak). Part C jsdom rendering —
masked grid cells are .gcard.back with the generic label
and no detail button; tray chips labelled; a synthetic
prompt carrying a REAL code for an opponent face-down card
still renders masked (render-side guard); Hand Destruction
context renders names; the un-select grid is guarded.
ALL PASSED. Full-suite run on the branch: every suite
green except test-logdetail-ui D11/D12, which fail
IDENTICALLY on the pristine base f4365e2 in this
environment (pre-existing; the probe touches history
rendering only, unrelated to selection).

Real frames (cap-facedown-select.js,
shots-facedown-select/): a live page at 390x620 and
390x700 shows the selection sheet with the opponent's set
monster and set S/T as full card backs labelled
「裏側のモンスター（守備表示）」「裏側のカード」, while the
opponent's face-up Mudora and the player's own 太陽の書
keep art, name, stats, text and the 詳細 button.
## Opponent card info (user request, 2026-11-04): tap an opponent's card, see its public info

The user asked to tap an opponent's monster (or any field
card) and read its info — "face-up public info only". Audit
of what already stood: in neutral board states the zone tap
already fed the resident preview for opponent face-up cards,
and the preview tap opened the full detail. The gaps were
contextual: (1) while a selection sheet is up, the sheet
wrap covers the board, so even peeking （盤面を見る) was
look-only — no card could be tapped for its detail; (2)
during SELECT_PLACE/DISFIELD placement, a tap on any zone
the placement does not target was swallowed silently, so
the opponent's board could not be checked mid-placement.

What shipped, all behind ONE visibility guard:

- boardCardAt(key) is now the single resolution point for
  board info: a field card resolves iff it is face-up, or
  it is the player's own card (own face-down cards ghost
  through by design). An opponent's face-down card NEVER
  resolves — the same rule the tile art and the stat strip
  already obey, now shared by every info path. The neutral
  zone tap was refactored onto it with no behaviour change.
- Peek info taps (R-SEL-2 extension): while a prompt sheet
  is peeked down, the wrap still covers the board, so a
  backdrop tap on the wrap is forwarded by coordinates
  (elementsFromPoint -> peekBoardTap -> peekInfoTap) to the
  card under the point, and its read-only detail floats
  over the board via openInfoPop (its close reads 選択に
  戻る while a prompt is live). Only card surfaces answer
  (zones, the preview strip, hand cards); phase/menu
  buttons under the wrap stay unreachable, and the tap
  never answers, toggles or cancels the pending selection.
  A tap on an opponent face-down card is refused by the
  guard and changes nothing.
- Placement info taps: during placeCtx, a tap on a zone
  the placement does not target now feeds the resident
  preview through the same guard instead of being
  swallowed; available-zone taps place exactly as before,
  and the placement state (chosen set) is untouched by
  looking.

Operation design (why these shapes): candidates inside a
selection stay selectable (grid tap / 詳細 button as
before); non-candidate board cards are info-only, reached
through the existing peek convention rather than a new
mode — the same "look without committing" grammar as
R-SEL-1/R-SEL-2. Own cards' taps and sheets are unchanged.

Tests: test-oppinfo.js (new, 23 checks) pins the guard
(face-up resolves / face-down refuses, both zones),
preview + detail from real click dispatches, the
mid-SELECT_CARD peek flow (select -> peek -> info on a
NON-candidate opponent card -> selection intact, prompt
still pending -> close -> confirm still works), and the
placement info tap. Affected suites re-run green:
cardart / facedown / setvis / layout / overlay /
typecolor / purpose / logdetail-ui / ui / fx / strot /
phase2.

Real-browser frames (cap-oppinfo.js, shots-oppinfo/,
genuine mouse hit-testing, 390x620/700): a real duel with
a fabricated opponent board — tapping 雷魔神－サンガ's
tile puts it in the resident preview (ATK 2600/DEF 2200,
its text); mid-SELECT_CARD, peeking and tapping the
opponent's face-up 《ラビリンス・ウォール・シャドウ》
through the wrap floats its full detail over the board
with the selection sheet still parked below （現在 1 枚
selected, unanswered). Capture note: uiAnswer refreshes
the board from the worker's real snapshot, so the rig
fabricates the board AFTER the sheet opens (in real play
the state is simply the real state).
## Cannot-attack reasons (2026-11-04, user report: バロメットが召喚したターンに攻撃できなかった)

Investigation (~/workspace/duel-app-baromett-investigation/) proved
the ruling was CORRECT: the opponent's 《ラビリンス・ウォール・
シャドウ》 (34771947) bars monsters summoned that turn from
attacking, except original-Level-5+; Baromett is an Xyz monster
and has no Level, so the exception never applies to it. The
defect was display-only: the core simply never offered the attack
and the sheet said nothing — the cannot-activate reasons had no
attack twin.

Fix (client.js, "cannot-attack reasons" block; test surface
window.__atkblock; gate test-atkblock.js, 21 checks): while a
SELECT_BATTLECMD is live, an own face-up attack-position monster
with no offered 攻撃 action gets the greyed 攻撃 row WITH the
reason (the cannot-activate row's exact form), and the same
reason rides the persistent preview. Monsters WITH an attack
action are untouched, as is every other sheet. Derivations are
text-derived from the pool, evidence is the client's own
records, and a reason is stated only when it fully explains the
missing command:

  (1) FIELD summon-turn block — a face-up field spell (szone[5],
      either player; the effect ranges over both fields) whose
      text bars this-turn summons except original Level N+.
      Derivation == {34771947: 5}. "Summoned this turn" is a
      zone-diff arrival tracker (trackFieldSummons, fed the
      presentation-event copy in onUpdate): normal summon, set
      and special summon all arrive; a set flipped face-up by an
      effect keeps its arrival turn (STATUS_SUMMON_TURN parity);
      a flip summon of a monster set on an EARLIER turn arrives
      via the flipsummon event, marked only when exactly one
      zone turned face-up with that observation (ambiguity =
      silence). Identity-less previous occupants mint no claim.
  (2) SELF summon-turn block — the monster's own printed clause
      「このカードは召喚したターンには攻撃できない」, armed only
      by a kind-attributed normal summon / set (its script hooks
      SUMMON_SUCCESS). Derivation == {《迷宮の重魔戦車》35026117}.
      It sits in the GG deck, so today it can only ever matter
      under a future control change; the derivation is pool-
      general regardless.
  (3) The revive rider's attack half — rides the existing
      monsterRevived latch (same proof, attack wording). NO pool
      card carries the rider today (audit C1), so this arms only
      for a future pool card.

Enumerated NOT covered (pool audit, test-atkblock B/C): the pool
holds exactly 4 attack-barring clauses. The other two:
  - 《メタファイズ・ホルス・ドラゴン》's Pendulum-material rider
    (a stolen monster cannot attack this turn) — UNREACHABLE:
    the pool holds zero Pendulum monsters, so the branch can
    never arm; it is also the pool's only control-change text.
  - 《光の護封霊剣》② (this turn the opponent's monsters cannot
    direct attack) — the card sits only in the HUMAN's deck, so
    the blocked side is always the CPU, which has no sheet; the
    human's attack surface can never be its surface.
Watcher for future pools: SELECT_COUNTER-style re-audit — if a
Pendulum monster, an opponent-played direct-attack block, or a
control-change card enters the pool, B1 fails until the case is
classified and (where reachable) covered.

Real frames (cap-atkblock.js, shots-atkblock/): rigged decks
(40x Mudora + Baromett vs 40x Shadow) played through the real
UI — T1 NS Mudora, CPU T2 Shadow, T3 NS + Xyz Baromett, BP, tap
Baromett at 390x620/700. The sheet shows the greyed 攻撃 row:
《ラビリンス・ウォール・シャドウ》の効果で、召喚したターンの
モンスターは攻撃できません, and the preview carries the same
reason (asserted from the DOM and read off the frames).

## FX coverage: the summon callout (2026-11-04, user order)

User order: every event should present the card that did it, with
the card's image — "このカードが効果を使いました／召喚しました"
must read off the presentation, not the log. Inventory of the
pre-round build (code + redesign inventory.md, base 244f0ad era
carried to 3c8b288) found activations already covered (chain pop /
set-activate tilt pop / chain-solve pop all show the card), attacks
covered (scene emphasis + target ghost), movement covered (flight
ghosts), destruction covered (flash + flight / battle dissolve),
confirmations covered (reveal sheet). The summon family was the
hole: a NORMAL SUMMON — the most common event in the game — was a
430 ms puff and nothing else; a generic special summon and a
revival were a portal glow around a tile that simply appears; a
flip summon only the tile's own flip. On the CPU's 620 ms pace the
opponent's summons in particular read as "result + one log line"
(inventory finding B40/所見2).

Fix: `fxSummonCallout(key, code, con, pos)` — one shared grammar
for every summon no bigger scene owns. The summoned card's image
stamps in over its own zone at 1.5x (settle-in 0-200 ms), a seat
rim ignites (gold = human, lapis = opponent; the redesign colour
grammar; new CSS `.fx3-lapisframe`, gold reuses `.fx3-goldframe`),
holds readable (640 ms own seat / 800 ms opponent — the opponent's
actions run on CPU pace), rim keeps a 0.38 floor through the hold
so the stamp reads as a presentation, then a 260 ms ease-out.
Presentation only: the scene claims NO input window and lives in
#fxlayer (pointer-events:none), so it cannot cover a prompt or
the result screen.

Wiring (fxProcessInner arrivals + one event hook):
- normal summon (incl. advance summons): puff + callout
- generic special summon (hand / deck / extra, non-EX-method):
  portal + callout
- revival / return from grave or banished: portal + callout
- flip summon: changed-diff flip + callout (event hook)
NOT wired, deliberately:
- fusion / Xyz arrivals: material converge + portal already
  present the card's arrival as a scene (a callout on top would
  double the read)
- ace cut-in summons: the ace scene owns them end-to-end (the
  arrivals ace branch consumes them before the callout branches;
  with the cut-in setting OFF they fall through to the callout,
  so they are never left with nothing)
- synchro arrivals take the generic path today, so they gain the
  callout; the synchro GRAMMAR (material lights / level sum) is
  the redesign-impl S block's, not this round's
- face-down arrivals (sets, face-down special summons): never —
  the identity is not public information yet (guarded on
  POS_FACEUP at every call site)

Coverage table (event -> card-image presentation, before -> after):
  normal summon        puff only                 -> puff + callout
  advance summon       converge + puff + glow    -> + callout
  special summon (gen) portal 600                -> portal + callout
  synchro (non-ace)    generic portal            -> + callout (grammar: redesign-impl S, unlanded)
  fusion / Xyz         converge + portal         -> unchanged (covered)
  revival              portal 700                -> portal + callout
  flip summon          tile flip                 -> flip + callout
  set (mon / S/T)      puff (face-down: correct) -> unchanged
  ace summon           full cut-in               -> unchanged (covered)
  activation (any loc) chain pop / tilt pop      -> unchanged (covered)
  chain solve / negate solve pop (gold / gray)   -> unchanged (covered)
  attack               scene + target ghost      -> unchanged (covered)
  destroy / banish / send / bounce / deck return
                       flash + flight / vanish   -> unchanged (covered)
  draw (own / opp)     flight face-up / face-down-> unchanged (covered / correctly hidden)
  search / confirm     reveal sheet (name+detail)-> unchanged (covered)
  position change      rotation                  -> unchanged (covered)
  flip (by effect/atk) flash + flip              -> unchanged (covered)
  Xyz attach / detach  zone glow / peel          -> unchanged (covered)
  stat change          strip flash               -> unchanged (covered)
  LP damage/heal/cost  count + float (cause card
                       shown by the solve pop)   -> unchanged; cost-vs-damage colour split is redesign-impl F (unlanded)
  deck -> grave (mill) pile glow only            -> redesign-impl I(1) implements the flight on its branch (unlanded); NOT duplicated here
  finisher             full-screen scene         -> unchanged (covered)
NOT covered, with counts and reasons (2 kinds):
  - counter add/remove: pool holds 0 counter cards (data.json
    audit: 0 texts mention カウンター) and the engine emits no
    counter event — nothing to present, nothing reachable.
  - equip / target-relation display: pool holds 0 equip-type
    cards (type bit 0x40000 audit: 0) and the engine parses
    EQUIP / CARD_TARGET for the log only, emitting no FX event.
Deck-out finish and deck shuffle carry no card to present (the
result text / pile count already carry them); out of scope for a
card-image rule.

Tests: test-fx Part 1C (FXC1-FXC9) pins the callout records —
normal (both seats), generic special summon, revival fire it;
fusion, set monsters and face-down special summons do NOT; flip
summons fire it alongside the flip beat; fxError stays null.
Full test-fx passes (synthetic 1/1B/1C + two live duels to the
result screen; live tally includes summoncall=5). test-fxidentify
passes. Real frames: cap-fxcov.js (parked real duel + synthetic
state replay, frames timed by FX-scene-local clock) in
shots-fxcov/ — callout-summon-me / -opp / -spsummon /
-flipsummon at 390x620 and 390x700, f01 stamp (~120-180 ms) and
f02 hold (~400-570 ms) read off the frames: enlarged card, seat
rim, name band legible, board not covered.

## App renamed: MILLENNIUM DUELISTS (2026-11-04, user decision)

The app's title changed from 「トトと簡易デュエル」 to
**MILLENNIUM DUELISTS** — the plural is deliberate: the selling point
is that AI-piloted original-work character decks are the opponents.
Display surfaces replaced (text only, world styling unchanged, the
wordmark is set in the app's own type — no imitation of any official
logo):

- v2/index.html: `<title>` and the start-screen `<h1>`, now set as a
  two-line gold inscription (MILLENNIUM / DUELISTS, letterspaced).
- index.html (retired v1 page): `<title>`, `<h1>`, footer name.
- README.md: repository heading (with a one-line 旧名 note).

Untouched on purpose: repository name, URLs, file paths, and the v1
localStorage keys (`toto-duel-*-v1`) — those are functional
identifiers, not display names. No test depended on the old title
string.

Subtitle (same decision, added minutes later): the title screen
carries a small **for GENESYS** line under the wordmark — GENESYS is
Konami's official English spelling of the format, and the line marks
the app as GENESYS-rules-only. Placement judgement: the subtitle
lives ONLY on the v2 title screen. It is deliberately NOT folded
into the `<title>` tags, the v1 page, or the README heading — those
carry the plain proper name; the subtitle is a title-screen design
element, not part of the name itself.
## Deck-select page (2026-11-04, user request: デッキ選択は別ページで)

The start flow is two pages again. Before: the title overlay
carried everything (title, both deck picks, first/second, the
settings rows, the start button). Now:

- Title page (#start): title, tagline, 「デッキを選ぶ」 (new
  #todeck) and the load message. Nothing else — no deck, turn or
  settings controls remain there (test-deckpage DP2).
- Deck page (#deckpage, new overlay): header (「← タイトルへ」
  back button + デッキ選択), then in one fixed column — own-deck
  section, opponent-deck section, 先攻・後攻, the settings rows
  (チェーン確認 / 召喚カットイン / 音, ids unchanged) — and a
  footer with the live selection summary (#decksum: own deck /
  opponent deck / turn choice, refreshed by every seg handler and
  at boot) above the start button.

Layout law kept: the deck page is a one-screen fixed column that
never scrolls (overflow hidden); each deck list is a vertical
list that scrolls inside its own region (.decklist,
overflow-y:auto, inside a flex .dp-sec), so a growing roster of
character decks stays fully reachable — proven in the capture
rig by cloning both lists to 10 decks (list scrolls internally,
last entry reachable, page still fits the screen). Deck rows are
the same .deck cards as before, full-width now; the selected
state (gold frame + check dot) is unchanged, and own/opponent
remain separate labelled lists.

Unchanged on purpose: every control id (seg-mydeck / seg-opdeck /
seg-first / seg-resp / seg-cutin / soundbtn / startbtn), so all
existing suites drive the flow exactly as before. The start
button still IS the load state (A-03: disabled 読み込み中… ->
デュエル開始, failure -> 再読み込み), now on the deck page;
navigation is wired before the data load so the failure path's
retry button stays reachable. Art preload still fires at boot
and on every deck change (deck-select-time preload, no blank/'?'
surfaces). The VS curtain moved to #app level (z 65, above both
pre-duel pages) — it still has no button and advances on its own;
starting hides both pages. Rematch restore （同じ設定でもう1戦）
clicks the start button directly and is unaffected. A pre-duel
deck-recipe viewer does not exist in the current build and was
NOT added here (out of scope, noted for the record).

Tests: new test-deckpage (DP1-DP13) — structure, navigation,
defaults, summary updates, stylesheet scroll contract, and the
deck-page start (VS curtain plays, both pages hidden, board up).
test-ui (both runs), test-layout and test-bgm pass unchanged.
Real frames: cap-deckpage.js in shots-deckpage/ — title and deck
page at 390x620 / 390x700, swapped-selection state, plus the
10-deck scroll stress at 700; the summary wraps to two lines
rather than truncating the turn choice (fixed after the first
capture round).

## Board-tile kind frame (user decision 2026-11-04, variant 1 shipped)

Follow-up to the variant-A band colors: the user also wanted the
kind color ON THE BOARD ("盤面の方にも欲しい"), where the name band
is covered by the art and cannot carry it. Two placements were
prototyped on branch proto/tile-color (tilecolor-report.md):
variant 1 frames the whole tile edge; variant 2 put a small chip
on the tile's bottom edge. The user picked variant 1 (2026-11-04);
variant 2 was NOT shipped and no trace of it (body-class gating,
.kchip element) remains in the tree.

Implementation: tileHTML adds kindCls(code) to the .tile class
list, gated on the faceUp position bit specifically. Face-down
tiles get no kind class at all — an opponent's set card obviously,
and the owner's own set card too (its owner-visible name band
keeps the variant-A band color; the tile itself stays frameless
under the veil, exactly as prototyped). The stylesheet draws the
frame as .tile::after — a 2px border just inside the tile edge,
colored with the full-strength frame color var(--kc), NOT the
bands' deepened --kcd: the frame is a thin mark with no text on
it, so it keeps the original frame hue. Two structural facts keep
it robust: the class sits on .tile, which never rotates, so a
defense tile's 90-degree .inner rotation leaves the frame
upright; and the corner badges (.mats/.ctrs, z-index 2) paint
above the ::after, as measured in the prototype. Opponent face-up
tiles are framed too (public information, same as their bands).

Pinned by test-typecolor.js (extended to 45 checks: TC0g/TC0h
stylesheet contract — frame rule present, no prototype gating or
chip remnants; TC22–TC31 fabricated-board tile classes — face-up
tiles of every represented kind carry the class on .tile, the
class never rides on .inner, own set and opponent face-down
tiles carry no kind class). Impact suites green on the branch:
cardart, setvis, facedown, layout, strot.

Capture: cap-tileframe.js -> shots-tileframe/ (390x700) and
shots-tileframe-620/ (390x620) — REAL play (human seat driven
through the real UI: hand tap -> action sheet -> zone tap;
position change through the action sheet on the next own turn;
CPU plays its own turns). At 700 the full set landed: board-atk
(face-up monster framed right after the summon), board-mixed
(opponent face-up Spell framed green next to an own face-up
Effect monster framed orange, captured mid CPU turn), board-def
(face-up DEFENSE monster: computed ::after border 2px in the
Effect color rgb(207,116,52) on the unrotated .tile while the
.inner transform is a 90-degree rotation matrix; the owner's
own set S/T beside it carries no frame). At 620, board-atk and
board-mixed landed (same two frame colors visible, layout
intact) but no board-def: across repeated attempts the CPU's
turn did not return within the capture harness's 9-minute
patience window, so the defense frame at 620 rests on the 700
measurement plus the shared stylesheet. The successful run's
styles.json has oppBack null — the CPU had no face-down card
at that moment — so an opponent face-down tile's computed
style is NOT measured; its framelessness is pinned by the
fabricated-board class checks (TC29/TC30) and the faceUp gate
itself. Normal and ritual monsters do not exist in the current
pool (0 cards), so those two frame colors are verified on
tiles only via the fabricated-board class contract and the
band legend, not in real play. WKWebView on a real device
remains unmeasured, as ever (capture environment is
Chromium-class).
## Neuron import Phase 1 (2026-11-04, user concept: 相手デッキは自前、自分のデッキはニューロンから)

What landed: the deck-select page's own-deck section gains an
import entry (＋ デッキを取り込む); saved decks become rows
inside the own-deck list itself, under a 保存したデッキ divider
(a second list region crushed the page at phone heights — the
one-scroll-region shape is the deck page's own rule). Imported
decks are validated against the OCG GENESYS rules,
saved to localStorage ('v2saveddecks', ~0.7 KB per deck), listed
next to the built-in decks, and — when every main+extra card is
in the current 63-card pool — playable immediately. Opponent
decks stay curated; importing is own-side only.

Import inputs (Phase 0 verdict stands: the app itself can never
fetch the official DB — CORS blocks it from any static origin,
verified in a real browser; the user brings the data):
- the official deck page's HTML (text view, whole-page copy).
  Rows are parsed per list table (monster/spell/trap -> main,
  extra_list -> extra, side_list -> side); each row's hidden
  link_value cid maps to a passcode via the bundled cid table,
  then alias-normalizes to the representative passcode
  (83764719 -> 83764718, verified end to end).
- .ydk / passcode lists (with #main / #extra / !side markers, or
  bare: Extra-Deck monster kinds are split off by type), YDKE
  URLs, and card-name lists (名前 ×n lines; names resolve through
  a whitespace/width-normalized index). Passcodes of 1-8 digits
  are accepted (real codes include 4-digit ones like 2511).
- Unresolvable names / codes are rejected at import with the
  offending entries listed — nothing is silently dropped.
- A pasted deck with no name (text formats) gets a provisional
  name 取り込みデッキ YYYY-MM-DD hh:mm (date/time of import).

Validator (neuron.js validateGenesis, data in genesys-data.json):
- points: main+extra+side total <= 100. Point data = the official
  point list, 2026-10-01 applied edition (?list=202610),
  snapshot at tools-neuron/official_points_202610.json (1,115
  names; parse verified identical to the hand-kept pt_by_name
  table). On failure the breakdown is shown per card
  (name (pt) xN = subtotal).
- same name <= 3 across all three decks (grouped by
  representative passcode and by identical display name).
- no Link / Pendulum; deck sizes main 40-60 / extra 0-15 /
  side 0-15.
- release cutoff of the bundled list: cards first released on or
  after 2026-03-01 are rejected, named individually (ocg_date
  from YGOPRODeck misc info, earliest across printings).
- cards that cannot be used in official duels (Token / Skill /
  placeholder heuristic) are rejected, named individually.
- three verdicts, three wordings: Genesis-illegal ->
  「このデッキは使えません」 + reasons, NO save offered;
  Genesis-legal but pool-unsupported -> 「Genesisには適合して
  いますが、このアプリでは未対応のカードが含まれています」
  + the unsupported names, save offered (labelled 対戦はまだ
  できません), start button disabled while it is selected with
  the reason on the button and the summary line naming the
  cards; fully supported -> 「Genesis適合 ― そのまま対戦
  できます」. Side-deck cards count toward points but do not
  gate play (the app has no side deck; noted in the result view).

Dataset (genesys-data.json, ~0.8 MB, fetched lazily ONLY when the
import panel is used; built by tools-neuron/gen-genesys-data.py):
points / JA names (12,301 reps) / alias (BabelCDB datas.alias +
same-English-name fallback merges) / cid map (14,409, from
ygo.sqlite) / link-pendulum, extra-kind, post-cutoff (402) and
unusable (231) rep sets. Point-name -> passcode resolution:
YGOPRODeck JA dump + ygo.sqlite JA names first, then Yugipedia
SMW (exact batches + archseries harvest), then individual
official-DB lookups (keyword search -> cid -> sqlite passcode;
glyph-variant stragglers closed by core-token search with HTML-
entity unescape + NFKC normalization). FINAL COVERAGE: all 1,115
pointed names resolved to a representative passcode — 0
unresolved. A deck containing a pointed card can therefore never
have that card silently valued at 0.

Known limits (honest edges):
- Same-name counting does NOT merge cards whose name is *treated
  as* another card's name (e.g. ハーピィ・レディ1号 is counted
  under its own name). Needs treated-as data the sources do not
  expose mechanically.
- 659 representative cards have no ocg_date in the sources; they are
  treated as pre-cutoff. A brand-new card missing its date would
  slip the cutoff check (its name would still surface in the
  composition view).
- The HTML path expects the page's text view: the visible-text
  clipboard form (what a plain select-all copy produces) is not
  parsed in Phase 1 — the panel asks for the page HTML.
- Points follow the bundled 202610 list only; list revisions
  (Phase 5) re-run the generator (sources are cached in
  ~/workspace/neuron-import-research/build-cache).

Out of scope (per the phase plan): Phase 2 (deck-code input —
needs a relay decision; direct fetch is impossible), Phase 3
(full-pool engine: lazy script/card/image supply), Phase 4
(pool-wide clarity machinery).

Tests: test-neuron (N0-N13) — real-fixture HTML import -> 45/15/9,
100pt, legal, playable, save -> reboot -> select -> duel starts;
variant-passcode normalization; points / copies / Link rejections
with reasons and no save; cutoff unit; legal-but-unsupported
save + start gating + two-step delete; name-list resolution and
unknown-name rejection. Regression: test-deckpage, test-ui,
test-layout, test-oppinfo, test-facedown-select, test-recipe-v11,
test-typecolor, test-cardart, test-bgm, test-setvis, test-atkblock,
test-genesis pass. test-logdetail-ui D11/D12 fail IDENTICALLY on
the unmodified base tree (pre-existing, not this change).
Frames: cap-neuron.js in shots-neuron/ (import OK / NG verdicts
and the saved deck on the deck page, 390x620 / 390x700).

## Card-view round + keycard S/T stage + art #18 (2026-11-04, user requests)

Three user asks landed on one branch (feat/cardview-keycard):

1) Card-view (「せっかく画像設定するんだから、確認する場面では
画像がよく見えた方がいい」). The read-only detail sheet
(openCardInfo) now LEADS with the big art: a .infoart block at
the top of the sheet carrying cardArtFile(code, true) inline
(deck context via deckKeyOfCode, exactly like the resident
preview resolves a bare code), width 100%, height
min(280px, 44dvh), top-anchored crop per the standing rule;
unlisted cards fall back to the shared placeholder through the
class background, the same fallback as the FX big card. Name /
meta / stats / text follow below, unchanged; the sheet's
internal scroll is untouched. Pile sheets (openPileSheet) lead
every known card's row with a .pthumb thumbnail (30x40, the
SMALL art file, the instance seat's deck context): grave,
removed and own EX rows. A hidden card (code null — face-down
banished) keeps the bare '？' row: NO thumbnail element, no
name, data-info empty, tap does nothing. The opponent EX sheet
stays count-only. Board tiles, the resident preview and the
1-screen base layout are unchanged. Measured on real frames
(390x620 / 390x700, cap-cardview.js): at 620 the detail sheet
shows art + name without scrolling; the meta line starts right
below the name and the first text lines sit under the sticky
close bar until scrolled (the pre-existing sticky-btnrow
grammar, unchanged). Tests: test-cardview (CV0-CV10).

2) Keycard spell/trap stage (「魔法・罠でも切り札カードは
同じような演出を入れよう」). A key S/T now gets an ace-grade
presentation on ACTIVATION — fxKeycardCutin, a 2400 ms scene on
the #fxcutin stage: gold frame held over the activating card's
own tile, scrim, the big card (big art file) settling in, the
name banner with a 魔法カード/罠カード sub-line, burst rings;
any tap skips to the exit (fxKeycardSkip, wired into the same
pointerdown handler as the ace skip). The trigger is the BGM
ladder's own — an 'activate' event whose code is in
KEYCARD_ACTIVATE_CODES (《墓守の罠》 98715423 / 《現世と冥界の
逆転》 17484499) — derived from the keycard definitions, no
per-name branch in the FX code, and gated by the same cut-in
setting as the monster cut-ins. While it runs it OWNS the
event: fxRoundBEvents skips the generic fxSetActivate tilt for
that activation (no stacking); with cut-ins off, or while an
ace scene is presenting, the generic presentation keeps the
activation as before. It does NOT reuse fxAceSceneV3: that
scene is built around materials converging on an empty zone
and a summon landing, and an activation's card already stands
in its S/T zone — same stage and grammar, activation-shaped
timeline instead. BGM conditions were not touched (visual and
ladder fire on the same event). Tests: test-keycardact
(KA0-KA5: fires for both key traps on both seats, no generic
stacking, control trap unchanged, cutin-off fallback).

3) Individual art #18: 《墓守の罠》 (98715423) -> 'hakamori'
(user art ~/workspace/duel-assets/hakamori-user-20261104.jpg,
the white-robed Egyptian priestess). First TRAP with
individual art; plain CARD_ART registration, no deck override.
Files generated top-anchored like every delivery (small
320x320 square crop, big 640x882 full-width crop). Because the
keycard stage resolves its art through cardArtFile/CARD_ART,
the stage now shows this illustration (pinned by
test-keycardact KA2i and by the keyact frames). test-cardart
gained the #18 entries (CA0w/x, CA7z35-38, CA11k/l, CA13o,
CA14i, CA16z); the unlisted fallback exemplar (classic Agido
16135253) is unaffected.

Regression on the final tree: test-cardart, test-cardview,
test-keycardact, test-fx, test-oppinfo, test-bgm,
test-typecolor, test-facedown-select, test-chainpass,
test-logdetail-ui, test-overlay, test-setvis, test-layout,
test-ui all pass.
Frames: cap-cardview.js (grave / detail / keyact at 390x620
and 390x700) in ~/workspace/duel-app-cardview-shots/.
Unmeasured, as ever: real-device WKWebView look and feel, SE
timing by ear.

4) Individual art #19: 《宵闇のルーチェ》 (45409943) -> 'luce'
(user art ~/workspace/duel-assets/luce-user-20261105.jpg,
1024x1536 — the white-and-gold winged figure with the halo
spire and coin discs over a night sky). Plain CARD_ART
registration, no deck override; the Ishizu EXTRA deck runs
3 copies. Files generated with the standard top-anchored
procedure (JPEG q88 — byte-calibrated against the #18
delivery: full-width crop y0-1411 -> 640x882, 164KB; square
crop x0-1024 / y0-1024 -> 320x320, 39KB). Visual check of
both delivered files: the spire, the feathered wing, the
head and the sword all stay inside the frame; the cut is
bottom-only (lowest clouds), per the standing rule. Luce
is an Ishizu KEYCARD, so the summon cut-in stage and the
Keycard BGM tier now resolve this illustration through
cardArtFile/CARD_ART with no further wiring. test-cardart
gained the #19 entries (CA0y/z, CA7z39-42, CA31, CA11af/ag,
CA13p, CA16z2 — the fabricated-board asymmetry contract
included: an opponent face-down Luce gets NO art).
Knock-on: test-cardview's unlisted-EX exemplar WAS Luce
(CV4b fabricated her EX row as the bare placeholder); the
role passes to 《冥府の執行者 プルート》 37706769 (Ishizu
EX, still unlisted), same convention as the test-cardart
exemplar moves. Regression on this branch: test-cardart,
test-cardview, test-keycardact, test-bgm all pass.
Unmeasured, as ever: real-device WKWebView look and feel,
SE timing by ear.
## Neuron import guidance fix + URL import (2026-11-04 訂正)

CORRECTION of the Phase 1 section above. Its panel guidance told
users to pick 「テキスト表示」 on "the Neuron deck page". That
mode exists only on the official card-database WEBSITE's view
switcher; the Neuron APP — where users actually keep their
decks — has no such thing (the user's own screenshot of the
app's My Deck screen shows exactly four buttons: コピー / 画像
共有 / デッキコード / リスト保存, plus a comment field). The
Phase 1 text conflated the app with the website. All
「テキスト表示」 wording is removed from the panel, the parser's
error messages and the code comments.

Facts established this round (measured, not assumed):
- 「リスト保存」 in the app produces the official deck
  registration sheet as an IMAGE (大会提出用のデッキ登録シート;
  the user confirms it lands on the clipboard as an image). It
  is not text and the app cannot read it; the panel now says so
  in one line. OCR import was considered and rejected as the
  main route (quality).
- A Neuron share link (https://neuron.konami.net/link/<id>)
  behaves by user agent: mobile agents get a 535-byte app-launch
  stub (no deck data); desktop agents get a 302 to the matching
  www.db.yugioh-card.com member_deck page, whose HTML is the
  same structure the Phase 1 HTML parser already reads (the
  real link's page — "Alluring Heroines", dno=57 — parses to
  44/15/3 with zero unknown cids).
- CORS, measured in a real Chromium from the app's own origin
  (https://gm0231.github.io): neuron.konami.net ALSO sends no
  Access-Control-Allow-Origin (Phase 0 had only verified
  db.yugioh-card.com). Direct fetch from the app is impossible
  for both hosts; header checks agreed (no ACAO on link 200 /
  link 302 / member_deck 200 responses).
- The deck page copied as rendered text (select-all in a phone
  browser) has a stable shape in both locales: totals lines,
  section headers with counts, then per card an index line, the
  printed name, an optional restriction note and a bare-number
  count line; a detailed listing of the same deck follows. Real
  captures are frozen as fixtures (test-neuron-visual-fixture
  .txt = MILLENNIUM PROPHECY via deck code 2t9x91u;
  test-neuron-share-fixture.txt/.html = the share link above).
- The shared pages print most names in ENGLISH, with JA names
  for OCG-only cards, mixed on one page. genesys-data.json now
  carries name -> representative indexes for EVERY printing in
  JA and EN (indexJa 12,218 / indexEn 14,738; file grows
  0.80MB -> 1.73MB, still lazy-loaded only when the panel
  opens). A rep-level map was not enough: "Harpie Lady 1" is
  alias-merged onto "Harpie Lady" and exists only as a
  printing-level name. 656 representatives still have no JA
  name in any upstream dump (recent cards); three such printed
  names verified against real pages are supplemented in the
  generator (SUPPLEMENT_JA). A page containing an unsupple-
  mented one fails the visual import's totals cross-check with
  an explicit mismatch error — never a silently wrong deck —
  and the URL/HTML path (cid-based) is unaffected.

What shipped:
- URL import is now the primary flow (user spec: "URLを貼る
  だけで取り込めるように"): pasting a share link, a deck-page
  URL, or a bare 7-character deck code fetches the deck page
  (direct attempt, then public CORS relays in order:
  allorigins /raw, allorigins /get, codetabs, allorigins /raw
  once more; payloads are content-checked for link_value rows;
  a deck-search hop follows the embedded member_deck URL),
  parses, validates and AUTO-SAVES a Genesis-legal deck.
  Pasting the link/code into the field starts the flow by
  itself. A pasted HTML page is never mistaken for the URL
  flow (the URL route requires the input to be essentially
  just the URL). Total fetch failure shows why (CORS + relay
  situation) and points at the copy-paste fallback.
  DURABILITY CAVEAT: the fetch depends on free third-party
  relays (allorigins measured working end-to-end 2026-11-04 —
  the full member_deck HTML came back through it — but flaky:
  roughly one attempt in three from this network; corsproxy.io
  now requires an API key, cors.lol / cors.eu.org answered
  rate-limited). They can stop without notice; the paste paths
  below are the permanent fallback and are fully supported.
- Visual-text import: neuron.js parseVisualText reads the
  copied-page format (JA and EN, list and detailed blocks,
  stops before the second listing so nothing double-counts,
  cross-checks the page's own totals). Fixture tests prove the
  visual parse is card-for-card identical to the HTML parse on
  both real pages.
- Guidance rewritten around the real steps; a deck-code field
  with a "公式デッキページを開く" button was added for the
  fallback route (opens the official search page in the user's
  browser).
- The shared "Alluring Heroines" deck is the standing
  counterexample for verdict expectations: under the bundled
  list 202610 it is NOT Genesis-legal — its ハーピィ・レディ
  －華麗なる分身－ x3 and 香水戦術 x1 are first released in
  ORIGINAL ARTWORK COLLECTION on 2026-09-26, after the list's
  2026-03-01 cutoff — so the correct landing is "このデッキは
  使えません" naming both cards (51pt, otherwise legal; it
  also has 35 pool-unsupported cards). It becomes legal only
  when a later list edition moves the cutoff forward.

Tests: test-neuron extended (V1-V2e visual fixtures vs HTML
ground truth; U0-U3 URL helpers, stubbed relay flows incl.
two-hop code flow and total-failure honesty) — all pass.
test-neuron-url.js is the real-network Chromium E2E (real
share link + real deck code; retries the full flow per case
against relay flakiness). Measured outcome 2026-11-04: BOTH
cases passed in real-browser runs (share link on attempt 3 of
its run; deck code -> search -> member_deck -> auto-save on
attempt 1 of a later run), and both also failed whole runs
inside bad relay windows — from this VM the relays are
time-window dependent, which is exactly the durability caveat
above; the failure path shown to users in those windows is
the honest message, verified live. Shots:
shot-neuron-url-share.png / shot-neuron-url-code.png.
Frames: cap-neuron.js adds panel-guidance and import-visual
shots (390x620 / 390x700).

## 2026-11-04: classic Agido aliases the Ancient Guard art (user ruling)
- The user ruled that the art delivered for 《古衛兵アギド》 (62320425) is also used for the deck's classic 《アギド》 (16135253): CARD_ART gains `16135253: 'agido'` (same two files, no new assets). The entry for 62320425 stays for when that card returns to a deck.
- test-cardart / test-cardview: the unlisted-fallback exemplar moves from 16135253 to 《現世と冥界の逆転》 (17484499) — with the alias, no Ishizu main-deck monster remains unlisted. CA7c inverts (the agido art is now preloaded via the classic card's deck membership); CA7b2 pins the alias itself.

## 2026-11-04: URL import robustness round (relay re-measurement + failure classification)

Trigger: at 08:35 the user pasted a fresh share link on a real
iPhone and the whole chain failed with "デッキページを取得
できませんでした"; the parent's same-hour probes saw allorigins
408/522 and codetabs 522. The chain was rebuilt around measured
behaviour, not assumptions.

### Relay survey (real Chromium, page origin = the app's own
https://gm0231.github.io, fetches via this VM's egress,
2026-11-04 ~08:44-09:15 JST, per-attempt cap 30s in the survey)

Targets: the Mai share link, a member_deck URL, the private
share link wkmqz2oarqk3lcga, and https://example.com/ as a
control. Three runs over the share target, one over the rest.
This network was in a bad window for the whole survey (the
same window as the user's failure):

- direct: CORS neterror in ~0.6-1.1s on every target (expected;
  kept first so a future ACAO header just works).
- allorigins /raw: neterror ~6-21s on every probe (both deck
  hosts and the control). NOT one answer this window — but it
  delivered real deck pages earlier the same day (E2E passes
  above), so it stays as the lead relay.
- allorigins /get: same pattern as /raw (one 0.14s fast fail).
  Stays third: same service, different request shape.
- codetabs: neterror ~19.5-19.9s on every probe this window;
  delivered earlier the same day. Promoted above /get (no
  envelope round-trip).
- proxy.corsfix.com (both ?<url> and ?url= forms): the ONLY
  service that answered every probe, in 0.2-0.8s — with
  403 {"corsfix_error":"domain_not_registered"}: corsfix only
  serves origins registered with it. NOT adopted (unusable
  until gm0231.github.io is registered at corsfix — a free
  owner action; if done, adding
  `u => 'https://proxy.corsfix.com/?' + u` as route 2 is a
  one-line change and it was measurably the fastest responder).
- corsproxy.io (both forms): 401 "A valid API key is required"
  within ~0.03-6s. Not adoptable without a key. Excluded.
- api.cors.lol: fast neterror (0.2-1s) or 30s timeout; never
  answered (earlier round: rate-limited). Excluded.
- proxy.cors.eu.org: 30s timeout everywhere. Excluded.
- proxy.cors.sh: 30s timeout everywhere (needs a key in any
  case). Excluded. test.cors.workers.dev: fast neterror
  (dead). cors.bridged.cc: timeouts (dead).
  cors-proxy.htmldriven.com: neterror ~11s. yacdn.org/proxy:
  neterror ~1.3s. All excluded.
- The ~19.7s neterror pattern hit allorigins AND codetabs AND
  the control target alike, i.e. part of this window's failure
  sits in this VM's egress path, not only in the relays; the
  user's phone network is a different path. Numbers here are
  evidence for THIS network, stated as such.

### Chain design (client.js, neuronFetch*)
- Routes: direct -> allorigins /raw -> codetabs -> allorigins
  /get. 20s per attempt (was 25s), up to 2 rounds with a 3s
  pause, one 150s deadline shared across both hops (was: up to
  ~25s x 6 wraps x 2 hops with no progress and no rounds
  structure). Hop 2 still tries the route that answered hop 1
  first. The panel now shows progress: （中継経路 i/4・n回目）.
- Payload classification (neuronClassifyPayload): 'deck' /
  'searchlink' are success; 'page' = a real full HTML page that
  is not a deck (junk = error bodies, rate-limit notices, the
  app stub, empties — the chain keeps trying on junk). When two
  DIFFERENT routes return a 'page', the chain stops early:
  relays are couriers, two agreeing non-deck pages are
  conclusive about the link.
- Failure verdicts split by evidence:
  - reason 'notdeck' (a relay answered; the link did not lead
    to a deck): 「リンク先からデッキを取得できませんでした」
    + the private-deck explanation — a private deck cannot be
    imported; make it public in Neuron and paste again (it may
    be set back to private afterwards). The user's wkmqz link
    was confirmed private by the user, and resolves
    server-side to the Neuron top page.
  - reason 'noanswer' (nothing usable answered): the previous
    relay wording + paste fallback, unchanged.
- Panel guidance corrected twice: (1) a line now states only
  public decks can be imported; (2) the list-save note was
  wrong as written — the Neuron "リスト保存" copy is a
  composite clipboard (sheet IMAGE + "#遊戯王ニューロン" +
  share URL text); in the app's text field it pastes as text
  and imports as a link. The note now says exactly that (the
  sheet image itself is still unreadable).

### Tests
- test-neuron: U0f (composite list-save text extracts the URL
  verbatim), U1d (the composite text pasted as-is drives the
  full flow to auto-save), U4/U4b/U4c (relays answering with a
  landing page -> the not-a-deck verdict naming the private
  cause, no relay blame, nothing saved), U5 (classifier unit:
  deck / searchlink / page / junk). All pass, no regressions
  (N/V/U series complete).
- Regression: test-deckpage, test-layout all pass.
- test-neuron-url.js: Case C added (private link -> failure
  verdict; the kind — not-a-deck vs relay-down — is logged,
  and the private-cause wording is asserted whenever the
  not-a-deck verdict is reached; shot-neuron-url-private.png
  on that path). Run records are appended below as they land.

### E2E run records (test-neuron-url.js, real Chromium, new chain)
- Run 1 (2026-11-04, after this round's changes): ALL PASS.
  Case A (Mai share link): success on flow attempt 1 (44/15/3,
  51pt, cutoff verdict naming both cards). Case B (deck code
  2t9x91u): success on attempt 1, auto-saved. Case C (private
  link): verdict kind = not-a-deck — a relay answered with the
  Neuron landing page and the panel showed the private-deck
  wording (shot-neuron-url-private.png; the guidance lines for
  public-only import and the corrected list-save note are also
  visible in the same frame). One flow attempt now packs up to
  2 rounds x 4 routes per hop, so "attempt 1" is much denser
  than the old single-pass chain.
- Run 2 (2026-11-04, same morning): MIXED, recorded as-is.
  Case A FAILED all 3 flow tries — the final panel text was
  the honest relay-down message (nothing saved; the failure
  path did its job inside a bad relay window). Case B passed
  on attempt 1. Case C: the not-a-deck verdict text itself
  appeared in the attempt logs twice, but the harness's kind
  line misreported it as relay-down — a harness race: runFlow
  started a retry while the previous chain was still in
  flight, and concurrent flows overwrote each other's panel.
  Two fixes followed: (app) neuronDoParse gained a re-entry
  guard so a second paste/click mid-fetch cannot start a
  competing chain over the same panel; (harness) runFlow now
  hard-waits for the parse button to settle (> the 150s
  budget) before a retry and reads results after a settle
  pause. test-neuron re-verified after the guard (66 checks,
  all pass).
- Run 3 (2026-11-04, after the guard + harness settle-wait):
  ABORTED by hand during Case B. Case A failed all 3 tries in
  the bad window (final panel text was the honest relay-down
  verdict; nothing saved). Case A's failed tries also exposed
  a rig artifact: in the hidden headless page, Chrome's
  intensive timer throttling clamps setTimeout, inflating the
  app's abort timers so all-failure flows overran the harness
  marker waits — not app behaviour (a foreground phone app is
  never throttled, and the app's budget itself is Date.now()-
  based). The rig now launches with
  --disable-background-timer-throttling /
  --disable-backgrounding-occluded-windows /
  --disable-renderer-backgrounding so it measures the app.
- Run 4 (2026-11-04, throttling-free rig): ALL PASS. Case A
  on attempt 2 (attempt 1 outlasted the 200s marker wait in
  the still-bad window), Case B on attempt 1, Case C on
  attempt 1 with verdict kind = relay-down (no relay could
  deliver even the landing page in this run — the not-a-deck
  kind was proven in run 1 and in test-neuron U4). Summary
  across the round's four runs: the new chain lands the real
  imports whenever any relay answers at all, denser retries
  turned several would-be total failures into attempt-1/2
  successes, and in the worst windows the failure shown is
  the honest, correctly-classified one. The relays remain
  time-window dependent from this network; that durability
  caveat is unchanged and is stated in the panel itself.

## Select-purpose line (2026-11-05, user instruction: 効果でカードを選ぶ時に「何のために選ぶか」を簡単に)
- Ask: when an effect makes the player select cards, the sheet must
  say in plain words what the selection is FOR (e.g. reviving from
  the grave -> 「自分フィールドに特殊召喚するカードを選択」-class
  wording; banishing -> 「除外するカードを選択」), for every card,
  as an ADDED line — the existing effect context line stays.
- Where the purpose actually lives: not in SELECT_CARD (no purpose
  field on the wire) but in MSG_HINT. Scripts/procedures call
  Duel.Hint(HINT_SELECTMSG, player, value) right before selecting;
  GameState.apply dropped MSG_HINT entirely (default: break), so
  the declaration never reached the UI. Duel.run now taps it
  (Engine.parseHint), keeps the latest selectmsg value per player,
  and attaches it to that player's next prompt as
  prompt.selectHint, CONSUMED on any prompt dispatch for that
  player (a stale purpose would be a fabrication). Measured on
  the real core before adopting the rule (12 bot duels, every
  pairing): all 492 card-select prompts kept their own hint under
  consume-on-dispatch.
- Client: SELECT_HINT_PURPOSE maps the generic HINTMSG_* system
  ids (bundled constant.lua, values 500-579) mechanically to
  Japanese purpose sentences; gridSheet renders it as a .purpose
  line under the title, uiUnselect renders the same; uiSelectSum
  passes it through gridSheet. Fallbacks, in order: (a) the core
  hint via the table; (b) the BU-13 provable inference (hand-limit
  discard — already that sheet's title/sub, not duplicated);
  (c) nothing — the sheet renders exactly as before. Bare
  HINTMSG_SELECT (560), side labels (SELF/OPPO), raw card codes
  and aux.Stringid card-string ids prove no generic purpose and
  yield no line. Tribute / attack-target / hand-limit sheets
  suppress the line (their title/sub already states the purpose).
  The hint rides only the selecting player's own prompt object;
  nothing about the opponent is derived or displayed.
- Coverage census (counted, not sampled silently):
  static — 82 card-selection call sites across the 63 pool-card
  scripts: 80 declare a generic HINTMSG_* purpose (incl. 2 passed
  as the hint argument of aux.SelectUnselectGroup), 1 declares a
  card-specific string (メタバース 89208725, s.activate: its
  aux.Stringid hint names the card's own string, so no generic
  purpose is provable — that selection keeps the generic heading
  + context line), 1 is the no-hint condition-check invocation of
  the Dark Guardian summon procedure (s.spproccon; the actual
  selection invocation passes HINTMSG_TODECK). Global procedure
  scripts (fusion/synchro/xyz material) declare their own hints
  (511/512/513) and are covered by the same path.
  dynamic — 12 bot duels on the new engine, two samples:
  396/398 and 409/411 card-select prompts render a purpose line;
  the only unrendered case in both samples is メタバース 効果①
  above. Core-driven selections also gain purposes (attack target
  549, tribute 500). SELECT_SUM / SELECT_COUNTER prompts did not
  occur in the samples (counter selection is unreachable in this
  pool, cf. BU-13; ritual material flows through SELECT_UNSELECT).
- Pins: test-hintpurpose.js (parseHint layout; end-to-end plumbing
  vs an independent raw-stream simulation over 4 duels — 0
  mismatches, 112/112 card-selects with hint; jsdom rendering:
  line present/absent per hint kind, tribute suppression, context
  line preserved) + test-purpose.js H0-H20/D4/D5 (mapping wording,
  null fallbacks). Pre-existing flaky gates unrelated to this
  round: test-logdetail-ui D11/D12 and test-strot premise checks
  fail intermittently on unmodified main as well (trajectory
  depends on the crypto shuffle); both were observed failing and
  passing on pristine checkouts during this round.

## Selection-clarity round (2026-11-05, backlog BU-15/21/22/23/24/28; branch feat/selection-clarity-fixes, NOT merged)

Client-only display fixes for the confirmed selection/readability defects in the brushup backlog. No engine, protocol or BGM/SE changes; the secrecy guard is untouched.

- BU-15 (auto-pass chip overlapped the chain dock's dismissal buttons): `syncAutoPassChipPos()` — while the chain dock is open, #autopass rides directly above the dock (inline bottom = dock height + 6px); when the dock closes the inline bottom is dropped and the CSS home applies. Called from uiChain's draw, updateAutoPassChip and dockClose.
- BU-22 (peek hid the yes/no answer buttons): `#peekbar` — while a sheet is peeked, syncPeekBar mirrors its answer controls (bigbtn/optbtn/posbtn, never the view sheet's #sheet-cancel) into a bottom band; a mirror click calls the original control's click(), so handlers and disabled state are the sheet's own. The bar is cleared on sheetOpen/sheetClose and rebuilt on every peek toggle.
- BU-23 (no mandatory/optional marking): `gridReqNote()` derives the tag from the prompt's own terms — cancelable → （任意：選ばずにやめることもできます）, min 0 → （任意：0枚でも決定できます）, otherwise （必須） — appended to the grid sheet sub; uiUnselect gets the same derivation (the cancel-would-confirm middle case gets no tag rather than a lie). The declare grid says （必須）and carries `announceDupNote()`: the "same result" line fires ONLY when the pool literally repeats a code. Verified against data.json: all 63 pool codes have unique names and the pool is built from Object.keys, so the line never fires today — it is wired to the literal condition only.
- BU-21 (position sheet, wording only): the sub now states a tap commits immediately and cannot be undone （タップした表示形式で即確定し、取り消すことはできません). No protocol "back" was invented.
- BU-24 (resolving link weak on the chip row): the solving chip now also carries a 解決中 tag in words, and .link.solving's frame is thickened (box-shadow 0 0 0 2px gold + glow). Resolved links keep the existing .done dim + ✓.
- BU-28 (chain candidate effect line silently truncated): fxTruncated() flags the exact >28-char cut; when cut, the candidate's line appends （続きは「詳細」で読めます）, pointing at the existing 詳細 pop that already shows the full text without answering.

Verification: new test-clarity.js (34 checks, jsdom real boot) pins every item — chip geometry with a stubbed dock height, peek mirrors incl. disabled-state copy and an end-to-end yes/no answered from the band, grid sub tags (mandatory/cancelable), declare grid (real pool shows no dup line; synthetic repeat fires it), position wording, chainbar tags via render(), the BU-28 guide on a real SELECT_CHAIN dock. Related suites re-run green: test-ui, test-purpose, test-loghist, test-chainpass, test-oppinfo, test-facedown-select, test-cardview, test-fx, test-zolga, test-fxidentify, test-poolcov. A real-browser harness (local server, this branch) played Ishizu vs GG and screenshotted 10 scenes at phone size: dock-open chip geometry measured with zero overlap, all new texts visible in place; the yes/no peek band was additionally shot in a 430×760 viewport with both answers inside the band while peeked. WKWebView on a real device remains unmeasured, as always.

## Individual art #19b: Luce's Ishizu-only override (2026-11-05; branch feat/art19b-luce-ishizu, NOT merged)

《宵闇のルーチェ》 (45409943) gains the 7th DECK_ART entry: DECK_ART.ishizu[45409943] = 'luce-ishizu' (user art ~/workspace/duel-assets/luce-ishizu-user-20261105.jpg, 1024x1536 — the all-gold Egyptian form: golden wings, Eye-of-Horus shields, the pyramids and the Nile below). CARD_ART keeps the plain 'luce' (white wings) from the #19 delivery, so any non-Ishizu deck context resolves the white painting and only the Ishizu deck — the only deck that runs her — wears the gold form; resolution follows the owning seat's deck, as with the six earlier overrides. As an Ishizu keycard, her summon cut-in inside an Ishizu duel now resolves this art through the same cardArtFile path. Files generated with the standard top-anchored procedure (JPEG q88 — byte-calibrated against the #19 delivery: full-width crop y0-1411 -> 640x882, 193KB; square crop x0-1024 / y0-1024 -> 320x320, 47KB). Visual check of both delivered files (read as images): the spire, both golden wings, the helmeted head and the sword stay inside the frame; the cut is bottom-only (the lowest landscape), per the standing rule. test-cardart updated: the delivered-files list gains the pair; CA7z42 (was: NO override) is replaced by CA7z42-45 (registration, Ishizu small+big resolution, GG fallback, preload); the res13 board now expects the deck-scoped art on the Ishizu seat and the plain art under the GG context (CA11af/CA11ag/CA16z2); a flipped-seat fixture (CA32, CA11ah/ai, CA13q, CA14u, CA16z3/z4) pins the plain fallback and that an opponent face-down Luce in Ishizu context gets NO art. Regression on this branch: test-cardart, test-cardview, test-keycardact, test-bgm all pass. Unmeasured, as ever: real-device WKWebView look and feel, the cut-in on a real screen after merge.

## Art focus exceptions (2026-11-05; branch feat/art-focus-exceptions, NOT merged)

The wide BIG-art bands (.infoart detail sheet, .popart floating pop) paint the 640x882 file with background-size:cover pinned to 'center top', so a painting whose subject sits low in the frame shows only scenery in the band — confirmed on the live build for 《カオスポッド》: tiles / hand / resident preview read fine, but the detail band showed the shelf and canopic-jar tops with a red fragment of the pod at the bottom edge. The delivered FILES are not the problem (all 26 file crops re-verified OK the same morning; the chaospod SMALL file already carries its own +350 shift from the v2 swap).

User ruling (2026-11-05): the top-anchored rule stays the default; ONLY a painting whose subject is essentially absent from a top-only band crop may shift, that card only. Implementation: `ART_FOCUS` (slug -> background-position) in client.js, consulted by artCss/artApply via `artPosition()` for the BIG file only; slug resolution factored into `artSlug()` (cardArtFile behavior unchanged). Measured over all 26 registered arts by reproducing both bands from the delivered big files (sheet 390x280 = image y 0-52.1%, pop 390x180 = y 0-33.5%): exactly three qualify — chaospod 'center 85%' (the pod sits at y 55-85% of the frame), luce and luce-ishizu 'center 38%' (her head/torso sit at the sheet band's bottom edge and outside the pop band entirely). Borderline non-qualifiers, judged and recorded in the cropfix report: taiyou/tsuki (the book's emblem reads clearly inside the sheet band), sphinx, agido, hana. The SMALL file keeps 'center top' on every surface (its crop already reads fine everywhere; same measurement pass). Cut-in surfaces receive the value through artApply but it is a numerical no-op there: the bigcard box (242x334 at phone width) matches the 640x882 aspect to under a pixel of cover overflow, so no position can shift anything — no band-only branching was added. Secrecy guard untouched.

Evidence: before/after band reproductions (sheet size) for the three slugs in ~/workspace/goals/simple-phone-duel-app/hidden_files/cropfix/ (<slug>-band-before.jpg / -band-after.jpg), plus the full 26-slug judgment table appended to that folder's report.md; pop-size framing for the three was verified in the same pass (pod fills the band; Luce's figure centered). Tests (jsdom env rebuilt at /tmp/jsdomtest, real runs, no SKIP): test-cardart ALL CARDART CHECKS PASSED (new CAF1-CAF10 pin the table, artCss/artApply agreement, small-file and non-exception invariance, unlisted default); test-cardview ALL PASS (new CV15/CV15b/CV16/CV17 pin the real .infoart/.popart positions); regression test-fx ALL FX CHECKS PASSED, test-keycardact ALL PASS. Unmeasured: live-build play and real-device WKWebView (post-merge supervised check).

## Individual art #20: Minerva, Lightsworn Saint (2026-11-05; branch feat/art20-minerva, NOT merged)

《ライトロード・セイント ミネルバ》 (30100551) -> 'minerva' in CARD_ART (user art ~/workspace/duel-assets/minerva-user-20261105.jpg, 1024x1536 — the winged saint enthroned in a cathedral of light, her owl on her left hand). A plain registration: NO deck-scoped override (the Ishizu deck is the only deck that runs her — x2 in the v11 EXTRA deck — and every context resolves the same painting) and NOT a keycard. Files generated with the standard top-anchored procedure (JPEG q88 — generation byte-calibrated against the #19 delivery first: luce regenerated to exactly 163,725 / 39,199 bytes; then full-width crop y0-1411 -> 640x882, 202KB; square crop x0-1024 / y0-1024 -> 320x320, 43KB). Visual check of both delivered files (read as images): hood and face, both wings, the owl and the staff all stay inside the frame; the cut is bottom-only (the pedestal base), per the standing rule.

Band focus check (mandatory this round): her face sits at ~43% of the frame, so the bands were reproduced from the delivered big file before deciding. Sheet band (390x280, center top = image y 0-52.1%): her face IS inside the band but pinned to its bottom edge, under a band mostly filled with dome, light rays and banner. Pop band (390x180, center top = y 0-33.5%): the subject is ENTIRELY absent — dome, light rays, banner and pillar tops only, exactly the state the 2026-11-05 exception clause exists for. She therefore becomes the 4th ART_FOCUS entry: minerva 'center 40%', which centers her face in the pop band and seats face and torso mid-band in the sheet band. Before/after reproductions for both band sizes are in ~/workspace/goals/simple-phone-duel-app/hidden_files/cropfix/ (minerva-band-{sheet,pop}-{before,after}.jpg), all four read as images in this round.

Tests updated: test-cardart — delivered-files list gains the pair; CA0z2/CA0z3 pin the v11 EX membership (x2) and GG absence; CA7z46-49 pin registration, file resolution, preload and the absence of a deck override; CAF1 now pins exactly FOUR focus entries; CAF11-13 pin Minerva's artCss/artApply positions (big 'center 40%', small 'center top'); a res15 board fixture (CA33, CA11aj/CA11ak, CA13r, CA16z5) pins own/opponent face-up art and that an opponent FACE-DOWN Minerva gets NO art. test-cardview — CV18/CV18b/CV19 pin the real .infoart/.popart bands (big file, 'center 40%'). Unmeasured, as ever: merged live-build play and real-device WKWebView.

## Individual art #20b: Minerva painting replaced with v2 (2026-11-05; branch feat/art20b-minerva-v2, NOT merged)

The user replaced the #20 painting the same day ("やっぱこっちにして"): new source ~/workspace/duel-assets/minerva-user-20261105-v2.jpg (1024x1536 — the saint FLOATING in the cathedral, owl on her left hand, face at ~1/4 of the frame instead of ~43%). CARD_ART registration unchanged (30100551 -> 'minerva', no deck override, not a keycard). Both delivered files regenerated with the identical standard procedure (generation byte-calibrated against the v1 delivery first: v1 minerva regenerated to exactly 202,115 / 43,119 bytes with LANCZOS; then full-width crop y0-1411 -> 640x882, 202,796 bytes; square crop x0-1024 / y0-1024 -> 320x320, 45,919 bytes). Visual check of both delivered files (read as images): hood and face, both wings, the owl and the staff all stay inside the frame; the cut is bottom-only (altar candles / floor), per the standing rule.

Band focus RE-measured on the v2 painting (mandatory, since ART_FOCUS 'center 40%' was a v1-composition value): bands reproduced from the NEW delivered big file at sheet 390x280 and pop 390x180, each at center top / center 20% / center 40%, all six read as images (cropfix/minerva2-band-{sheet,pop}-{top,20,40}.jpg). Face landmarks on the v2 frame (of big-file height): hood top ~16%, eyes ~29%, mouth ~33%, chin ~35%. Findings: center top — sheet band fine (face inside, upper area), but the pop band pins the face to its bottom edge with the chin clipped (window 0-33.5% vs chin at ~35%); center 40% — pop band cuts the face off at the eyes (window starts at 26.6%); center 20% — BOTH bands center the complete face (pop window 13.3-46.8%, sheet window 9.6-61.7%; hood, face, owl and chest gem all inside). Verdict: ART_FOCUS minerva 'center 40%' -> 'center 20%'. The exception itself stays (center top does not suffice for the pop band); the entry count is unchanged at four.

Tests updated: test-cardart — header notes and CAF1 / CAF11 / CAF13 now pin 'center 20%'; test-cardview — MINERVA note and CV18b / CV19 now pin 'center 20%' with the v2 rationale. Both suites re-run green. Unmeasured, as ever: merged live-build play and real-device WKWebView.

## Individual art #20c: Minerva's Ishizu-only override (2026-11-05; branch feat/art20c-minerva-ishizu, NOT merged)

《ライトロード・セイント ミネルバ》 (30100551) gains the 8th DECK_ART entry: DECK_ART.ishizu[30100551] = 'minerva-ishizu' (user art ~/workspace/duel-assets/minerva-ishizu-user-20261105.jpg, 1024x1536 — the Egyptian temple variant: blue-and-gold feathered wings, hieroglyph pillars, the same owl on her hand). CARD_ART keeps the plain 'minerva' (the floating cathedral painting from the #20/#20b deliveries), so any non-Ishizu deck context resolves the cathedral painting and only the Ishizu deck — the only deck that runs her — wears the Egyptian form; resolution follows the owning seat's deck, as with the seven earlier overrides. She is not a keycard, so no cut-in or BGM surface keys off this entry. Files generated with the standard top-anchored procedure (JPEG q88 — generation byte-calibrated first against two committed deliveries: minerva regenerated to exactly 202,796 / 45,919 bytes and luce-ishizu to exactly 192,533 / 46,823 bytes; then full-width crop y0-1411 -> 640x882, 246,720 bytes; square crop x0-1024 / y0-1024 -> 320x320, 50,924 bytes). Visual check of both delivered files (read as images): hood and face, both blue-and-gold wings, the owl and the staff all stay inside the frame; the cut is bottom-only (the temple floor), per the standing rule.

Band focus check (mandatory, slug-keyed): bands reproduced from the NEW delivered big file at sheet 390x280 and pop 390x180, each at center top and center 20%, all four read as images (cropfix/minerva-ishizu-band-{sheet,pop}-{top,20}.jpg). Face landmarks sit at the same height as the v2 plain painting (eyes ~29% of the big file). Findings: center top — sheet band fine (face inside), but the pop band (window y 0-33.5%) pins her face to its bottom edge with the mouth and chin outside it — the exception-clause state; center 20% — BOTH bands center face, torso and owl (pop window 13.3-46.8%, sheet window 9.6-61.7%). Verdict: the variant becomes the 5th ART_FOCUS entry, 'minerva-ishizu': 'center 20%' — the same value as the plain painting, judged and recorded separately.

Tests updated: test-cardart — delivered-files list gains the pair; CA7z49 (was: NO override) is replaced by CA7z50-53 (registration as 8th entry, Ishizu small+big resolution, GG fallback, preload); CAF1 now pins exactly FIVE focus entries; new CAF14-17 pin the variant's artCss/artApply positions (Ishizu big 'center 20%', GG big keeps plain art at 'center 20%', variant small 'center top', artApply agreement); the res15 board now expects the deck-scoped art on the Ishizu seat and the plain art under the GG context (CA11aj/CA11ak/CA16z5), with the opponent FACE-DOWN Minerva still getting NO art (CA13r). test-cardview — CV18/CV18b now pin the deck-scoped BIG file at 'center 20%' on the real .infoart band; new CV19/CV19b pin the same on the .popart band. Regression on this branch: test-cardart, test-cardview, test-keycardact, test-bgm, test-fx all pass (real jsdom runs, no SKIP). Unmeasured, as ever: real-device WKWebView look and feel after merge.

## Individual art #21: Castel, the Skyblaster Musketeer (2026-11-06; branch feat/art21-castel, NOT merged)

《鳥銃士カステル》 (82633039) -> 'castel' in CARD_ART (user art ~/workspace/duel-assets/castel-user-20261106.jpg, 1024x1536 — the purple-winged bird musketeer diving over the canyon, rifle in hand). A plain registration: NO deck-scoped override (the Ishizu deck is the only deck that runs him — x3 in the v11 EXTRA deck — and every context resolves the same painting) and NOT a keycard. Files generated with the standard top-anchored procedure (JPEG q88, LANCZOS — generation byte-calibrated against three committed deliveries first: minerva 202,796 / 45,919, luce-ishizu 192,533 / 46,823, minerva-ishizu 246,720 / 50,924, all exact; then full-width crop y0-1411 -> 640x882, 202,449 bytes; square crop x0-1024 / y0-1024 -> 320x320, 45,427 bytes). Visual check of both delivered files (read as images): the crested head and helmet, both purple wings, the rifle and the talons all stay inside the frame; the cut is bottom-only (canyon mist), per the standing rule.

Band focus check (mandatory this round): his head sits HIGH in the frame (of big-file height: crest ~12%, eyes ~26%, beak ~29-33%), unlike the low-seated subjects that qualified before. Bands reproduced from the delivered big file at center top and read as images (cropfix/castel-band-{sheet,pop}-top.jpg). Sheet band (390x280, center top = image y 0-52.1%): the full head, face and torso sit inside. Pop band (390x180, center top = y 0-33.5%): crest, helmet, eye and beak all inside — the head reads clearly. Verdict: NO ART_FOCUS entry for castel; the exception clause ("subject essentially absent from a top-only band") is not met, and ART_FOCUS stays at exactly five entries.

Tests updated: test-cardart — header gains the 21st-delivery note; delivered-files list gains the pair; CA0z4/CA0z5 pin the v11 EX membership (x3) and GG absence; CA7z54-57 pin registration, file resolution, preload and the absence of a deck override; CAF18/CAF19 pin that his artCss/artApply positions stay 'center top' (big and small) after the band measurement; a res16 board fixture (CA34, CA11al/CA11am, CA13s, CA16z6) pins own/opponent face-up art and that an opponent FACE-DOWN Castel gets NO art. test-cardview unchanged (no band-position surface changes; its Castel-free fixtures are unaffected) and re-run as regression. Unmeasured, as ever: merged live-build play and real-device WKWebView.

## Individual art #21b: Castel's Ishizu-only override (2026-11-06; branch feat/art21b-castel-ishizu, NOT merged)

《鳥銃士カステル》 (82633039) gains the 9th DECK_ART entry: DECK_ART.ishizu[82633039] = 'castel-ishizu' (user art ~/workspace/duel-assets/castel-ishizu-user-20261106.jpg, 1024x1536 — the Egyptian variant: nemes headdress and gold-and-blue regalia on the same purple-winged musketeer, the Nile and pyramids below). CARD_ART keeps the plain 'castel' (the canyon painting from the #21 delivery), so any non-Ishizu deck context resolves the canyon painting and only the Ishizu deck — the only deck that runs him — wears the Egyptian form; resolution follows the owning seat's deck, as with the eight earlier overrides. He is not a keycard, so no cut-in or BGM surface keys off this entry. Files generated with the standard top-anchored procedure (JPEG q88, LANCZOS — generation byte-calibrated first against four committed deliveries: castel regenerated to exactly 202,449 / 45,427 bytes and minerva-ishizu to exactly 246,720 / 50,924 bytes; then full-width crop y0-1411 -> 640x882, 250,266 bytes; square crop x0-1024 / y0-1024 -> 320x320, 53,722 bytes). Visual check of both delivered files (read as images): the crested head and headdress, both purple wings, the rifle and the talons all stay inside the frame; the cut is bottom-only (the Nile shore), per the standing rule.

Band focus check (mandatory, slug-keyed): bands reproduced from the NEW delivered big file at sheet 390x280 and pop 390x180, each at center top and center 20%, all four read as images (cropfix/castel-ishizu-band-{sheet,pop}-{top,20}.jpg). The Egyptian painting seats his face LOWER than the plain painting: the tall nemes headdress pushes face and beak to ~29-37% of the big file (plain painting: eyes ~26%, beak ~29-33%, and the whole head reads inside the pop band). Findings: center top — sheet band fine (full head, face and torso inside), but the pop band (window y 0-33.4%) cuts the face at its bottom edge with the beak outside it — the exception-clause state; center 20% — BOTH bands seat the whole head mid-band (pop window 13.3-46.7%, sheet window 9.6-61.7%; crest, headdress, face, beak and rifle all inside). Verdict: the variant becomes the 6th ART_FOCUS entry, 'castel-ishizu': 'center 20%' — judged and recorded separately from the plain painting, which keeps NO exception.

Tests updated: test-cardart — header notes gain the #21b follow-up in both the focus-exceptions and DECK_ART-entry narratives and the 21st-delivery paragraph; delivered-files list gains the pair; CA7z57 (was: NO override) is replaced by CA7z57-60 (registration as 9th entry, Ishizu small+big resolution, GG fallback to the plain art, preload); CAF1 now pins exactly SIX focus entries; CAF18/CAF19 re-labelled to pin the PLAIN painting at 'center top', and new CAF20-23 pin the variant's artCss/artApply positions (Ishizu big 'center 20%', GG big keeps plain art at 'center top', variant small 'center top', artApply agreement); the res16 board now expects the deck-scoped art on the Ishizu seat and the plain art under the GG context (CA11al/CA11am/CA16z6), with the opponent FACE-DOWN Castel still getting NO art (CA13s). test-cardview — header and constant notes updated; new CV20/CV20b pin the deck-scoped BIG file at 'center 20%' on the real .infoart band, and CV21/CV21b pin the same on the .popart band. Unmeasured, as ever: merged live-build play and real-device WKWebView.
