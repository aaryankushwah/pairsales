# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Paperclip — an open-source Node.js control plane for orchestrating AI agent teams. This fork (see CONTEXT.MD) targets non-technical marketing teams with pre-configured agents running via OpenClaw. The dashboard is React + Express + PostgreSQL (Drizzle ORM), and OpenClaw handles all agent execution through a WebSocket gateway adapter.

## Commands

```bash
# Development
pnpm install              # Install all workspace dependencies
pnpm dev                  # Start API + UI with watch mode (embedded PG, zero config)
pnpm dev:server           # Server only
pnpm dev:ui               # UI only (needs server running separately)

# Build & Typecheck
pnpm build                # Build all workspaces
pnpm typecheck            # Alias: pnpm -r typecheck

# Testing
pnpm test                 # Vitest watch mode
pnpm test:run             # Vitest single run (all packages)
pnpm test:e2e             # Playwright E2E (headless)
pnpm test:e2e:headed      # Playwright E2E (with browser)

# Database
pnpm db:generate          # Generate migration from schema changes (compiles packages/db first)
pnpm db:migrate           # Apply pending migrations
pnpm db:seed              # Seed database

# Verification (run all three before claiming done)
pnpm -r typecheck && pnpm test:run && pnpm build
```

Dev server runs at `http://localhost:3100` (API and UI served together). Health check: `curl http://localhost:3100/api/health`.

Leaving `DATABASE_URL` unset uses embedded PostgreSQL at `~/.paperclip/instances/default/db/`. Reset with `rm -rf ~/.paperclip/instances/default/db && pnpm dev`.

## Architecture

**Monorepo** (pnpm workspaces):

| Workspace | Role |
|---|---|
| `server/` | Express 5 REST API, orchestration services, WebSocket realtime |
| `ui/` | React 19 + Vite + React Router 7 + Tailwind CSS + Radix UI |
| `packages/db/` | Drizzle ORM schema (`src/schema/*.ts`), migrations, DB client |
| `packages/shared/` | Types, Zod validators, constants, API path definitions |
| `packages/adapter-utils/` | Base adapter functionality |
| `packages/adapters/openclaw-gateway/` | OpenClaw WebSocket adapter (the only adapter used) |
| `cli/` | CLI tool (`pnpm paperclipai ...`) |
| `agents/` | Agent config files (SOUL.md, HEARTBEAT.md) |

**Dependency flow**: `server` → `db`, `shared`, `adapter-utils`, `openclaw-gateway`. `ui` → `shared`, `adapter-utils`, `openclaw-gateway`. `db` → `shared`.

### Server (`server/src/`)

- **Routes** (`routes/`): Express routers — one file per domain (agents, issues, companies, projects, goals, approvals, costs, etc.). Routes enforce company-scoping and actor permissions via `authz.ts` helpers (`assertBoard`, `assertCompanyAccess`).
- **Services** (`services/`): Business logic as factory functions taking `db`. Heartbeat orchestration (`heartbeat.ts`) is the most complex service. Every mutation logs to `activity_log`.
- **Realtime**: WebSocket server in `realtime/live-events-ws.ts` for live updates.
- **Auth**: better-auth for session-based auth. Deployment modes: `local_trusted` (no auth, dev default) and `authenticated`. Actor types: `board` (human), `agent` (API key bearer), `service` (internal).

### UI (`ui/src/`)

- **Pages** (`pages/`): One component per route (Dashboard, Agents, Issues, Projects, Goals, Approvals, Costs, etc.)
- **API layer** (`api/`): Centralized `client.ts` with typed wrappers; consumed via React Query hooks.
- **Context providers**: CompanyContext (selected company), ThemeContext, LiveUpdatesProvider, DialogContext, SidebarContext, PanelContext, etc.
- **Components** (`components/`): 60+ components, uses Radix UI primitives in `components/ui/`.
- **Routing**: React Router with `/:companyPrefix/*` nesting. Root redirects to first company's dashboard.
- **Path alias**: `@/` maps to `ui/src/` (configured in Vite and tsconfig).

### Database Schema (`packages/db/src/schema/`)

All domain entities are company-scoped (FK to `companies`). Key tables: `companies`, `agents` (with `reports_to` for org tree), `issues` (parent/child hierarchy, single assignee), `projects`, `goals`, `approvals`, `cost_events`, `activity_log` (immutable audit trail), `heartbeat_runs`, `agent_api_keys` (hashed bearer tokens).

**Schema change workflow**: edit `packages/db/src/schema/*.ts` → export from `schema/index.ts` → `pnpm db:generate` → `pnpm -r typecheck`.

## Engineering Rules

1. **Company-scope everything** — all entities scoped to a company; enforce boundaries in routes/services.
2. **Keep contracts synchronized** — schema changes must propagate across `db` → `shared` → `server` → `ui`.
3. **Preserve control-plane invariants**: single-assignee tasks, atomic issue checkout, approval gates, budget hard-stop auto-pause, immutable activity logging.
4. **Activity logging** — every mutation must call `logActivity()` with actor, action, entity, and details.
5. **API conventions** — base path `/api`, consistent HTTP errors (400/401/403/404/409/422/500), company access checks on all endpoints.
6. **Plan docs** — new plans go in `doc/plans/` with `YYYY-MM-DD-slug.md` naming.

## Key Environment Variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection (unset = embedded PG) |
| `OPENCLAW_GATEWAY_URL` | WebSocket URL for OpenClaw (`ws://localhost:18789`) |
| `OPENCLAW_GATEWAY_TOKEN` | Auth token for gateway |
| `ANTHROPIC_API_KEY` | For agent model calls |
| `BETTER_AUTH_SECRET` | Session signing secret |
| `PAPERCLIP_DEPLOYMENT_MODE` | `local_trusted` or `authenticated` |
| `PAPERCLIP_SECRETS_MASTER_KEY` | AES-256 key for secret storage |

## TypeScript

Target ES2023, module NodeNext, strict mode. No ESLint or Prettier configured — rely on `tsc --noEmit` for correctness.
