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
- **Statuses** — not started, doing, waiting, done (plus backlog as a separate concept). Change status directly from the expanded task card.
- **Checklists** — add checklist items to any task. Toggle items directly from the expanded card without opening the edit modal. Progress shown as "2/5 items".
- **Comments** — append timestamped notes/comments to tasks from the edit modal. Useful for tracking updates on longer-running tasks.
- **Due dates** — with overdue detection and visual indicators (days overdue, due today, due tomorrow, etc.)
- **Default due dates** — configurable number of days from now (default: 7), applied automatically to new tasks. Set to 0 to disable.
- **Extend due dates** — quick presets (+1 day, +1 week, +2 weeks) or pick a custom date via the extend modal
- **Labels** — custom labels with a 10-color picker, used for filtering tasks in the tag bar
- **T-shirt sizing** — XS, S, M, L, XL effort estimates. Set manually or auto-inferred by AI during polish. Displayed as a pill on each task card.

## Task Sections

Tasks are organized into sections on the main screen:

- **Stale** — tasks untouched for longer than the staleness threshold (default: 2 days)
- **Up Next** — active tasks (not started + doing) that are not stale or snoozed
- **Waiting** — tasks marked as blocked/waiting on someone
- **Snoozed** — tasks with a future snooze date, showing when they'll return
- **Backlog** — someday/maybe tasks in a collapsible section at the bottom. Move tasks to backlog to keep them out of your active list without losing them.

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

## Snooze System

Four preset options: Tonight, Tomorrow, This Weekend, Next Week. Each snooze increments a counter. After hitting the reframe threshold (configurable, default: 3), snoozing triggers the Reframe flow instead.

## Routines (Recurring Tasks)

Recurring tasks with configurable cadence:

- **Frequencies**: daily, weekly, monthly, quarterly, annually, or custom (every N days)
- **Management**: routines live in their own screen, accessible from the tag bar. Active and paused routines are shown separately.
- **Auto-spawning**: when a routine is due, a task instance is automatically created in the main task list. Completing the instance logs the completion on the routine and schedules the next occurrence.
- **Pause/resume**: routines can be paused without deleting them
- **Convert from task**: any one-off task can be converted to a routine via the Edit modal, which removes the original task and creates the routine

## Notion Integration (requires Notion token)

- **Search and link** — search existing Notion pages from the Add or Edit task modal and link them to tasks
- **AI-suggested linking** — when searching, AI evaluates whether any found pages are a good match or if a new page should be created
- **Create pages** — AI generates structured Notion page content from the task title and notes, then creates the page in Notion
- **Parent page** — new pages are created under a configurable parent page ID, or under the first accessible page if none is set
- **Connection indicators** — linked tasks show an "N" badge next to the title. Tap to open the Notion page directly.
- **Open in Notion** — linked tasks show an "Open in Notion" link when expanded
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

The mapping is **AI-inferred** — when you first connect a board, Claude analyzes your list names and automatically maps them to Boomerang statuses. You can re-infer the mapping at any time from Settings. Backlog is a Boomerang-only concept with no Trello equivalent.

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

- **Push to Trello** — from the Edit modal's Connections section, push any task to Trello. The AI selects the appropriate list based on the task's current status and the inferred list mapping.
- **Linked cards** — once pushed, the Trello connection shows as a green badge with a direct link to open the card in Trello, and an unlink button.
- **Pull from Trello** — the `useTrelloSync` hook pulls cards from all mapped lists, updates linked task statuses, and uses AI to deduplicate new cards against existing tasks.
- **Status sync** — changing a task's status in Boomerang automatically moves the linked Trello card to the matching list.
- **AI deduplication** — when new Trello cards are found, Claude compares them to existing tasks and auto-links matches above the confidence threshold. Only truly new cards create new tasks.
- **Board/list selection** — configure which board and default list to sync with in Settings. Change anytime.
- **Sync Now button** — manual sync trigger in Settings with last-sync timestamp display.
- **List mapping display** — view and re-infer the AI-generated list mapping in Settings.

## Notifications

Browser push notifications with configurable options:

- **Frequency**: 15 minutes, 30 minutes, 1 hour, or 2 hours
- **Types** (individually toggleable):
  - Overdue tasks — tasks past their due date
  - Stale tasks — tasks untouched beyond the staleness threshold
  - General nudges — motivational messages (AI-generated when custom instructions are set, otherwise from a built-in list of ADHD-friendly messages)
  - Stale task percentage warning — notification when the percentage of stale tasks exceeds a configurable threshold
  - Size-based reminders — advance reminders based on task size: XL tasks 3 days before due, L tasks 2 days before, M tasks 1 day before
  - AI small-task nudge — suggests a specific XS or S task by name in the notification, encouraging you to knock out a quick win

## Sorting

Tasks can be sorted via a dropdown in the header. Available sort options:

- **Age** — oldest tasks first (default)
- **Due date** — earliest due date first
- **Size** — smallest effort first
- **Name** — alphabetical by title

## Cross-Client Sync

Multiple clients (e.g. PWA + browser tab on the same phone) stay in sync via Server-Sent Events (SSE):

- **Real-time updates** — when you edit in one client, the other receives the change within ~1 second
- **Automatic reconnect** — if the SSE connection drops (mobile background throttling, network interruption), it auto-reconnects
- **Visibility resume** — switching back to the app triggers an immediate sync check as a safety net
- **Stale client protection** — the server rejects writes from old cached JavaScript to prevent data loss

## Pull-to-Refresh

On touch devices, pull down on the task list to refresh data from the server.

## Motivational Toasts

- **Completion toasts** — context-aware messages when you complete a task. Quick messages for same-day tasks, normal messages for recent tasks, celebratory messages for long-standing tasks. Shows days on list, today's completion count, and points earned.
- **Undo button** — each completion toast includes an Undo button with a 4-second window to reverse the completion
- **Reopen toasts** — encouraging messages when you reopen a task from the done list ("Back in the ring", "Round two — you got this", etc.)

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

Accessible via the chart icon in the header, the Analytics screen shows:

- **Activity rings** — full-size daily progress rings
- **Current streak** — consecutive days meeting your daily goals
- **Longest streak** — your all-time best streak
- **Best daily points** — highest points scored in a single day
- **Best daily tasks** — most tasks completed in a single day
- **Vacation mode** — freezes your streak so time away doesn't reset it. Choose a duration (3 days, 5 days, 7 days, or custom) and it auto-expires when the end date passes. End early if you're back sooner.
- **Free day** — one-tap button to pause your streak for a single day without entering vacation mode. Togglable on/off for today.
- **Reset streaks** — clears all streak data, with double confirmation to prevent accidents

## Find Related (Notion)

From any expanded task card, use the "Find Related" button to search your Notion workspace for related pages. Results can be linked to the task, or you can create a new Notion page directly from the search results. This supplements the existing Notion linking available in Add and Edit modals.

## Smart Recurrence

When a routine spawns a new task instance, AI can suggest an appropriate due date based on the routine's notes, cadence, and completion history. This helps recurring tasks get realistic deadlines instead of a generic default.

## File Attachments

Attach files to any task (5 MB limit per file). Attachments can be added in the Add Task modal or Edit Task modal, and are viewable in the expanded task card.

## Version Display

The current app version (from git tags or the `APP_VERSION` build arg) is shown in the Settings header.
