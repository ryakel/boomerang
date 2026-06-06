# Wallaby — Running Ideas & Backlog

Living catalog of everything observed in the loggd.life reference (screenshots +
PDFs, 2026-06-06), mapped to Boomerang. **Current phase = reskin only.** Net-new
features are parked here until the reskin lands. Add to this list freely; don't
delete — strike through or mark `DROPPED` instead.

**Legend:** ✅ done · 🔧 in progress · ⬜ reskin todo · 🅿️ deferred (new feature) · ❓ needs decision

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

## 4. Open questions (❓ for the next screenshot/answer)
1. Persistent top header in Wallaby (brand + bell + avatar) — include in reskin, or skip until notifications/gamification land?
2. Tasks checkbox colors — driven by priority, by first label/category color, or fixed per task?
3. Home week strip Week/Month toggle — needed in the reskin?
4. Active bottom-nav color — currently green; keep?
