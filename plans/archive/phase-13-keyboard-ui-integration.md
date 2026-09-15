# PR Plan — Phase 13: Keyboard, Focus, and UI Integration

Status: complete (Verified 2026-09-14, Commits 813ce6c, e3a6902, 634d18d)
Source: `plans/audit-remediation-roadmap.md`
Spec references: `plans/llamamanager.md` §2, §4, §7

## Objective

Make documented interactions work consistently without duplicate handlers, stale controls, or event-listener leaks.

## In scope

- Choose one owner for global Enter, quit, kill, and field navigation.
- Remove duplicate keyboard registrations and listener leaks.
- Eliminate React `act(...)` warnings from UI tests.
- Wire the theme provider and runtime theme switching.
- Reconcile four primary tabs with Catalog and palette actions.
- Wire preset load and relink callbacks.
- Make text inputs controlled and visibly labeled.
- Remap focus correctly on screen changes.
- Add confirmation UI for host exposure, kill, quit, and deletion.
- Show live process state in the shell header.
- Preserve stdout/stderr identity in the console.

## Out of scope

- New domain features.
- Mouse support.
- Terminal compatibility sign-off.

## Tests

- One keypress causes one action.
- Mount/unmount cycles do not increase key listener count.
- Runtime theme switching changes all screens.
- Focus traversal works on every screen.
- Input reset/load/model-change synchronization.
- Confirmation accept/cancel behavior.
- UI suite is free of `act(...)` and listener warnings.

## EXIT criterion

Every documented keybinding has one working owner, every advertised action is wired, and UI tests run without React update or listener warnings.
