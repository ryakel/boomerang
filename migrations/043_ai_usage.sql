-- AI usage tracking (2026-07-17, OpenAI integration + usage dashboard).
-- One row per AI call, logged server-side at the gateway/proxy so every
-- surface is covered regardless of provider. Cost is the estimate computed
-- at insert time from the pricing table in aiModels.js (a snapshot — later
-- price changes don't rewrite history); NULL when the model isn't priced.
CREATE TABLE IF NOT EXISTS ai_usage (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  feature TEXT,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cost_estimate REAL
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_ts ON ai_usage(ts);
