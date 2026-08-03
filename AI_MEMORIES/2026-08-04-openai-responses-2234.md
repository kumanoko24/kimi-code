# OpenAI Responses and local gateway action ledger

- updated_at: `2026-08-04T05:32:25+08:00`
- objective: add native OpenAI Responses support for GPT-5.6 Sol, Terra, and Luna through the local port 2234 gateway
- current milestone: M2 — gateway compact route and deployment
- status: in progress
- Kimi pre-change commit: `c27a9f`
- gateway pre-change commit: `889bdb5`
- live rollback boundary: deployed gateway artifact `24db43a15ec0d74e5566dabdba877b469bd22f5c758f99a9203c1a2d4dfefa55.whl`

## Invariants

- Keep the Kimi-side input cap configurable and set the live profile to `258000`; do not silently clamp gateway requests.
- Preserve one stable session identity in both `prompt_cache_key` and an opt-in request header; never configure one static header for every session.
- Preserve OpenAI compaction output as opaque provider state and send it back unchanged on the next Responses request.
- Never print or mutate source credentials. Keep port 2234 loopback-only and retain the previous release for rollback.
- Keep existing protocols and legacy text compaction working when native Responses compaction is unavailable.

## Milestones

### M1 — request and compaction contracts (PASS)

Success criteria:

- Kimi omits an inferred `max_output_tokens` while retaining explicitly configured output caps for providers that support them;
- an opt-in provider header receives the same per-session cache key as `prompt_cache_key`;
- OpenAI Responses exposes native compact capability without leaking the opaque state into rendered text;
- contract-focused tests cover all three behaviors and existing provider tests remain green;
- one checkpoint commit records the dependency-closed Kimi mechanism.

Recovery boundary: revert the M1 Kimi commit; no live config or service mutation belongs to M1.

Evidence:

- OpenAI Responses omits context-derived fallback `max_output_tokens` but preserves explicit hard caps;
- one per-session cache identity now populates both `prompt_cache_key` and the configured dynamic header;
- native compact output is stored as opaque protocol state, persisted on the wire, projected without rendering, and replayed byte-for-byte as JSON values;
- `agent-core-v2` build and typecheck passed; all 288 test files / 4,485 tests passed; import-boundary lint passed across 1,053 files;
- changed-file oxlint reported zero errors; repository-wide pre-existing warnings remain outside this milestone.

Baseline evidence:

- direct port 2234 Responses requests returned HTTP 200 with exact expected text for Sol/medium, Terra/high, and Luna/xhigh;
- the installed Kimi `0.31.1` failed against the same gateway with HTTP 400 because it sent `max_output_tokens`;
- direct `POST /v1/responses/compact` returned HTTP 404;
- port 2234 is a loopback LaunchAgent service with four fresh eligible accounts and the recorded rollback artifact.

### M2 — gateway compact route and deployment (pending)

Promotion condition: M1 contracts and focused regressions pass.

Success criteria:

- the gateway forwards the official compact body without silent semantic mutation;
- invalid requests and upstream failures keep the public OpenAI error envelope and structured terminal observability;
- focused and full gateway gates pass, a checkpoint commit exists, and canonical deployment preserves the prior artifact;
- live compact RBV returns `response.compaction` through port 2234.

Recovery boundary: reactivate the recorded pre-change wheel and exact LaunchAgent state.

### M3 — live Kimi profile and end-to-end RBV (pending)

Promotion condition: M1 and M2 are independently PASS and the deployed compact route is healthy.

Success criteria:

- live Kimi configuration exposes Sol, Terra, and Luna with medium/high/xhigh and a `258000` input cap;
- real Kimi CLI turns succeed for all three models and exercise tools, stable affinity, and native compaction;
- regressions, changeset, documentation, diff audit, and clean status pass;
- final evidence is committed and the Kimi feature branch is pushed to the verified `kumanoko24/kimi-code` remote.

Recovery boundary: restore the pre-change Kimi config and the prior gateway artifact.
