# Testing the Notification Stack

End-to-end test sequence for the notification stack (Pushover + curated digest + deep links + engagement analytics + adaptive throttling + tag-based wake-me + inline web-push actions + post-completion next-up + tone-aware AI + weekly pattern review + dedup + From overrides).

Run these after deploy. None of them should require code changes — all configuration is in Settings or env vars.

---

## Prereqs (one-time)

1. **Pushover account** at [pushover.net](https://pushover.net), iOS app installed ($5), signed in.
2. **API token** — Pushover dashboard → Create an Application called "Boomerang". Copy the API Token.
3. **User Key** — top of Pushover dashboard, copy it.
4. **(Optional) Anthropic API key** in Settings → AI for tone-aware rewrites and AI nudges.
5. **(Optional) SMTP** configured via env vars for email tests.

---

## Settings configuration

Open Boomerang → Settings → Notifications.

### Pushover
- Master toggle ON
- **Public app URL** = `https://your-boomerang-host.example.com` (no trailing slash). Without this, deep links won't work.
- **User Key** = your User Key
- **App Token** = your Boomerang application's API Token
- All eight per-type toggles ON (high-priority, overdue, stale, nudges, size, pile-up, package delivered, package exception)
- Save

### Email (optional, for digest test)
- Master toggle ON
- **From name** = "Boomerang" (or your preferred display name)
- **From address** = an address on a domain you control with SPF/DKIM/DMARC configured
- **Recipient** = your inbox
- All per-type toggles ON

### Daily digest
- **Style** = Curated
- **Email digest** ON, **Web push digest** ON, **Pushover digest** ON
- **Time** = a couple of minutes from now (so you can watch it fire), or any time that lets you test manually with the Test button

### Quiet hours (for tag-based bypass test)
- Enable, set the window to cover "now" (e.g. 00:00 → 23:59)
- **Bypass label** = `wake-me` (default)

---

## Test 1 — Basic Pushover delivery

**Goal:** confirm credentials work and the channel delivers.

1. Click **Test Pushover** in Settings → Pushover.
2. ✅ iOS Pushover app receives a notification titled "Boomerang test" within ~5 seconds.

**If it fails:** check User Key + App Token are correct; check `GET /api/pushover/status` reports `configured: true`; check server logs for `[Pushover] Send failed`.

---

## Test 2 — Pushover Emergency (priority 2)

**Goal:** confirm priority-2 alarm rings, repeats every 30s, and auto-cancels.

1. Click **Test Emergency** in Settings → Pushover.
2. Confirm the dialog.
3. ✅ Pushover app rings on iOS with the `persistent` alarm sound.
4. ✅ Alarm repeats every 30 seconds.
5. ✅ Auto-cancels after ~90 seconds (server-side `setTimeout` on the receipt).

**If alarm bypasses DND/silent**: that's expected for priority 2 — that's the entire point.

---

## Test 3 — Stage progression (Pushover)

**Goal:** verify priority-mapping (stage 1 → 0, stage 2 → 1, stage 3 → 2).

1. Disable quiet hours temporarily (so priority 0 fires).
2. Create a task with `high_priority = true` and a due date ~90 seconds in the future.
3. ✅ T+0s: Stage 1 fires at priority 0 (default tone).
4. (If due-date is today by midnight rollover) ✅ T+~60s: Stage 2 fires at priority 1 (`pushover` ringtone, bypasses quiet hours when re-enabled).
5. ✅ T+90s+: Stage 3 fires at priority 2 (`persistent` Emergency, 30s repeats).

**Faster alternative:** create a task with `high_priority = true` AND `energy = errand` AND due date 5 minutes ago. Next dispatcher tick (within 60s) fires priority 2 immediately.

---

## Test 4 — Receipt cancel-on-resolution

**Goal:** confirm Emergency stops as soon as the user acts.

1. Trigger a Stage-3 priority-2 alarm (Test 3 or Test 2).
2. While alarm is ringing, mark the task done in the app (or tap the deep link).
3. ✅ Alarm stops within 30 seconds (next retry is cancelled server-side).
4. Verify in DB: `SELECT pushover_receipt FROM tasks WHERE id = '<task-id>'` returns NULL.

**Tap-as-cancel:** from a different device, tap the alarm's "Open in Boomerang" link. It should both cancel the alarm and stamp `notification_log.tapped_at` for analytics.

---

## Test 5 — Deep links + tap tracking

**Goal:** verify notifications open the right task and the tap is counted.

1. Trigger any Pushover priority-1 or priority-2 notification on a task you can identify.
2. Tap the notification on iOS.
3. ✅ Boomerang opens directly into the EditTaskModal for that task.
4. Open Settings → Analytics → Notification engagement.
5. ✅ The `pushover` row's "tap" count increased by 1.

**Verify in DB:** `SELECT tapped_at FROM notification_log WHERE task_id = '<id>' ORDER BY sent_at DESC LIMIT 1` is non-null and within the last few minutes.

---

## Test 6 — Tag-based quiet-hours bypass (`wake-me`)

**Goal:** confirm only labeled tasks override quiet hours.

1. Set quiet hours to cover "now" in Settings.
2. Create task A: `high_priority = true`, due 5 min ago, NO `wake-me` label.
3. Create task B: `high_priority = true`, due 5 min ago, WITH `wake-me` label (use the "Wake me up for this" checkbox in EditTaskModal).
4. Wait one dispatcher tick (~60s).
5. ✅ Task A: no Pushover notification fires (quiet hours respected).
6. ✅ Task B: Pushover priority 2 fires despite quiet hours.

**Reverse:** uncheck "Wake me up for this" on task B. Next tick: silence resumes.

---

## Test 7 — Curated daily digest

**Goal:** verify digest content is curated, friendly, and tappable.

1. Create a few tasks with varied states:
   - 1-2 due today
   - 1 due in 2 days
   - 1 task `last_touched` 5+ days ago
   - 1 XS or S task
   - Complete a task today (to populate "yesterday recap" tomorrow, or use a streak)
2. Click **Test daily digest** in Settings → Morning Digest.
3. ✅ Email arrives (and/or web push and/or Pushover, per enabled channels).
4. ✅ Email body contains sections: lead-in line → Yesterday recap (if applicable) → Today → Coming up → Carrying → Quick wins → Weather (if configured).
5. ✅ Each task in the email is a clickable link with `?task=<id>` in the URL.
6. ✅ Tapping a digest task in email opens the app on that task.
7. ✅ Subject line is friendly, not alarmist (no "OVERDUE!" or all-caps).

**Empty-state test:** with no active tasks (or all completed), click Test digest again. ✅ Returns `success: false, error: "Nothing to surface..."` — no email sent.

**Style toggle:** set `digest_style = counts` and click Test. ✅ Falls back to the legacy plain-counts format.

---

## Test 8 — Engagement analytics dashboard

**Goal:** verify the analytics panel reflects real engagement.

1. Trigger several notifications (any combination of Tests 1–7).
2. Tap some, ignore others. Complete a task within 24h of a notification.
3. Open Settings → Analytics → expand **Notification engagement**.
4. ✅ "By channel" table shows non-zero `sent` for `pushover` (and `email`/`push` if used). Tap-rate and completion-rate reflect what you did.
5. ✅ "By notification type" table is similar.
6. **Range selector:** change to 7 days, 90 days. Numbers update.

---

## Test 9 — Adaptive throttling + thumbs feedback

**Goal:** confirm the system backs off after consecutive ignored notifications, and that 👎 reverts the back-off.

This is harder to test rapidly because it needs 10 actual notifications. Use the test endpoint repeatedly to seed:

1. Manually fire 10 priority-0 Pushover notifications via repeated `Test Pushover` clicks. Don't tap any of them.
2. Wait for the next dispatcher tick. ✅ Server logs (or the Analytics → Adaptive throttle decisions panel) show a back-off event for `pushover` × `<type>` (1.0× → 1.5×).
3. In Analytics, click 👎 on that decision.
4. ✅ A new "revert" row appears in `throttle_decisions` (multiplier_new back to 1.0). The `(channel, type)` is now in a 7-day override window — auto-tuning suspended.
5. **Verify in DB:** `SELECT * FROM throttle_decisions WHERE channel = 'pushover' ORDER BY decided_at DESC LIMIT 5`.

**Faster alternative:** directly INSERT 10 rows into `notification_log` with the same `channel` + `type`, NULL `tapped_at`/`completed_after`, then trigger a fresh notification. The new send should pick up the multiplier from `getEffectiveThrottleMultiplier()`.

---

## Test 10 — Inline web-push actions (Snooze 1h / Done)

**Goal:** confirm action buttons resolve tasks without opening the app.

**Requires** PWA installed to home screen, web push enabled, `push_notifications_enabled = true`.

1. Create a task with a deep-link payload (any task with `taskId` in `data` — most do).
2. Trigger a web push notification. (Easiest: high-priority Stage 1 with web push enabled.)
3. Long-press / expand the notification on the device.
4. ✅ "Snooze 1h" and "Done" buttons appear.
5. Tap **Snooze 1h**.
6. ✅ Task's `snoozed_until` is set to 1 hour from now; `snooze_count` incremented; `notification_log.tapped_at` stamped.
7. Refresh Boomerang and verify the task is snoozed.
8. **Repeat with Done:** task transitions to `status = done`, `completed_at` set.

---

## Test 11 — Post-completion "Next up" toast

**Goal:** confirm the completion toast surfaces a next-task suggestion.

1. Make sure you have at least 2 active tasks. Mix of high-priority, due dates, and sizes for variety.
2. Complete any task in the app.
3. ✅ Toast appears with the usual congratulatory message AND a "Next up: <next-task-title>" line at the bottom.
4. ✅ The toast stays on screen for 8 seconds (vs the usual 4).
5. Tap the "Next up" line.
6. ✅ EditTaskModal opens on that suggested task.

**Selection logic:** high_priority +100 / due-today +50 / XS or S size +20. Highest score wins.

---

## Test 12 — Tone-aware AI rewrite

**Goal:** confirm AI tone-rewriting kicks in when configured.

**Setup:**
1. Set Anthropic API key in Settings.
2. In Settings → AI, set `Custom instructions` to something distinctive, e.g. *"Use very dry, deadpan humor. No exclamation marks. Address me as 'friend'."*

**Test:**
1. Create a high-priority task with a due date (any path that triggers a high-priority notification — easiest: create with due 5 min ago).
2. Wait for the dispatcher tick.
3. ✅ The Pushover (or web push or email) notification body reads in your custom tone, not the static template.
4. ✅ Stays under 140 characters, plain text, preserves the underlying meaning.
5. **Check budget:** at most one rewrite per dispatcher tick (60s) per channel. Repeated firings within the same minute use the static body.
6. **Emergency exception:** create a stage-3 priority-2 task. ✅ Body is the static template, NOT rewritten (urgency over tone).

**Failure modes** that should fall back gracefully (still use static body):
- No Anthropic key → no rewrite call attempted
- Empty `ai_custom_instructions` → no rewrite call attempted
- Anthropic API down or 2.5s timeout → static body, error logged

---

## Test 13 — Quokka weekly pattern review

**Goal:** confirm avoidance-pattern detection creates a Quokka chat on Sundays.

**Hard to wait for naturally** — to test, temporarily change the trigger gate. In `server.js` `runWeeklyPatternReview()`, change:
```js
if (now.getDay() !== 0) return
if (now.getHours() !== 10) return
```
…to comment those out, then restart the server. (Revert when done.)

**Setup:**
1. Have at least 2 active tasks with `snooze_count >= 3` and `last_touched` within the last 14 days. (You can manually update via the DB or via Quokka tool to bump `snooze_count`.)
2. Clear the `weekly_pattern_review` throttle key: `DELETE FROM notification_throttle WHERE key = 'weekly_pattern_review'`.

**Test:**
1. Restart the server (or wait 30s for the first check).
2. ✅ Server log shows `[WeeklyPatternReview] Created chat <id> with N avoidance pattern(s)`.
3. Open Quokka in the app.
4. ✅ A new chat titled "Weekly pattern review" exists with a seeded user message listing the qualifying tasks.
5. ✅ If Pushover is configured + enabled, a priority-0 ping arrives titled "[BOOMERANG] Weekly pattern review".
6. **Throttle:** trigger the check again. ✅ It does NOT fire — the throttle key blocks for 6.5 days.

**Edge case:** with 0 or 1 qualifying tasks, ✅ no chat created, no ping, no throttle stamped.

---

## Test 14 — Web-push subscription dedup

**Goal:** confirm duplicate subscriptions are removed automatically.

1. Open Boomerang in browser, install as PWA, enable web push.
2. Trigger a test push. ✅ Receives 1 notification.
3. Uninstall the PWA, reinstall, re-enable push.
4. Trigger a test push. ✅ Still receives 1 notification (not 2 or more).
5. **Verify in DB:** `SELECT COUNT(*), p256dh FROM push_subscriptions GROUP BY p256dh HAVING COUNT(*) > 1` returns zero rows.

**One-time cleanup script** (for installs that already accumulated dupes):
```
DB_PATH=/data/boomerang.db node scripts/dedupe-push-subscriptions.js
```
✅ Reports `Found N duplicate keypair group(s); removed M stale row(s).` Re-run is a no-op.

---

## Test 15 — Email From overrides + deliverability

**Goal:** confirm Settings UI override beats env var beats SMTP user.

1. Set `email_from_address = digest@yourdomain.com`, `email_from_name = "Boomerang Digest"` in Settings.
2. Trigger a Test Email or Test Daily Digest.
3. ✅ Email arrives with the From header `"Boomerang Digest" <digest@yourdomain.com>`.
4. **Deliverability:** send to a [mail-tester.com](https://mail-tester.com) address. ✅ Score 9+/10 if SPF/DKIM/DMARC are configured on the sending domain.

---

## Test 16 — Failure isolation across channels

**Goal:** confirm Pushover failures don't break web push or email for the same notification event.

1. Temporarily blackhole Pushover: `echo "127.0.0.1 api.pushover.net" >> /etc/hosts` (in the container, or change DNS to fail).
2. Trigger any notification (e.g. a high-priority overdue task).
3. ✅ Server logs show `[Pushover] Send network error: ...`.
4. ✅ Web push and email still fire successfully.
5. ✅ Dispatcher loop keeps running — no crash.
6. Revert the hosts change. Next notification: Pushover delivers normally.

---

## Test 17 — Graceful no-op (no Pushover credentials)

**Goal:** confirm a fresh install with no Pushover credentials works fine.

1. Clear Pushover credentials in Settings: User Key + App Token both empty.
2. Toggle Pushover master toggle OFF.
3. Trigger any notification.
4. ✅ Web push and email fire normally (if enabled).
5. ✅ No Pushover send attempted, no errors logged.
6. ✅ `GET /api/pushover/status` returns `{ configured: false, has_user_key: false, has_app_token: false }`.

---

## Health-check after deploy

After every deploy, run this quick sequence:

1. **Test Pushover** button → Pushover delivers ✅
2. **Test daily digest** button → at least email + Pushover deliver ✅
3. Create a high-priority overdue task → wait 60s → Pushover priority-1 (or priority-2 if avoidance) fires with deep-link URL ✅
4. Tap the deep link → app opens on the task ✅
5. Mark task done → check `notification_log.completed_after` is stamped (proves end-to-end engagement loop works) ✅

If all 5 pass, the notification stack is healthy. If 1–2 fail, check Configuration.md for setup steps. If 3+ fail, check server logs for module load errors (most likely a missing-from-Dockerfile bug).
