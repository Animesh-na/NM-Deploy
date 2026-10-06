# NM-Deploy

Runs the Voyage Estimation platform: Docker Compose for the full stack, the edge proxy, environment template,
architecture and deployment notes. The application code lives in two sibling repositories:

| Repository | Contents |
|---|---|
| `NM-backend` | Go API + persistence worker (`cmd/api`, `cmd/worker`), calculation engine, migrations, backend docs |
| `NM-frontend` | React/Vite app |
| `NM-Deploy` (this repo) | `docker-compose.yml`, `deploy/edge/nginx.conf`, `.env.example`, [ARCHITECTURE.md](ARCHITECTURE.md), production notes |

## 1. Clone all three side by side

The compose file builds the images from `../NM-backend` and `../NM-frontend`, so the three folders must be
siblings with exactly these names:

```bash
mkdir voyage && cd voyage
```

```bash
git clone https://github.com/Animesh-na/NM-backend.git
```

```bash
git clone https://github.com/Animesh-na/NM-frontend.git
```

```bash
git clone https://github.com/Animesh-na/NM-Deploy.git
```

```
voyage/
├── NM-backend/
├── NM-frontend/
└── NM-Deploy/      ← run docker compose here
```

## 2. Configure

```bash
cd NM-Deploy && cp .env.example .env
```

Fill in the required secrets in `.env`:

- `POSTGRES_PASSWORD`, `RABBITMQ_PASSWORD`, `JWT_SECRET`
- `MFA_ENCRYPTION_KEY`: 64 hex characters, e.g. `openssl rand -hex 32`
- `ADMIN_EMAIL`, `ADMIN_PASSWORD`: the first admin account

`.env` is gitignored. Never commit it.

## 3. Run

```bash
docker compose up -d --build --wait
```

Open http://localhost:8080 and sign in with the admin account. Jaeger: http://localhost:16686, RabbitMQ:
http://localhost:15672.

| Task | Command (in NM-Deploy) |
|---|---|
| Status | `docker compose ps` |
| Logs | `docker compose logs -f api-1` |
| Apply a `.env` change (e.g. `CALC_AUTHORITY`) | `docker compose up -d` |
| Rebuild after pulling new code in the other repos | `docker compose up -d --build --wait` |
| Stop (keep data) | `docker compose down` |
| Stop and delete all data | `docker compose down -v` (cannot be undone) |
| End-to-end smoke test | `cd ../NM-backend && SMOKE_EMAIL=… SMOKE_PASSWORD=… go run ./cmd/smoke -base http://127.0.0.1:8080` |

## Versions that belong together

The frontend and backend share contracts: `calc.v1`, the `ws.v1` WebSocket protocol, the patch allowlist and the
golden test outputs. Deploy matching versions:

- **Before a change is merged**, run parity in `NM-backend` with `bash scripts/golden/parity.sh`. It reads
  `../NM-frontend`.
- **For releases**, tag both code repos with the same version (e.g. `v1.4.0`). Build the images from those tags.

## Calculation authority

`CALC_AUTHORITY` in `.env` sets who computes the results the user sees:

- `local` (default): the browser.
- `server_display`: the Go engine, with the browser as fallback.
- `server_only`: the Go engine only.

The browser reads the stage once per page load. To roll back, set `local` and run `docker compose up -d`. See
[ARCHITECTURE.md §3](ARCHITECTURE.md#3-calculation-authority-stages).

## Production

Not chosen yet: see [deploy/production/README.md](deploy/production/README.md).

## Working with Claude Code

[CLAUDE.md](CLAUDE.md) holds the rules for AI-assisted changes: calculation integrity, data, security, and the
STOP-AND-ASK list. `.claude/` holds the reviewer agents. To use them, start Claude Code in `NM-Deploy` and add
`../NM-backend` and `../NM-frontend` as additional directories.
