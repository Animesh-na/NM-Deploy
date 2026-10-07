# Production deployment target

Not chosen yet. The production topology is an open decision (see
[backend/docs/DEPLOYMENT.md](../../../NM-backend/docs/DEPLOYMENT.md#open-questions)).

Options and what would go in this folder:

| Option | Contents here | Good fit when |
|---|---|---|
| Docker Compose on 1–2 VMs | `compose.prod.yml` (no PostgreSQL service; managed PostgreSQL) | Small team, low traffic, simplest operations |
| Kubernetes | Helm chart or `k8s/{base,overlays/staging,overlays/production}` | You already run Kubernetes; you need autoscaling and rolling deploys |
| Managed containers (ECS, Cloud Run, Container Apps) | Terraform in a top-level `infra/` | You don't want to run a cluster |

Requirements for every option (already met by the images):

- Run images built once per commit, tagged with the git SHA. Staging and production use the same image.
- Run `migrate` (API image with `-migrate`) as a one-shot job before rolling out `api` and `worker`.
- Stateless API replicas behind a load balancer. No sticky sessions. WebSocket upgrade and a 75 s idle timeout.
- PostgreSQL with backups. Redis must be single-shard, with no eviction (`noeviction`) and AOF persistence. RabbitMQ
  needs durable queues.
- Secrets come from a secrets manager. `WS_ALLOWED_ORIGINS` is the public URL. TLS is terminated before the edge.
- Health checks: `/healthz` for liveness, `/readyz` for readiness (returns 503 while draining). Allow a termination
  grace period of at least 35 s.

## Observability in production

The compose stack ships Prometheus, Loki, Tempo, Alloy and Grafana as single nodes with local storage. That suits one
host. For production, keep the same pipeline and these settings:

- Applications export OTLP to a collector (`OTEL_EXPORTER_OTLP_ENDPOINT`). Give each replica a unique
  `service.instance.id` through `OTEL_RESOURCE_ATTRIBUTES`. Kubernetes can set it from the pod name.
- Reuse the collector config in `deploy/observability/otel-collector/`, including the background-Redis filter.
- Point the backends at durable or managed storage: Tempo and Loki on object storage (S3/GCS/Azure Blob), and
  Prometheus with remote write or a managed service (Grafana Cloud, Amazon Managed Prometheus, …).
- Collect logs with the platform's agent instead of mounting the Docker socket. Use Alloy as a DaemonSet on
  Kubernetes, or the cloud's log driver. Keep the `service` and `level` labels and `trace_id` as structured metadata,
  so the Grafana links keep working.
- Put Grafana behind SSO and TLS, with the admin password in the secrets manager. Provision the same data sources and
  dashboard from `deploy/observability/grafana/`.
