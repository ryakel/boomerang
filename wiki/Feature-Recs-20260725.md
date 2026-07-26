# Feature Recs 20260725

Ten feature recommendations from a full-codebase research pass (task/data layer, Quokka, notifications/integrations, client + every recorded backlog ledger). Organizing insight: a large amount of finished server infrastructure is currently dark — built, merged, validated, and called by nothing. Most of these recommendations light up existing machinery rather than adding new surface area.

Each rec lists what exists already (with file references), the build sketch, and rough effort. Batch 1 was delivered first; batch 2 followed from the same research.

---

## Batch 1

### 1. Light up "Pick Three" — the morning commit ritual

**The gap.** Migration 046 shipped a complete intentional-commitment model — `committed_on` with a 3-task ceiling, `intention_when`/`intention_where`, `first_step`, verb endpoints `/commit` `/uncommit` `/shrink` `/shelve` `/unshelve` `/let-go`, and `GET /api/today` — and nothing calls any of it. `POST /api/tasks/:id/commit` has zero callers across `src/`, `ios/`, and `scripts/`. The digest's headline sections (commitment sentences, ten-minutes nudge, invite line) are unreachable — it permanently runs its fallback path (`digestBuilder.js:131-142`, `threeMode = 'today' | 'empty'`).

**The feature.** A Kept-native morning flow on the Today view: an empty three-slot rail under the Day Arc → pick sheet fed by `todayPayload()` (`server/taskModel.js:112`) → committing asks the two implementation-intention questions ("when?" "where?") and offers an AI-drafted `first_step` (≤140 chars, the shrink-it cap). `/shelve` and `/let-go` become swipe actions on the pool so triage finally has a UI. Extend Quokka with the verbs at the same time (explicitly not-yet-done, `wiki/Claude-Notes-Features.md:213`) so "commit the dentist thing for tomorrow morning at my desk" works conversationally.

**Why #1.** Implementation intentions are one of the few interventions with strong evidence for ADHD follow-through; the digest was *designed around* this flow; ~80% of the work (model, validation, ceiling, digest rendering) is already merged. Mostly UI + Quokka tool schemas.

**Effort:** M–L (client UI + Quokka tools; server done).

### 2. Calendar-aware capacity — make Today time-real

**The gap.** GCal events are fetched (`server.js:2203-2237`) but consumed only by `useGCalSync.js` to mint tasks — and it reads only `start`, discarding `end`. `digestBuilder.js` imports nothing calendar-related; What Now knows the weather and growth areas but not that the day is meeting-walled until 3pm.

**The feature.** A small server-side event snapshot for today/tomorrow (an `app_data` cache like `weather_cache`, refreshed on the existing OAuth token), then three fold-ins:
- a "your day" line in the digest ("3 events, first at 9:30, ~2.5h actually free");
- free-hours math in `/api/today`, making Pick Three honest — committing three L tasks on a five-meeting day gets a gentle callout using the existing size→duration mapping;
- event context in the What Now prompt so "a couple hours" picks respect the 45 minutes before the next call.

**Why.** Time blindness is the ADHD failure mode the app doesn't touch yet. The backlog lists "workload balancing across the week" as long-term advanced AI — this is the 20%-effort version that needs no new AI, just data already fetched and discarded.

**Effort:** M.

### 3. "Throw a photo at it" — Quokka vision capture

**The gap.** Explicitly parked (`wiki/Claude-Notes-Quokka.md:91`): no way to hand Quokka a PDF/image and get staged tasks. Every piece exists: `extractAttachmentText()` in `src/api.js`, the vision-capable `/api/messages` path (OCR + research already use it), Quokka's staged-execution/preview/rollback machinery, the ThrowSheet capture surface, and the Share Extension's `POST /api/intake`.

**The feature.** Add photo/file to the Throw sheet and the Quokka composer. A snapped school flyer, appointment letter, bill, or whiteboard becomes a staged plan — tasks with inferred due dates and sizes, maybe a package or a GCal event — approved as one unit. Shared PDFs from Mail/Safari ride the existing intake path.

**Why.** Paper is where ADHD tasks go to die; "point phone at the mail pile" is the highest-wow capture upgrade available, and staged approval means the AI never mutates anything unreviewed. It's plumbing between four systems that already exist.

**Effort:** M.

### 4. Gmail-aware escalation ladders — "looks like they replied"

**The gap.** Parked in `wiki/Escalation-Ladder.md:96`: no auto-detection of outbound attempts, no inbound success detection. Ladders exist for exactly the tasks (confrontation/errand, avoidance-boosted) where manual bookkeeping is least likely to happen — and Gmail sync already fetches, junk-filters, and AI-classifies inbox mail every 5 minutes (`server/gmailSync.js`).

**The feature.** Ladders optionally carry a contact (email/name, often extractable from the task title or rung script). The Gmail classifier gains one cheap check against active ladders: an inbound match surfaces "Looks like Comcast replied — resolve the ladder?" as a pending action (reusing the `gmail_pending` Keep/Dismiss pattern), and a second `in:sent` query (same `gmail.readonly` scope) lets sent mail auto-log an attempt via the existing `log_escalation_attempt` path — points and streak credit included, no ping needed.

**Why.** Closes the loop on the app's most anxiety-shaped feature. Today the ladder nags but can't see the thing was already done — precisely the interaction that trains a user to ignore it. Fits the notification philosophy: this mostly *removes* nags.

**Effort:** M.

### 5. Geofenced errand recall — deliver on `location_json`

**The gap.** Migration 046 also shipped `location_json` — `{lat, lng, radius_m 50-1000, label, trigger: arrive|leave}` — validated (`taskModel.js:170-193`), stored, filterable via `?has_location=true` (`server.js:741`), and completely dead: no UI, no iOS code, no delivery. `geocode_location` already exists as a Quokka tool (`adviserToolsMisc.js:310`).

**The feature.** A location picker in the task editor (geocode endpoint exists), native CLLocationManager region monitoring in the Capacitor shell (iOS allows 20 regions — sync the nearest N located tasks into BoomerangKit via the App Group), and a **local** notification on arrive/leave: "You're near Home Depot — *return the light switch* is waiting." Local delivery means nothing touches the server send paths or the dev muzzle.

**Why.** "Errand" is one of the two `AVOIDANCE_ENERGY_TYPES` (`src/store.js:224`) — the scoring engine already knows these are the dodged tasks, and context-triggered recall is the one delivery mechanism that beats out-of-sight-out-of-mind. It's also the rare *new* ping aligned with the Great Alert Deletion: it fires only when action is possible in the next five minutes. Caveat: needs a Mac build session, like the rest of the queued Swift work.

**Effort:** M native + S web.

---

## Batch 2

### 6. The Ten-Minute timer — light up `timer`

**The gap.** `todayPayload()` ships `timer: null` as an explicit forward-shape placeholder — "no timer feature exists yet" (`taskModel.js:110-111`). The digest's ten-minutes nudge (`digestBuilder.js:162-166`) is the spec's stand-in for the timer condition: it rotates daily through committed tasks with a `first_step` and asks for ten minutes — but tapping it starts nothing.

**The feature.** A full-screen, deliberately boring focus timer on the Today view: pick (or arrive via the digest deep link at) a task, and it shows only the `first_step` and a ten-minute countdown. Completion offers *done / kept going / not today*; "kept going" starts an untimed session. Credit flows through existing rails — projects via `log_project_session`, plain tasks via a small timed-session field on the task (stamp durable evidence the same way `completion_days` does). Populate `timer` in `/api/today` so the watch/widget shape is real when those land.

**Why.** Task initiation is *the* ADHD bottleneck and "just ten minutes on the first step" is the canonical unlock — the digest already makes the promise; this makes it a button. Also the natural companion to Pick Three (rec 1): commit → shrink → start.

**Effort:** M.

### 7. Home & Lock Screen widgets over `/api/today`

**The gap.** Widget support is the one open item in the mobile-native backlog (`wiki/UPCOMING_FEATURES.md`, long-term §9). `GET /api/today` was built as a client-shaped payload with no consumer; grep across `ios/` finds zero WidgetKit/ActivityKit code. BoomerangKit (merged 2026-07-26) already gives extensions shared Keychain credentials — the exact prerequisite a widget process needs.

**The feature.** A WidgetKit extension in BoomerangKit's orbit: small widget = Day Arc ring + committed count; medium = the three commitments with checkmarks; Lock Screen accessory = streak + next commitment. Timeline provider reads a snapshot the app writes to the App Group on every sync (widgets shouldn't hit the network on their own schedule), refreshed opportunistically via `SharedCredentials.bestToken` + `/api/today`. Interactive completion via an AppIntent button — which forces building the task-title `AppEntity` + `EntityQuery` that the entire queued Siri expansion (complete-a-task, snooze, today summary — `UPCOMING_FEATURES.md` §50-69) is blocked on. One investment unblocks two backlog tracks.

**Why.** The home screen is the highest-frequency glance surface an ADHD tool can occupy — seeing the three commitments without opening the app is the point of having three. Caveat: Mac build session required.

**Effort:** M–L native.

### 8. The Suggestions Inbox — one triage surface for everything the app wants to ask

**The gap.** The app generates review-shaped items in five disconnected places: Gmail pending tasks/packages sit *inside the main list* (moving them out is parked — `wiki/Claude-Notes-Integrations.md:365`); routine `pattern_suggestions` live in a modal behind the system menu; weekly `tag_suggestions` in another; `spawn_mode: 'prompt'` (loop asks "spawn today?" with Add/Skip) is designed but unbuilt (`server.js:3622`, `wiki/Activity-Prompts.md:311`); and `capture_source` was added so voice-captured items could be called out for triage — nothing reads it (`server.js:368`). Bonus: the Gmail classifier's required `reason` field — documented as "the user's only window into the AI's reasoning" — is logged to console and dropped (`gmailSync.js:314`, `db.js:1861`).

**The feature.** One Kept-native Inbox (More row + a badge on Today when non-empty): every card is a question with two-tap answers — Gmail keeps (showing the classifier's `reason`, persisted at last), pattern/tag suggestions, prompt-mode loop spawns, and a "captured on the go" section for recent `capture_source: siri|shortcut` items that landed dateless and sizeless. Accept/dismiss routes to the existing per-type endpoints; nothing new server-side except the `reason` column and the prompt-mode spawn path.

**Why.** Scattered review queues silently rot — which is why gmail-pending items currently squat in the main list. ADHD-wise, batching all low-stakes decisions into one two-minute surface is far cheaper than ambushing them across five. This consolidates four parked backlog items into one coherent feature.

**Effort:** M.

### 9. Stuck-task radar — reactive interventions instead of weekly pings

**The gap.** The signals for "this task is stuck" are all persisted and almost none are acted on: `snooze_count` (reframe threshold exists), `boomerang_count` / `last_boomeranged_at` (tracked, deliberately never shown as shame), `staleness_days`, avoidance-boosted energy types, DIY verdicts that never re-run, and the escalation ladder's stuck flag. The parked list is explicit: reactive ladder creation ("the avoidance-boost logic already flags stuck confrontation/errand tasks — the hook exists, the surface doesn't", `wiki/Escalation-Ladder.md:96`), and "you always snooze this type of task" pattern recognition (`UPCOMING_FEATURES.md` §39-43). A weekly pattern review *does* exist but only as a Pushover ping seeding a Quokka chat (`server.js:4606-4685`).

**The feature.** A weekly server-side radar pass (piggybacking the existing Sunday scan cadence) that classifies stuck tasks by signal shape and attaches a *specific* offer, surfaced as Inbox cards (rec 8) or a Today banner — never a new notification: snoozed 3+ → reframe or shelve; boomeranged repeatedly with no `first_step` → shrink it (AI-drafted); stuck confrontation/errand → "want a ladder?" (pre-drafted via the existing `generate_escalation_ladder`); repair-shaped and stale → re-run the DIY check with a "hire it out" nudge. Each card deep-links into the existing flow rather than inventing new ones. While in that code: the weekly review is the one background send that skips `notifsMuzzled` and uses server-local time instead of `userTime.js` (`server.js:4611`, started outside the muzzle branch at `:4915`) — fix both.

**Why.** This is the difference between an app that *records* avoidance and one that *interrupts* it. Every intervention offered already exists as a flow — the radar just routes the right task to the right door, quietly.

**Effort:** M.

### 10. The Flight Log — week wrap + achievements expansion

**The gap.** A pile of earned, durable, or computable signals has no reflective surface: `computeRecords()` bests, 24 badges with rich derived signals (`src/badges.js` — phoenix, dragons slain, dawn/night catches, balanced weeks), escalation attempt logs (append-only, surfaced only as a count), project session logs (no frequency view), notification engagement analytics collected with **zero UI consumers** (`getNotificationAnalytics()` at `src/api.js:1430`, no call sites), and the achievements expansion backlog where the recorded instruction was "be really creative" — twenty named achievements already listed (`wiki/Kept-Design-Language.md:434` §13c). Two polished viz components — `MonthDots`, `DensityRibbon` — sit dormant in the never-shipped `kept-viz-preview.jsx`.

**The feature.** An in-app weekly "Flight Log" (Kept-native, reachable from More/Analytics; optionally one quiet line in the existing Monday digest, which already has a Monday-only section): the week's arc rendered with the dormant DensityRibbon/MonthDots, records touched, boomerangs *survived* (count framed as resilience, honoring the no-shame rule), ladders climbed, and newly earned achievements — implementing §13c's tiering + hidden-until-earned mechanics. Everything user-visible gets stamped durable at observation time (`settings.badges_earned` pattern), per the derived-stat durability rules (`wiki/Claude-Notes-Platform.md:5-11`).

**Why.** ADHD time-blindness erases wins as fast as tasks — a weekly artifact that says "you did in fact do things" is the retention loop the daily streak can't provide alone. No new notifications, no new data collection; it's a rendering pass over evidence the app already keeps.

**Effort:** M.

---

## Sequencing note

Recs 1 → 6 → 7 form a spine (commit ritual → starter timer → glance surface) that turns the dormant task-model layer into the product's centerpiece; 8 → 9 pair naturally (radar cards land in the Inbox); 2–5 and 10 are independent.

## Appendix — incidental findings from the research pass

Bugs/drift noticed while mapping, not features:

- **Weekly pattern review ignores the dev muzzle and user timezone** — `startWeeklyPatternReview()` is called outside the `notifsMuzzled` branch (`server.js:4915`) and gates on server-local `now.getHours()` (`server.js:4611`) instead of `userTime.js`. Also, `wiki/Claude-Notes-Notifications.md:206` still lists it under "Considered But Not Yet Built."
- **`out_for_delivery` package pings have no per-type toggle** in any channel — delivered/exception/signature are gated, out-for-delivery dispatches unconditionally (`pushNotifications.js:376-378`, `emailNotifications.js:339-341`, `pushoverNotifications.js:444-446` vs `server.js:2745-2750`).
- **Client/server scoring divergence** — `db.js` `calcPoints()` (:1250) omits the assignee flat-1 rule and `stack_bonus`; the server streak in `getAnalytics()` (:1308-1338) omits sessions/waiting/escalations/`completion_days` that `store.js` `computeStreak()` credits.
- **AI-assisted search is untracked** — both branches (`server.js:1163-1244`) call Anthropic directly and never `logAiUsage`, so it's invisible in the AI usage dashboard.
- **Quokka wiki/tool drift** — `notion_search`/`notion_get_page` are documented but never registered (only 3 Notion tools exist), and `adviserToolsIntegrations.js:273` still tells the model to reference `notion_search`; tool counts in `wiki/Claude-Notes-Quokka.md` are stale (actual: 87).
- **`staleness_days` default mismatch** — `2` in `store.js:19`/`db.js:220` vs the Settings input's `?? 7` fallback (`SettingsModal.jsx:3118`).
- **Hourly weather is fetched and discarded** — `fetchForecast` requests hourly fields (`weatherSync.js:103`) but `normalizeForecast` never copies them into the cache; `sunrise`/`sunset`/`wind_gust_max` are cached and read by nothing.
- **`src/wallaby-preview.jsx` is broken dead code** — it imports from `src/wallaby/`, which no longer exists.
