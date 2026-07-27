# Settings Design Language

Status: **specified, not yet implemented.** This is the design language for every
settings surface in Boomerang — the rules that make settings screens consistent
and scannable, and that a future change can follow without inventing. It extends
the Kept language (`wiki/Kept-Design-Language.md`, esp. §4 "hairline lists" and
§13b "progressive disclosure") into the one surface Kept never covered properly.

Scope: **presentation only.** Nothing here changes how settings are stored,
synced, or written. Every row still calls the same `update(key, value)` path;
the settings-blob hazards (last-writer-wins, merge guards, `app_data`
carve-outs — see the `add-setting` skill) are untouched by this document.
Collapse/expand state stays session-local and is never persisted (the
2026-07-17 rule that already exists in `SettingsModal.jsx:21-24` stands).

---

## 0 · The audit — what is actually inconsistent today

The owner's complaint ("we condensed and collapsed it and it's hard to read and
inconsistent anyway") is verifiable in the code. As of 2026-07-27:

**Seven different collapse/disclosure implementations** coexist in the settings
surface:

| # | Pattern | Where | Affordance |
|---|---|---|---|
| 1 | `SettingsSection` | `SettingsModal.jsx:25` | raw `▸`/`▾` text glyph, far left |
| 2 | `SectionHeader` | `SettingsModal.jsx:2005` (NotificationsPanel) | identical to #1 but hand-rolled again with its own `openSections` state |
| 3 | `FormDisclosure` | `src/components/FormDisclosure.jsx` (task/routine editors) | lucide `ChevronDown`, right side, rotates |
| 4 | `InfoHintRow` | `SettingsModal.jsx:50` | lucide `Info` glyph toggles a hint paragraph |
| 5 | Notification history toggle | `.v2-notif-history-toggle`, own chevron char | text chevron, right side |
| 6 | Integration expander | `.v2-integrations-name-toggle` + `.v2-chevron-open` | lucide `ChevronRight`, rotates 90° via class |
| 7 | Label color picker | native `<details>/<summary>` in `LabelsPanel` | none (swatch is the summary) |

**Four different row-title styles**: `.v2-form-label` (600 11px ALL-CAPS
letterspaced, `--v2-text-meta`), `.v2-settings-row-label` (500 14px sentence
case, `--v2-text`), `.v2-notif-card-label` (600 14px), `.v2-integrations-name`
(600 14px). Section headers use the *smallest, dimmest* of the four.

**The inverted hierarchy, precisely:** a collapsed `SettingsSection` header
renders its label as `.v2-form-label` — `600 11px`, uppercase, `0.08em`
tracking, `--v2-text-meta` — and directly beneath it the `hint` prop as
`.v2-settings-row-hint` — `400 12px/1.5`, sentence case, same `--v2-text-meta`,
wrapping to two lines. The description is physically larger than the label it
describes, and neither carries a value. Six of those stacked is the General
and Data tabs today.

**Summaries describe, never state.** Every `SettingsSection` hint in the file
is prose about what lives inside ("Theme family and light/dark mode.",
"Due-date defaults, staleness, reframe trigger, DIY reality check.") — not one
shows what is currently *set*. `FormDisclosure`'s own header comment promises
"collapsed rows show a summary of what's set inside" and no settings caller
honors it.

**Four different row paddings**: `.v2-settings-row` 18px 0, `.v2-labels-row`
10px 0, `.v2-integrations-row` 16px 0, `.v2-notif-card` 12px 14px.

**The tab strip fails at phone width.** Six pills (`.v2-settings-tabs`) at
12px in a ~330px content column don't fit one row; depending on build they
wrap into a ragged second row or clip ("Notifica…"). Either way the top of
the surface reads as broken.

**Dead space**: General holds exactly seven settings and two status values,
collapsed into three dim rows filling the top third of the screen. The
collapse machinery costs a tap per section and hides one-word values.

Every rule below exists to kill one of these findings.

---

## 1 · Principles

Five rules. Each settles an argument; each names the failure it prevents.

1. **A row at rest shows its value.** If a setting's current state fits on the
   row — and almost every one here does: `Kept`, `Dark`, `7 days`, `On`,
   `Connected` — it is visible without any tap. A summary is a **value**,
   never a description of what could be set. *(Prevents: today's
   expand-everything-to-learn-anything surface.)*

2. **The label is the biggest thing in the row.** Scan order is label →
   value → (rarely) description, and the type hierarchy matches: label
   brightest and largest, value second, description smallest and usually
   absent. *(Prevents: the inverted 11px-caps-label / 12px-prose-hint stack.)*

3. **One level of hiding, ever.** A setting is either on the page, or exactly
   one drill-down away behind a navigation row that states its value. Never a
   collapsed section *containing* collapsed rows, never a hint behind a hint.
   *(Prevents: disclosure-inside-disclosure archaeology in Integrations.)*

4. **One component per job.** There is one row component family, one
   disclosure, one group wrapper, one chevron. A new settings screen composes
   them; it does not define a local `SectionHeader`. *(Prevents: the seven
   parallel collapse implementations.)*

5. **Descriptions are earned, not default.** Most settings are explained by
   their label and value. A persistent description is allowed only where
   misunderstanding causes harm (danger zone, security). Everything else goes
   behind the row's info affordance or gets deleted. *(Prevents: two lines of
   `--v2-text-meta` prose under every row, and the dead space it creates.
   This also honors the standing 2026-07-17 user request: "I want to click
   on each for a description — otherwise they should be minimized.")*

---

## 2 · Row taxonomy

Every settings row is one of these eight kinds. If a new setting doesn't fit
one, the taxonomy gets a deliberate amendment — don't invent an ad-hoc row.

Shared anatomy for all kinds (the base `SettingRow`):

```
┌──────────────────────────────────────────────┐
│ Label ⓘ?                    [value/control] │  min-height 52px
└──────────────────────────────────────────────┘  padding 0 (rows are
   ↑ 400/500 15px --v2-text        ↑ trailing      full-bleed inside the
                                                   24px modal body pad)
```

- Min height **52px** (≥44pt target with breathing room), vertically centered.
- Hairline divider `1px solid var(--v2-hairline)` **between** rows only —
  never after the last row of a group (`:last-child { border-bottom: none }`).
- The **entire row** is the touch target for toggle, navigation, and
  disclosure kinds — not just the control.
- Optional `ⓘ` info affordance (lucide `Info`, 13px, `--v2-text-faint`)
  immediately after the label; tapping it folds a description paragraph out
  *below* the row content (12px, `--v2-text-meta`). This is `InfoHintRow`'s
  behavior, absorbed into the base row so every kind can have it.

### 2.1 Toggle row
- **Use for:** a boolean that takes effect immediately (show 7-day strip,
  DIY reality check, channel masters).
- **Rest state:** label left, existing `Toggle` switch right. The switch IS
  the value — no text value.
- **Interaction:** tapping anywhere on the row flips it (whole-row `<label>`).
- **Dependent toggles** (e.g. "Open 7-day strip by default" under "Show
  7-day strip") render at 0.45 opacity and non-interactive while the parent
  is off — never hidden, so the user learns the relationship.

### 2.2 Value row (picker)
- **Use for:** an enum or reference the user picks from a list (AI model,
  Notion parent page, weather location).
- **Rest state:** label left; current value right in `400 15px
  var(--v2-text-meta)`, ellipsized from the left if long.
- **Interaction:** row tap opens the picker. For native `<select>`-backed
  values, the styled select overlays the trailing area (existing pattern,
  kept — no new dependency); for anything richer, the row navigates to a
  sub-page (kind 2.4).

### 2.3 Segment row
- **Use for:** an enum of **2–3 options with short labels** where seeing all
  options at once matters (Theme family, Mode). 4+ options or long labels →
  kind 2.2 instead.
- **Rest state:** label left, `.v2-settings-segment` control trailing when the
  options fit (`Standard | Kept` does; `Light | Dark | System` does down to
  360px). If they don't fit, the stacked variant (`.v2-settings-row-stacked`)
  puts the segment on its own line — the only sanctioned two-line row at rest.

### 2.4 Navigation row
- **Use for:** drilling into a sub-page (a settings category from the index,
  Impact dates, Custom instructions, a single integration, Devices,
  Notification history).
- **Rest state:** label left; **value summary** right in `--v2-text-meta`
  (`"2 dates"`, `"Set"`, `"Connected"`, `"Kept · Dark"`); lucide
  `ChevronRight` 16px `--v2-text-faint` at the far right edge. The chevron is
  trailing, always — leading `▸` glyphs are banned.
- **Summary rule:** must be derivable synchronously from already-loaded
  state. If it would need a fetch, show nothing (empty trailing) rather than
  prose about the destination.

### 2.5 Action row
- **Use for:** a verb (Export, Import, Open activity log, Test push, Sync
  now, Change server…).
- **Rest state:** existing `.v2-settings-btn` pill(s), left-aligned in the
  row body; related actions share one row (`.v2-settings-actions`). Actions
  are never disguised as toggles or navigation.
- **Async state:** the button carries its own progress label
  ("Reseeding…") and disables — no global spinners.

### 2.6 Destructive action
- **Use for:** anything that deletes data (Clear completed, Clear all data,
  Revoke device, Remove label).
- **Rest state:** inline destructive (revoke/remove) = `.v2-settings-btn`
  tinted `var(--bm-danger)` (defined for every v2 theme in
  `src/kept/palette.css:30` — crimson, deliberately not the ember accent and
  not `--v2-alert-overdue`, which is task-status vocabulary). Page-level
  destructive = the existing danger card (`.v2-settings-danger`), retinted
  from the hardcoded `rgba(232,68,58,…)` to `--bm-danger`-derived, always the
  **last** group on its page, never collapsed.
- **Interaction:** always a confirm dialog; the confirm restates the count of
  what dies. This is the one row kind where a persistent description is
  mandatory ("No undo other than restoring from a backup.").

### 2.7 Status row
- **Use for:** read-only facts (App build, Server version, connection state,
  push subscription state, muzzle banner).
- **Rest state:** label left; value right in the mono treatment
  (`.v2-settings-build`: ui-monospace 13px on `rgba(var(--v2-text-rgb), .06)`).
  Health-ish statuses get the existing dot vocabulary
  (`.v2-integrations-dot-connected` green / `-warn` amber / `-unconfigured`
  faint) before the value. No chevron — nothing to open. Explanations live
  behind the `ⓘ`.

### 2.8 Free-text / credential row
- **Free-text** (custom instructions): a navigation row whose sub-page is a
  full-width `.v2-form-textarea` plus its action row (Import/Export/Clear).
  Multi-line editors never sit inline on a list page.
- **Credential/secret** (API keys, Pushover tokens): label + masked value
  (`••••` + last 4 where safe, or `Set` / `Not set`) + a `Change…` action.
  Secrets are never echoed at rest. (Aligned with the Quokka secret blocklist
  posture in `adviserToolsMisc.js` — settings UI must not display what the
  adviser is forbidden to read.)

**List editors** (Labels, Impact dates, push devices, enrolled devices) are
not a row kind — they are sub-pages composed of the kinds above: each item a
row (usually 2.2/2.4 + an inline 2.6), plus one 2.5 "Add…" action row at the
bottom.

---

## 3 · The collapse rule

The current failure mode is collapsing things whose value is one word. So:

1. **If a row's value fits on the row, it must not hide behind a disclosure.**
   `Theme: Kept`, `Daily goal: 3`, `Staleness: 7 days` are rows, full stop.
   They may live one navigation level down (§6), but on their page they are
   permanently visible.

2. **Groups on a settings page never collapse.** `SettingsSection` — the
   collapse-everything wrapper — is deleted (§7). Pages are kept short enough
   not to need folding by the navigation model instead (§6). A page with ≤ ~10
   rows in 2–3 groups needs no collapse; every redesigned page in §8 meets
   that.

3. **In-place disclosure is reserved for unbounded or streaming content**
   that would otherwise dominate the page: server log stream, notification
   history list, an integration's advanced sub-settings. These use the one
   blessed component (`FormDisclosure`, restyled per §7.3) and its summary
   **must state a value**: `"18 entries"`, `"live"`, `"3 lists"` — never
   "Live tail of the server process."

4. **Descriptions collapse by default** (behind `ⓘ`, §2 anatomy) — that is
   the only other sanctioned hiding, and it is one level deep (rule 1.3:
   never a disclosure inside a disclosure, never `ⓘ` inside one either).

5. Disclosure open-state is session-local component state. It is **never
   written to settings** — the blob is last-writer-wins and UI chrome state
   must not ride it (this is already the codebase rule; it becomes design
   law here).

---

## 4 · Type scale and hierarchy

All from existing tokens; body face `--v2-font-body` (DM Sans), display face
`--v2-font-display` (Fraunces in Kept themes) for page titles only.

| Role | Spec | Token colors | Notes |
|---|---|---|---|
| Page title | `700 32px/1.1 var(--v2-font-display)` | `--v2-text` | Existing `.v2-modal-title`, unchanged. Sub-page titles: `700 22px/1.15` same face. |
| **Row label** | `500 15px/1.3 var(--v2-font-body)` | `--v2-text` | Sentence case. The brightest, largest thing in a row. (Up from today's 14px, and dethrones the caps caption.) |
| Row value / summary | `400 15px/1.3` | `--v2-text-meta` | Right-aligned, trailing. Numeric values `font-variant-numeric: tabular-nums`. Mono variant for builds/versions (§2.7). |
| Group caption | `600 11px/1` uppercase, `0.08em` tracking | `--v2-text-faint` | The existing `.v2-form-label` treatment, demoted to `--v2-text-faint` and **only** ever used as a non-interactive caption above a group — never as a tappable row label again. |
| Description (folded) | `400 12px/1.5` | `--v2-text-meta` | Max ~3 lines of copy. If it needs more, the copy is wrong. |
| Persistent description | `400 12px/1.45`, single line | `--v2-text-meta` | Danger zone and security rows only (§1.5). |

Explicit orderings this fixes:

- **Label > description, always** — in size (15 vs 12), weight (500 vs 400)
  and color (`--v2-text` vs `--v2-text-meta`). Today it is the reverse.
- **Descriptions are optional and subordinate.** The default row has none.
  A description earns its place only when the label + value genuinely cannot
  carry the meaning **and** getting it wrong costs something. Audit result
  against today's copy: of the ~14 hints on General/Tasks, two survive as
  persistent text (danger zone, device revocation), about five move behind
  `ⓘ`, the rest are deleted.

---

## 5 · Spacing, grouping, dividers

- **Row:** min-height 52px, full-bleed width inside the modal body's existing
  24px horizontal padding (no per-row horizontal padding — Kept is "plain
  hairline rows", not iOS inset cards; see Kept §4). Internal gap between
  label block and trailing control: 16px.
- **Divider:** `1px solid var(--v2-hairline)` between sibling rows. No divider
  after a group's last row; no divider directly under a group caption. Never
  two hairlines adjacent (the current `.v2-settings-section` +
  `.v2-settings-row` double-border stacking is a bug this rule outlaws).
- **Group:** caption (§4) + its rows. 28px vertical gap between groups —
  the caption's top margin, so the previous group's final row reads as
  closed. A group earns a caption only when a page has **two or more**
  groups; a single-group page shows rows with no caption (the page title
  already names it).
- **Sub-page top:** back affordance + title block, 16px below the modal
  header hairline, 20px above the first group.
- **Danger card:** the one framed element (12px radius, `--bm-danger` tint
  border/background) — visual exception is the point.
- No other boxes, cards, or background tints on settings pages. The
  Notifications per-type cards (`.v2-notif-card`) are re-cut as plain grouped
  rows under this language (§8 note).

---

## 6 · Navigation — replacing the six-tab strip

**Decision: a settings index that drills down. The tab bar is deleted.**

Root = an index page of navigation rows (§2.4), one per category, each
showing a live value summary. Tapping drills into a category page; a back
control (lucide `ChevronLeft` + previous title, top-left, 44px target)
returns. One level of depth for categories; a second level only for the
sub-surfaces named in §8 (Impact dates, Custom instructions, per-integration
pages, Devices, History/Logs). Never deeper.

Why this over the alternatives considered:

- **Scrollable segmented control / horizontally scrolling tabs:** solves the
  clipping, but hidden tabs are undiscoverable off-screen state, horizontal
  scroll inside a bottom sheet fights the sheet-dismiss gesture on iOS, and
  a 7th category re-breaks it. Rejected.
- **Fewer, merged tabs (e.g. 4):** already tried in spirit — the current six
  ARE a merge (the file's own comment at `SettingsModal.jsx:240-247`
  describes folding AI and Logs away). Merging further makes each tab longer
  and brings back the collapse machinery this document deletes. Rejected.
- **Index + drill-down:** fits the phone-first one-handed reality (list rows
  are full-width thumb targets in the bottom sheet's natural reach; no
  reaching for a top strip), scales to any category count, and — decisive —
  the index rows *carry the value summaries* that principle 1 demands, so
  the root screen answers "what's my setup?" at a glance instead of being
  pure chrome. It also matches the app's existing hub-and-detail mobile IA
  (Kept K3) instead of introducing a second navigation idiom.

Root index (six rows, one group, no caption):

| Row | Summary (from loaded settings, sync only) |
|---|---|
| General | `Kept · Dark` (theme family + mode) |
| Tasks | `Due +7d · Stale 7d` |
| Labels | `8 labels` |
| Integrations | *(empty — status needs fetches; rule §2.4)* |
| Notifications | `Push · Pushover` (enabled channel masters) or `Off` |
| Data | *(empty)* |

Desktop: the modal is already a 640px right-side drawer (`ModalShell.css`).
The same stack navigation runs inside it unchanged — pages slide
horizontally with the existing motion tokens (`--v2-dur-emphasis` /
`--v2-ease-emphasis`; instant under `prefers-reduced-motion`). Desktop does
not degrade: it gains the index's at-a-glance summaries and loses a cramped
pill strip. No two-pane split view — one navigation model on both form
factors, per principle 4.

State: current page = component state in `SettingsModal` (e.g.
`const [page, setPage] = useState('index')`). Deep entry points that today do
`setActiveTab('Integrations')` (the AI-keys cross-link) become
`setPage('integrations')` — same mechanism, and the modal may accept an
`initialPage` prop for external openers. Not persisted anywhere.

---

## 7 · Component spec

New components live in `src/components/settings/` (a subdirectory of an
existing bundled tree — no Dockerfile change). All styling in one
`settings.css` next to them; every color through `--v2-*` / `--bm-*` tokens
(zero new global tokens needed — sizes and spacings above are component
constants in that stylesheet, not tokens, matching current practice).

### 7.1 New

```jsx
// Page chrome + stack navigation inside ModalShell.
<SettingsNav page={page} onNavigate={setPage}>
  {pages}                       // renders current page, slide transition
</SettingsNav>

<SettingsPage id="general" title="General" parent="index">
  {groups}
</SettingsPage>

<SettingsGroup caption="Appearance">   // caption optional (§5)
  {rows}
</SettingsGroup>

// Base row — all kinds share it. `info` is the folded ⓘ description.
<SettingRow label value info onPress trailing disabled />

// Kind wrappers (thin, over SettingRow):
<ToggleRow   label checked onChange info disabled />          // §2.1
<ValueRow    label value onPress info />                      // §2.2 (picker/select)
<SegmentRow  label value options onChange stacked info />     // §2.3
<NavRow      label summary onPress info />                    // §2.4
<ActionRow>  <SettingsButton …/> … </ActionRow>               // §2.5
<StatusRow   label value mono dot="ok|warn|off" info />       // §2.7
<SecretRow   label set lastFour onChange />                   // §2.8
```

### 7.2 Kept (unchanged or lightly restyled)

- `Toggle` (`SettingsModal.jsx:71`) — kept as-is; becomes the trailing
  control of `ToggleRow`.
- `.v2-settings-segment` — kept; gains the trailing-inline placement rule.
- `.v2-settings-btn` family — kept; danger variants re-token to
  `--bm-danger`.
- `.v2-settings-build` mono chip, integration status dots, danger card,
  confirm dialog, logs stream, `AutosaveIndicator`, `ModalShell` — kept.
- `FormDisclosure` — kept as **the** single in-place disclosure (settings
  usage per §3.3 only; task/routine editors continue using it). Two changes:
  callers must pass a value-bearing `summary` (enforced by review, stated in
  its header comment), and the head grows to the 52px/15px row anatomy so it
  matches `SettingRow` visually. Its `--v2-*` tokens already resolve in Kept
  themes via the palette override, so no re-skin needed.

### 7.3 Deleted

- `SettingsSection` (`SettingsModal.jsx:25`) — the collapse-by-default
  wrapper. Replaced by `SettingsGroup` (non-collapsing) + navigation.
- `SectionHeader` (`SettingsModal.jsx:2005`, NotificationsPanel) and its
  `openSections` state — same fate.
- `InfoHintRow` (`SettingsModal.jsx:50`) — absorbed into `SettingRow`'s
  `info` prop.
- `.v2-notif-history-toggle` / `.v2-integrations-name-toggle` /
  `.v2-integrations-toggle-btn` + `.v2-chevron-open` — replaced by `NavRow`
  or restyled `FormDisclosure`.
- The `<details>` color-picker in `LabelsPanel` — replaced by a `ValueRow`
  opening the swatch grid.
- `.v2-settings-tabs` / `.v2-settings-tab*` — the tab strip.
- Dead CSS riding along: `.v2-settings-beta`, `.v2-settings-roadmap`,
  `.v2-settings-subhead` (superseded by group captions).
- All raw `▸ ▾ ►` glyphs. Chevrons are lucide, trailing, 16px, and mean
  exactly two things: `ChevronRight` = navigates, rotating `ChevronDown` =
  expands here.

---

## 8 · Worked example — General and Tasks under the language

### General today
Three collapsed `SettingsSection`s ("APPEARANCE — Theme family and light/dark
mode.", "HOME SCREEN — 7-day strip and daily goal.", "BUILD & VERSION — What
this client and the server are running.") in the top third of the screen;
two-thirds dead space; zero values visible; 3 taps + scanning ~20 lines of
hint prose to see everything.

### General page, redesigned — 7 rows, 3 groups, nothing collapsed

```
‹ Settings                     General

APPEARANCE
Theme                    [Standard | Kept]   SegmentRow — 2 options, trailing.
                                             Marketing copy ("warm Smoke/Linen
                                             canvases…") → deleted.
Mode               [Light | Dark | System]   SegmentRow — trailing ≥360px,
                                             stacked below that.
HOME SCREEN
Show 7-day strip ⓘ                    (on)   ToggleRow; the two-line hint moves
                                             behind ⓘ.
Open strip by default                (off)   ToggleRow, dependent — dimmed
                                             45% while parent is off.
Daily task goal ⓘ                       3    SettingRow with the compact
                                             numeric input trailing.
ABOUT
App build ⓘ                    2026.07.24-3  StatusRow, mono chip; the native
                                             vs web explanation stays behind ⓘ
                                             (it earns it — the two builds
                                             genuinely differ in the shell).
Server version ⓘ               2026.07.24-3  StatusRow, mono chip.
```

Every value visible in one glance, zero disclosures, and the page now *fills*
sensibly: seven 52px rows + two captions ≈ 430px of content instead of three
dim strips.

### Tasks page, redesigned — 8 rows, 3 groups, two sub-pages

```
‹ Settings                       Tasks

BEHAVIOR
Default due date ⓘ               7 days     Numeric row; "0 = no default"
                                            copy → behind ⓘ.
Staleness threshold ⓘ            7 days     Numeric row; the cross-ref to the
                                            Stale notification → behind ⓘ.
Reframe after                  3 snoozes    Numeric row — the unit does the
                                            explaining; hint deleted.
DIY reality check ⓘ                 (on)    ToggleRow; the 4-line paragraph
                                            (hire-out verdicts, per-task
                                            override) → behind ⓘ.
IMPACT DATES
Impact dates                   2 dates ›    NavRow → sub-page: one row per
                                            event ("Christmas · Dec 25 ·
                                            14d lead ›" → inline editor),
                                            plus "+ Add impact date"
                                            ActionRow. Kills today's
                                            five-inputs-crammed-per-event
                                            wrapping flexbox.
AI
Custom instructions              Set ›      NavRow → sub-page: full-height
                                            textarea + Import/Export/Clear
                                            ActionRow. Summary is Set/Off,
                                            not the prose.
Workhorse model ⓘ         Sonnet (default)  ValueRow over the existing
                                            <select> (catalog + Custom…).
Quick model                Haiku (default)  ValueRow, same.
                                            "Keys live in Integrations" →
                                            behind ⓘ on the model rows; the
                                            standalone "API keys" prose
                                            block is deleted.
```

The same translation applies mechanically elsewhere; two notes so nobody
invents: **Data** becomes six rows (Server connection = StatusRow + Change…
action, Devices `2 devices ›`, Backup = ActionRow pair, Activity log ›,
Server logs ›, Markdown import as an ActionRow) with the danger card last and
never collapsed; **Notifications** flattens the per-type cards into grouped
ToggleRows (channels group, then per-type groups), with History as a NavRow
(`50 entries ›`). **Integrations** becomes a list of NavRows (dot + name +
`Connected ›`) each drilling to a per-integration page — which finally gives
its nested sub-settings a legal home under the one-level rule.

---

## 9 · Migration plan

SettingsModal.jsx is ~3,455 lines; this lands as seven independently
shippable PRs on `dev`, each leaving the surface fully working. Presentation
only throughout — no PR touches `update()`, the settings blob, or any
storage path.

1. **PR1 — components.** `src/components/settings/` (`SettingsNav`,
   `SettingsPage`, `SettingsGroup`, `SettingRow` + kind wrappers,
   `settings.css`). Nothing imports them yet. Zero behavior change.
2. **PR2 — navigation shell.** Replace the tab strip with the index +
   drill-down chrome; each existing tab panel renders *unchanged* as the body
   of its category page (`SettingsSection`s and all). Update the AI-keys
   cross-link to `setPage`. This alone fixes the clipped tab bar and is the
   riskiest UX change — ship it early and alone so it can be judged in
   isolation on `boomerang-dev`.
3. **PR3 — General + Tasks** converted to the language (§8), including the
   Impact-dates and Custom-instructions sub-pages. Delete `InfoHintRow`.
   This PR is the proof artifact — screenshot before/after in the PR body.
4. **PR4 — Data** (+ danger-card re-token to `--bm-danger`, Devices
   sub-page, logs behind restyled `FormDisclosure`).
5. **PR5 — Notifications** (flatten cards, delete the local `SectionHeader`
   + `openSections`).
6. **PR6 — Integrations** (largest: per-integration sub-pages; delete the
   name-toggle expander family). Labels panel rows re-cut in the same PR
   (small).
7. **PR7 — teardown.** Delete `SettingsSection`, the tab CSS, dead classes
   (§7.3), stray glyph chevrons; grep-verify no `v2-settings-section` /
   `v2-settings-tab` references remain; update `wiki/Features.md` +
   `wiki/Claude-Notes-Platform.md` + this page's status line.

Each PR follows the repo git model (fresh `claude/*` ref → PR to `dev`,
per-merge approval) and gets an entry in `wiki/Version-History.md`. Rollback
unit = one PR; because panels convert whole-page-at-a-time, no page is ever
half-old half-new.

---

*Written 2026-07-27 against `SettingsModal.jsx` @ 3,455 lines. When a rule
here fights reality, change the rule **in this file first**, then the code —
the language only works if the document stays the single source of truth.*
