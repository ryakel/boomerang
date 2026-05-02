-- Add pushover_receipt column to tasks (default NULL = no outstanding emergency)
-- When a Pushover priority-2 (Emergency) notification is sent, the receipt id
-- returned by the API is stored here so we can cancel the retry loop when the
-- task is resolved (or when the user taps the alarm to engage).
ALTER TABLE tasks ADD COLUMN pushover_receipt TEXT;
