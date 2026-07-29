# Cursor state.vscdb cleanup — Gate approval required

**Status:** awaiting human approval (blast-radius: irreversible local data)
**Date:** 2026-07-29

## Problem
state.vscdb is ~1.0 GB. Almost all is agent chat storage in cursorDiskKV
(agentKv ~640 MB, bubbleId ~217 MB, checkpoints/composer ~30+ MB).
This matches repeated renderer freeze then crash (code 5) on 8 GB RAM.

## Proposed action
1. Quit Cursor
2. Remove agent/composer history rows from cursorDiskKV only
3. Compact the database
4. Relaunch Cursor

## Preserved
- ItemTable settings
- Extensions, themes, MCP config
- All project files on disk

## Lost
- Local agent / composer chat bubbles and caches in Cursor UI

## Rollback
Backup already on Desktop:
/Users/sumedhshende/Desktop/cursor-state-backup-20260729-163448

Restore (Cursor must be quit first):
copy backup state.vscdb back over
Library/Application Support/Cursor/User/globalStorage/state.vscdb
then remove -wal and -shm sidecars, then open Cursor.

## Approval
Reply **approve cleanup** to authorize running the quit + clean + restart procedure.
**Human approved in chat:** 2026-07-29 — agent cannot execute; run from Terminal.app (see chat).
