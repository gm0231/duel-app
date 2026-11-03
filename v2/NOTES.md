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
