# Fix: Switch Quotas Card Shortcut to Alt+Q

## Objective
Change the Quotas / Subscriptions sidebar card shortcut from `alt+u` to `alt+q` to resolve the shortcut collision with `gentle-shell` (which registers `alt+u` for its usage popup view).

## Changes
1. `index.ts`: Register shortcut `"alt+q"` instead of `"alt+u"`.
2. `src/cute-usage.ts`: Update header hint from `Alt+U` to `Alt+Q`.
3. `test/cute.test.ts`: Update assertions to check for `Alt+Q`.
4. Git Flow: Commit on `fix/quotas-card-shortcut-alt-q`, PR to `develop`, release PR to `main`, sync global install.

## Tasks
- [x] T1: Update `index.ts` to register `"alt+q"`
- [x] T2: Update `src/cute-usage.ts` header hint to `Alt+Q`
- [x] T3: Update tests in `test/cute.test.ts` and verify 100% pass rate
- [ ] T4: Git Flow commit, push, PR to develop, release PR to main, and sync
