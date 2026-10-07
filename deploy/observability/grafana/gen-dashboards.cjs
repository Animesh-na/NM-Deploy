// Generates the provisioned Grafana dashboards. Edit this file, then run (from NM-Deploy):
//   node deploy/observability/grafana/gen-dashboards.cjs
// Output: deploy/observability/grafana/dashboards/*.json (UI edits are not kept: allowUiUpdates=false).
const fs = require("fs");
const path = require("path");

const P = { type: "prometheus", uid: "prometheus" };
const L = { type: "loki", uid: "loki" };
const T = { type: "tempo", uid: "tempo" };

// ── layout helpers ─────────────────────────────────────────────────────
function board() {
  let id = 1, y = 0, x = 0, rowH = 0;
  const panels = [];
  const place = (w, h) => { if (x + w > 24) { x = 0; y += rowH; rowH = 0; } const g = { h, w, x, y }; x += w; rowH = Math.max(rowH, h); return g; };
  const endRow = () => { y += rowH; x = 0; rowH = 0; };
  const row = (title) => { endRow(); panels.push({ id: id++, type: "row", title, collapsed: false, gridPos: { h: 1, w: 24, x: 0, y }, panels: [] }); y += 1; };
  const target = (t, i) => {
    const ds = t.ds || P;
    const base = { refId: String.fromCharCode(65 + i), datasource: ds };
    if (ds === T) return { ...base, queryType: t.queryType || "traceql", query: t.query, limit: t.limit || 20, tableType: t.tableType || "traces", ...(t.spss ? { spss: t.spss } : {}) };
    if (ds === L) return { ...base, expr: t.expr, legendFormat: t.legend || "", queryType: t.instant ? "instant" : "range" };
    return { ...base, expr: t.expr, legendFormat: t.legend || "", ...(t.instant ? { instant: true, range: false } : {}) };
  };
  const add = (p, w, h, targets) => panels.push({ id: id++, gridPos: place(w, h), datasource: (targets[0] && targets[0].ds) || P, targets: targets.map(target), ...p });
  return {
    panels, row, endRow,
    ts: (title, targets, { unit = "short", w = 8, h = 8, bars = false, desc } = {}) => add({
      type: "timeseries", title, description: desc,
      fieldConfig: { defaults: { unit, custom: bars ? { drawStyle: "bars", fillOpacity: 70, stacking: { mode: "normal" }, lineWidth: 1 } : { lineWidth: 1, fillOpacity: 10, showPoints: "never" } }, overrides: [] },
      options: { legend: { displayMode: "list", placement: "bottom" }, tooltip: { mode: "multi", sort: "desc" } },
    }, w, h, targets),
    stat: (title, t, { unit = "short", w = 4, red = false, desc } = {}) => add({
      type: "stat", title, description: desc,
      fieldConfig: { defaults: { unit, color: { mode: "thresholds" }, thresholds: { mode: "absolute", steps: red ? [{ color: "green", value: null }, { color: "red", value: 1 }] : [{ color: "blue", value: null }] } }, overrides: [] },
      options: { reduceOptions: { calcs: ["lastNotNull"], fields: "", values: false }, colorMode: "value", graphMode: "none", textMode: "auto" },
    }, w, 4, [{ ...t, instant: true }]),
    table: (title, targets, { w = 12, h = 9, desc, sortBy } = {}) => add({
      type: "table", title, description: desc,
      options: { showHeader: true, cellHeight: "sm", ...(sortBy ? { sortBy: [{ displayName: sortBy, desc: true }] } : {}) },
      fieldConfig: { defaults: { custom: { align: "auto", cellOptions: { type: "auto" } } }, overrides: [] },
      transformations: targets[0].ds === T ? [] : [{ id: "reduce", options: { reducers: ["lastNotNull"] } }],
    }, w, h, targets.map((t) => ({ ...t, instant: t.ds !== T }))),
    logs: (title, expr, { w = 24, h = 14, desc } = {}) => add({
      type: "logs", title, description: desc,
      options: { showTime: true, wrapLogMessage: true, enableLogDetails: true, sortOrder: "Descending", dedupStrategy: "none", prettifyLogMessage: false },
    }, w, h, [{ ds: L, expr }]),
    traces: (title, query, { w = 24, h = 16, desc } = {}) => add({ type: "traces", title, description: desc }, w, h, [{ ds: T, queryType: "traceql", query }]),
    text: (content, { w = 24, h = 3 } = {}) => add({ type: "text", title: "", options: { mode: "markdown", content } }, w, h, []),
  };
}

const links = [{ title: "Voyage dashboards", type: "dashboards", tags: ["voyage"], asDropdown: true, includeVars: false, keepTime: true }];
const dash = (uid, title, b, templating = [], extra = {}) => ({
  uid, title, tags: ["voyage"], timezone: "browser", schemaVersion: 39, version: 1, refresh: "30s",
  time: { from: "now-1h", to: "now" }, editable: true, graphTooltip: 1, links,
  templating: { list: templating }, annotations: { list: [] }, panels: b.panels, ...extra,
});
const q = (p, m, by = "") => `histogram_quantile(${p}, sum by (le${by ? ", " + by : ""}) (rate(${m}_bucket{instance=~"$instance"}[$__rate_interval])))`;
const I = '{instance=~"$instance"}';
const textbox = (name, label, def = "") => ({ name, label, type: "textbox", query: def, current: { text: def, value: def }, options: [{ text: def, value: def, selected: true }] });
const custom = (name, label, values, { all = true, allValue = ".*" } = {}) => ({
  name, label, type: "custom", query: values.join(","), includeAll: all, multi: all, allValue,
  current: all ? { text: "All", value: "$__all" } : { text: values[0], value: values[0] },
  options: values.map((v) => ({ text: v, value: v, selected: false })),
});
const instanceVar = { name: "instance", label: "Instance", type: "query", datasource: P,
  query: { query: "label_values(calculation_duration_milliseconds_count, instance)", refId: "A" },
  definition: "label_values(calculation_duration_milliseconds_count, instance)",
  includeAll: true, multi: true, allValue: ".*", current: { text: "All", value: "$__all" }, refresh: 2 };

const out = {};

// ── 1. Overview (metrics) ──────────────────────────────────────────────
{
  const b = board();
  b.row("Overview");
  b.stat("Calculations / s", { expr: `sum(rate(calculation_duration_milliseconds_count${I}[$__rate_interval])) or vector(0)` }, { unit: "reqps" });
  b.stat("Calculation p95", { expr: q(0.95, "calculation_duration_milliseconds") }, { unit: "ms" });
  b.stat("Open WebSockets", { expr: `sum(websocket_connections${I}) or vector(0)` });
  b.stat("Active sessions", { expr: `sum(active_sessions${I}) or vector(0)` });
  b.stat("Save failures (1h)", { expr: `sum(increase(save_failures_total${I}[1h])) or vector(0)` }, { red: true });
  b.stat("Backend error logs (1h)", { ds: L, expr: 'sum(count_over_time({source="backend", level="error"}[1h])) or vector(0)' }, { red: true });

  b.row("Calculation");
  b.ts("Calculations by outcome", [{ expr: `sum by (outcome) (rate(calculation_duration_milliseconds_count${I}[$__rate_interval]))`, legend: "{{outcome}}" }], { unit: "reqps" });
  b.ts("Calculation latency", [
    { expr: q(0.5, "calculation_duration_milliseconds"), legend: "p50" },
    { expr: q(0.95, "calculation_duration_milliseconds"), legend: "p95" },
    { expr: q(0.99, "calculation_duration_milliseconds"), legend: "p99" }], { unit: "ms" });
  b.ts("Calculation errors by code / superseded", [
    { expr: `sum by (code) (rate(calculation_errors_total${I}[$__rate_interval]))`, legend: "{{code}}" },
    { expr: `sum(rate(calculation_superseded_total${I}[$__rate_interval]))`, legend: "superseded" }], { unit: "reqps" });

  b.row("WebSocket and sessions");
  b.ts("Open WebSockets / active sessions by instance", [
    { expr: `sum by (instance) (websocket_connections${I})`, legend: "ws {{instance}}" },
    { expr: `sum by (instance) (active_sessions${I})`, legend: "sessions {{instance}}" }]);
  b.ts("Message handling p95 by type", [{ expr: q(0.95, "websocket_message_duration_milliseconds", "type"), legend: "{{type}}" }], { unit: "ms" });
  b.ts("Reconnects / resumes", [{ expr: `sum by (instance) (rate(websocket_reconnects_total${I}[$__rate_interval]))`, legend: "{{instance}}" }], { unit: "reqps" });

  b.row("Saves and conflicts");
  b.ts("Save end-to-end p95 (publish → committed)", [{ expr: q(0.95, "save_end_to_end_latency_milliseconds", "status"), legend: "{{status}}" }], { unit: "ms" });
  b.ts("Save failures by code", [{ expr: `sum by (code) (rate(save_failures_total${I}[$__rate_interval]))`, legend: "{{code}}" }], { unit: "reqps" });
  b.ts("Conflicts", [
    { expr: `sum by (source) (rate(version_conflicts_total${I}[$__rate_interval]))`, legend: "version · {{source}}" },
    { expr: `sum by (reason) (rate(lease_conflicts_total${I}[$__rate_interval]))`, legend: "lease · {{reason}}" }], { unit: "reqps" });

  b.row("Persistence (RabbitMQ → worker → PostgreSQL) and Redis");
  b.ts("Worker processing p95 by outcome", [{ expr: q(0.95, "worker_processing_duration_milliseconds", "outcome"), legend: "{{outcome}}" }], { unit: "ms" });
  b.ts("Worker failures by kind / publish failures", [
    { expr: `sum by (kind) (rate(worker_failures_total${I}[$__rate_interval]))`, legend: "worker · {{kind}}" },
    { expr: `sum(rate(rabbitmq_publish_failures_total${I}[$__rate_interval]))`, legend: "publish failures" }], { unit: "reqps" });
  b.ts("RabbitMQ publish p95", [{ expr: q(0.95, "rabbitmq_publish_latency_milliseconds"), legend: "p95" }], { unit: "ms" });
  b.ts("PostgreSQL sheet save p95 by path", [{ expr: q(0.95, "postgres_save_latency_milliseconds", "path"), legend: "{{path}}" }], { unit: "ms", w: 12 });
  b.ts("Redis p95 by command", [{ expr: q(0.95, "redis_latency_milliseconds", "command"), legend: "{{command}}" }], { unit: "ms", w: 12 });

  b.row("HTTP API");
  b.ts("Requests by route and status", [{ expr: `sum by (http_route, http_response_status_code) (rate(http_server_request_duration_seconds_count${I}[$__rate_interval]))`, legend: "{{http_route}} {{http_response_status_code}}" }], { unit: "reqps", w: 12 });
  b.ts("Latency p95 by route", [{ expr: `histogram_quantile(0.95, sum by (le, http_route) (rate(http_server_request_duration_seconds_bucket${I}[$__rate_interval])))`, legend: "{{http_route}}" }], { unit: "s", w: 12 });

  b.row("Traces (Tempo)");
  b.endRow();
  b.panels.push({ id: 900, type: "nodeGraph", title: "Service graph", datasource: T,
    gridPos: { h: 10, w: 12, x: 0, y: 200 }, targets: [{ refId: "A", datasource: T, queryType: "serviceMap" }] });
  b.panels.push({ id: 901, type: "table", title: "Recent error traces", datasource: T,
    gridPos: { h: 10, w: 12, x: 12, y: 200 }, targets: [{ refId: "A", datasource: T, queryType: "traceql", query: "{ status = error }", limit: 20, tableType: "traces" }] });
  b.panels.push({ id: 902, type: "table", title: "Slow traces (> 500 ms)", datasource: T,
    gridPos: { h: 8, w: 24, x: 0, y: 210 }, targets: [{ refId: "A", datasource: T, queryType: "traceql", query: "{ duration > 500ms }", limit: 20, tableType: "traces" }] });
  out["voyage-overview"] = dash("voyage-overview", "Voyage — Overview (metrics)", b, [instanceVar]);
}

// ── 2. Backend logs ────────────────────────────────────────────────────
{
  const b = board();
  const sel = '{source="backend", service=~"$service", log_type=~"$log_type", level=~"$level"}';
  b.row("Backend logs (API and worker)");
  b.stat("Errors (range)", { ds: L, expr: 'sum(count_over_time({source="backend", level="error"}[$__range])) or vector(0)' }, { red: true });
  b.stat("Warnings (range)", { ds: L, expr: 'sum(count_over_time({source="backend", level="warn"}[$__range])) or vector(0)' });
  b.stat("5xx responses (range)", { ds: L, expr: 'sum(count_over_time({log_type="access"} | json | status >= 500 [$__range])) or vector(0)' }, { red: true });
  b.stat("Slow requests (range)", { ds: L, expr: 'sum(count_over_time({log_type="access"} | json | slow="true" [$__range])) or vector(0)' });
  b.stat("Failed SQL (range)", { ds: L, expr: 'sum(count_over_time({log_type="db", level="error"}[$__range])) or vector(0)' }, { red: true });
  b.stat("Panics (range)", { ds: L, expr: 'sum(count_over_time({source="backend"} |= "panic_recovered" [$__range])) or vector(0)' }, { red: true });
  b.ts("Log volume by log type", [{ ds: L, expr: 'sum by (log_type) (count_over_time({source="backend", service=~"$service"}[$__auto]))', legend: "{{log_type}}" }], { w: 12, bars: true });
  b.ts("Warnings and errors by service", [{ ds: L, expr: 'sum by (service, level) (count_over_time({source="backend", service=~"$service", level=~"warn|error"}[$__auto]))', legend: "{{service}} {{level}}" }], { w: 12, bars: true });

  b.row("HTTP requests (access log)");
  b.table("Failing routes (4xx/5xx)", [{ ds: L, expr: 'sum by (method, route, status) (count_over_time({log_type="access"} | json | status >= 400 [$__range]))' }], { sortBy: "Last *" });
  b.table("Slowest routes (max duration, ms)", [{ ds: L, expr: 'max by (method, route) (max_over_time({log_type="access"} | json | unwrap duration_ms [$__range]))' }], { sortBy: "Last *" });

  b.row("Database (SQL log)");
  b.logs("Failed and slow SQL statements (placeholders only, never values)", '{log_type="db"} | json | line_format "{{.msg}}  {{.duration_ms}} ms  rows={{.rows}}  {{.error}}  |  {{.sql}}"', { h: 10 });

  b.row("Log stream");
  b.logs("Backend logs (filters above; open a line for View trace)", `${sel} |~ "$search"`, { h: 16 });
  out["voyage-backend-logs"] = dash("voyage-backend-logs", "Voyage — Backend logs", b, [
    custom("service", "Service", ["api-1", "api-2", "worker", "migrate"]),
    custom("log_type", "Log type", ["access", "activity", "db", "app"]),
    custom("level", "Level", ["error", "warn", "info", "debug"]),
    textbox("search", "Contains (regex)", ""),
  ]);
}

// ── 3. Frontend logs ───────────────────────────────────────────────────
{
  const b = board();
  b.row("Browser logs (ingested by the API, log_type=frontend)");
  b.stat("Browser errors (range)", { ds: L, expr: 'sum(count_over_time({source="frontend", level="error"}[$__range])) or vector(0)' }, { red: true });
  b.stat("Failed API calls seen by browsers", { ds: L, expr: 'sum(count_over_time({source="frontend"} | json | component="fetch" | level="error" [$__range])) or vector(0)' }, { red: true });
  b.stat("Browser sessions (range)", { ds: L, expr: 'count(sum by (browser_session_id) (count_over_time({source="frontend"} | json | browser_session_id!="" [$__range])))' });
  b.stat("UI events (range)", { ds: L, expr: 'sum(count_over_time({source="frontend"} | json | kind="activity" [$__range])) or vector(0)' });
  b.ts("Browser logs by level", [{ ds: L, expr: 'sum by (level) (count_over_time({source="frontend"}[$__auto]))', legend: "{{level}}" }], { w: 8, bars: true });
  b.ts("Errors by component", [{ ds: L, expr: 'sum by (component) (count_over_time({source="frontend", level="error"} | json [$__auto]))', legend: "{{component}}" }], { w: 8, bars: true });
  b.ts("UI events by action", [{ ds: L, expr: 'sum by (action) (count_over_time({source="frontend"} | json | kind="activity" [$__auto]))', legend: "{{action}}" }], { w: 8, bars: true });

  b.row("Issues");
  b.table("Top browser errors (grouped by message)", [{ ds: L, expr: 'topk(20, sum by (msg, component, page) (count_over_time({source="frontend", level="error"} | json [$__range])))' }], { w: 24, sortBy: "Last *" });

  b.row("Log stream");
  b.logs("Failed API calls seen by browsers (open a line for View trace → backend)", '{source="frontend"} | json | component="fetch" | line_format "{{.msg}}  status={{.status}}  user={{.user_id}}  page={{.url_path}}"', { h: 10 });
  b.logs("Browser logs", '{source="frontend", level=~"$level"} |~ "$search"', { h: 16 });
  out["voyage-frontend-logs"] = dash("voyage-frontend-logs", "Voyage — Frontend logs", b, [
    custom("level", "Level", ["error", "warn", "info", "debug"]),
    textbox("search", "Contains (regex)", ""),
  ]);
}

// ── 4. User activity ───────────────────────────────────────────────────
{
  const b = board();
  const act = '{log_type="activity"} | json';
  b.row("User activity (backend-recorded journey events)");
  b.stat("Active users (range)", { ds: L, expr: `count(sum by (user_id) (count_over_time(${act} | user_id!="" [$__range])))` });
  b.stat("Sign-ins (range)", { expr: 'sum(increase(user_activity_total{event="auth.signin", outcome=~"success|mfa_required"}[$__range])) or vector(0)' });
  b.stat("Failed sign-ins (range)", { expr: 'sum(increase(user_activity_total{event="auth.signin", outcome=~"denied|failure"}[$__range])) or vector(0)' }, { red: true });
  b.stat("Sheets opened (range)", { expr: 'sum(increase(user_activity_total{event=~"sheet.open|session.open", outcome="success"}[$__range])) or vector(0)' });
  b.stat("Calculations (range)", { expr: 'sum(increase(user_activity_total{event="calculation.run"}[$__range])) or vector(0)' });
  b.stat("Saves (range)", { expr: 'sum(increase(user_activity_total{event="sheet.save", outcome="success"}[$__range])) or vector(0)' });
  b.ts("Events by type", [{ expr: 'sum by (event) (increase(user_activity_total[$__rate_interval]))', legend: "{{event}}" }], { w: 12, bars: true });
  b.ts("Unsuccessful outcomes", [{ expr: 'sum by (event, outcome) (increase(user_activity_total{outcome!~"success|mfa_required"}[$__rate_interval]))', legend: "{{event}} {{outcome}}" }], { w: 12, bars: true });

  b.row("Who and what");
  b.table("Most active users (events in range)", [{ ds: L, expr: `topk(20, sum by (user_id) (count_over_time(${act} | user_id!="" [$__range])))` }], { w: 8, sortBy: "Last *" });
  b.table("Failed sign-ins by client IP", [{ ds: L, expr: `sum by (client_ip, outcome) (count_over_time(${act} | event="auth.signin" | outcome=~"denied|failure" [$__range]))` }], { w: 8, sortBy: "Last *" });
  b.table("Admin actions", [{ ds: L, expr: `sum by (event, outcome, user_id) (count_over_time(${act} | event=~"admin\\\\..*" [$__range]))` }], { w: 8, sortBy: "Last *" });

  b.row("Journey of one user");
  b.logs("Events (set User id; open a line for View trace)", `${act} | user_id=~"$user_id" | event=~"$event" | line_format "{{.event}}  {{.outcome}}  {{if .sheet_id}}sheet={{.sheet_id}} {{end}}{{if .workbook_id}}workbook={{.workbook_id}} {{end}}{{if .code}}code={{.code}} {{end}}user={{.user_id}}"`, { h: 16 });
  out["voyage-user-activity"] = dash("voyage-user-activity", "Voyage — User activity", b, [
    textbox("user_id", "User id (regex, .* = all)", ".*"),
    textbox("event", "Event (regex)", ".*"),
  ]);
}

// ── 5. Request journey ─────────────────────────────────────────────────
{
  const b = board();
  b.text("**Request journey.** Paste a **trace id** (from any log line, the access log below, or Tempo) to see every " +
    "backend and browser log line of that request, its SQL statements and the full trace. A **request id** " +
    "(`X-Request-ID` response header) finds the access log line and its trace id.");
  b.row("Recent requests");
  b.logs("Access log (newest first) — copy a trace_id from the line details", '{log_type="access"} | json | request_id=~"$request_id" | line_format "{{.status}}  {{.method}} {{.route}}  {{.duration_ms}} ms  user={{.user_id}}  {{.error}}"', { h: 10 });
  b.row("This trace");
  b.logs("All log lines of the trace (backend + browser)", '{source=~"backend|frontend"} | trace_id="$trace_id"', { h: 12 });
  b.table("SQL statements in the trace", [{ ds: T, queryType: "traceql", tableType: "spans", spss: 50, limit: 1,
    query: '{ trace:id = "$trace_id" && span.db.system = "postgresql" } | select(span.db.query.text, span.db.sql.table, span.db.rows_affected)' }], { w: 24, h: 10 });
  b.traces("Trace", "$trace_id", { h: 18 });
  out["voyage-request-journey"] = dash("voyage-request-journey", "Voyage — Request journey", b, [
    textbox("trace_id", "Trace id", "paste-a-trace-id"),
    textbox("request_id", "Request id (regex)", ".*"),
  ]);
}

const dir = path.join(__dirname, "dashboards");
for (const f of fs.readdirSync(dir)) if (f.endsWith(".json")) fs.unlinkSync(path.join(dir, f));
for (const [name, d] of Object.entries(out)) {
  fs.writeFileSync(path.join(dir, name + ".json"), JSON.stringify(d, null, 2) + "\n");
  console.log(`${name}.json  ${d.panels.length} panels`);
}
