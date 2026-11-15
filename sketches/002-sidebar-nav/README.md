# Variant 002 — Sidebar navigation

> Throwaway UI prototype for FairShare. Open `index.html` in a browser. Everything
> loads from CDN — no build step, no install.

## Design stance

A **tool-first, denser workspace**. On desktop the left sidebar is the persistent
navigation rail and the main area shows one active view at a time; the Groups view
uses a two-column master/detail split (group list on the left, selected group's
balances on the right). Mobile defaults to a bottom tab bar — no sidebar on small
screens.

## Key choices

- **Navigation:** on **≥768px** a dark `w-60` sidebar with Dashboard / Groups /
  Analytics / Profile (active state highlighted, plus local-first indicator and the
  user's fingerprint footer). Below 768px the sidebar is hidden and a bottom tab bar
  takes over; a mobile top bar holds the logo and profile.
- **Groups view:** two-column on desktop (list → detail). Selecting a group swaps the
  detail panel's balances live (Roommates / Japan Trip 2026 / Team Lunch each render
  their own balances or an "all settled 🎉" empty state).
- **Typography & color:** system stack, compact `text-sm` density; slate shell with
  shadcn semantic tokens; green/rose/amber money semantics preserved.
- **Components (shadcn/us via CDN, no build):** `.card`, `.btn` (`default`/`outline`/
  `ghost`, `data-size="lg"`), `.badge`, `.avatar`, line-variant `.tab-list` for the
  activity filter, and native `<dialog class="sheet" data-side="bottom">` bottom
  sheets for settle-up / add-expense / new-group.
- **Interactions:** tab & sidebar switching, group selection in the detail pane,
  activity filter, collapsible splits, Equal/Custom toggle, active (pressed) states.

## Trade-offs

- **Strong at:** density and multi-tab workflows; the sidebar + master/detail pattern
  serves heavy bookkeepers and wide screens well.
- **Weak at:** first-run warmth. It reads as a utility, not a friendly social app;
  the empty landing requires a click before context is visible on mobile.

## Best for

Power users and desktop-heavy usage — people managing several groups with lots of
expenses, where quick navigation between views matters more than a welcoming
overview.
