# Desktop Design Plan

Status: **planned** — not shipped. All changes must be desktop-only (`@media (min-width: 769px)`) and must not modify any base/mobile CSS rules.

## Ground Rules (learned the hard way)

1. **Never modify base CSS values.** All desktop overrides go inside `@media (min-width: 769px)` blocks. The base rules are the mobile layout and they are sacred.
2. **Never use `display: contents` for layout hacks.** It breaks parent measurement, confuses flex context, and causes cascading failures.
3. **Test mobile after every desktop change.** If mobile looks different, the change is wrong.
4. **Desktop CSS lives in a dedicated file** (`src/v2/desktop.css`) imported after the component CSS. No inline desktop overrides scattered across component files.
5. **Ship to dev first, verify on both mobile and desktop, then promote to main.** No cherry-picks, no direct pushes.

---

## 1. Stats Strip on Desktop Kanban

**Current state:** Stats line (date, streak, today count) renders above the Kanban on desktop (moved there in this session). WeekStrip renders below it when toggled. Both use the mobile centered layout.

**Goal:** On desktop, the stats line should feel like part of the toolbar — compact, left-aligned, not floating centered in a sea of whitespace.

**Plan:**
```
@media (min-width: 769px) {
  .v2-home-stats {
    justify-content: flex-start;
    padding: 6px 16px 4px;
    text-align: left;
  }
}
```

**Risk:** Low. Only changes alignment on desktop. Mobile untouched.

---

## 2. WeekStrip on Desktop

**Current state:** WeekStrip renders as a full-width centered block below the stats line. On desktop Kanban, it takes up significant vertical space.

**Goal:** On desktop, the WeekStrip should render as a second row below the stats line with left alignment and reasonable sizing. The nav arrows (< May 24-30 >) should appear below the day cells.

**Plan:**
```
@media (min-width: 769px) {
  .v2-week-strip {
    margin: 0 0 12px 16px;
    padding: 0;
    max-width: 600px;
  }
}
```

**NOT doing:**
- Inline day cells in the stats flex row (display:contents was a disaster)
- Auto-shrink number of days (measurement was unreliable)
- Hiding the nav row on desktop

**Risk:** Low. Desktop-only override, mobile uses base rules.

---

## 3. Kanban Column Sizing

**Current state:** Columns are `flex: 0 0 260px` — fixed width, no resizing, horizontal scroll only.

**Goal:** Columns should grow to fill available space when the viewport is wide, but maintain a minimum width and scroll horizontally when narrow.

**Plan:**
```
@media (min-width: 769px) {
  .v2-kanban-col {
    flex: 1 0 220px;
    max-width: 400px;
  }
}
```

With `flex-wrap: wrap` on the container so columns stack into rows on medium viewports rather than being cut off.

**Risk:** Medium. Need to verify that 7 columns at 220px min (1540px) triggers scroll correctly, and that wrapping looks acceptable at intermediate widths (e.g. 1200px showing 5 columns + 2 wrapped).

---

## 4. Detail Panel Spacing

**Current state:** Streak/today detail panels have `max-width: 320px` and `padding: 10px 16px`. Labels and values can run together ("Current strea**k**20 days").

**Goal:** Add gap between label and value, widen slightly.

**Plan:**
```
@media (min-width: 769px) {
  .v2-stats-detail {
    max-width: 360px;
    padding: 10px 20px;
  }
  .v2-stats-detail-row {
    gap: 16px;
  }
}
```

**Risk:** Low. Mobile keeps the compact layout.

---

## Implementation Approach

1. Create `src/v2/desktop.css` with all overrides in `@media (min-width: 769px)` blocks
2. Import it at the end of `AppV2.css`: `@import './desktop.css';`
3. Test on mobile — must be pixel-identical to v1.21.18
4. Test on desktop at multiple widths (1024, 1280, 1440, 1920)
5. Ship to dev, validate both environments
6. Promote to main only after mobile is confirmed clean
