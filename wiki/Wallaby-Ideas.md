# Wallaby — Running Ideas & Backlog

Living catalog of everything observed in the loggd.life reference (screenshots +
PDFs, 2026-06-06), mapped to Boomerang. **Current phase = reskin only.** Net-new
features are parked here until the reskin lands. Add to this list freely; don't
delete — strike through or mark `DROPPED` instead.

**Legend:** ✅ done · 🔧 in progress · ⬜ reskin todo · 🅿️ deferred (new feature) · ❓ needs decision

**Reference assets:** the `wallaby-reference/` folder of loggd PDFs/screenshots
was **deleted at the 2026-06-07 prod promotion** (external assets must not ship).
Recover from git history (`git log -- wiki/wallaby-reference`) if needed.

> **Cross-cutting principle (2026-06-06):** the deferred net-new features are
> **theme-agnostic** — when built they live in the **shared app layer** and work
> in **every skin** (Standard / Terminal / Wallaby), *not* Wallaby-only. Wallaby
> just restyles them. (User: "it should be around for all skins.") This is also
> the **fork line**: each of these needs new data/schema/endpoints, so building
> any of them takes us past "reskin." Flag before crossing.

---

## Review pass 2026-06-07 (open — paused, do NOT lose)

Reference shots: `wallaby-reference/feature-requests-2026-06-07/` (deleted at the prod promotion — see git history).

1. ✅ **Edit-task modal redesign — DONE (2026-06-07).** New `src/v2/wallaby/WallabyEditTask.{jsx,css}` — loggd chip language: large title + "Add details or notes…" + "+ Add subtask…" + config **chips with carets** (Status · Due · Priority · Energy[+drain] · Size · Tags) that expand inline pickers, "More options" + Delete footer. Reuses `useTaskForm` + the same partial-save autosave contract (no clobber). Rendered by `AppV2` for regular tasks in Wallaby mobile (`useWallabyEditor`); projects/subs and **More options** fall back to the full `EditTaskModal` (which still owns gcal/knowledge/project-link/follow-ups/attachments/research/weather/wake-me). Verified: chips, energy picker, autosave persistence.
2. ⬜ **Streaks in Today's Pulse — NEW, easy.** loggd ("04") shows "🔥 Read 20 pages streak at risk! (**9 days**)" — the at-risk row names the habit AND shows the streak length. Extend the existing `atRisk` row in `HomeView` to include each habit's current streak count (already computed via `currentStreak(byDay)`), and lead with the longest at-risk streak.
3. ⬜ **Header avatar → ↗ arrow — easy.** The plain gradient avatar dot ("05") "looks stupid" — no real users. Put an **up-and-to-the-right arrow** graphic inside the circle (`ArrowUpRight`/`TrendingUp`); it opens Profile/"Your year", so a growth arrow fits. `.wb-header-avatar` in `WallabyHeader`.

---

## 1. Information architecture

Bottom nav (loggd): **Home · Habits · Tasks · Timer · More**.
- ✅ Bottom-nav shell (`WallabyShell`/`WallabyNav`), Wallaby-mode only, mobile.
- More → Profile, Goals, Settings + Coming-soon (Vision, Daily).
- ✅ Persistent top app header (`WallabyHeader`: brand + 🔔 bell + avatar) above each surface; bell → notifications center, avatar → Profile.
- ✅ Notifications center (`NotificationsView`) — reads existing `/api/notifications/log`, All/Unread, grouped, type icons, optimistic mark-all-read. (🅿️ reliable read-state persistence + delivery-bug fix = backend follow-up.)
- 🅿️ Desktop layout for Wallaby (currently desktop keeps Kanban + drawer).

## 2. Surfaces — reskin status

| Surface | Status | Notes |
|---|---|---|
| Habits — Single/Month/Year heatmap cards | ✅ | per-habit color, streak/count badges, per-card month labels |
| Habit detail + month calendar | ✅ | tap a card → Streak/Best/Total + completion calendar + Archive/Delete/Edit (`IMG_1586`) |
| Tasks — list | ✅ | Upcoming/Backlog/**Done** tabs w/ counts; Overdue/Today/Tomorrow/Upcoming/Anytime grouping w/ icons; semi-random per-task checkbox colors; notes subtitle; **tap → action sheet** (reschedule/edit/delete, focus="soon") |
| Goals (projects) — list + detail | ✅ | metric, progress, semantic buttons |
| Profile / dashboard | ✅ | avatar/bio/year-grid (Tasks/Points)/per-habit grids + **Records strip** (Best day / Best points / Longest streak, from `computeRecords`). Level/XP/badges = 🅿️ gamification; public/share intentionally omitted |
| Home — daily agenda | ✅ | Pulse + **Daily-summary card** (N tasks·M habits done + day-streak + mini 14-week heatmap) + per-day tasks/habits + interactive date strip. Mood/vision parts = 🅿️ |
| Settings (visual reskin) | ✅ | Account / Notifications / Preferences / Privacy / API; per-type Push/Email toggles (Boomerang already has the data) |
| Analytics — tabbed (Overview/Tasks/Habits) | ✅ (2026-06-07) | shared AnalyticsModal split into Overview / Tasks / Habits tabs (new per-habit completion view). Focus/Goals/mood tabs deferred (gated by Timer/mood features). |
| Analytics (visual reskin) | ✅ (reskin) / 🅿️ | Tabbed **Overview / Habits / Tasks / Goals / Focus**. Weekly **points** total + ‹week› nav, 🔥current/🏆best streak, stat cards (Habits checks, Tasks completed, Focus time, Check-ins), **Points Breakdown by activity type**, weekly **mood bar-chart** + **reflections** recap. Reskin-able: points/streak/habit+task counts (Boomerang has these). Deferred: focus-time, check-ins, mood, badge points (tied to new features). Reached via More/Profile. |

### Home "Today's Pulse" (richer Home — PDF 1)
The real Home is a scrolling daily dashboard. Reskin-able parts (existing data):
- ✅ **Pulse** card (today): "X habits left (n/m done)", "n tasks for today", streak-at-risk
- ✅ **Daily summary** card: "N tasks · M habits done today" + mini 14-week activity heatmap + day-streak chip (deep-work hours deferred with Timer)
- ✅ **Tasks card** for the selected day (n/m done + progress bar)
- ✅ **Habits today** section (checkable rows)
- ✅ **Interactive date/week strip** — select a day (backfill that day), page weeks, jump to today
- 🅿️ **Reflection + Today's Mood** (new — mood journal)
- 🅿️ **Vision Whisper** (new — mission/vision)
- ❓ Week/Month toggle on the Home week strip

## 3. Deferred net-new features (after reskin)

**Gamification (PDF 3):**
- 🅿️ XP + Levels (named tiers: Committed, Devoted, …) — `Lvl 35 · 7,625 XP`
- 🅿️ Badges with rarity (Common/Uncommon/Rare/Epic) + XP rewards (One Month Club, Quarter Veteran, Year One, Week Warrior…)
- 🅿️ Achievements row on Profile (Pro Member, Month Master, Dedicated, Perfect Week, Visionary)
- 🅿️ Streak milestones + "streak at risk" protection
- 🅿️ Goal progress % nudges ("25% Progress!")
- 🅿️ Leaderboard ("#1 on the weekly leaderboard")
- 🅿️ **Unified points economy** — points earned across activity types (badges / habits / focus / check-ins / vision / tasks / goals) with a weekly Points Breakdown (Analytics). Boomerang has a points concept but not this cross-activity economy.
- 🅿️ **Focus-time tracking** (hours/week, feeds Home summary + Analytics) — paired with the Timer feature.
- 🅿️ **Daily check-ins streak** + weekly **mood chart** + reflections recap (Analytics) — paired with the Daily mood-journal.

**New surfaces / features:**
- 🅿️ **Timer** — focus timer, full + compact (`timer-full.pdf`/`timer-compact.pdf`): activity heatmap, session log (Pomodoro/Tracking), streak, time distribution by task/goal/habit/tag, focus patterns, CSV export. Feeds Home summary + Analytics focus-time.
- 🅿️ **Vision** — full board (`vision.pdf`): Eulogy / Bucket List / Mission / Definition of Success (6 life areas) / **Odyssey Plan** (3 paths) / **Future Calendar** (ideal Tuesday/Sunday); per-section Public/Private.
- 🅿️ **Notes** — Notion-like nested-page tree + writing heatmap (`notes.pdf`). **User: should INTERFACE WITH their Notion** — Boomerang already has a Notion-backed Knowledge base; build Notes *on* that (one Notion source of truth), don't fork a second store.
- ✅ **Badges / achievements** (`badges.pdf`) — DONE (2026-06-07). 12 self-derived badges (bronze/silver/gold) from existing analytics, no new schema. `src/badges.js` + shared `BadgesGrid`, surfaced in AnalyticsModal (all skins) + Wallaby Profile. Deferred: persisted "seen" + earn-celebration toast; XP/levels economy (the bigger gamification fork).
- 🅿️ **Daily check-in** — rainbow mood slider (1–10) + reflection journal — `IMG_1580`
- 🅿️ **Notifications center** (bell) — grouped feed, All/Unread, mark-all-read — `PDF 3`
- 🅿️ **Weekly review / Week in Review** — recap of streaks, XP, check-ins, % habits
- 🅿️ **Public Profile** — shareable read-only profile (Overview vs Public Profile sub-tabs) — user: **omit the public/share part** (Home already excludes it)

**Habit mechanics (PDF 4 + IMG_1582):**
- 🅿️ **Habit templates** picker on create ("Pick a habit" — categorized: Sync/Health/Nutrition…, Custom)
- 🅿️ **Multi-check habits** (do N times/day — the count badges like "2")
- 🅿️ **Timed habits** (e.g. Meditation `0m/15m`, play button)
- 🅿️ **Habit sync sources** (GitHub Activity, Post on Threads/Reddit — auto-logged from external activity)
- 🅿️ Single / Weekly / **Yearly** range option (vs current Single/Week/Month)

### Full feature catalog (from the Help Center PDF — `help-center-full-feature-guide.pdf`)
The complete loggd feature set, for when we build past the reskin. All 🅿️ (theme-agnostic).

- **Habits — scheduling:** Daily · Weekdays · Weekends · **Flexible (N×/week)** · **Custom (pick days)**; **GitHub sync** (auto-track contributions); streaks & consistency. (Boomerang routines cover daily/weekly/custom; flexible-N×/week, weekday/weekend presets, and external sync are new.)
- **Tasks:** status Upcoming/Backlog/Completed; **priority High/Medium/Low**; swipe gestures; **smart/natural-language date input**; **task → focus session**.
- **Goals:** **Life Areas** (Career/Health/Relationships/Financial/Growth/Impact — sourced from Vision Board); **automatic goal tags** (creating a goal auto-creates a tag; tag tasks to link → filter by goal); **milestones**; two progress-tracking modes; time horizons.
- **Focus Timer:** **Pomodoro** (15–90 min + break timer) and **Tracking** (open stopwatch) modes; task integration; shared tags; **cross-device sync + persistent across navigation**; ambient sounds/music; multiple timer themes/clocks; desktop keyboard shortcuts.
- **Daily Journal:** free-form reflection + **mood rating**; mood shown on the Overview calendar; **pattern correlation** with habits/tasks/sleep over time.
- **Notes** (Notion-like): **hierarchical nested pages**, collapsible **tree sidebar**, **drag-&-drop** reparent/reorder, **slash commands**, rich-text editor, instant search. (Boomerang has a Notion-backed Knowledge base — overlaps; reconcile later.)
- **Overview:** Week / Month / **3-Month (desktop)** views; **mood calendar** (color-coded); per-day habit completion + tasks + focus time + mood.
- **Vision Board — 6 exercises:** Eulogy Method · Bucket List · Mission Statement · Definition of Success · **Odyssey Plan** (3 life paths) · **Future Calendar** (ideal day); **Vision Snapshots** (Pro, versioned over time).
- **XP / Levels / Badges:** 100 levels across **12 tiers** (Awakened → Absolute); XP rules (habit check 4XP first 3/day, task 2–5XP first 8/day, focus 1XP/15min, check-in 6XP, goal milestone 15XP, goal complete 5–50XP); **100+ badges** (rarity tiers); **feature unlocks by level** (Dark mode L3, Vision L5, Goals L7, Notes L9 — Pro unlocks all instantly).
- **Community:** monthly + all-time **leaderboards**, **activity feed**, **Hall of Fame** (monthly top-10 permanent).
- **Settings & Privacy:** **3-level privacy** (profile / section / item visibility); themes & appearance; mobile app + notifications; desktop keyboard shortcuts.
- **Plans:** **Free vs Pro** tiering (Free caps: 3 habits / 30 tasks / 3 goals; Pro: unlimited + instant feature access + Pro themes + Snapshots). *(Boomerang is single-user self-hosted — Pro/Community/leaderboards likely N/A; capture but flag as probably-out-of-scope.)*

## 4. Open questions (❓ for the next screenshot/answer)
1. Persistent top header in Wallaby (brand + bell + avatar) — include in reskin, or skip until notifications/gamification land?
2. Tasks checkbox colors — driven by priority, by first label/category color, or fixed per task?
3. Home week strip Week/Month toggle — needed in the reskin?
4. Active bottom-nav color — currently green; keep?
