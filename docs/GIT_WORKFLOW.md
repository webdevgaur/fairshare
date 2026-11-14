# FairShare — Git Workflow

> **Product / repo:** FairShare (`splitwise-clone/`) — a local-first Splitwise-style expense-splitting app.
> **Team size:** 1–2 developers. **Remote:** `origin = https://github.com/webdevgaur/fairshare.git`
> **Purpose of this doc:** define one consistent way to branch, commit, review, release, and log changes so the history stays clean, bisectable, and tells a story.

---

## Table of Contents

1. [Why trunk-based?](#1-why-trunk-based)
2. [Current state (as of 2026-11-14)](#2-current-state)
3. [Branching model & naming](#3-branching-model--naming)
4. [Commit convention](#4-commit-convention)
5. [Feature branch lifecycle](#5-feature-branch-lifecycle)
6. [Pull request workflow](#6-pull-request-workflow)
7. [Handling the existing `main` commits (F4/F5/F6)](#7-handling-the-existing-main-commits)
8. [Version tagging scheme](#8-version-tagging-scheme)
9. [Changelog approach](#9-changelog-approach)
10. [Feature roadmap → branches](#10-feature-roadmap--branches)
11. [Repo hygiene & automation](#11-repo-hygiene--automation)
12. [Quick reference / cheat sheet](#12-quick-reference--cheat-sheet)
13. [FAQ / decisions](#13-faq--decisions)

---

## 1. Why trunk-based?

For a 1–2 person team, **trunk-based development with short-lived feature branches** is the right fit:

- `main` is **always releasable** (green). Anyone can checkout `main` and ship a build at any moment.
- Branches live **hours to a day, not weeks** → no long-lived merge-drift, no giant conflict storms.
- Squash-merge keeps `main` **linear**, which makes `git bisect` and code archaeology trivial.
- You can still work in parallel: each dev takes a branch; two features land in one day.

Guardrails are the point: the workflow exists so that when the founding agency-agents specialists stop driving every commit, a human (or any future agent) can pick up where they left off without guessing.

**Rules of thumb**
- `main` must never be broken. Do not push directly to `main` for real features.
- One branch = one logical unit of work (a feature, a bug fix, a chore). Not one branch per file.
- Small, reviewable changes. Prefer 3 small PRs a day over 1 big one a week.
- If a branch lives >2–3 days, rebase it onto `main` and consider splitting it.

---

## 2. Current state

Observed on **2026-11-14**:

- **Single branch:** `main` (tracks `origin/main`). No develop, no release branch, no feature branches.
- **Three commits, all on `main`, linear:**

  | Commit | Date | Subject |
  |--------|------|---------|
  | `7c070ee` | 2026-11-13 | `Initial commit: FairShare - Splitwise clone` |
  | `bba8e04` | 2026-11-14 | `feat: migrate UI to shadcn components, local-first with Ed25519 crypto identity, CRDT sync relay` |
  | `dd0de6f` | 2026-11-14 | `chore: lock down build artifacts (test exclusions, .gitignore), add Playwright test suite with 29 E2E tests (25 pass, 4 reveal real bugs)` |

- **No tags** (`git tag -l` is empty).
- **package.json version is `0.0.0`**; **no `CHANGELOG.md`**.
- **Working tree is dirty** — uncommitted work for **F4 (payment links), F5 (export/import), F6 (comments & activity feed)** exists in the tree (modified `engine.ts`, `store.ts`, `sync.ts`, `api.ts`, `GroupPage.tsx`, `Profile.tsx`, plus untracked `paymentLinks.ts`, `exportImport.ts`, `feed.ts`, `notifications.ts`, `ActivityFeed.tsx`, `ExpenseComments.tsx`, `tsconfig.typecheck.json`).

Two things are true at once and this doc resolves them:

1. The **initial feature set (F4/F5/F6)** was built directly on `main` with no branches — fine as a bootstrap, but it's the *last* time we do that.
2. A **framing/cleanup step is needed** to turn the current tree into a clean, tagged baseline before feature-branching begins (see §7).

---

## 3. Branching model & naming

Trunk-based: all work branches off `main`, merges back into `main`. No `develop`, `staging`, or `release` branches — `main` is the trunk.

### Branch prefixes

| Prefix | Use | Example |
|--------|-----|---------|
| `feat/` | A new user-facing capability | `feat/f3-spending-analytics` |
| `fix/` | A bug fix | `fix/f5-csv-quoting` |
| `chore/` | Tooling, config, tests, refactors, docs (no user-visible behavior) | `chore/add-ci` |
| `docs/` | Documentation-only | `docs/update-dev-guide` |
| `test/` | Test-only work (optional; can fold into `feat`/`fix`) | `test/f7-conversion` |

### Naming rules

- **Format:** `<prefix>/<kebab-case-topic>`
- **Include the feature key** (`F1`–`F7`) in the topic for roadmap traceability. This connects the branch to the PRD/user story without hunting.
- **One branch per feature** (not per file). F4/F5/F6 were built as **one big working-tree blob**; going forward each feature gets its own branch.

### Feature → branch map (see §10 for details)

| Feature | Branch |
|---------|--------|
| F3 Spending Insights & Analytics | `feat/f3-spending-analytics` |
| F1 Receipt Scanning & OCR | `feat/f1-receipt-ocr` |
| F7 Multi-Currency Travel Mode | `feat/f7-multi-currency` |
| F2 Recurring Expenses | `feat/f2-recurring-expenses` |
| F4 Payment Links (done) | *(baseline — see §7)* |
| F5 Export/Import (done) | *(baseline — see §7)* |
| F6 Comments & Activity Feed (done) | *(baseline — see §7)* |

---

## 4. Commit convention

Use **Conventional Commits**. This gives you commit messages that machine-parse (for changelog/release automation later) and that read as a plain-English history.

### Format

```
<type>(<optional scope>): <imperative summary>   # ≤50 chars

[optional body — why, not what]

[optional footer — BREAKING CHANGE: … or refs]
```

### Types

| Type | When |
|------|------|
| `feat` | A new feature or user-visible capability |
| `fix` | A bug fix |
| `chore` | Build, tooling, config, dependency, or refactor with no behavior change |
| `docs` | Documentation only |
| `test` | Adding/updating tests |
| `refactor` | Code restructuring that doesn't change behavior (keeps tests green) |
| `perf` | Performance improvement |
| `build` | Build system / `vite` / `tsc` config changes |
| `ci` | CI configuration (`.github/workflows`) |
| `style` | Formatting only (no logic change) |

### Scopes

Use the app area as the scope. Suggested scopes: `engine`, `store`, `sync`, `api`, `ui`, `tests`, `relay`, `deps`, `build`.

> **Ordering preference:** `type(scope): summary` **before** `fix(engine): …`.

### Examples

```
feat(store): add uuid to ExpenseRecord for cross-device identity

Remote create_expense was minting a fresh local numeric id on apply,
so the same expense had different ids on different devices and comments
could not attach reliably. Carry op.op_id as the uuid.
```

```
fix(engine): clamp balance rounding to 2 decimals
chore(ci): add typecheck + playwright jobs to GitHub Actions
docs(README): document the sync protocol guarantees
```

### Rules

- **Imperative mood** summary (`add`, `fix`, `document`) — not past tense (`added`, `fixed`).
- **≤ 50 chars** for the subject line; wrap the body at ≤ 72.
- **Explain WHY** in the body, not WHAT (the diff already shows what).
- **One logical change per commit.** If a commit mixes concerns, split it.
- **Every commit leaves the tree working** — no commit with a type error or a failing test.
- **No "WIP", "fix2", "asdf".** If you must checkpoint, use WIP and squash before merging.

---

## 5. Feature branch lifecycle

The canonical loop. Terminal key for path: `cd splitwise-clone`

### Step 1 — Start from fresh `main`

```bash
cd splitwise-clone
git checkout main
git pull --rebase origin main     # never branch off a stale main
git checkout -b feat/f3-spending-analytics
```

### Step 2 — Work in small conventional commits

```bash
git add src/lib/analytics.ts
git commit -m "feat(engine): add analytics aggregation types"
git add src/lib/store.ts
git commit -m "feat(store): add category field to ExpenseRecord"
# …more small commits as the feature progresses…
```

### Step 3 — Push and open a PR (automated)

```bash
git push -u origin feat/f3-spending-analytics

# Create PR with `gh` — body auto-fills from CODE_REVIEW.md if available
gh pr create --base main --head feat/f3-spending-analytics \
  --title "feat: add spending insights & analytics (F3)" \
  --body "See CODE_REVIEW_F3.md for review findings."
```
This creates an auditable PR on GitHub with the diff, review comments, and CI status (once CI is set up). The PR is the permanent record of what changed and why.

### Step 4 — Keep the branch up to date

Reconcile with `main` frequently so the squash-merge is conflict-free. **Prefer rebase** to keep your own history tidy; the final squash erases the local commits anyway, so the choice is about your own working clarity.

```bash
git fetch origin
git rebase origin/main          # resolve conflicts here, not in the PR
git push --force-with-lease     # only if you rebased a pushed branch
```

### Step 5 — Merge (squash), tag, and clean up (automated)

After code review approves (no 🔴 blockers), merge via `gh`:

```bash
# Squash-merge and delete the remote branch in one command
gh pr merge --squash --delete-branch

# Switch to main, pull the squashed commit
git checkout main
git pull --rebase origin main

# Tag the release
git tag -a v0.2.0 -m "v0.2.0 — spending insights & analytics (F3)"

# Push tag and delete local branch
git push origin v0.2.0
git branch -d feat/f3-spending-analytics
```

This collapses the branch's scratch commits into **one** conventional commit on `main`, keeping `main` linear and each feature as a single, greppable, bisectable history entry. The PR remains on GitHub as the permanent record; the tag marks the release point.

> **Do not** use a merge commit on a short-lived feature branch — it pollutes the trunk with a bubble. Save merge commits for the rare case you genuinely want to preserve branch topology (not needed here).

### The loop in one picture

```
main:  o──────o──────o──────────●──────────────────●
        \                     /                    \
 feat:   ├──o──o──o──o───────┘        (squash)        ├──o──o──o───┘
        (create)         (rebase)                  (merge+delete)
```

---

## 6. Pull request workflow

Even a 1-person team benefits from a PR discipline: it forces a review checkpoint, runs checks in a clean environment, and leaves an auditable record. This is where the **agency-agents specialists** slots in — a code-review pass (e.g. `CODE_REVIEW_F4_F6.md`) is exactly the kind of self-review the PR body should reference.

### PR checklist (paste into the PR body)

```markdown
## What
- [ ] Feature/story: F3 — Spending Insights & Analytics (user-stories-phase1.md)
- [ ] One-sentence summary of the change

## Why
- [ ] Problem being solved / PRD section

## How
- [ ] Files touched and the shape of the change

## Verification
- [ ] `npm run build` (tsc) passes
- [ ] `npm run lint` passes
- [ ] `npx playwright test` passes (no regressions; note the count)
- [ ] ADR linked / decision recorded (docs/adr/)
```

### Review rules

- No review = no merge. On a 1-person team, "review" is a **self-review** using a checklist + a fresh-eyes pass (or delegate to a code-review specialist agent).
- **Each target branch must be rebased on latest `main`** and pass CI before merging.
- A PR should be small enough to review in one sitting. If it exceeds ~400 lines of diff, split it.
- Merge with **Squash and merge** only. Delete the branch after merge (GitHub can do this automatically).

### Branch protection (once you're on GitHub)

In `Settings → Branches → Branch protection rules` for `main`:

- Require a pull request before merging.
- Require status checks to pass (typecheck, lint, playwright).
- Require linear history (or just always squash) — GitHub blocks merge commits.
- Restrict direct pushes (set it so `main` can't be force-pushed).

### CI (recommended)

There is no CI today. Add `.github/workflows/ci.yml` that runs on `pull_request` (and `push` to `main`):

```yaml
name: CI
on: [pull_request, push]
jobs:
  frontend:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: frontend } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm, cache-dependency-path: frontend/package-lock.json }
      - run: npm ci
      - run: npm run build      # tsc -b + vite build
      - run: npm run lint
      - run: npx playwright install --with-deps chromium
      - run: npx playwright test # add a dev-server bootstrap step/wait-on
```

> Note: Playwright needs the Vite dev server running. Either use `wait-on`/`webServer` in `playwright.config.ts`, or start `npm run dev &` in the job before the test step.

---

## 7. Handling the existing `main` commits

The F4/F5/F6 work currently sits as uncommitted changes in the tree. Treat this as the **baseline** — commit it cleanly once, on `main`, then tag it. You only do this once; everything after uses feature branches.

### Step A — Commit the baseline as scoped conventional commits

The tree currently mixes **three features** (F4 payment links, F5 export/import, F6 comments/feed). Best practice: commit them as **separate, atomic conventional commits** rather than one giant blob, so history is honest. Work this way (from `splitwise-clone/`):

```bash
# 1) F6 — the foundation feature (engine/store/sync/feed/comments)
git add src/lib/engine.ts src/lib/store.ts src/lib/sync.ts src/lib/api.ts \
        src/lib/feed.ts src/lib/notifications.ts \
        src/pages/GroupPage.tsx src/components/ActivityFeed.tsx src/components/ExpenseComments.tsx
git commit -m "feat: add expense comments & activity feed (F6)

Establishes stable uuid on ExpenseRecord so comments attach to the same
expense across devices. Adds threads, reverse-chronological activity feed,
and local-only browser notifications."

# 2) F4 — payment links (independent, small)
git add src/lib/paymentLinks.ts src/pages/Profile.tsx
git commit -m "feat: add one-tap payment links (F4)

Deep links to Venmo/PayPal/Cash App pre-filled with amount and memo,
with optional per-user payment handles."

# 3) F5 — export/import (independent of F4)
git add src/lib/exportImport.ts src/lib/api.ts src/pages/Profile.tsx
git commit -m "feat: add CSV/JSON export & import with merge-by-uuid (F5)

Round-trip JSON export/import, CSV flatten, and Splitwise-CSV mapping.
Imported entities merged by uuid; no duplicate creation."

# 4) Close out the remaining config/test drift
git add playwright.config.ts vite.config.ts tsconfig.typecheck.json frontend/tests
git commit -m "chore: sync test/build config for the phase-1 feature set"
```

> The exact file-to-feature mapping above is illustrative — check `git status` and route each changed file to the feature it belongs to. If a file genuinely spans features (e.g. `api.ts`, `GroupPage.tsx`), split the hunks with `git add -p`.

### Step B — Verify the baseline

```bash
cd frontend
npm run build && npm run lint
npx playwright test        # note: 4 tests already reveal real bugs — fix or record them
```

If the 4 failing E2E tests represent known/unfixed bugs, then call `main` **pre-1.0 and not yet "releasable"** — tag it `v0.1.0-alpha` instead of `v0.1.0`, or raise/fix the bugs first (Jira-style: file them as issues, or fix them in the same baseline). See §8.

### Step C — Tag the baseline

```bash
git tag -a v0.1.0 -m "v0.1.0 — initial feature set (F4, F5, F6)
MVP + phase-1: payment links, export/import, comments & activity feed.
This is the baseline tag for the pre-trunk feature-branch era."
git push origin main --tags
```

This records the exact state of the "initial set" so you can always diff a later tag against a known-good point.

---

## 8. Version tagging scheme

Follow **Semantic Versioning** with a `v` prefix: `vMAJOR.MINOR.PATCH`.

### Pre-1.0 rule

While the product is `0.x` (`0.1.0`, `0.2.0`, …):

| Change | Bump | Example |
|--------|------|---------|
| New feature / user-visible capability | **MINOR** | `v0.1.0` → `v0.2.0` |
| Bug fix, non-user-facing tweak | **PATCH** | `v0.2.0` → `v0.2.1` |
| **Breaking** change (e.g. F7 rewrites `calculateBalances`) | **MINOR** in `0.x`, but call it out loudly in the release notes / `BREAKING CHANGE:` footer | `v0.2.0` → `v0.3.0` |

After 1.0, normal SemVer applies (breaking → MAJOR bump, e.g. `1.0.0` → `2.0.0`).

- **Tag format:** annotated (`git tag -a`) with a message describing the release. Annotated tags carry the author/date; lightweight tags don't.
- **Where tags go:** on `main`, at the merge commit of the last feature in the release.
- **Sync `package.json version`** with the tag at release time (currently `0.0.0`).
- **Convention:** only tag on `main`; never tag a feature branch.
- Tag naming: `v0.1.0`, `v0.2.0`, … (lowercase `v`, no date suffix). Use `-rc.1`/`-alpha` pre-release suffixes only when a release is knowingly not shippable (e.g. `v0.1.0-alpha` before the 4 known E2E bugs are fixed).

### Example release commands

```bash
git checkout main
git pull --rebase origin main
# bump frontend/package.json version to 0.1.0, commit: chore: bump version to 0.1.0
git tag -a v0.1.0 -m "v0.1.0 — F4/F5/F6 baseline"
git push origin main --tags
```

---

## 9. Changelog approach

For a 1–2 person team, **hand-maintain** a `CHANGELOG.md` at the repo root using the **Keep a Changelog** format. Skip changelog-generation CI tooling — it's overhead you don't need at this scale.

### Format

```markdown
# Changelog

All notable changes to this project are documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- F3 — Spending insights & analytics dashboard (category tagging, overview/categories/people/trends tabs).

## [0.1.0] - 2026-11-14

### Added
- F4 — One-tap payment links (Venmo/PayPal/Cash App deep links).
- F5 — CSV/JSON export & import with merge-by-uuid.
- F6 — Expense comments & activity feed, plus local browser notifications.
- Playwright E2E suite (29 tests) and shadcn UI migration.

[0.1.0]: https://github.com/webdevgaur/fairshare/compare/v0.0.0...v0.1.0
```

### Versioned sections

Sections: `Added`, `Changed`, `Fixed`, `Removed`, `Deprecated`, `Security`.

### Rules

- Keep an **`[Unreleased]`** section at the top. As you merge features, add one line under the appropriate heading.
- **At release time:** move every `[Unreleased]` line into a new `[vX.Y.Z] - YYYY-MM-DD` section, then reset `[Unreleased]`.
- Derive entries from the conventional-commit subjects (`feat:` → Added, `fix:` → Fixed, `chore:` → usually omit or list as Changed if notable).
- Add a compare link per release (GitHub's `...` compare URL).
- Keep it **user-facing** — a changelog is for the people using the app, not a dev log. Don't dump every commit.

### Release process (commands)

```bash
cd splitwise-clone
git checkout main && git pull --rebase origin main
# 1) Update CHANGELOG.md: move [Unreleased] -> [v0.1.0], add date + compare link
# 2) Update frontend/package.json version
git add CHANGELOG.md frontend/package.json frontend/package-lock.json
git commit -m "chore: release v0.1.0"
git tag -a v0.1.0 -m "v0.1.0"
git push origin main --tags
```

---

## 10. Feature roadmap → branches

From `user-stories-phase1.md`, the remaining features map to branches like this.

### Recommended sequence and parallel lanes

The stories define a dependency graph. Two lanes can run in parallel:

- **Lane A (serial, shared data foundation):** F6 → F5 → F2 → F3
- **Lane B (independent):** F1 can start immediately in parallel with Lane A
- **F7 always last** (it rewrites `calculateBalances`, which everything renders through)

Because **F4, F5, F6 are already built** (baseline, §7), the next branches are:

| Priority | Feature | Branch | Depends on | When to merge |
|----------|---------|--------|-----------|---------------|
| 1 | F6 Comments & Activity Feed | *(baseline)` | — | Already done |
| 2 | F5 Export / Import | *(baseline)* | F6 (uuid) | Already done |
| 3 | F2 Recurring Expenses | `feat/f2-recurring-expenses` | F6 (`createExpense` signature) | After F6 baseline |
| 4 | F3 Spending Insights & Analytics | `feat/f3-spending-analytics` | F6 (ExpenseRecord shape) | After F6 |
| — | F1 Receipt Scanning & OCR | `feat/f1-receipt-ocr` | none (independent) | In parallel |
| 5 | F7 Multi-Currency Travel Mode | `feat/f7-multi-currency` | F6, F3 | **Last** |

### Working the parallel lanes (2 devs or one dev alternating)

1. Dev A takes `feat/f3-spending-analytics`; Dev B takes `feat/f1-receipt-ocr` (independent lane).
2. Both branch off the **same latest `main`**, produce small conventional commits, push.
3. **Rebase onto `main` daily** — because F1 touches `engine.ts` (`Expense.custom`?) while F3 also touches `engine.ts`/`store.ts`, staying current avoids a hard conflict at merge time.
4. Land the smaller/less risky PR first (F1), then the other.
5. **F7 (`feat/f7-multi-currency`)** is only started after **F6 and F3** are both merged. Branch it off fresh `main`, and be extra careful around `calculateBalances` — keep the existing single-currency arithmetic path untouched and branch only into conversion when a rate/currency is present (per `user-stories-phase1.md` §F7).
6. After F7, bump the minor version (`v0.2.0` → `v0.3.0`) and release (§8–9).

**Golden rule for F7:** it's the cross-cutting change — don't let anything else branch off a `feat/f7-*` branch. Every other feature should be on `main` first so F7 rebases cleanly.

---

## 11. Repo hygiene & automation

Set these once. They make the trunk-based loop safe and boring.

### `.gitignore` (already good, but confirm)

`splitwise-clone/.gitignore` already ignores `backend/target/`, `backend/*.db`, `relay-server/target/`, `frontend/node_modules/`, `frontend/dist/`, `.env`, and test artifacts. **Never commit** `node_modules`, `target/`, `dist/`, `.env`, or `test-results/`.

### Pre-commit hooks (optional but recommended)

A lightweight `pre-commit` (or a `husky` hook) keeps commits honest:

```bash
# .git/hooks/pre-commit
cd frontend && npm run lint && npx tsc -b --noEmit
```
(Or use `pre-commit` framework in `pre-commit-config.yaml`.)

### Commit conventions lint (optional)

Install `commitlint` to block non-conventional messages on commit. Nice-to-have; if you skip it, at least keep the discipline in code review.

### Move the docs into the repo

Today `PRD_FairShare.md`, `user-stories-phase1.md`, and `docs/` (ADRs, API reference, dev guide) live **outside** the repo in `hermes_workspace/`. To make history self-contained, move them in:

```bash
mkdir -p splitwise-clone/docs
cp hermes_workspace/docs/adr/* splitwise-clone/docs/adr/      # keep ADRs in-repo
git add docs && git commit -m "docs: add ADRs and API reference into repo"
```

This means a fresh checkout carries the architecture decisions (F4/F6/F5 ADRs) that explain *why* the code looks the way it does — directly useful to the next agent the agency-agents system loads.

### Branch protection (repeat from §6)

Once you're on GitHub, protect `main`: require PRs, require passing checks, restrict direct pushes.

---

## 12. Quick reference / cheat sheet

```bash
# Start a feature
git checkout main && git pull --rebase origin main
git checkout -b feat/f3-spending-analytics

# Commit small, conventional
git add -p && git commit -m "feat(engine): add aggregation types"

# Push, open PR (feat/... -> main), keep current
git push -u origin feat/f3-spending-analytics
git fetch origin && git rebase origin/main && git push --force-with-lease

# Merge (squash) + delete
git checkout main && git pull --rebase origin main
git merge --squash feat/f3-spending-analytics && git commit -m "feat: add analytics"
git branch -d feat/f3-spending-analytics && git push origin main

# Release v0.x.y
# 1. edit CHANGELOG.md (move [Unreleased] -> new section)
# 2. bump frontend/package.json
git add CHANGELOG.md frontend/package.json frontend/package-lock.json
git commit -m "chore: release v0.2.0"
git tag -a v0.2.0 -m "v0.2.0"
git push origin main --tags

# Clean up (force-push protection): if you must rewrite a pushed branch
git push --force-with-lease origin feat/f7-multi-currency
```

### One-glance rules

| Situation | Do this |
|-----------|---------|
| Starting any work | branch off fresh `main` |
| Naming | `feat/fix/chore/docs` + kebab-case + `F<n>` key |
| Committing | Conventional Commits, imperative, ≤50-char subject, one logical change |
| Keeping current | `git rebase origin/main` (never `merge` into your own feature branch) |
| Merging into `main` | **Squash**, linear history |
| Releasing | tag on `main` (`vX.Y.Z`), update CHANGELOG + package.json |
| Feature that touches the balance engine | F7 — must be last, own branch, extra review |

---

## 13. FAQ / decisions

**Q: Should I use `git rebase` or `git merge` for feature branches?**
A: **Rebase** your feature branch on `main` to stay current, then **squash-merge** into `main`. This keeps `main` linear.

**Q: It's just me. Do I really need PRs?**
A: Yes, but treat them as a **checkpoint ritual**, not bureaucracy. A PR gives you a clean place for the checklist, ties the diff to a story, records what was verified, and gives the agency-agents code-review specialist something concrete to review.

**Q: What about the 4 failing Playwright tests?**
A: They're real bugs (per the commit message). Either fix them in the baseline (so `main` is genuinely releasable) before tagging `v0.1.0`, or tag `v0.1.0-alpha` and create `fix/` branches (e.g. `fix/playwright-sync-failures`) to address them as the first feature-branch cycle.

**Q: Can I ever commit directly to `main`?**
A: Only for trivial, non-user-visible changes (typos in docs, a one-line `.gitignore` fix, a version bump) — otherwise no.

**Q: F7 changes the same function everything uses. How do I avoid a mess?**
A: Land F6 and F3 on `main` first. Branch `feat/f7-multi-currency` off fresh `main`. Preserve the existing `calculateBalances` arithmetic path; branch only into conversion when a currency/rate is present. Rebase onto `main` after every other feature merges. This is the safest possible sequencing.

**Q: Do I need a `develop` branch?**
A: No. For 1–2 people `develop` adds a step with no benefit; trunk-based is simpler and faster.

---

## 14. Agent pipeline — from story to shipped feature

Every feature follows the same automated pipeline. The orchestrator (Hermes) drives each stage, delegating to specialist agents and executing Git/gh commands directly.

### Pipeline diagram

```
user-stories-phase1.md
         │
         ▼
┌─────────────────────┐
│ 1. Software Architect │  ───  ADR (docs/ADR-F*.md)
│    (validates approach)│
└─────────────────────┘
         │
         ▼
┌─────────────────────────┐
│ 2. Minimal Change Engineer │  ───  Code on feat/f*-<topic> branch
│    (implements)           │       Small conventional commits
└─────────────────────────┘
         │
         ▼
┌─────────────────────┐
│ 3. Code Reviewer     │  ───  CODE_REVIEW_F*.md
│    (reviews diff)    │       🔴/🟡/💭 classifications
└─────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│ 4. Orchestrator (Hermes)     │  ───  gh pr create
│    (creates PR, merges, tags)│       gh pr merge --squash --delete-branch
│                              │       git tag v0.X.0 && git push --tags
└─────────────────────────────┘
         │
         ▼
┌─────────────────────┐
│ 5. Technical Writer  │  ───  Update READMEs + docs
│    (updates docs)    │       Commit to main
└─────────────────────┘
         │
         ▼
    main (tagged)
```

### Commands executed by the orchestrator at each gate

**After code review approves (no 🔴 blockers):**

```bash
# 1. Create the PR
gh pr create --base main --head feat/f3-spending-analytics \
  --title "feat: add spending insights & analytics (F3)" \
  --body "$(cat CODE_REVIEW_F3.md)"

# 2. Squash-merge and delete remote branch
gh pr merge --squash --delete-branch

# 3. Tag the release
git checkout main && git pull --rebase origin main
git tag -a v0.2.0 -m "v0.2.0 — spending insights & analytics (F3)"
git push origin v0.2.0
git branch -d feat/f3-spending-analytics

# 4. Docs update committed to main
git add README.md frontend/README.md
git commit -m "docs: update READMEs for F3 analytics"
git push origin main
```

### Rollback procedure

Because every merge is a squash commit and every release is tagged:

```bash
# Roll back a specific feature
git revert <squash-commit-hash>
git push origin main

# Roll back to a known-good release
git checkout v0.1.0 -b fix/rollback-to-v0.1.0
# ... fix forward, then PR to main
```

The PR and CODE_REVIEW remain on GitHub as the permanent audit trail. The tag on main is the rollback anchor.

---

*Updated 2026-11-14. This doc is the source of truth for Git discipline on the FairShare repo.*
