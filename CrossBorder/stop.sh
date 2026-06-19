#!/usr/bin/env bash
# Stop all CrossBorder dev servers (Vite / npm run dev)

pkill -f "vite" 2>/dev/null
pkill -f "npm run dev" 2>/dev/null
for port in 3000 9000 9001; do
  lsof -ti:"$port" 2>/dev/null | xargs kill -9 2>/dev/null
done
echo "Stopped."
