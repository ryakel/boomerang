# Screenshots

Every image on this page — and everywhere else in this wiki — is captured from
**`scripts/demo-data.json`**, a fictional dataset written for exactly this
purpose. No real task, label, note or reminder appears in any published image.

To reproduce the whole set:

```bash
node scripts/make-demo-data.mjs
SEED_DB=1 SEED_FILE=scripts/demo-data.json PORT=3060 npm start
BASE=http://localhost:3060 node scripts/capture-screenshots.mjs
```

Mobile is 390×844 @3x (iPhone 14 logical size); desktop is 1440×900 @2x.

Then quantise before committing — these are flat-UI screenshots (large areas of
solid colour and text), so a 256-colour adaptive palette is visually lossless
here and about a third of the bytes. It took the set from 6.3 MB to 2.4 MB,
which matters because every re-shot image is a new blob in git history forever:

```bash
python3 - <<'EOF'
from PIL import Image
import glob
for p in glob.glob('wiki/images/*.png'):
    Image.open(p).convert('RGB').quantize(colors=256, dither=Image.NONE).save(p, optimize=True)
EOF
```

> **Do not point the capture script at a server holding real data.** The
> filenames it writes are the ones the wiki embeds, so a mistake here publishes
> a live database rather than a demo of one.

## Mobile — the PWA / installed app

| Today | Tasks | Loops |
|:--:|:--:|:--:|
| ![Today](images/kept-mobile-today.png) | ![Tasks](images/kept-mobile-tasks.png) | ![Loops](images/kept-mobile-loops.png) |
| The points arc, the day's list, overdue and ⏰ reminder badges | Grouped by when, with label filters across the top | A trail per loop — caught cycles, streak, and a quiet "to fix" chip |

| Throw · task | Throw · reminder | Long-press sheet |
|:--:|:--:|:--:|
| ![Throw a task](images/kept-mobile-throw.png) | ![Set a reminder](images/kept-mobile-throw-reminder.png) | ![Row action sheet](images/kept-mobile-tasks-sheet.png) |
| Day chips under the title | The same slot becomes a date-and-time picker | Reschedule, edit or delete without opening the task |

| Quick edit | Reminders | Loop detail |
|:--:|:--:|:--:|
| ![Quick edit](images/kept-mobile-edit-task.png) | ![Reminders](images/kept-mobile-reminders.png) | ![Loop detail](images/kept-mobile-loop-detail.png) |
| Subtasks inline; the rest behind chips | Passed / later today / upcoming | Cadence, trail and history for one loop |

| More | What now? |
|:--:|:--:|
| ![More](images/kept-mobile-more.png) | ![What now](images/kept-mobile-whatnow.png) |

### Dark

| Today | Loops |
|:--:|:--:|
| ![Today, dark](images/kept-mobile-today-dark.png) | ![Loops, dark](images/kept-mobile-loops-dark.png) |

## Desktop — the web app

The phone layout expands into three columns rather than turning into a
different product: the same surfaces, more of them visible at once.

| Today | Tasks · list |
|:--:|:--:|
| ![Desktop Today](images/kept-desktop-today.png) | ![Desktop Tasks list](images/kept-desktop-tasks-list.png) |

| Tasks · board | Loops |
|:--:|:--:|
| ![Desktop Board](images/kept-desktop-tasks-board.png) | ![Desktop Loops](images/kept-desktop-loops.png) |

![Desktop Throw](images/kept-desktop-throw.png)

## Settings

| General | Tasks |
|:--:|:--:|
| ![Settings General](images/settings-general.png) | ![Settings Tasks](images/settings-tasks.png) |

| Labels | Notifications |
|:--:|:--:|
| ![Settings Labels](images/settings-labels.png) | ![Settings Notifications](images/settings-notifications.png) |

![Settings Integrations](images/settings-integrations.png)

## Notes on the demo dataset

It is shaped to fill every surface a reader will meet rather than to look
impressive: a couple of genuinely overdue tasks, a today list with reminders on
it, one task waiting on someone else, a project with subtasks, a long
undated tail, and enough completions today that the points arc isn't sitting at
zero.

Loop history is synthesised at seed time from a per-dataset `seed_adherence`
(0.93 for the demo, 0.8 for the dev seed) — high enough that the trails read as
habits being kept, low enough that the "to fix" affordance still appears doing
its job.
