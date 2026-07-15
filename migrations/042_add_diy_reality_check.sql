-- DIY-or-hire "Reality check" (2026-07-14): repair/construction-shaped tasks
-- get an automatic, blunt AI assessment of whether the user should actually
-- do the job themselves or hire it out. Per the user: "I am admittedly not
-- handy. I should stop trying to always fix shit myself." The verdict STARTS
-- at 'hire' and DIY has to earn it (trivially-easy jobs only).
--
-- diy_assessed    Set once the assessment has run for this task (mirrors the
--                 crisis_triage_done pattern; reset never — a manual override
--                 in EditTaskModal flips the verdict instead of re-running).
-- diy_verdict     'hire' | 'diy' | NULL. 'hire' switches the task's nag
--                 framing to push the call, not the repair.
-- diy_reason      One blunt sentence of reasoning shown in EditTaskModal.
-- diy_first_move  One imperative step ("Call 2 plumbers for quotes") — used
--                 by the notification engines as the task's first move.
ALTER TABLE tasks ADD COLUMN diy_assessed INTEGER DEFAULT 0;
ALTER TABLE tasks ADD COLUMN diy_verdict TEXT;
ALTER TABLE tasks ADD COLUMN diy_reason TEXT;
ALTER TABLE tasks ADD COLUMN diy_first_move TEXT;
