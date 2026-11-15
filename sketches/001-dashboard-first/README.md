# Variant 001 — Dashboard-first

> Throwaway UI prototype for FairShare. Open `index.html` in a browser (double-click or
> `open index.html` on macOS). Everything loads from CDN — no build step, no install.

## Design stance

The landing view **is** the dashboard. Balance summaries, group cards, this-month
analytics, and the activity feed all live on one scrollable screen, so a returning
user sees the answer to "how am I doing?" without a single tap. Content-first and
airy.

## Key choices

- **Layout:** single column. Groups as horizontally-scrolling cards (snap-scroll)
  on mobile; on **≥768px** they reflow into a 3-column grid and the page widens to
  `max-w-5xl`. Bottom tab bar switches views (Home / Groups / Analytics / Profile).
- **Typography:** system font stack; large bold dollar figures for instant scannability.
- **Color:** shadcn semantic tokens for the shell; the app's money semantics
  (green = you're owed `#16a34a`, rose = you owe `#e11d48`, amber = category highlight)
  drive card tints. "you" badges give personal salience.
- **Components (shadcn/us via CDN, no build):** `.card` for summary/feed blocks,
  `.btn` with `default`/`outline`/`ghost` variants and `data-size="lg"` (44px) for
  touch targets, `.badge` for split pills, `.avatar` for member initials, native
  `<dialog class="sheet" data-side="bottom">` for the settle-up / add-expense /
  new-group / import bottom sheets.
- **Interactions:** tab-switched views, Activity filter tabs (All/Expenses/Settlements),
  collapsible split breakdowns, Equal/Custom split toggle, tap feedback via
  `.btn:active { transform: scale(.97) }`. No hover-only affordances.

## Trade-offs

- **Strong at:** glanceability and zero-friction check-ins; the money state is always
  front-and-center.
- **Weak at:** depth. Dense group/budget work (editing many expenses, reconciling a
  large group) gets buried under the feed; not ideal for power users.

## Best for

The everyday user who opens the app to check a balance or settle up quickly. Mobile
screen is the primary target; desktop is a comfortable wide reading layout.
