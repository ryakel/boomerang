# Development Notes

## Git Workflow
- Push directly to `main`. No feature branches until further notice.
- Single developer (ryakel) — no PR review process needed right now.

## Commit Convention
Use Angular-style conventional commits with task sizing.

### Format
```
<type>(<scope>): <subject> [<size>]
```

### Types
- `feat` — new feature
- `fix` — bug fix
- `refactor` — code restructuring, no behavior change
- `style` — formatting, whitespace, CSS-only changes
- `docs` — documentation only
- `test` — adding or updating tests
- `chore` — build, deps, config, tooling
- `perf` — performance improvement

### Scope
Use the area of the app affected: `ui`, `notifications`, `tasks`, `sync`, `settings`, `api`, `trello`, `notion`, `routines`, `analytics`, `store`, `server`, etc.

### Size
Append a size tag matching the app's task sizing system:
- `[XS]` — trivial one-liner, typo fix, config tweak
- `[S]` — small change, single file, < 20 lines
- `[M]` — moderate change, a few files, new component or feature slice
- `[L]` — large feature, multiple components/hooks, significant refactor
- `[XL]` — major feature, cross-cutting changes, architectural shift

### Examples
```
fix(ui): prevent button text overflow on mobile [XS]
feat(notifications): add quiet hours and notification history [L]
refactor(store): extract notification log helpers [S]
chore(deps): update vite to 6.4 [XS]
feat(tasks): add checklist support to task cards [M]
```

### Rules
- Subject line must be imperative mood, lowercase, no period
- Keep subject under 72 characters
- Use body for details when the change is M or larger
- Breaking changes: add `BREAKING CHANGE:` in the commit body
