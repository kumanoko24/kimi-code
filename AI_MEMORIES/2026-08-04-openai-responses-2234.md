# OpenAI Responses and local gateway action ledger

- updated_at: `2026-08-04T06:16:00+08:00`
- objective: add native OpenAI Responses support for GPT-5.6 Sol, Terra, and Luna through the local port 2234 gateway
- current milestone: M3 — live Kimi profile and end-to-end RBV
- status: PASS
- Kimi pre-change commit: `c27a9f`
- Kimi mechanism commits: `54b21c7cf`, `af2677ca6`
- gateway pre-change commit: `889bdb5`
- gateway commits: `4075d67`, `d45deb0`
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

### M2 — gateway compact route and deployment (PASS)

Promotion condition: M1 contracts and focused regressions pass.

Success criteria:

- the gateway forwards the official compact body without silent semantic mutation;
- invalid requests and upstream failures keep the public OpenAI error envelope and structured terminal observability;
- focused and full gateway gates pass, a checkpoint commit exists, and canonical deployment preserves the prior artifact;
- live compact RBV returns `response.compaction` through port 2234.

Recovery boundary: reactivate the recorded pre-change wheel and exact LaunchAgent state.

Evidence:

- `POST /v1/responses/compact` is forwarded to the private upstream compact route without modifying the request body; malformed public requests and upstream errors retain the OpenAI error envelope;
- 91 focused gateway tests, 550 full tests, Ruff, formatting, mypy, and compile gates passed;
- the deployed loopback listener is PID `21835` on `127.0.0.1:2234`, bound to commit `4075d676cd8ee86a8b573e9fe3f02f0dd0be2300` and artifact `5b4430dfe76149874a35e6e3fa019be18c7f75711e5b578f924c3f655a0cf4fc.whl`;
- direct compact RBV returned HTTP 200, object `response.compaction`, two output items, and usage; replaying those raw items through `/v1/responses` returned exact text `COMPACT_RBV_OK` with the same sticky assignment;
- structured logs record route, status, affinity source, decision, usage, and latency without printing opaque compact output.

### M3 — live Kimi profile and end-to-end RBV (PASS)

Promotion condition: M1 and M2 are independently PASS and the deployed compact route is healthy.

Success criteria:

- live Kimi configuration exposes Sol, Terra, and Luna with medium/high/xhigh and a `258000` input cap;
- real Kimi CLI turns succeed for all three models and exercise tools, stable affinity, and native compaction;
- regressions, changeset, documentation, diff audit, and clean status pass;
- final evidence is committed and the Kimi feature branch is pushed to the verified `kumanoko24/kimi-code` remote.

Recovery boundary: restore the pre-change Kimi config and the prior gateway artifact.

Evidence:

- installed Kimi binary SHA-256: `0aca5a281d09ab2e4abcb57fb43e18e08994d4daf7f23088b2631e15f9c532ab`; installed config SHA-256: `e8e084faca80e5395efed2703e075e2e55553eadf080c8539006dff51a6ac13e`; `kimi doctor` passed;
- the live config retains the existing default model and defines Sol, Terra, and Luna with exact model IDs, `medium` / `high` / `xhigh`, `max_context_size = 258000`, `max_input_size = 258000`, a dynamic cache-key header, and native compaction enabled;
- real CLI sessions returned exact `KIMI_SOL_HIGH_OK`, `KIMI_TERRA_MEDIUM_OK`, and `KIMI_LUNA_XHIGH_OK`; their wire records identify the expected OpenAI Responses provider, model, alias, and effort;
- tool RBV session `session_88a56f08-dc1e-4f5d-95d2-51c1383a9333` called Bash, observed `KIMI_TOOL_RBV_OK`, and returned exact `KIMI_TOOL_CALL_OK`; its two Responses calls used one session hash, progressed from `new_assignment` to `sticky_hit`, and reported a 96.9% cached-input ratio on the second call;
- compaction RBV session `session_147fc3b2-1e5e-45a6-8956-5e1e195ff284` called `/v1/responses`, `/v1/responses/compact`, then `/v1/responses`; request IDs `21e030f0efcf4ee6bfde361e6cb91bfb`, `800c61f060a245319a15c2a0337dc33f`, and `61c59577c521497c95315bed51d916ac` used one session hash and sticky assignment; the next turn returned exact `KIMI_AFTER_NATIVE_COMPACT_OK`;
- the compact wire record contains only the safe shape `protocol = openai_responses`, four opaque items, and no rendered summary message; the next request replayed those provider items;
- final regression gates passed: v2 288 files / 4,485 tests, legacy 225 files / 4,124 passing tests, kosong 49 files / 1,364 tests, all four relevant typechecks, all three package builds, native SEA smoke, VitePress build, changeset status, diff check, and changed-file lint with zero errors;
- English and Chinese user docs describe the dynamic cache header, native Responses compaction, experiment flag, and `/compact` behavior. The documented `gen-docs` sync helper is absent from this checkout, so the two language trees were updated manually and verified by the docs build.

### M4 — image input and compaction semantics (PASS)

Verified at `2026-08-04 15:07 UTC+8`.

Success criteria:

- pasted data-URI images remain intact through both OpenAI Responses adapters;
- real Sol, Terra, and Luna requests identify image content without the expected answer appearing in the prompt;
- native `/responses/compact` semantics match current OpenAI Codex behavior;
- focused tests, bilingual docs, one checkpoint commit, and the origin branch remain recoverable.

Recovery boundary: revert the M4 checkpoint commit. M4 changes no live config, gateway artifact, credentials, or listener state.

Evidence:

- the TUI turns pasted image bytes into a data URL, and both Responses adapters encode that value as `input_image`; focused legacy and v2 contract tests pin the data-URI shape;
- direct blind image RBV through `127.0.0.1:2234/v1/responses` returned `{"letter":"K","dot_color":"blue"}` for Sol, Terra, and Luna in response IDs `resp_024ba0929d237789016a718c620eac81979e72f833a11cdf29`, `resp_0ae4153db22d5780016a718c64b328819796ec750e946e6f10`, and `resp_04b0c967ba98504e016a718c66ce2c8195960f69325fed6be7`;
- gateway request IDs `9245e1542e5f489583ad15abd603b056`, `8338a081d12943aaa19c6b3376330385`, and `7638704c6165451b9aa0c15a603128f2` each recorded `explicit_session_header`, HTTP 200, and terminal usage;
- real Kimi SDK-engine sessions `session_e15323f1-e7d2-463e-aab8-8e2cf0bd1ab7`, `session_254b8070-0e0f-4015-be69-ace381dee5f9`, and `session_21ad15fd-3fa7-496c-bf12-82276e8c967a` used the live Sol, Terra, and Luna aliases with image input and returned `K_BLUE`, `K_blue`, and `K_blue`;
- the live aliases all retain `capabilities = ["thinking", "tool_use", "image_in"]`, and the loopback listener remains PID `21835` on the same deployed wheel;
- current OpenAI Codex source at `5af85998c24fb3353ddd8164c3ed472057b03cb3` sends history as `input` and base instructions as `instructions` to the dedicated compact endpoint, without a summary prompt; its separate local fallback appends `SUMMARIZATION_PROMPT` and runs an ordinary Responses inference;
- Kimi's native path matches that split: it sends conversation input plus the active system prompt and selected `medium` / `high` / `xhigh` reasoning effort to `/responses/compact`, while its existing text fallback remains prompt-based;
- the Codex comparison exposed and fixed a legacy clone-binding defect that kept native compact bound to the pre-`withThinking` provider; v2 now forwards per-turn thinking params through the model requester as well;
- direct compact-effort RBV sent `reasoning.effort = "xhigh"` through port 2234 and returned `response.compaction` ID `resp_018f010ea90ace61016a718ee23be08194bdcf4b14eb4df28a`; gateway request `af442945590246aa81d3091dcecb732e` completed with HTTP 200;
- the newly installed Kimi binary SHA-256 is `95a32c2d5f6908c7b7dd1c70da981a6ea9197d5683bea3dcd8f00484e346aec1`; `kimi doctor` and native smoke passed, and the replaced binary is recoverable at `/Users/noelbao/.kimi-code/backups/openai-responses-20260804-1505/kimi`;
- installed-binary session `session_a89fc506-fa52-4b7a-a150-8d8fa52cf6eb` returned `FIRST_INSTALLED_DONE`, triggered native compact with `thinkingEffort = "high"`, persisted four opaque provider items, then returned `SECOND_INSTALLED_DONE`; gateway requests `ac8ad0b4bb5d4ab6b509bf8135a6240c`, `47dcb9c129ec43af96b75632ea77cbef`, and `af785744ac2645d0b871d68cd2e7ecb2` shared one sticky session hash and all completed with HTTP 200;
- final gates passed: kosong 49 files / 1,364 tests, v2 288 files / 4,487 tests, legacy 225 files / 4,124 passing tests, TUI image 19 tests, all three relevant typechecks, native SEA smoke, VitePress build, changeset status, diff check, and changed-file lint with zero errors.

Local recovery:

- pre-change Kimi config: `/Users/noelbao/.kimi-code/backups/openai-responses-20260804-0550/config.toml`;
- pre-change Kimi binary: `/Users/noelbao/.kimi-code/backups/openai-responses-20260804-0550/kimi`;
- pre-change gateway wheel: `/Users/noelbao/Library/Application Support/openai-api-gateway/releases/2234/releases/24db43a15ec0d74e5566dabdba877b469bd22f5c758f99a9203c1a2d4dfefa55.whl`.
