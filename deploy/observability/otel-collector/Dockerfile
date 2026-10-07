# The collector image is distroless (no shell): add a static busybox only so
# the compose healthcheck can probe the health_check extension (M9).
ARG COLLECTOR_VERSION=0.111.0
FROM busybox:1.36-musl AS busybox
FROM otel/opentelemetry-collector-contrib:${COLLECTOR_VERSION}
COPY --from=busybox /bin/busybox /busybox
