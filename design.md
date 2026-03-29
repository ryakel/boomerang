Build a mobile-first PWA called Boomerang. This is a personal ADHD task manager for one user (me). No auth needed. Here is the full spec:

---

## CONCEPT

The core idea: a task always comes back. Unlike normal to-do apps that let things fade, Boomerang uses persistent nagging and AI intelligence to prevent tasks from disappearing. Dismissal is never free — every "not now" requires a "then when."

---

## TECH STACK

- React + Vite
- PWA (vite-plugin-pwa) — installable to iPhone home screen
- localStorage for persistence (simple, no backend needed yet)
- Anthropic API (claude-sonnet-4-20250514) for AI features
- Deployment target: Cloudflare Pages
- No auth, no backend, no database

Store the Anthropic API key in a .env file as VITE_ANTHROPIC_API_KEY.

---

## DESIGN

- Mobile-first. Design for a 390px wide iPhone screen first. Desktop should work but is not the priority.
- Dark theme. Background ~#0B0B0F, surfaces ~#141418, not pure black.
- Accent color: #FF6240 (orange — warm, attention-getting, not aggressive)
- Typography: import Syne (700, 800) for headers/wordmark, DM Sans (400, 500, 600) for body. Both from Google Fonts.
- Feels like a native app, not a website. No visible scrollbars. Smooth transitions. Touch-friendly tap targets (min 44px).
- NOT gamified. No streaks, badges, points, confetti, or shame mechanics.
- Task states are visually distinct: stale tasks get an orange left border, snoozed tasks are dimmed (opacity 0.5), active tasks are normal.

---

## DATA MODEL

All data in localStorage. Two keys: `boom_tasks_v1` and `boom_settings_v1`.

### Task shape:
```json
{
  "id": "uuid",
  "title": "string",
  "status": "open | done",
  "tags": ["string"],
  "snoozed_until": "ISO datetime | null",
  "snooze_count": 0,
  "staleness_days": 2,
  "last_touched": "ISO datetime",
  "created_at": "ISO datetime",
  "completed_at": "ISO datetime | null",
  "reframe_notes": "string | null"
}
```

### Settings shape:
```json
{
  "staleness_days": 2,
  "reframe_threshold": 3,
  "digest_time": "07:00"
}
```

### Tags (hardcoded to start, manageable in settings later):
- inside (#4A9EFF)
- outside (#52C97F)
- follow-up (#FFB347)

---

## STALENESS LOGIC

A task is stale if:
- status is "open", AND
- snoozed_until is null or in the past, AND
- (now - last_touched) > staleness_days * 86400000ms

A task is snoozed if:
- snoozed_until is not null AND snoozed_until > now

---

## SNOOZE OPTIONS

When snoozing a task, always offer exactly 4 options:

- **Tonight** → today at 8:00 PM (if already past 7pm, snooze 4 hours instead)
- **Tomorrow** → tomorrow at 9:00 AM
- **This Weekend** → next Saturday at 10:00 AM (if today is Saturday, next Saturday)
- **Next Week** → next Monday at 9:00 AM

Each snooze: increment snooze_count, update last_touched, set snoozed_until.

---

## REFRAME TRIGGER

When a user tries to snooze a task and snooze_count >= reframe_threshold (default 3):
- Instead of showing the normal snooze modal, show the Reframe modal
- Ask: "What's actually in the way?" (text input)
- On submit, call Claude API (see AI Features below)
- Replace the original task with Claude's reframed version(s)

---

## SCREENS / VIEWS

### 1. Main List (default view)

Header:
- Left: "BOOMERANG" wordmark (Syne 800)
- Right: count of open non-snoozed tasks (e.g. "4 open")

Tag filter bar (horizontal scroll, pill buttons):
- All | Inside | Outside | Follow-up

Task sections (in this order):
1. **Stale** — tasks past staleness threshold. Orange left border. Show days old (e.g. "3d").
2. **Up Next** — open, not stale, not snoozed.
3. **Snoozed** — dimmed. Show when it comes back (e.g. "tomorrow", "Sat Mar 30").

Each task card:
- Task title (left, prominent)
- Tag pill(s) if any (small, colored)
- Days old or snooze label (right, muted)
- Tap card → expand inline to show: [Done ✓] [Snooze] buttons
- Swipe right → complete (if implementing gestures; otherwise tap to expand is fine)

Bottom fixed area:
- "What can I do right now?" button (full width, accent color, prominent)
- Quick-add input: text field + "+" button. Tapping "+" without text opens the full Add modal.

### 2. Add Task Modal (bottom sheet)

- Large text input (autofocused): task title
- Tag selector: row of 3 tag pills to toggle
- "Add Task" button
- Dismiss by tapping outside or X

### 3. Snooze Modal (bottom sheet)

- Task title shown at top
- 4 large snooze option buttons (full width)
- Dismiss by tapping outside

### 4. Reframe Modal (bottom sheet)

- Headline: "This one keeps coming back."
- Subtext: "[task title] has been snoozed [N] times. What's actually in the way?"
- Multi-line text input
- "Reframe It" button (calls Claude)
- Loading state while Claude responds
- On success: show new task title(s) with "Looks good" confirm button

### 5. What Now Flow (full screen overlay)

Step 1 — Time:
- Question: "How much time do you have?"
- 3 large option buttons: "5–10 minutes" | "30 minutes" | "A couple hours"

Step 2 — Energy:
- Question: "How's your energy?"
- 3 large option buttons: "Running on fumes" | "Moderate" | "I've got it"

Step 3 — Results (Claude response):
- Loading state: "Finding the right thing..."
- Show Claude's 1–3 suggestions (parsed from response)
- Each suggestion: task name + one-line reason, tappable (opens that task)
- "Never mind" button to dismiss

### 6. Settings (accessible via gear icon in header)

- Default staleness threshold (number input, days)
- Reframe trigger threshold (number input, snooze count)
- Tag management (list with color, add/remove)
- "Clear completed tasks" button

---

## AI FEATURES

### What Now — Claude API call

Endpoint: POST https://api.anthropic.com/v1/messages

Prompt (construct dynamically):