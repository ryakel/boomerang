# Features

## Core Concept

Every task always comes back. Dismissal is never free — every "not now" requires a "then when."

## Task Management

- **Quick add** — type and hit Enter from the bottom bar to instantly create a task
- **Full add modal** — title, notes, due date, labels, T-shirt size, and Notion link
- **Edit tasks** — full edit modal with all fields, including the ability to convert a one-off task into a routine
- **Swipe gestures** — iMessage-style swipe actions on task cards. Swipe right-to-left to reveal Edit and Done buttons. Swipe left-to-right to delete. Clean SVG icons (pencil, checkmark, trash) instead of text labels.
- **Delete tasks** — delete any task via swipe gesture or from the expanded card actions
- **Expanded actions** — tap a task to expand it and reveal Done, Snooze, Extend, Edit, Backlog, and Delete buttons
- **Statuses** — not started, doing, waiting, done (plus backlog and project as separate concepts). Change status directly from the expanded task card.
- **Checklists** — add checklist items to any task. Toggle items directly from the expanded card without opening the edit modal. Progress shown as "2/5 items".
- **Comments** — append timestamped notes/comments to tasks from the edit modal. Useful for tracking updates on longer-running tasks.
- **Due dates** — with overdue detection and visual indicators (days overdue, due today, due tomorrow, etc.)
- **Default due dates** — configurable number of days from now (default: 7), applied automatically to new tasks. Set to 0 to disable.
- **Extend due dates** — quick presets (+1 day, +1 week, +2 weeks) or pick a custom date via the extend modal
- **Labels** — custom labels with a 10-color picker, drag-to-reorder in Settings. On mobile, labels appear as a compact dropdown selector; on desktop, they show as a horizontal pill bar. In task modals, labels use a dropdown picker with colored removable pills showing selected labels.
- **T-shirt sizing** — XS, S, M, L, XL effort estimates. Set manually or auto-inferred by AI during polish. Displayed as a pill on each task card.

## Task Sections

Tasks are organized into sections on the main screen:

- **Stale** — tasks untouched for longer than the staleness threshold (default: 2 days)
- **Up Next** — active tasks (not started + doing) that are not stale or snoozed
- **Waiting** — tasks marked as blocked/waiting on someone
- **Snoozed** — tasks with a future snooze date, showing when they'll return
- **Backlog** — someday/maybe tasks in a collapsible section at the bottom. Move tasks to backlog to keep them out of your active list without losing them.
- **Projects** — dedicated space for longer-term tasks. Accessible via the overflow menu ("...") in the header. No notifications, no nagging, no stale/overdue visual pressure. Use "Move to Projects" in any task's edit modal.

## Task Count Display

The header shows a task count with configurable display modes:

- **Open only** — just the count of non-snoozed open tasks
- **Active** — non-snoozed open tasks as a fraction of total open + backlog tasks
- **All** — non-snoozed open tasks as a fraction of total open + done tasks

## AI Features (requires Anthropic API key)

All AI features use Claude (claude-sonnet-4-20250514) via a server-side proxy. They are fully disabled if no API key is configured — the rest of the app works normally without them.

- **What Now** — a guided flow that asks how much time you have (5-10 min, 30 min, a couple hours) and your energy level (running on fumes, moderate, I've got it), then recommends 1-3 tasks with reasons. Enforces hard rules matching task size to available time and energy. When fewer than 3 picks are available, shows a "Feeling ambitious?" stretch suggestion one size up. You can mark tasks done directly from the suggestions.
- **Polish** — takes messy brain-dump notes and turns them into clear, actionable bullet points. Also cleans up the task title if it's vague. Automatically triggers date inference and size inference on the polished content.
- **Research** — from the edit modal, click Research to ask a question about the task. Claude generates practical research notes (steps, options, pros/cons) that append to the task's existing notes. Useful for tasks where you need to figure out *how* before you can start.
- **Date inference** — extracts due dates from natural language in task titles and notes ("do this by Friday", "end of month", etc.). Runs automatically after polishing if no due date is set.
- **Size inference** — estimates task effort as a T-shirt size (XS through XL) based on the task description. Runs automatically after polishing, on quick-add (title only), and on full add when no size is manually set.
- **Auto size button** — in the Add and Edit task modals, a ✨ Auto button lets you manually trigger AI size inference at any time. Re-evaluates based on the current title and notes.
- **Reframe** — when a task has been snoozed past the reframe threshold (default: 3 times), the next snooze attempt opens a reframe modal instead. You describe what's blocking you, and the AI breaks the stuck task into 1-3 actionable replacement tasks.
- **Smart nudges** — when browser notifications are enabled and custom instructions are set, notification nudge messages are AI-generated to match your communication style. Falls back to built-in messages when AI is unavailable.
- **AI custom instructions** — a text field in Settings that shapes all AI output across every feature. Can be imported from or exported to a `.md` or `.txt` file.

## Energy/Capacity Tagging

AI-inferred energy tagging on every task — no manual fields to fill in.

### Energy Types

| Type | Icon | Meaning | Examples |
|---|---|---|---|
| `desk` | 💻 | Focused computer/paperwork | Update resume, pay bills, debug code |
| `people` | 👥 | Social interaction | Lunch with coworker, team standup |
| `errand` | 🏃 | Going somewhere physically | Pick up prescription, grocery run |
| `confrontation` | ⚡ | Emotionally difficult interaction | Call insurance to dispute, give feedback |
| `creative` | 🎨 | Open-ended thinking/making | Design logo, write blog post |
| `physical` | 💪 | Bodily effort | Clean garage, mow lawn |

### Energy Levels (1-3)

| Level | Display | Meaning |
|---|---|---|
| 1 | ⚡ | Low drain — easy, routine |
| 2 | ⚡⚡ | Medium drain — requires focus |
| 3 | ⚡⚡⚡ | High drain — significant willpower |

- **Auto-inferred** — `inferSize()` returns size, energy type, and energy level in a single API call
- **Tap-to-cycle** — on task cards, tap the type emoji to cycle types, tap the bolts to cycle intensity
- **Points multiplier** — `SIZE_POINTS[size] × ENERGY_MULTIPLIER[level] × speedMultiplier`. An XL⚡⚡⚡ task can earn up to 80 points
- **Nagging boost** — confrontation/errand tasks get nagged ~30-56% more frequently via `applyAvoidanceBoost()`
- **What Now filter** — capacity step asks "What can you do right now?" with energy type options

## Snooze System

Context-aware preset options that show the exact date and time (e.g., "Tomorrow · Mon Apr 6 9 AM"). Options adapt to the current day of week — "This Weekend" only appears Mon–Thu, "Tonight" disappears after 7 PM, and duplicate days are automatically removed. A "Pick a date..." button opens a custom date/time picker for full control. High-priority tasks get shorter intervals (2 Hours, Tonight, Tomorrow, Day After). Each snooze increments a counter. After hitting the reframe threshold (configurable, default: 3), snoozing triggers the Reframe flow instead.

## Routines (Recurring Tasks)

Recurring tasks with configurable cadence:

- **Frequencies**: daily, weekly, monthly, quarterly, annually, or custom (every N days)
- **End date**: optional end date to auto-stop a routine (e.g., "study daily until exam day"). After the end date, no new tasks are spawned. Displayed on routine cards as "ends Mon DD".
- **Management**: routines live in their own screen, accessible from the tag bar. Active and paused routines are shown separately.
- **Auto-spawning**: when a routine is due, a task instance is automatically created in the main task list. Completing the instance logs the completion on the routine and schedules the next occurrence.
- **Pause/resume**: routines can be paused without deleting them
- **Convert from task**: any one-off task can be converted to a routine via the Edit modal. The original task stays active and is linked to the new routine as its first instance — completing it later logs the completion on the routine, and future instances are spawned by cadence.
- **Notion integration**: find or create a Notion page from the routine add/edit form. Linked pages appear on routine cards and are inherited by spawned task instances.

## Notion Integration (requires Notion token)

- **Search and link** — search existing Notion pages from the Add or Edit task modal and link them to tasks
- **AI-suggested linking** — when searching, AI evaluates whether any found pages are a good match or if a new page should be created
- **Create pages** — AI generates structured Notion page content with full metadata (due date, size, energy, priority, status), checklists as to_do blocks, and file attachment uploads via Notion's 3-step file upload API
- **Parent page** — new pages are created under a configurable parent page ID, or under the first accessible page if none is set
- **Connection indicators** — linked tasks show an "N" badge next to the title. Tap to open the Notion page directly.
- **Ongoing sync** — linked tasks automatically sync changes (title, notes, checklists) to Notion with a 5-second debounce. Title updates go via Notion properties API; content sync deletes old blocks and appends new ones (full replacement). Failed syncs are queued for offline replay.
- **Pull sync** — child pages of a configured parent page are discovered, analyzed by AI, and converted to tasks. Supports deduplication (exact title match + AI confidence scoring).
- **Database sync** — paste a Notion database ID or URL in Settings to sync database rows as tasks. Rows are Notion pages, so dedup and linking work the same as page sync.
- **Routine auto-detection** — when AI analyzes a Notion page and detects recurring patterns (e.g., "change filter every 3 months"), a suggestion banner appears offering to create a routine with the inferred cadence. Dismiss permanently with "x".
- **Routine support** — routines can also be linked to Notion pages

## Connections (Edit Modal)

The Edit Task modal has a combined **Connections** section showing both Notion and Trello integration buttons. When a task is linked to an integration, the button turns into a green badge showing the connection status with "Open" (to view in the external app) and "×" (to unlink) actions. This replaces separate integration sections with a unified UI.

## Trello Integration (requires Trello API key + token)

Bidirectional sync between Boomerang tasks and Trello cards with AI-powered list mapping and automatic deduplication.

### Setup

The Trello admin page shows an "API Key" and a "Secret" — **the Secret is NOT what you need.** The Trello REST API uses a Key + Token pair. The token is generated separately by authorizing your app.

#### Step-by-step

1. Go to https://trello.com/power-ups/admin
2. Create a new Power-Up (or select an existing one) to get your **API Key**
3. Generate a **Token** — on the same page, look for the link that says "Token" or "generate a Token". This opens an authorization page where you grant Boomerang read/write access. If you don't see the link, visit this URL directly (replace `YOUR_API_KEY` with your actual key):
   ```
   https://trello.com/1/authorize?expiration=never&name=Boomerang&scope=read,write&response_type=token&key=YOUR_API_KEY
   ```
4. Copy the long token string shown after you click **Allow**

#### In Boomerang (UI)

1. Go to **Settings → Integrations → Trello**
2. Paste your **API Key** and **Token** (labeled "Secret" in the UI), then click **Connect**
3. Select a **Board** from the dropdown
4. Select a **List** within that board — this is where new cards will be created

#### Via environment variables (Docker/Portainer)

Set these two env vars in your container:

```
TRELLO_API_KEY=your_api_key
TRELLO_SECRET=the_token_you_generated_above
```

> **Note:** Despite the env var name `TRELLO_SECRET`, the value should be the **token** you generated in step 3 above, NOT the "Secret" shown on the Trello admin page. Those are different things.

### Bidirectional Sync

Trello lists map to Boomerang statuses:

| Trello List | Boomerang Status |
|-------------|-----------------|
| To Do | not_started |
| In Progress | doing |
| On Hold | waiting |
| Done | done |

The mapping is **AI-inferred** — when you first connect a board, Claude analyzes your list names and automatically maps them to Boomerang statuses. You can re-infer the mapping at any time from Settings. Backlog and Projects are Boomerang-only concepts with no Trello equivalent.

#### How sync works

- **On app open**: Boomerang pulls cards from all mapped Trello lists, updates statuses on already-linked tasks, and uses AI deduplication (0.85 confidence threshold) to auto-link new Trello cards to matching Boomerang tasks
- **On visibility change**: Sync runs again when you switch back to the app
- **Manual sync**: Hit "Sync Now" in Settings → Integrations → Trello to force a sync
- **Status push**: When you change a task's status in Boomerang, the linked Trello card is automatically moved to the corresponding list

### How to use it

Once connected and a board/list is selected:

- **Push a task to Trello** — Open any task (tap to expand), then tap **Edit**. In the Connections section, tap **Push to Trello**. This creates a card on the appropriate list with the task title as the card name and notes as the description.
- **Connection indicators** — Linked tasks show N (Notion) and T (Trello) badges next to the title. Tap a badge to open the linked page/card directly.
- **View linked card** — In the Edit modal, connected integrations show as green badges with an "Open" link and an unlink button.
- **Unlink** — Tap the × on a connection badge to disconnect the task from the Trello card (doesn't delete the card).
- **Pull from Trello** — Cards created directly in Trello are automatically pulled and matched to existing tasks or created as new tasks on sync.

### Features

- **Push to Trello** — from the Edit modal's Connections section, push any task to Trello. Creates a card with native Trello checklists (not dumped in notes) and uploads file attachments.
- **Ongoing sync** — linked tasks automatically sync changes to Trello with a 5-second per-task debounce. Syncs title, notes, due date, and checklists (creates new, updates modified items, deletes removed). Pre-existing linked tasks without Trello IDs get hydrated by matching checklist names on first sync.
- **Linked cards** — once pushed, the Trello connection shows as a green badge with a direct link to open the card in Trello, and an unlink button.
- **Pull from Trello** — the `useTrelloSync` hook pulls cards from all mapped lists, updates linked task statuses, and uses AI to deduplicate new cards against existing tasks.
- **Status sync** — changing a task's status in Boomerang automatically moves the linked Trello card to the matching list.
- **AI deduplication** — when new Trello cards are found, Claude compares them to existing tasks and auto-links matches above the confidence threshold. Only truly new cards create new tasks.
- **Offline queue** — failed Trello/Notion syncs are queued in localStorage (200 cap) and replayed on reconnect.
- **Board/list selection** — configure which board and default list to sync with in Settings. Change anytime.
- **Multi-list sync** — select multiple Trello lists to pull from via checkboxes in Settings. All checked lists are synced in parallel.
- **Sync Now button** — manual sync trigger in Settings with last-sync timestamp display.
- **List mapping display** — view and re-infer the AI-generated list mapping in Settings.

## Google Calendar Integration (requires Google OAuth credentials)

Bidirectional sync between Boomerang tasks and Google Calendar events with AI-inferred time slots and OAuth 2.0 authentication. Works with any Google account (Gmail, Workspace, etc.).

### Setup

#### Step-by-step (Google Cloud Console)

1. Go to https://console.cloud.google.com/apis/credentials
2. Create a project (or select an existing one)
3. Enable the **Google Calendar API** (APIs & Services → Library → search "Calendar")
4. Create **OAuth 2.0 Client ID** credentials (type: Web application)
5. Add `http://localhost:3001/api/gcal/callback` as an authorized redirect URI (adjust port/host if needed)
6. Copy the **Client ID** and **Client Secret**

#### In Boomerang (UI)

1. Go to **Settings → Integrations → Google Calendar**
2. Paste your **Client ID** and **Client Secret**, then click **Connect**
3. Complete the Google consent screen in the popup window
4. Select which **Calendar** to sync with from the dropdown
5. Enable **Sync tasks to Google Calendar** and configure sync options

#### Via environment variables (Docker/Portainer)

```
GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret
```

### Features

- **Push sync** — tasks with due dates are automatically synced as Google Calendar events. AI infers the optimal time of day and duration based on task title, size, and energy type. When push sync is first enabled, all existing tasks with due dates today or in the future are pushed to the calendar automatically (past due dates are excluded). New tasks with due dates are synced after a 5-second debounce.
- **Recurring events** — routine-spawned tasks create recurring Google Calendar events with RRULE matching the routine's cadence (daily, weekly, biweekly, monthly, etc.). Subsequent routine spawns link to the existing recurring event. Pull sync collapses recurring instances into a single task per series.
- **Pull sync** — calendar events can be pulled as Boomerang tasks via "Sync Now" (only visible when pull sync is enabled) or automatically on app open. Events already pushed by Boomerang are filtered out. Recurring event instances are collapsed (one task per series).
- **Bulk cleanup** — "Remove All Events" button in Settings deletes all Boomerang-managed events from the calendar and unlinks all tasks. Useful for testing or starting fresh.
- **AI-timed events** — Claude suggests time slots (desk tasks → morning, errands → midday, people tasks → afternoon) and durations based on task size (XS=15min to XL=4h). Falls back to configurable defaults.
- **Per-task duration override** — set a custom duration (in minutes) on any task via EditTaskModal. Overrides AI/size-based defaults. Shown when a due date is set.
- **Event buffer** — optional 15-minute buffer on either side of calendar events, ensuring breathing room around meetings. Toggle in Settings → GCal.
- **All-day mode** — optionally create all-day events instead of timed events (toggle in settings).
- **Configurable sync scope** — choose which task statuses sync (not_started, doing, waiting, open). Only tasks with due dates are synced.
- **Auto-cleanup** — completing or deleting a task removes the calendar event (configurable).
- **AI deduplication** — pull sync uses exact title match + AI fuzzy matching (0.85 confidence threshold) to avoid duplicating existing tasks.
- **Offline queue** — failed GCal operations are queued alongside Trello/Notion operations (200 cap) and replayed on reconnect.
- **Calendar picker** — choose which Google Calendar to sync with from your calendar list.
- **OAuth 2.0** — secure server-side token management with automatic refresh. Tokens are stored in the database, never exposed to the browser.

## Gmail Integration (requires Google Cloud project with Gmail API)

AI-powered email scanning that automatically finds tasks and package tracking numbers in your inbox.

- **OAuth connection** — uses the same Google OAuth credentials as Google Calendar. Just enable the Gmail API in your Cloud project.
- **AI email analysis** — Claude analyzes your inbox emails to find actionable tasks (appointments, deadlines, documents to submit) and package tracking numbers from shipping confirmations.
- **Pending review** — imported items appear with a yellow border and envelope badge. Expand a card to "Keep" (approve) or "Dismiss" it. No items are auto-committed without your review.
- **Configurable scan window** — defaults to 7 days back, adjustable in Settings.
- **Auto-scan** — optional 5-minute polling for new emails when enabled.
- **Manual scan** — "Scan Now" button in Settings for on-demand scanning.
- **Smart filtering** — only scans primary inbox; skips promotions, social, updates, and forums.
- **Deduplication** — tracks processed message IDs to avoid creating duplicates on re-scan.
- **Package detection** — recognized carriers: USPS, UPS, FedEx, Amazon, DHL, OnTrac, LaserShip.

## Package Tracking (requires 17track API key)

Track packages from any carrier with automatic status updates, notifications, and delivery detection. Accessed via the Package icon in the header bar.

- **Add tracking** — enter a tracking number and optional label. Carrier is auto-detected from the number format (USPS, UPS, FedEx, DHL, Amazon, OnTrac, LaserShip). Duplicate tracking numbers are rejected.
- **Immediate tracking** — on add, the server registers with 17track and polls immediately so the card shows real status from the start.
- **Status-colored cards** — pending (gray), in transit (blue), out for delivery (teal), delivered (green), exception (red), expired (dim gray). Carrier logos displayed on each card.
- **Carrier links** — every card has a "Track on [Carrier]" link that opens the carrier's website with the tracking number pre-filled. Works even without an API key.
- **Detail modal** — tap a card to see the full tracking timeline with events, locations, and timestamps. ETA shown in the status banner.
- **Sorting** — sort by status (default, grouped by Issues/Active/Delivered), delivery date (flat by ETA), or carrier (grouped by carrier name).
- **Batch refresh** — refresh-all button in the header polls all active packages in one batched API call. Pull-to-refresh triggers the same batch refresh.
- **Auto-refresh on open** — app loads cached data instantly, then silently refreshes all packages from 17track in the background. Cards update automatically via SSE.
- **Adaptive polling** — server-side polling adjusts frequency based on status: 15 min for out-for-delivery, 30 min for pending, 1-4 hours for in-transit, hourly for exceptions. Batched requests (up to 40 per API call) to stay within free tier limits.
- **Animated swipe actions** — swipe left on a card to reveal Refresh and Delete buttons (same smooth finger-tracking animation as task cards).
- **Signature required** — detected from tracking events. Shows a prominent badge on the card and auto-creates a high-priority errand task for full nagging escalation. Task auto-completes when the package is delivered.
- **Notifications** — delivery, exception, out-for-delivery, and signature-required notifications. Respects quiet hours.
- **Auto-cleanup** — delivered packages are automatically removed after a configurable retention period (default: 3 days).
- **Duplicate detection** — client-side live check while typing (shows warning with existing label), server-side 409 guard. Yellow "Duplicate" badge on existing duplicate cards.
- **API quota handling** — when the daily API limit is reached, a yellow banner appears with the reset time. Carrier links remain functional as a manual fallback.
- **Graceful degradation** — without an API key, the feature works as a manual tracking notebook with carrier detection and carrier website links.
- **Shortened status** — verbose carrier messages shortened on cards ("Label created, package pending"). Full text shown in detail modal.

## Notifications

### Browser Push Notifications

Browser push notifications with configurable options:

- **Frequency**: 15 minutes, 30 minutes, 1 hour, or 2 hours
- **Types** (individually toggleable):
  - Overdue tasks — tasks past their due date
  - Stale tasks — tasks untouched beyond the staleness threshold
  - General nudges — motivational messages (AI-generated when custom instructions are set, otherwise from a built-in list of ADHD-friendly messages)
  - Stale task percentage warning — notification when the percentage of stale tasks exceeds a configurable threshold
  - Size-based reminders — advance reminders based on task size: XL tasks 3 days before due, L tasks 2 days before, M tasks 1 day before
  - AI small-task nudge — suggests a specific XS or S task by name in the notification, encouraging you to knock out a quick win

### Email Notifications

Server-side email notifications that work even when the app isn't open. Requires SMTP configuration via environment variables.

- **SMTP configuration** — `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` env vars
- **Recipient** — set via Settings UI (`email_address`) or `NOTIFICATION_EMAIL` env var
- **Gracefully tolerant** — if SMTP is not configured, the system is completely inert (no errors, no broken UI)
- **Per-type toggles** — independently enable/disable email for each notification type:
  - High priority tasks, overdue tasks, stale tasks, general nudges, size-based reminders, pile-up warnings
  - Package tracking: delivered, exceptions
- **AI nudge messages** — email nudges use Claude AI to generate contextual, motivating one-liners specific to the task being nudged. Falls back to static messages when no API key is configured.
- **Batch mode** — when enabled, all triggered notifications are combined into a single email with sections instead of sending individual emails. Toggle in Settings → Email Notifications.
- **Same notification logic** — uses identical frequencies, quiet hours, and avoidance boost as push notifications
- **Dark-themed HTML emails** — styled to match the app aesthetic
- **Test email** — send a test email from Settings to verify SMTP configuration
- **Server-side throttling** — throttle timestamps stored in SQLite (not localStorage), persists across restarts

## Morning Digest

Scheduled daily summary notification via email and/or push at a configurable time (default 7:00 AM).

- **Content** — open task count, overdue count, stale count, due-today count
- **Channels** — email and push toggles independent of each other
- **Time picker** — set your preferred digest time in Settings → Notifications
- **Throttled** — fires once per 23 hours (won't re-fire the next minute)
- **Conditional** — only fires if there are open tasks

## Markdown Import

Bulk import tasks from markdown text or files. Accessible from the overflow menu ("...") in the header.

- **Supported formats** — checkboxes (`- [ ] task`), bullet lists (`- task`, `* task`), numbered lists (`1. task`)
- **Sections** — `## Headings` become group labels in the preview
- **Smart filtering** — completed checkboxes (`- [x]`) and plain paragraphs are skipped
- **Preview flow** — paste or upload → preview parsed tasks → select/deselect → import
- **File upload** — accepts `.md`, `.txt`, `.markdown` files

## Sorting

Tasks can be sorted via a dropdown in the header. Available sort options:

- **Age** — oldest tasks first (default)
- **Due date** — earliest due date first
- **Size** — smallest effort first
- **Name** — alphabetical by title

## Offline Mutation Queue

When the server is unreachable, mutations (task updates, creates, deletes) are queued in localStorage (`boom_mutation_queue`, 200 cap) and replayed sequentially on reconnect. The header shows a sync status indicator (Cloud/CloudOff icons) with pending queue count.

## High Priority Tasks

Tasks can be marked as high priority via a toggle in the Edit modal. High priority tasks get 3-stage notification escalation:
- **Before due** — notified 24 hours before due date (configurable)
- **On due date** — every hour (configurable)
- **Overdue** — every 30 minutes (configurable)

## Desktop UI

On screens 768px+, the app switches to a desktop layout:
- **Kanban board** — 6-column board (Doing, Up Next, Waiting, Snoozed, Backlog, Projects) with drag-and-drop between columns
- **Hover states** — task cards reveal action buttons on hover
- **Side drawer** — EditTaskModal renders as a 480px right-side drawer instead of bottom sheet, with slide-in animation
- **Richer cards** — desktop cards show notes preview (first 120 chars), checklist progress bar with done/total count, and always-visible tags
- **Keyboard shortcuts** — `n` (new task), `/` (search), `j`/`k` (navigate), `Enter`/`e` (edit), `x` (complete), `s` (snooze), `Escape` (close/deselect), `?` (help). Disabled when typing in inputs.
- **Sheet modals** — Settings, Routines, Analytics, and Edit Task use centered sheet-overlay modals with X close button (mobile keeps full-screen)
- **Compact header** — "What now?" button in header instead of bottom bar

## Cross-Client Sync

Multiple clients (e.g. PWA + browser tab on the same phone) stay in sync via Server-Sent Events (SSE):

- **Real-time updates** — when you edit in one client, the other receives the change within ~1 second
- **Automatic reconnect** — if the SSE connection drops (mobile background throttling, network interruption), it auto-reconnects
- **Visibility resume** — switching back to the app triggers an immediate sync check as a safety net
- **Stale client protection** — the server rejects writes from old cached JavaScript to prevent data loss

## Pull-to-Refresh

On touch devices, pull down on the task list to refresh data from the server.

## Motivational Toasts

- **AI-generated messages** — when a task is created or updated (title/energy change), Claude pre-generates 4 toast variants (quick completion, normal, long-overdue, reopen) with both headline and subtitle. Messages are stored on the task and served instantly — no async delay.
- **Backfill on load** — pre-existing tasks without messages get them generated in the background on first load (staggered 1s apart).
- **Static fallback** — if AI messages aren't available, funny static messages are used ("Archaeologists found this task", "The sequel nobody asked for", etc.)
- **Undo button** — each completion toast includes an Undo button with a 4-second window to reverse the completion
- **Points display** — shows days on list and points earned as a subtitle suffix

## Done List

- View all completed tasks grouped by date
- Per-task display of how long it was on the list
- **Reopen tasks** — any completed task can be reopened and returned to the active list
- Today's completions highlighted at the top with a count
- "Done today" counter displayed in the header, linking to the done list

## Data Export/Import

- **Export**: downloads a JSON backup of all tasks, routines, settings, and labels
- **Import**: upload a previously exported JSON file to restore data (triggers a page reload)
- Available in Settings under the "Data" section

## Activity Rings and Points

Apple Fitness-inspired activity rings track your daily progress:

- **Tasks ring (green)** — progress toward your daily task completion goal
- **Points ring (orange)** — progress toward your daily points goal
- **Streak ring (blue)** — current streak of consecutive days meeting your goals

### Points System

Each completed task earns points based on its T-shirt size:
- XS = 1 point, S = 2, M = 5, L = 10, XL = 20

Speed bonuses reward fast turnaround:
- Completed same day as created: **2x** points
- Completed within 2 days: **1.5x** points

### Ring Display

- **Mini rings** appear in the header for at-a-glance progress
- **Full rings** are shown on the Analytics screen with detailed breakdowns

## Analytics

Accessible from the overflow menu ("...") in the header, the Analytics screen shows:

- **Activity rings** — full-size daily progress rings (tasks, points, streak)
- **Stat cards** — current streak, longest streak, best daily points, best daily tasks
- **Daily completion chart** — bar chart showing tasks or points per day, with time range picker (7d, 30d, 90d, all time). Toggle between tasks and points view. All-time groups by week.
- **Day-of-week patterns** — 7-bar chart showing which days you're most productive, with "best day" insight. Current day highlighted.
- **Tag breakdown** — horizontal bars showing completions per label, using label colors
- **Energy type breakdown** — completions by energy type (desk, errand, people, etc.) with energy icons
- **Size breakdown** — completions by T-shirt size (XS through XL) with point totals
- **Activity heat map** — GitHub-style contribution graph showing 52 weeks of daily activity. Toggle between tasks (green) and points (orange). Color intensity scales with volume. Scrollable on mobile.
- **Completed task search** — collapsible section; search completed tasks with filters for energy type, size, and tag
- **Vacation mode** — freezes your streak so time away doesn't reset it. Choose a duration (3 days, 5 days, 7 days, or custom) and it auto-expires when the end date passes. End early if you're back sooner.
- **Free day** — one-tap button to pause your streak for a single day without entering vacation mode. Togglable on/off for today.
- **Reset streaks** — clears all streak data, with double confirmation to prevent accidents

## Find Related (Notion)

From any expanded task card, use the "Find Related" button to search your Notion workspace for related pages. Results can be linked to the task, or you can create a new Notion page directly from the search results. This supplements the existing Notion linking available in Add and Edit modals.

## Smart Recurrence

When a routine spawns a new task instance, AI can suggest an appropriate due date based on the routine's notes, cadence, and completion history. This helps recurring tasks get realistic deadlines instead of a generic default.

## File Attachments

Attach files to any task (5 MB limit per file). Attachments can be added in the Add Task modal or Edit Task modal, and are viewable in the expanded task card.

- **Auto-research** — adding an attachment automatically triggers the Research feature, including the file as a Claude API content block (image or document type)
- **Trello sync** — attachments are uploaded to Trello when pushing a task
- **Notion sync** — attachments are uploaded to Notion via the 3-step file upload API when creating a page

## Version Display

The current app version (from git tags or the `APP_VERSION` build arg) is shown in the Settings header.
