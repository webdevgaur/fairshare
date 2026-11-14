# FairShare — Split Expenses

FairShare is a **local-first, Splitwise-style expense-splitting app** for groups who share costs — roommates, trip-goers, friends, and teams. Its defining difference from mainstream expense apps: **no account is required and your data stays on your device.** Identity is a locally-generated Ed25519 keypair, records live in `localStorage`, and sync is an optional convenience rather than a requirement.

Built with [agency-agents](https://github.com/msitarzewski/agency-agents) specialist AI personas as the development team.

> **App root for all code paths below:** `frontend/`. The detailed architecture, API reference, and developer guide live in the sibling [`docs/`](../docs/README.md) directory.

---

## Feature Matrix

| Feature | Status | Notes |
|---|---|---|
| Identity & Name Prompt | ✅ Done | Ed25519 keypair generated on first launch; 8-char fingerprint user id. No cloud auth, no email/password. |
| Dashboard | ✅ Done | "You're owed" / "You owe" summary cards; group list with per-group balance; navigation. |
| Groups | ✅ Done | Create with comma-separated member names. Local-first store. |
| Expenses | ✅ Done | Equal splits (remainder on first member) **or** custom per-person amounts. |
| Settlements | ✅ Done | Record who paid whom, how much; balance updates. |
| Balance engine | ✅ Done | Pure-TS `paid − owes + received − sent`, plus greedy debt-simplification suggestions. |
| Sync indicator | ✅ Done | Offline / online status based on the relay connection. |
| **F4** — Payment Links | ✅ Done | Venmo / PayPal / Cash App deep links pre-filled with amount + memo; optional per-user payment handles. |
| **F6** — Comments & Activity Feed | ✅ Done | Threaded comments per expense (stable `uuid`), reverse-chronological feed with date headers, local browser notifications. |
| **F5** — Export / Import | ✅ Done | JSON round-trip (merge-by-uuid), CSV export, Splitwise CSV import, formula-injection protection. |
| **F3** — Spending Insights & Analytics | ✅ Done | Category breakdown, monthly spending, this-month / last-month / all-time cards, hand-built charts, on-read computation. |
| **F1** — Receipt Scanning & OCR | ✅ Done | On-device Tesseract.js v5 (WASM, lazy-loaded on first scan); heuristic parser extracts merchant / date / total / line items; receipt image stored in IndexedDB (never leaves device); review-and-assign grid before batch-creating expenses; falls back to manual entry if OCR fails. |

**Roadmap:** the PRD ([`../PRD_FairShare.md`](../PRD_FairShare.md)) defines seven features (F1–F7). **F2** (Recurring Expenses) and **F7** (Multi-Currency Travel Mode) remain unbuilt.

---

## Architecture

FairShare is a client-only SPA plus a small, stateless sync relay. There is **no backend of record** — the browser is the source of truth.

```
┌─────────────────────────────── Browser ────────────────────────────────┐
│  React SPA (Vite + TS)                                                 │
│  pages + components → src/lib/api.ts   (UI facade, the only entry)    │
│        ├── engine.ts         types + balance + analytics               │
│        ├── store.ts          LocalStore (localStorage)                 │
│        ├── sync.ts           CRDT SyncClient (encrypted patches)       │
│        ├── feed.ts           activity-feed builder                     │
│        ├── paymentLinks / exportImport / identity / crypto             │
│        └── notifications.ts                                            │
│                     │  WebSocket (encrypted CRDT patches)              │
└─────────────────────┼─────────────────────────────────────────────────┘
                      ▼
        ┌──────────────────────────────┐
        │  Relay Server (Rust)         │  ephemeral room per group; forwards
        │  ws://… :3002                │  JSON patches; stores nothing
        └──────────────────────────────┘
```

See [`docs/README.md`](../docs/README.md) for the write / read / sync paths, the CRDT guarantees, and the full data model.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Frontend | React 19 + TypeScript ~7, Vite 8 (`@vitejs/plugin-react`) |
| Routing | react-router-dom 7 |
| Styling | Tailwind CSS 4 + `@base-ui/react` (shadcn-style primitives), tw-animate-css |
| Icons | lucide-react |
| Crypto | `@noble/ed25519` + `@noble/hashes` (Ed25519 identity, sign/verify) |
| Sync transport | WebSocket → Rust relay server (tokio-tungstenite, in-memory `DashMap` rooms) |
| Tests | Playwright (`@playwright/test`) — end-to-end browser tests |

---

## Repository Layout

```
splitwise-clone/
├── README.md                 ← you are here
├── frontend/                 ← the app (React SPA, this is the app root)
│   ├── src/
│   │   ├── App.tsx           Router + Layout + NamePrompt gate
│   │   ├── main.tsx          React entry
│   │   ├── pages/            Dashboard, GroupPage, Profile
│   │   ├── components/       ActivityFeed, ExpenseComments, ui/*
│   │   └── lib/              All business logic (see docs/API_REFERENCE.md)
│   │       ├── api.ts        UI facade (the only entry point)
│   │       ├── engine.ts     Types + balance + analytics
│   │       ├── store.ts      LocalStore (localStorage)
│   │       ├── sync.ts       CRDT SyncClient
│   │       ├── feed.ts       Activity-feed builder
│   │       ├── paymentLinks.ts, exportImport.ts, identity.ts,
│   │       ├── crypto.ts, notifications.ts, utils.ts
│   │       └── (index.css)   Tailwind + theme tokens + animations
│   ├── tests/                Playwright specs + setup.ts helpers
│   ├── playwright.config.ts, vite.config.ts, package.json
└── relay-server/             Rust WebSocket relay (cargo)
    ├── src/main.rs
    └── README.md
```

---

## Quick Start

### Prerequisites

- **Node.js** 20+ and **npm**
- **Rust toolchain** (only needed to run the sync relay server locally)
- **Playwright browsers**: `npx playwright install chromium` (first time only)

### 1. Install frontend dependencies

```bash
cd frontend
npm install
```

### 2. Start the relay server (optional but recommended)

The sync indicator will show **Offline** if the relay isn't running. To test cross-device sync, start it:

```bash
cd relay-server
cargo run                       # listens on 0.0.0.0:3002 by default
# or with flags: cargo run -- --port 9090 --host 127.0.0.1
```

### 3. Run the app

```bash
cd frontend
npm run dev                     # Vite on http://localhost:5173
```

On first visit you'll be prompted for a name; this seeds the local identity. There is **no `/api` backend** — the Vite proxy rule `/api → http://localhost:3001` is vestigial and unused by the app (data is fully client-side).

### 4. Run the tests

```bash
cd frontend
npm run dev &                   # keep the dev server running
npx playwright test             # 63 E2E tests across 12 spec files
```

---

## Documentation

Full docs live in the sibling [`docs/`](../docs/README.md) directory (at the workspace root, outside the git repo):

| Doc | Contents |
|---|---|
| [`docs/README.md`](../docs/README.md) | Architecture overview, dev setup, running tests |
| [`docs/API_REFERENCE.md`](../docs/API_REFERENCE.md) | Full reference for `src/lib/*`: types, functions, methods |
| [`docs/DEVELOPER_GUIDE.md`](../docs/DEVELOPER_GUIDE.md) | End-to-end "how to add a feature" walkthrough |
| [`docs/adr/0001-f4-payment-links.md`](../docs/adr/0001-f4-payment-links.md) | ADR — F4 One-Tap Payment Links |
| [`docs/adr/0002-f6-comments-activity-feed.md`](../docs/adr/0002-f6-comments-activity-feed.md) | ADR — F6 Comments & Activity Feed |
| [`docs/ADR-F5-EXPORT-IMPORT.md`](../docs/ADR-F5-EXPORT-IMPORT.md) | ADR-0003 — F5 Export / Import (accepted) |
| [`docs/ADR-F3-ANALYTICS.md`](../docs/ADR-F3-ANALYTICS.md) | ADR — F3 Spending Insights & Analytics (proposed) |
| [`docs/F5_USER_GUIDE.md`](../docs/F5_USER_GUIDE.md) | User guide for Export / Import (F5) |
| [`docs/F1_OCR_MOBILE_ANALYSIS.md`](../docs/F1_OCR_MOBILE_ANALYSIS.md) | F1 OCR mobile implementation analysis (the web path is shipped via Tesseract.js; mobile needs a separate Vision / ML Kit native module) |

Workflow / product docs (also at the workspace root, outside the git repo):

| Doc | Contents |
|---|---|
| [`../GIT_WORKFLOW.md`](../GIT_WORKFLOW.md) | Branching model, commit conventions, release/tagging, changelog |
| [`../PRD_FairShare.md`](../PRD_FairShare.md) | Product requirements: features F1–F7 |
