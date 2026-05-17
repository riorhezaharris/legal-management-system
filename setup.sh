#!/usr/bin/env bash
# Run once after first clone or after Issue #2 is written by RALPH.
set -euo pipefail

echo "=== Installing dependencies ==="
npm install

echo "=== Generating Prisma client ==="
npx prisma generate

echo "=== Building TypeScript ==="
npm run build

echo "=== Setup complete. Run 'npm run dev' to start the server. ==="
echo ""
echo "To apply database migrations, run:"
echo "  npx prisma migrate dev --name init"
