// Single source of truth for which Claude model each AI feature uses.
// Previously the model id was a literal string repeated at every call site
// (server AND client) — a model upgrade meant grep-and-replace across a
// dozen files instead of one edit. No Node-specific dependencies here, so
// this file is safe to import from both server modules and the Vite client
// bundle (src/api.js, src/hooks/useNotifications.js).
//
// SONNET_MODEL — the workhorse tier: Quokka's adviser chat, Gmail
// classification, Growth Areas inference/rephrasing, routine pattern
// detection, weekly tag suggestions, AI-generated nudge/toast messages,
// task research, escalation-ladder generation, size/energy inference.
// HAIKU_MODEL — cheap/fast tier: AI-assisted search (Activity Log, Done
// list), short push-notification message generation.
export const SONNET_MODEL = 'claude-sonnet-5'
export const HAIKU_MODEL = 'claude-haiku-4-5-20251001'
