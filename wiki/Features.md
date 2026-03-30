# Features

## Core Concept

Every task always comes back. Dismissal is never free — every "not now" requires a "then when."

## Task Management

- **Quick add** — type and hit Enter from the bottom bar to instantly create a task
- **Full add modal** — title, notes, due date, labels, T-shirt size, and Notion link
- **Edit tasks** — full edit modal with all fields, including the ability to convert a one-off task into a routine
- **Hover action buttons** — edit and done buttons appear on hover over any task card
- **Expanded actions** — tap a task to expand it and reveal Done, Snooze, Extend, Edit, and Backlog buttons
- **Statuses** — open, snoozed, stale, backlog, done
- **Due dates** — with overdue detection and visual indicators (days overdue, due today, due tomorrow, etc.)
- **Default due dates** — configurable number of days from now (default: 7), applied automatically to new tasks. Set to 0 to disable.
- **Extend due dates** — quick presets (+1 day, +1 week, +2 weeks) or pick a custom date via the extend modal
- **Labels** — custom labels with a 10-color picker, used for filtering tasks in the tag bar
- **T-shirt sizing** — XS, S, M, L, XL effort estimates. Set manually or auto-inferred by AI during polish. Displayed as a pill on each task card.

## Task Sections

Tasks are organized into sections on the main screen:

- **Stale** — tasks untouched for longer than the staleness threshold (default: 2 days)
- **Up Next** — active tasks that are not stale or snoozed
- **Snoozed** — tasks with a future snooze date, showing when they'll return
- **Backlog** — someday/maybe tasks in a collapsible section at the bottom. Move tasks to backlog to keep them out of your active list without losing them.

## Task Count Display

The header shows a task count with configurable display modes:

- **Open only** — just the count of non-snoozed open tasks
- **Active** — non-snoozed open tasks as a fraction of total open + backlog tasks
- **All** — non-snoozed open tasks as a fraction of total open + done tasks

## AI Features (requires Anthropic API key)

All AI features use Claude (claude-sonnet-4-20250514) via a server-side proxy. They are fully disabled if no API key is configured — the rest of the app works normally without them.

- **What Now** — a guided flow that asks how much time you have (5-10 min, 30 min, a couple hours) and your energy level (running on fumes, moderate, I've got it), then recommends 1-3 tasks with reasons. You can mark tasks done directly from the suggestions.
- **Polish** — takes messy brain-dump notes and turns them into clear, actionable bullet points. Also cleans up the task title if it's vague. Automatically triggers date inference and size inference on the polished content.
- **Date inference** — extracts due dates from natural language in task titles and notes ("do this by Friday", "end of month", etc.). Runs automatically after polishing if no due date is set.
- **Size inference** — estimates task effort as a T-shirt size (XS through XL) based on the task description. Runs automatically after polishing.
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
- **Open in Notion** — linked tasks show an "Open in Notion" link when expanded
- **Routine support** — routines can also be linked to Notion pages

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
- **Vacation mode** — freezes your streak so time away doesn't reset it. Resume when you're back.
- **Reset streaks** — clears all streak data, with double confirmation to prevent accidents

## Find Related (Notion)

From any expanded task card, use the "Find Related" button to search your Notion workspace for related pages. Results can be linked to the task, or you can create a new Notion page directly from the search results. This supplements the existing Notion linking available in Add and Edit modals.

## Smart Recurrence

When a routine spawns a new task instance, AI can suggest an appropriate due date based on the routine's notes, cadence, and completion history. This helps recurring tasks get realistic deadlines instead of a generic default.

## File Attachments

Attach files to any task (5 MB limit per file). Attachments can be added in the Add Task modal or Edit Task modal, and are viewable in the expanded task card.

## Version Display

The current app version (from git tags or the `APP_VERSION` build arg) is shown in the Settings header.
