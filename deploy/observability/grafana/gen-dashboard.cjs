// Generates dashboards/voyage-overview.json. Edit this file, then run (from NM-Deploy):
//   node deploy/observability/grafana/gen-dashboard.cjs deploy/observability/grafana/dashboards/voyage-overview.json
const P = { type: "prometheus", uid: "prometheus" }, L = { type: "loki", uid: "loki" }, T = { type: "tempo", uid: "tempo" };
let id = 1, y = 0, x = 0, rowH = 0;
const panels = [];
const I = '{instance=~"$instance"}';
const sel = () => '{instance=~"$instance"}';
const row = (title) => { panels.push({ id: id++, type: "row", title, collapsed: false, gridPos: { h: 1, w: 24, x: 0, y }, panels: [] }); y += 1; };
const place = (w, h) => { if (x + w > 24) { x = 0; y += rowH; rowH = 0; } const g = { h, w, x, y }; x += w; rowH = Math.max(rowH, h); return g; };
const endRow = () => { y += rowH; x = 0; rowH = 0; };
const ts = (title, targets, unit = "short", w = 8, h = 8, custom = {}) => panels.push({
  id: id++, type: "timeseries", title, datasource: targets[0].ds || P, gridPos: place(w, h),
  fieldConfig: { defaults: { unit, custom: { lineWidth: 1, fillOpacity: 10, showPoints: "never", ...custom } }, overrides: [] },
  options: { legend: { displayMode: "list", placement: "bottom" }, tooltip: { mode: "multi", sort: "desc" } },
  targets: targets.map((t, i) => ({ refId: String.fromCharCode(65 + i), datasource: t.ds || P, expr: t.expr, legendFormat: t.legend || "", ...(t.ds === L ? { queryType: "range" } : {}) })),
});
const stat = (title, expr, unit = "short", ds = P, thresholds) => panels.push({
  id: id++, type: "stat", title, datasource: ds, gridPos: place(4, 4),
  fieldConfig: { defaults: { unit, color: { mode: "thresholds" }, thresholds: thresholds || { mode: "absolute", steps: [{ color: "green", value: null }] } }, overrides: [] },
  options: { reduceOptions: { calcs: ["lastNotNull"], fields: "", values: false }, colorMode: "value", graphMode: "area", textMode: "auto" },
  targets: [{ refId: "A", datasource: ds, expr, ...(ds === L ? { queryType: "instant" } : { instant: true }) }],
});
const red = { mode: "absolute", steps: [{ color: "green", value: null }, { color: "red", value: 1 }] };
const q = (p, m, by = "") => `histogram_quantile(${p}, sum by (le${by ? ", " + by : ""}) (rate(${m}_bucket${sel()}[$__rate_interval])))`;
const bars = { drawStyle: "bars", fillOpacity: 60, stacking: { mode: "normal" } };

row("Overview");
stat("Calculations / s", `sum(rate(calculation_duration_milliseconds_count${I}[$__rate_interval])) or vector(0)`, "reqps");
stat("Calculation p95", q(0.95, "calculation_duration_milliseconds"), "ms");
stat("Open WebSockets", `sum(websocket_connections${I}) or vector(0)`);
stat("Active sessions", `sum(active_sessions${I}) or vector(0)`);
stat("Save failures (1h)", `sum(increase(save_failures_total${I}[1h])) or vector(0)`, "short", P, red);
stat("Error logs (1h)", 'sum(count_over_time({service=~".+", level="error"}[1h])) or vector(0)', "short", L, red);
endRow();

row("Calculation");
ts("Calculations by outcome", [{ expr: `sum by (outcome) (rate(calculation_duration_milliseconds_count${I}[$__rate_interval]))`, legend: "{{outcome}}" }], "reqps");
ts("Calculation latency", [
  { expr: q(0.5, "calculation_duration_milliseconds"), legend: "p50" },
  { expr: q(0.95, "calculation_duration_milliseconds"), legend: "p95" },
  { expr: q(0.99, "calculation_duration_milliseconds"), legend: "p99" }], "ms");
ts("Calculation errors by code / superseded", [
  { expr: `sum by (code) (rate(calculation_errors_total${I}[$__rate_interval]))`, legend: "{{code}}" },
  { expr: `sum(rate(calculation_superseded_total${I}[$__rate_interval]))`, legend: "superseded" }], "reqps");
endRow();

row("WebSocket and sessions");
ts("Open WebSockets / active sessions by instance", [
  { expr: `sum by (instance) (websocket_connections${I})`, legend: "ws {{instance}}" },
  { expr: `sum by (instance) (active_sessions${I})`, legend: "sessions {{instance}}" }]);
ts("Message handling p95 by type", [{ expr: q(0.95, "websocket_message_duration_milliseconds", "type"), legend: "{{type}}" }], "ms");
ts("Reconnects / resumes", [{ expr: `sum by (instance) (rate(websocket_reconnects_total${I}[$__rate_interval]))`, legend: "{{instance}}" }], "reqps");
endRow();

row("Saves and conflicts");
ts("Save end-to-end p95 (publish → committed)", [{ expr: q(0.95, "save_end_to_end_latency_milliseconds", "status"), legend: "{{status}}" }], "ms");
ts("Save failures by code", [{ expr: `sum by (code) (rate(save_failures_total${I}[$__rate_interval]))`, legend: "{{code}}" }], "reqps");
ts("Conflicts", [
  { expr: `sum by (source) (rate(version_conflicts_total${I}[$__rate_interval]))`, legend: "version · {{source}}" },
  { expr: `sum by (reason) (rate(lease_conflicts_total${I}[$__rate_interval]))`, legend: "lease · {{reason}}" }], "reqps");
endRow();

row("Persistence (RabbitMQ → worker → PostgreSQL) and Redis");
ts("Worker processing p95 by outcome", [{ expr: q(0.95, "worker_processing_duration_milliseconds", "outcome"), legend: "{{outcome}}" }], "ms");
ts("Worker failures by kind / publish failures", [
  { expr: `sum by (kind) (rate(worker_failures_total${I}[$__rate_interval]))`, legend: "worker · {{kind}}" },
  { expr: `sum(rate(rabbitmq_publish_failures_total${I}[$__rate_interval]))`, legend: "publish failures" }], "reqps");
ts("RabbitMQ publish p95", [{ expr: q(0.95, "rabbitmq_publish_latency_milliseconds"), legend: "p95" }], "ms");
ts("PostgreSQL sheet save p95 by path", [{ expr: q(0.95, "postgres_save_latency_milliseconds", "path"), legend: "{{path}}" }], "ms", 12);
ts("Redis p95 by command", [{ expr: q(0.95, "redis_latency_milliseconds", "command"), legend: "{{command}}" }], "ms", 12);
endRow();

row("HTTP API");
ts("Requests by route and status", [{ expr: `sum by (http_route, http_response_status_code) (rate(http_server_request_duration_seconds_count${I}[$__rate_interval]))`, legend: "{{http_route}} {{http_response_status_code}}" }], "reqps", 12);
ts("Latency p95 by route", [{ expr: `histogram_quantile(0.95, sum by (le, http_route) (rate(http_server_request_duration_seconds_bucket${I}[$__rate_interval])))`, legend: "{{http_route}}" }], "s", 12);
endRow();

row("Traces (Tempo)");
panels.push({ id: id++, type: "nodeGraph", title: "Service graph", datasource: T, gridPos: place(12, 10),
  targets: [{ refId: "A", datasource: T, queryType: "serviceMap" }] });
panels.push({ id: id++, type: "table", title: "Recent error traces", datasource: T, gridPos: place(12, 10),
  targets: [{ refId: "A", datasource: T, queryType: "traceql", query: "{ status = error }", limit: 20, tableType: "traces" }] });
panels.push({ id: id++, type: "table", title: "Slow traces (> 500 ms)", datasource: T, gridPos: place(24, 8),
  targets: [{ refId: "A", datasource: T, queryType: "traceql", query: "{ duration > 500ms }", limit: 20, tableType: "traces" }] });
endRow();

row("Logs (Loki)");
ts("Log volume by service", [{ ds: L, expr: 'sum by (service) (count_over_time({service=~"$service"}[$__auto]))', legend: "{{service}}" }], "short", 12, 8, bars);
ts("Warnings and errors by service", [{ ds: L, expr: 'sum by (service, level) (count_over_time({service=~"$service", level=~"warn|error"}[$__auto]))', legend: "{{service}} {{level}}" }], "short", 12, 8, bars);
panels.push({ id: id++, type: "logs", title: "Logs (open a line, then 'View trace')", datasource: L, gridPos: place(24, 14),
  options: { showTime: true, wrapLogMessage: true, enableLogDetails: true, sortOrder: "Descending", dedupStrategy: "none" },
  targets: [{ refId: "A", datasource: L, expr: '{service=~"$service", level=~"$level"} |= "$search"', queryType: "range" }] });
endRow();

const dash = {
  uid: "voyage-overview", title: "Voyage Platform — Overview", tags: ["voyage"], timezone: "browser",
  schemaVersion: 39, version: 1, refresh: "30s", time: { from: "now-1h", to: "now" }, editable: true, graphTooltip: 1,
  templating: { list: [
    { name: "instance", label: "Instance", type: "query", datasource: P,
      query: { query: 'label_values(calculation_duration_milliseconds_count, instance)', refId: "A" },
      definition: 'label_values(calculation_duration_milliseconds_count, instance)',
      includeAll: true, multi: true, allValue: ".*", current: { text: "All", value: "$__all" }, refresh: 2 },
    { name: "service", label: "Log service", type: "query", datasource: L,
      query: { label: "service", stream: "", type: 1, refId: "B" }, definition: "label_values(service)",
      includeAll: true, multi: true, allValue: ".+", current: { text: "All", value: "$__all" }, refresh: 2 },
    { name: "level", label: "Log level", type: "custom", query: "error,warn,info,debug",
      includeAll: true, multi: true, allValue: ".*", current: { text: "All", value: "$__all" },
      options: ["error", "warn", "info", "debug"].map((v) => ({ text: v, value: v, selected: false })) },
    { name: "search", label: "Log contains", type: "textbox", query: "", current: { text: "", value: "" } },
  ] },
  annotations: { list: [] },
  panels,
};
require("fs").writeFileSync(process.argv[2], JSON.stringify(dash, null, 2) + "\n");
console.log(panels.length + " panels");
