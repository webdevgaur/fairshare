# Variant 003 — Mobile-first card UI

> Throwaway UI prototype for FairShare. Open `index.html` in a browser. Everything
> loads from CDN — no build step, no install.

## Design stance

Built mobile-first for a **375px viewport**. One column, big rounded cards, generous
padding, soft shadows, and a floating rounded bottom tab bar. The feel is a friendly
finance app — approachable, tactile, nothing anxiety-inducing. The whole page is
centered to `max-w-md`, so it reads as a phone on any screen (this variant is
deliberately not given a desktop breakpoint).

## Key choices

- **Layout:** single-column scroll per tab (Home / Groups / Analytics / Profile),
  bottom tab bar in a floating rounded pill with `44px+` touch targets.
- **Cards:** `rounded-3xl` + soft shadow everywhere; balance cards use tinted
  backgrounds (`#ecfdf5` owed / `#fff1f2` owe) for instant color-coding.
- **Typography:** system stack; big `text-3xl` figures, `text-base` card titles.
- **Components (shadcn/us via CDN, no build):** `.card`, `.btn` (`default`/`outline`,
  `data-size="lg"` for 44px), `.badge` split pills, `.avatar` initials, and native
  `<dialog class="sheet" data-side="bottom">` bottom sheets used for **all**
  modals/actions — settle-up, add expense, scan receipt, new group, and a group
  detail sheet that's populated per group.
- **Interactions:** tab switching, tapping a group opens its balance detail sheet,
  collapsible splits, Equal/Custom toggle, payment deep links (Venmo / PayPal /
  Cash App), pressed-state feedback.

## Trade-offs

- **Strong at:** single-hand thumb reach and an inviting, low-anxiety feel; great
  for the planned React Native (Expo) port — this layout maps 1:1 to a native app.
- **Weak at:** desktop and information density. It can't show two columns, and
  reading a large feed requires a lot of scrolling.

## Best for

The primary mobile experience. This is the likeliest layout to carry into the Expo
app; the floating tab bar and bottom-sheet pattern are native-first patterns.
