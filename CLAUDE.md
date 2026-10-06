# Voyage Platform — rules for changes

Maritime voyage-estimation platform. Three repositories, cloned side by side: `NM-backend`, `NM-frontend` and this `NM-Deploy`. Server-authoritative calculation was introduced in migration milestones M0–M10
(complete). Architecture: [ARCHITECTURE.md](ARCHITECTURE.md).
History and decisions:

- `../NM-backend/docs/migration/PROGRESS.md`
- `../NM-backend/docs/migration/DECISIONS.md` (D-nnn)
- `../NM-backend/docs/migration/DISCREPANCIES.md` (X-nnn)

## Layout

- `../NM-backend` is the Go/Gin API and persistence worker (one module, two processes; a modular monolith). It contains
  the authoritative calculation engine `internal/voyagecalc`.
- `../NM-frontend` is the React/Vite app. It still contains the browser calculation, used as a fallback and for
  comparison. Stage 5, its removal per domain, is deferred (D-058).
- `NM-Deploy` (here) holds docker-compose, the edge proxy, `.env.example` and ARCHITECTURE.md.

Treat the code as the source of truth. Never assume a feature exists until you've found it.

## Working rules

- In each repo, branch from `main` (`feat/…`, `fix/…`). A change that touches both code repos needs a branch in each, merged together; run parity before merging. Never commit to `main` directly. Never force-push. Use conventional commits.
- Small steps: change → run the relevant tests → fix → commit.
- Log decisions in `DECISIONS.md` (next number after the last D-nnn).
- Before merging calculation changes, run the `parity-guardian` agent. For versioning, lease, session, WebSocket,
  worker or reconnect code, run `concurrency-reviewer`.

## STOP-AND-ASK (don't decide alone)

Stop and ask the user when a decision would change any of these:

- a calculation output for any golden scenario (any frontend ↔ Go discrepancy)
- money precision or rounding behavior
- regulatory logic (EU ETS, UK ETS, FuelEU, CII, EEOI)
- data-loss or "saved" semantics, or data retention
- the authentication/authorization model
- public API compatibility
- the production deployment topology
- the engine-version policy or the multi-tab policy

## Non-negotiable rules

**Calculation integrity**

- Never change a formula silently. For any discrepancy: reproduce → isolate the input → identify current product
  behavior → add a regression test → log it in `DISCREPANCIES.md` → get a user decision → then change.
- Don't invent maritime rules. Don't simplify formulas. Don't delete or weaken tests to make them pass.
- There is one engine, `internal/voyagecalc`; extend it. Never create a second competing engine.
- Calculations are deterministic: no map-iteration-order aggregation, no global mutable state, no randomness.

**Data and concurrency**

- PostgreSQL is the only durable truth. Redis holds session, lease, recovery, cache and rate-limit data only.
- Optimistic concurrency is `UPDATE … SET version = version + 1 WHERE id = $1 AND version = $2`. Zero rows means
  `VERSION_CONFLICT`. Never `WHERE version < $n`. Never last-writer-wins.
- Every mutation carries a fencing token, and PostgreSQL writes are fenced too.
- Sticky sessions are never the consistency mechanism.
- RabbitMQ carries durable persistence only, never UI traffic. Workers are idempotent.
- "Saved" means the PostgreSQL commit succeeded.
- `calculation_snapshots` is also the save idempotency ledger: never delete its rows.
- Sheets stay one row with JSON `data`. Analytics columns are generated from it (D-060).

**Security**

- No long-lived JWTs in WebSocket query strings; use the short-lived, single-use tickets.
- Patches only through the field allowlist, with typed validation and size limits.
- Validate org, sheet, segment and lease ownership server-side on every request and patch.
- No secrets in frontend source, bundles, URLs, logs or responses. Don't log sheet contents.
- Browser-facing DTOs must not expose internal diagnostics or proprietary intermediate values.

## Commands

```text
# Whole stack (NM-Deploy)
up:         cp .env.example .env (fill secrets) ; docker compose up -d --build --wait   → http://localhost:8080
smoke:      (../NM-backend) SMOKE_EMAIL=… SMOKE_PASSWORD=… go run ./cmd/smoke -base http://127.0.0.1:8080

# Backend (../NM-backend) — go 1.24
fmt:        gofmt -l <files you touched>
vet/test:   go vet ./... ; go test ./...
build:      go build ./...
race:       MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD:/src" -v gomodcache:/go/pkg/mod -w /src golang:1.24 go test -race ./internal/voyagecalc/... ./internal/handlers ./internal/services
            (no cgo on Windows: race runs in the golang container, D-027)
migrate:    go run ./cmd/api -migrate          # -migrate-down N reverts N versioned migrations
test-db:    docker run -d --name m3-pg -e POSTGRES_PASSWORD=m3test -e POSTGRES_DB=m3 -p 127.0.0.1:55432:5432 postgis/postgis:16-3.4-alpine
test-redis: docker run -d --name m4-redis -p 127.0.0.1:56379:6379 redis:7-alpine
test-mq:    docker run -d --name m6-rabbit -p 127.0.0.1:55672:5672 -p 127.0.0.1:55673:15672 rabbitmq:3.13-management-alpine
integr.:    TEST_REDIS_ADDR=127.0.0.1:56379 TEST_AMQP_URL=amqp://guest:guest@127.0.0.1:55672/ \
            TEST_DATABASE_URL=postgres://postgres:m3test@127.0.0.1:55432/m3?sslmode=disable \
            go test -tags integration -count=1 ./internal/repository ./internal/session/... ./internal/realtime ./internal/persist
ws-order:   (container) go test -race -count=100 -run TestOutOfOrderCompletionOnlyLatestResultEmitted ./internal/realtime
ws proto:   UPDATE_WS_PROTOCOL=1 go test ./internal/realtime, then copy internal/realtime/protocol.generated.ts to ../NM-frontend/src/contracts/ws/
allowlist:  UPDATE_PATCH_ALLOWLIST=1 go test ./internal/voyagecalc/contract -run TestPatchAllowlist   # review the diff
bench:      go test -run XXX -bench 'BenchmarkGolden|BenchmarkHugeVoyage' ./internal/voyagecalc/contract
docs:       node scripts/docs/check-docs.mjs

# Parity (../NM-backend) — frontend defaults to ../NM-frontend (FRONTEND_DIR overrides)
parity:     bash scripts/golden/parity.sh            # schema sync + TS types + go test -tags parity (88/88)
parity+:    bash scripts/golden/parity.sh --update   # also regenerates frontend expected outputs
scenarios:  node scripts/golden/derive-scenarios.mjs # rebuild golden inputs + manifest (then parity --update)

# Frontend (../NM-frontend) — Node 24, npm 11
install:    npm ci
lint:       npm run lint                          # 30 known pre-existing errors; introduce no new ones
typecheck:  npx tsc --noEmit -p tsconfig.app.json
test:       npm test                              # known baseline failures: live-API vessel fuel + weather routing files
build:      npm run build ; npm run check:bundle  # bundle secret scan
contract:   npm run contract:gen | contract:check
golden:     TZ=UTC npm run golden:update          # writes ../NM-backend/internal/voyagecalc/testdata/golden/**/*.expected.json
dev:        (PowerShell) $env:VITE_SERVER_CALCULATION='true'; $env:VITE_MARINE_API_BASE='/api/v1'; $env:DEV_API_PROXY='http://localhost:8090'; npx vite --port 8080
```
