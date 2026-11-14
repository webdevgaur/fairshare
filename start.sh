#!/usr/bin/env bash
set -euo pipefail

echo "=== FairShare — Splitwise Clone ==="
echo ""

# Check env vars
if [ ! -f backend/.env ]; then
  echo "Creating backend/.env from template..."
  cp .env.example backend/.env
  echo "Edit backend/.env with your Clerk JWKS URL"
fi

if [ ! -f frontend/.env ]; then
  echo "Creating frontend/.env from template..."
  cp .env.example frontend/.env
  echo "Edit frontend/.env with your VITE_CLERK_PUBLISHABLE_KEY"
fi

# Build & start backend
echo ""
echo "=== Building backend (Rust) ==="
cd backend
cargo build --release 2>&1
echo "=== Starting backend on :3001 ==="
DATABASE_URL="sqlite:splitwise.db" \
CLERK_JWKS_URL="$(grep CLERK_JWKS_URL .env | cut -d= -f2)" \
./target/release/splitwise-clone &
BACKEND_PID=$!
cd ..

# Start frontend
echo ""
echo "=== Starting frontend on :5173 ==="
cd frontend
npm run dev &
FRONTEND_PID=$!
cd ..

echo ""
echo "FairShare running:"
echo "  Frontend: http://localhost:5173"
echo "  Backend:  http://localhost:3001"
echo ""
echo "Press Ctrl+C to stop both"

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT
wait