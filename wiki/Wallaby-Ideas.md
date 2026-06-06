# Wallaby — Running Ideas & Backlog

Living catalog of everything observed in the loggd.life reference (screenshots +
PDFs, 2026-06-06), mapped to Boomerang. **Current phase = reskin only.** Net-new
features are parked here until the reskin lands. Add to this list freely; don't
delete — strike through or mark `DROPPED` instead.

**Legend:** ✅ done · 🔧 in progress · ⬜ reskin todo · 🅿️ deferred (new feature) · ❓ needs decision

**Reference assets:** clean copies of every loggd reference live in
[`wallaby-reference/`](./wallaby-reference/) (PDFs + screenshots) — loggd.life
blocks automated fetch, so that folder is the source of truth.

> **Cross-cutting principle (2026-06-06):** the deferred net-new features are
> **theme-agnostic** — when built they live in the **shared app layer** and work
> in **every skin** (Standard / Terminal / Wallaby), *not* Wallaby-only. Wallaby
> just restyles them. (User: "it should be around for all skins.") This is also
> the **fork line**: each of these needs new data/schema/endpoints, so building
> any of them takes us past "reskin." Flag before crossing.

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
| Tasks — list | ✅ (partial) | ⬜ add **Done** tab (Upcoming/Backlog/Done w/ counts); ⬜ TODAY/TOMORROW grouping w/ icons; ⬜ per-task checkbox color (priority? label? — ❓); ⬜ notes subtitle line |
| Goals (projects) — list + detail | ✅ | metric, progress, semantic buttons |
| Profile / dashboard | ✅ (partial) | ⬜ add **Level / XP / achievements** row (🅿️ those are new features); ❓ Public Profile sub-tab |
| Home — daily agenda | ✅ (basic) | ⬜ enrich toward **Today's Pulse** (below) |
| Settings (tabbed) | ⬜ | Account / Notifications / Preferences / Privacy / API; per-type Push/Email toggles (Boomerang already has the data) |
| Analytics — "Your productivity insights" | ⬜ / 🅿️ | Tabbed **Overview / Habits / Tasks / Goals / Focus**. Weekly **points** total + ‹week› nav, 🔥current/🏆best streak, stat cards (Habits checks, Tasks completed, Focus time, Check-ins), **Points Breakdown by activity type**, weekly **mood bar-chart** + **reflections** recap. Reskin-able: points/streak/habit+task counts (Boomerang has these). Deferred: focus-time, check-ins, mood, badge points (tied to new features). Reached via More/Profile. |

### Home "Today's Pulse" (richer Home — PDF 1)
The real Home is a scrolling daily dashboard. Reskin-able parts (existing data):
- ⬜ **Pulse** banner: "X habits left (n/m done)", "n tasks for today", streak-at-risk
- ⬜ **Daily summary** card: "You put in Xh deep work, finished N tasks…" + mini activity heatmap + day-streak
- ⬜ **Tasks today** section (n/m done, Manage/Hide)
- ✅ **Habits today** section (checkable rows)
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
- 🅿️ **Timer** — focus timer (deep-work sessions feed Home summary)
- 🅿️ **Vision** — Eulogy Method + Bucket List (checklists, progress, "Think Big") — `IMG_1579`
- 🅿️ **Daily check-in** — rainbow mood slider (1–10) + reflection journal — `IMG_1580`
- 🅿️ **Notifications center** (bell) — grouped feed, All/Unread, mark-all-read — `PDF 3`
- 🅿️ **Weekly review / Week in Review** — recap of streaks, XP, check-ins, % habits
- 🅿️ **Public Profile** — shareable read-only profile (Overview vs Public Profile sub-tabs)

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
