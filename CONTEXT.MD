# GTM Agent

A SaaS product that gives non-technical marketing teams an autonomous AI marketing department.
Built on a stripped fork of Paperclip (paperclipai/paperclip) with OpenClaw as the agent runtime.

## Architecture
- Forked Paperclip dashboard (React + Express + PostgreSQL + Drizzle ORM)
- OpenClaw gateway running alongside it (ws://127.0.0.1:18789, Protocol v3)
- Both run in Docker Compose on a single GCP VM per customer
- Agents are pre-configured — users interact only through the web dashboard

## Repo structure
Paperclip monorepo (pnpm workspaces):
- server/ — Express API (port 3100)
- ui/ — React + Vite frontend
- packages/adapters/openclaw-gateway/ — the only adapter we use
- packages/db/ — Drizzle schema + migrations
- agents/ — SOUL.md + HEARTBEAT.md for each marketing agent
- docker-compose.yml — runs app + openclaw + postgres together

## Key decisions
- OpenClaw handles all agent execution, scheduling, and model calls
- Paperclip handles dashboard, tasks, approvals, budgets, and auth
- The two talk via the Gateway WebSocket — the openclaw-gateway adapter is the bridge
- No plugins, no multi-adapter selection, no user-configurable agents