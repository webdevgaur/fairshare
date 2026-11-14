# FairShare — Split Expenses

A Splitwise-like cost-sharing app. Built with **Rust (Axum)** backend + **React/TypeScript** frontend, authenticated via **Clerk**.

Built using [agency-agents](https://github.com/msitarzewski/agency-agents) specialist AI personas as the development team.

## Tech Stack

| Layer | Choice |
|-------|--------|
| Backend | Rust, Axum, SQLx (SQLite) |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS |
| Auth | Clerk (JWT via JWKS) |
| Database | SQLite (local, zero-config) |

## Features

- **Groups** — Create shared expense groups with members
- **Expenses** — Add expenses with equal or custom splits
- **Balances** — Real-time per-person balance calculations
- **Settlements** — Record payments to settle debts
- **Auth** — Clerk-powered (Google, GitHub, email)

## Quick Start

### 1. Set up Clerk

1. Create an account at https://dashboard.clerk.com
2. Create a new application
3. Copy the **Publishable Key** and **JWKS URL**

### 2. Configure environment

```bash
# Backend
echo 'CLERK_JWKS_URL=https://your-clerk-domain.clerk.accounts.dev/.well-known/jwks.json' > backend/.env
echo 'DATABASE_URL=sqlite:splitwise.db' >> backend/.env

# Frontend
echo 'VITE_CLERK_PUBLISHABLE_KEY=pk_live_YOUR_KEY_HERE' > frontend/.env
```

### 3. Start the backend

```bash
cd backend
cargo run --release
# Starts on http://localhost:3001
```

### 4. Start the frontend

```bash
cd frontend
npm run dev
# Starts on http://localhost:5173
```

Or use the combined script:

```bash
./start.sh
```

## API Endpoints

All routes except `/health` require a Clerk JWT in the `Authorization: Bearer <token>` header.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/api/groups` | Create group |
| GET | `/api/groups` | List user's groups (with balances) |
| GET | `/api/groups/:id` | Get group details |
| GET | `/api/groups/:id/members` | List group members |
| GET | `/api/groups/:id/balances` | Per-member balances |
| POST | `/api/expenses` | Create expense |
| GET | `/api/expenses/group/:id` | List group expenses |
| POST | `/api/settlements` | Record settlement |
| GET | `/api/settlements/group/:id` | List group settlements |

## Project Structure

```
splitwise-clone/
├── backend/
│   ├── src/
│   │   ├── main.rs          # Server setup, routes
│   │   ├── auth.rs          # Clerk JWT verification
│   │   ├── models.rs        # Data types
│   │   └── routes/
│   │       ├── groups.rs    # Group CRUD + balances
│   │       ├── expenses.rs  # Expense CRUD
│   │       └── settlements.rs
│   ├── migrations/          # SQLx migrations
│   └── Cargo.toml
├── frontend/
│   ├── src/
│   │   ├── App.tsx          # Clerk + Router setup
│   │   ├── lib/api.ts       # API client
│   │   └── pages/
│   │       ├── Dashboard.tsx # Group list + summary
│   │       └── GroupPage.tsx # Group detail + expenses
│   ├── index.html
│   └── package.json
├── start.sh
└── .env.example
```

## Agency-Agents Plugin

The [agency-agents-router](https://github.com/msitarzewski/agency-agents) Hermes plugin is installed with 283 specialist personas. Restart the Hermes session to access:
- `agency_agents_search` — find specialists
- `agency_agents_inspect` — examine agent details
- `agency_agents_load` — load an agent for the current task
- `agency_agents_delegate` — delegate work to a specialist agent