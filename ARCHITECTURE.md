# Crabwalk Dashboard Architecture

## Overview

Crabwalk is a real-time monitoring dashboard for Clawdbot agents. It displays sessions, actions, and exec events from one or more Clawdbot gateways.

## Data Flow

```
┌─────────────────┐     ┌─────────────────┐
│   MacBook Pro   │     │    Mac Mini     │
│   (48GB RAM)    │     │   (16GB RAM)    │
│                 │     │                 │
│ Gateway :18789  │     │ Gateway :18789  │
└────────┬────────┘     └────────┬────────┘
         │                       │
         │ WebSocket             │ SSH + CLI
         │                       │
         └───────────┬───────────┘
                     │
            ┌────────▼────────┐
            │    Crabwalk     │
            │   Dashboard     │
            │    :9009        │
            └─────────────────┘
```

## Data Sources

### Primary Gateway Connection (WebSocket)
- **Configured via**: `CLAWDBOT_URL` env var
- **Default**: `ws://127.0.0.1:18789`
- **Current**: `ws://10.144.238.251:18789` (Mac Mini's gateway)
- **Protocol**: Clawdbot Gateway Protocol v3
- **Auth**: `CLAWDBOT_API_TOKEN` env var
- **Real-time events**: sessions, actions, exec events

### Unified Dashboard (SSH + CLI)
- **MacBook**: Local `clawdbot` CLI commands
- **Mac Mini**: SSH to `felipes-mac-mini.local` + CLI commands
- **Endpoints**: `unified.status`, `unified.crons`, `unified.sessions`
- **Use case**: Aggregated view across both gateways

## Session Count Discrepancy - Root Cause

The dashboard was showing 52 sessions when the actual count should be ~9.

**Cause**: Persistence service was accumulating historical sessions in `data/sessions.json`. Subagent sessions (ephemeral by nature) were being persisted and never cleaned up.

**Fix**: 
1. Clear stale data: `rm data/sessions.json data/actions.jsonl data/exec-events.jsonl`
2. Dashboard now correctly shows live session count

**Actual Sessions (as of 2026-01-31)**:
- MacBook: 3 sessions (main + 2 subagents)
- Mac Mini: 6 sessions (main + 3 crons + 2 iOS)
- **Total: 9 active sessions**

## Key Files

### Integration Layer
- `src/integrations/clawdbot/client.ts` - WebSocket client for gateway
- `src/integrations/clawdbot/collections.ts` - TanStack DB collections for sessions/actions
- `src/integrations/clawdbot/persistence.ts` - File-based persistence (auto-starts)
- `src/integrations/clawdbot/protocol.ts` - Type definitions for gateway protocol
- `src/integrations/clawdbot/parser.ts` - Event parsing utilities

### tRPC Router
- `src/integrations/trpc/router.ts` - API endpoints
  - `clawdbot.*` - Single gateway operations
  - `unified.*` - Multi-gateway aggregation

### Persistence
- `data/sessions.json` - Persisted session list
- `data/actions.jsonl` - Action history (max 10k)
- `data/exec-events.jsonl` - Exec events (max 20k)
- `data/state.json` - Persistence service state

## Configuration

### Environment Variables (.env.local)
```
CLAWDBOT_URL=ws://10.144.238.251:18789  # Mac Mini gateway
CLAWDBOT_API_TOKEN=<gateway-token>
PORT=9009
```

### Multi-Gateway Support
The unified router fetches data from both gateways:
1. **MacBook**: Local CLI calls
2. **Mac Mini**: SSH + CLI calls

## Recommendations for Unified Team Structure

### Current Limitations
1. Only one WebSocket connection (to Mac Mini)
2. Unified router uses SSH which adds latency
3. Persistence accumulates stale subagent sessions

### Proposed Improvements
1. **Multi-Gateway WebSocket**: Connect to both gateways via WebSocket
2. **Session TTL**: Add automatic cleanup of idle subagent sessions
3. **Gateway Labels**: Tag sessions with source gateway for filtering
4. **Shared Session Index**: Consider gateway-side session federation

### Cleanup Script
Run periodically to prevent session accumulation:
```bash
cd ~/repos/crabwalk
rm -f data/sessions.json data/actions.jsonl data/exec-events.jsonl
```

Or use the tRPC endpoint: `clawdbot.persistenceClear`
