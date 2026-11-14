# ADR-F1 — Receipt Scanning & OCR

- **Status:** Proposed
- **Date:** 2026-11-14
- **Decider:** Software Architect (subagent)
- **Feature:** F1 — Receipt Scanning & OCR
- **Depends on:** F6 (stable `uuid` foundation — already merged)
- **Depended-on by:** None

## Context

**The feature.** A group member scans a paper/digital receipt and the app extracts line items into pre-filled split entries, so they stop re-typing every item.

**The web path.** The web app is a React/Vite SPA; the only practical on-device OCR engine that runs in a browser **without a server** is **Tesseract.js (WASM)**. It runs image→text surfaced as `text` + blocks/paragraphs/lines/words with confidence and bounding boxes.

**The mobile path (the reason the web approach is Tesseract.js).** React Native has **no WASM runtime**, so Tesseract.js **cannot run on mobile** at all. The mobile analysis (`docs/F1_OCR_MOBILE_ANALYSIS.md`) concludes the mobile path must use genuinely different on-device engines: **Apple Vision (iOS)** and **Google ML Kit (Android)** — and importantly that those engines, like Tesseract, only produce *text + geometry*, not structured expense fields. The merchant/total/tax/line-item extraction is a **separate algorithm** that must live in **shared TypeScript**. That analysis defines a single cross-platform `OcrResult` contract (`{ text, blocks[{ text, lines[{ text, words[{ text, boundingBox, confidence }] }] }] }`) and a shared `parseReceipt(text, boxes)`; web already emits that shape, native engines are mapped to it.

**Verified current state.** F1 is not started:
- No `src/lib/ocr.ts`, `receipt-parser.ts`, `receipt-store.ts`; no `components/receipt-scanner.tsx` / `receipt-review.tsx`; no Scan Receipt button in `GroupPage.tsx`.
- `package.json` has **no** `tesseract.js` dependency, and no IndexedDB helper (`idb`).
- `engine.ts` `Expense` has `uuid`, `category`, `splits`; `store.createExpense(opts)` already accepts `uuid`, `date`, `created_at`, `category` — so each call emits a **fresh `uuid`** (F6 satisfied).
- `api.createExpense` builds its `create_expense` sync payload explicitly: `{ group_id, amount, description, paid_by, splits, uuid, date, created_at, category }` — **no image field**. The `create_expense` CRDT op in `sync.ts` similarly carries only structured data over an encrypted WebSocket patch. So "images never sync" is structurally true of the *current* code and just needs a guard.

## Decision

### 1. OCR engine (web): Tesseract.js v5, lazy-loaded on first scan
Use `tesseract.js` v5 via a small worker wrapper (`src/lib/ocr.ts`). Load the worker + WASM core + `eng` language data **only when the user first taps "Scan"**, not at app boot. Surface loading progress; on worker/core load failure, degrade to manual entry (no blocked expense creation).

Tesseract.js v5 is not a single ~5MB blob: it pulls the **worker**, the **WASM core** (~3–4MB), and the **`eng` traineddata** (~2–4MB), by default from a CDN. For a **local-first** app, do not rely on the CDN — host the core + traineddata under `public/` (or the app's assets) so the model works offline and doesn't depend on a third-party host. Cache the loaded model in a Cache Storage / IndexedDB entry to make repeat scans near-instant and offline.

### 2. Receipt parser — shared, position-aware heuristic (`src/lib/receipt-parser.ts`)
Keep **parsing in shared TypeScript**, matching the mobile recommendation, and make it **position-aware** rather than raw-text-only: use the bounding boxes (present in both Tesseract's and the native engines' `OcrResult`) to identify the total (bottom-most / largest amount, or the word "TOTAL"), merchant, date, tax, and item lines. Parser is best-effort; expected imperfection is handled by the human review grid, not by chasing accuracy in regex.

### 3. Image storage — IndexedDB (`src/lib/receipt-store.ts`), never localStorage
Compress the receipt image and store it as a blob in **IndexedDB**, with get/put/delete and a **cap** (evict oldest / enforce a byte budget). The structured expense record stays in the existing `localStorage` `LocalStore` as usual. localStorage is the wrong home for binary blobs (5–10MB quota, and `JSON.stringify` on a base64 image is wasteful) — IndexedDB is correct for the image, localStorage right for the small text store.

### 4. Sync — enqueue each scanned expense normally (no image)
Batch-created scan expenses ride the existing `create_expense` path via `api.createExpenseFromScan(groupId, parsedItems, assignments)` → N `createExpense` calls, each generating its own `uuid` so comments and splits can attach individually. **Never** put image bytes in the op payload. Add a test asserting the sync payload shape contains no image field (structure-level privacy guard).

## Trade-offs

| Choice | You gain | You give up |
|---|---|---|
| **Client-side Tesseract.js WASM** (vs server-side OCR) | Images never leave the device; works offline; no per-scan cost; no cloud keys/consent flow | ~5MB+ of WASM/lang data to load (lazy-load + host locally to soften); slower and less accurate than cloud on bad scans; CPU on the client |
| **Server-side cloud OCR** (Textract/Azure receipt model) | Higher accuracy + **structured** vendor/total/line-items with minimal custom parsing | Breaks local-first/privacy (image uploads to 3rd party); needs a backend proxy + consent; per-scan cost; fails offline. Keep as an explicit opt-in "improve accuracy" only |
| **Heuristic parser** (regex + box positions) vs **ML-based extraction** | Zero model/footprint; no network; fully local; shared web+mobile; result is human-reviewable | Best-effort on receipts (multi-line items, dashes/coupons, subtotal vs tax vs tip ambiguity, split-across-lines items, low-contrast thermal print). The review grid is the safety net, not the parser |
| **ML-based receipt extraction** (cloud Document AI) | Structured fields without bespoke parsing | Cost, privacy, offline failure; contradictory to the product's local-first promise |
| **IndexedDB for images** (vs localStorage) | ~GBs quota; stores real blobs; no base64 string bloat; streaming reads for large images | Async API / more code; browsers can **evict IndexedDB under storage pressure** → must handle quota-exceeded and re-request; images are per-browser, never synced |
| **localStorage for images** | Sync, tiny code | 5–10MB cap; base64 string inflation (~33%); `JSON.stringify` of binary is slow; risks blowing the whole structured store's budget |
| **Lazy-load Tesseract on first scan** | No ~5MB hit on boot; app stays fast | First scan pays the download/compile cost (mitigate with caching + a progress state); a grace failure path is required |

## Consequences

**Positive.**
- **Privacy is preserved by construction on web:** images are processed on-device and stored in IndexedDB; the sync path (`create_expense`) carries only structured data. Matches the local-first / privacy promise.
- **F6 is the only dependency and it's already satisfied.** Each scanned line item → its own `createExpense` → its own `uuid`, so comments/splits attach individually.
- **Reuses the existing `create_expense` CRDT path** (uuid/date/created_at/category already threaded) — no data-model or sync-protocol rebase; the balance engine is untouched.
- **Parser and result types are shared web + mobile** (the `OcrResult` contract + `parseReceipt`), so the receipt logic is written once.

**Inherited debt / risks.**
- **Mobile needs a separate native module.** Tesseract.js is web-only; mobile must map Vision (iOS) / ML Kit (Android) onto the same `OcrResult` contract. The mobile analysis recommends a thin ~150-line Expo native module (or a VisionCamera MLKit plugin) rather than a third-party unified library — and this requires a **development build**, not Expo Go. The one thing mobile must **not** duplicate is the parser.
- **Receipt images are device-local, not synced.** Because sync carries only structured data, other group members **will not see the scanned image** on their devices (only the extracted expenses). This is the correct privacy trade-off but a UX gap worth documenting; the image is viewable only on the scanning device.
- **IndexedDB eviction.** Under storage pressure a browser can silently evict IndexedDB; the store must handle QuotaExceededError and re-prompt, and treat the image as best-effort (the structured expense is the source of truth — never block creation because the image write failed).
- **Heuristic parsing is the weak link.** Line-item extraction from OCR text is unreliable; budget review-grid correction UI and a "retry / clear / type it" fallback. Add an **explicit opt-in cloud retry** (Textract/Azure receipt model) behind a backend proxy + consent if accuracy matters later — never silent upload.
- **`createExpenseFromScan` emits one CRDT op per line item.** N items → N ops. Acceptable for receipts (few items), but it is a burst; keep the batch small and sequential to avoid a flood of patches.

## Verified

- No OCR/receipt files, no `tesseract.js` dep, no IndexedDB helper present in `frontend/`; F1 is unstarted.
- `store.createExpense` supports `opts.uuid/date/created_at/category`; `api.createExpense` builds its sync payload without any image field (current code already satisfies the no-image-sync AC — a guard test is the remaining hardening).
- F6 `uuid` is merged and backfilled on load.
- `GIT_WORKFLOW.md` §14 positions this ADR as the Software Architect's gate-1 artifact (docs/ADR-F*.md) feeding the Minimal Change Engineer on a `feat/f1-*` branch.
