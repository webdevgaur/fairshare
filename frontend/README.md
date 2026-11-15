# FairShare — Frontend (React SPA)

The FairShare web client. A **local-first** single-page app: all data lives in `localStorage`, identity is an Ed25519 keypair, and sync is an optional WebSocket relay.

> **App root for all paths below:** `splitwise-clone/frontend/`. See [`../../docs/README.md`](../../docs/README.md) for the architecture overview, and [`../../docs/API_REFERENCE.md`](../../docs/API_REFERENCE.md) for the full `src/lib/*` reference.

---

## Setup

### Prerequisites

- **Node.js** 20+ and **npm**
- **Playwright browsers**: `npx playwright install chromium` (first time only)

### Install

```bash
npm install
```

### Run (dev)

```bash
npm run dev              # Vite on http://localhost:5173
```

### Build & preview

```bash
npm run build            # tsc -b && vite build
npm run preview          # serve the production build
```

---

## npm Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start the Vite dev server (HMR) |
| `npm run build` | Type-check (`tsc -b`) then build |
| `npm run lint` | Run oxlint |
| `npm run preview` | Serve the production build locally |
| `npx playwright test` | Run the end-to-end suite (needs a running dev server) |

---

## Feature Overview

| Feature | Status | Where it lives |
|---|---|---|
| Identity & Name Prompt | ✅ | [`src/lib/identity.ts`](src/lib/identity.ts) + [`src/lib/crypto.ts`](src/lib/crypto.ts) — Ed25519 keypair, `localStorage` |
| Dashboard | ✅ | [`src/pages/Dashboard.tsx`](src/pages/Dashboard.tsx) |
| Groups, Expenses, Settlements | ✅ | [`src/pages/GroupPage.tsx`](src/pages/GroupPage.tsx) + [`src/lib/engine.ts`](src/lib/engine.ts) |
| Balance engine & debt simplification | ✅ | [`src/lib/engine.ts`](src/lib/engine.ts) |
| Sync indicator (offline/online) | ✅ | [`src/lib/sync.ts`](src/lib/sync.ts) + [`src/pages/Dashboard.tsx`](src/pages/Dashboard.tsx) |
| **F4** — Payment Links | ✅ | [`src/lib/paymentLinks.ts`](src/lib/paymentLinks.ts) + [`src/pages/Profile.tsx`](src/pages/Profile.tsx) |
| **F6** — Comments & Activity Feed | ✅ | [`src/lib/feed.ts`](src/lib/feed.ts), [`src/components/ActivityFeed.tsx`](src/components/ActivityFeed.tsx), [`src/components/ExpenseComments.tsx`](src/components/ExpenseComments.tsx), [`src/lib/notifications.ts`](src/lib/notifications.ts) |
| **F5** — Export / Import | ✅ | [`src/lib/exportImport.ts`](src/lib/exportImport.ts) + [`src/pages/Profile.tsx`](src/pages/Profile.tsx) |
| **F3** — Spending Insights & Analytics | ✅ | [`src/lib/engine.ts`](src/lib/engine.ts) `computeAnalytics` + the `SpendingInsights` section in [`src/pages/Dashboard.tsx`](src/pages/Dashboard.tsx) (hand-built donut + bar charts) |
|| **F1** — Receipt Scanning & OCR | ✅ | [`src/lib/ocr.ts`](src/lib/ocr.ts) lazy-loaded Tesseract.js v5 (WASM), [`src/lib/receipt-parser.ts`](src/lib/receipt-parser.ts) heuristic parser, [`src/lib/receipt-store.ts`](src/lib/receipt-store.ts) IndexedDB image store, [`src/components/ReceiptScanner.tsx`](src/components/ReceiptScanner.tsx) + [`src/components/ReceiptReview.tsx`](src/components/ReceiptReview.tsx), [`src/lib/api.ts`](src/lib/api.ts) `createExpenseFromScan` |
|| **F9** — Couple Mode | ✅ (v0.5.0) | Mutual couple registration ([`src/pages/Profile.tsx`](src/pages/Profile.tsx)); per-group toggle ([`src/pages/GroupPage.tsx`](src/pages/GroupPage.tsx)); netted settlement suggestions (`src/lib/engine.ts`); expenses split by all N members |
|| **F8** — Group Member Invite | ✅ (v0.6.0) | [`src/components/qr-code.tsx`](src/components/qr-code.tsx), [`src/components/qr-scanner.tsx`](src/components/qr-scanner.tsx), [`src/lib/invites.ts`](src/lib/invites.ts) — Identity QR on Profile, share-link deep-link handler, Pending → Accept/Decline workflow |
|| **F10** — Activity Log | ✅ (v0.7.0) | [`src/components/activity-log.tsx`](src/components/activity-log.tsx) + Activity tab on GroupPage — append-only chronological audit trail of expense adds, settlements, and comments. Backfill for pre-existing data. Schema v3 (exportImport). |

---

## Test Suite

The suite is **Playwright end-to-end** against the dev server (`http://localhost:5173`). It has **105 tests across 16 spec files** and no unit tests — the logic is exercised through the browser UI and via seeded `localStorage`.

### Run the whole suite

```bash
npm run dev &        # keep the dev server running
npx playwright test
```

Or run a build instead: `npm run build && npm run preview`.

### Run a single file / name

```bash
npx playwright test tests/comments.spec.ts
npx playwright test --grep "F3"       # by test-name substring
```

### Per-file coverage

| Spec | Tests | Covers |
|---|---|---|
| `tests/identity.spec.ts` | 6 | Identity prompt, fingerprint, persistence |
| `tests/dashboard.spec.ts` | 6 | Summary cards, group list, navigation |
| `tests/navigation.spec.ts` | 6 | Routing between pages |
| `tests/expenses.spec.ts` | 6 | Equal + custom splits |
| `tests/settlements.spec.ts` | 3 | Record settlements, balance updates |
| `tests/comments.spec.ts` | 6 | Expense comments / threads |
| `tests/activity-feed.spec.ts` | 5 | Reverse-chronological feed, date headers |
| `tests/paymentLinks.spec.ts` | 3 | Venmo / PayPal / Cash App deep links |
| `tests/exportImport.spec.ts` | 11 | JSON round-trip, CSV, Splitwise import |
| `tests/analytics.spec.ts` | 4 | Spending insights, category breakdown |
| `tests/receipt-scan.spec.ts` | 4 | Scan → OCR-extracted line items, uuid + no-image sync payload, IndexedDB storage, manual-entry fallback |
|| `tests/sync.spec.ts` | 3 | CRDT sync, offline queue |
||| `tests/couple-mode.spec.ts` | 11 | Couple registration, per-group toggle, netted settlements |
|| `tests/invites.spec.ts` | 11 | QR code generation, QR scanner, share-link invite, Pending → Accept/Decline workflow |
|| `tests/activity-log.spec.ts` | 11 | Append-only chronological audit trail, backfill, Activity tab |
||| **Total** | **105** | |

### Helpers in `tests/setup.ts`

| Helper | Purpose |
|---|---|
| `clearStorage(page)` | Wipe `fairshare_*` localStorage keys |
| `seedIdentity(page, name)` | Seed local identity so the name prompt is skipped; returns the fingerprint |
| `seedGroup(page, name, desc, members)` | Create a group via the store; returns `group_id` |
| `seedExpense(page, groupId, desc, amount, opts?)` | Create an expense (equal split); optional `{ category?, date? }`; returns `{ id, uuid }` |
| `seedComment(page, groupId, expenseId, expenseUuid, text)` | Seed a comment keyed by expense `uuid` |
| `seedSettlement(page, groupId, amount)` | Create a settlement |
| `gotoApp(page, path)` | Navigate to `BASE_URL` + path and wait for `networkidle` |

> **Convention:** always call `clearStorage` in `beforeEach`. Comment/analytics seeds rely on the expense carrying a stable `uuid` so they attach across devices.

---

## Structure

```
src/
├── App.tsx              Router + Layout + NamePrompt gate
├── main.tsx             React entry
├── pages/               Dashboard, GroupPage, Profile
├── components/          ActivityFeed, ExpenseComments, ReceiptScanner, ReceiptReview, ui/*
└── lib/                 All business logic (see ../../docs/API_REFERENCE.md)
    ├── api.ts           UI facade — the only entry point
    ├── engine.ts        Types + balance engine + analytics
    ├── store.ts         LocalStore (localStorage)
    ├── sync.ts          CRDT SyncClient
    ├── feed.ts          Activity-feed builder
    ├── paymentLinks.ts  Deep-link builders (F4)
    ├── exportImport.ts  JSON / CSV export + import (F5)
    ├── ocr.ts           Lazy-loaded Tesseract.js wrapper (F1)
    ├── receipt-parser.ts Heuristic OCR→expense parser (F1)
    ├── receipt-store.ts IndexedDB image store (F1)
    ├── identity.ts      Local user (name + fingerprint)
    ├── crypto.ts        Ed25519 keypair (sign/verify)
    ├── notifications.ts Browser Notification wrapper
    └── utils.ts         cn() helper re-export
```

> **Note on `@noble/*`:** `vite.config.ts` excludes `@noble/hashes` and `@noble/ed25519` from dependency pre-bundling because their subpath exports (e.g. `./sha2` vs `./sha2.js`) fail during esbuild dep optimisation. Do not remove that exclusion unless you've verified the production build resolves.
