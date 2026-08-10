# OpenAI Responses and local gateway action ledger

- updated_at: `2026-08-10T08:22:00+08:00`
- objective: retain native OpenAI Responses support while adding isolated `kiminn` provider observability, tmux identity, and managed-Kimi video fallback
- current milestone: M18 — managed Kimi K3 video fallback
- next milestones: none
- status: PASS (`M1` through `M18` independently PASS)
- Kimi pre-change commit: `c27a9f`
- Kimi mechanism commits: `54b21c7cf`, `af2677ca6`
- gateway pre-change commit: `889bdb5`
- gateway commits: `4075d67`, `d45deb0`, `b383c5c`
- live rollback boundary: restore isolated files from `/Users/noelbao/.kiminn/backups/m16-m18-20260810-0811/` and roll gateway artifact `09b8dbd1ceb537acb27c3e875474017b851a0ced489d92a86457e6a171c7eab5.whl` back to `f395b5ccc08399b99f04c1aafed68da6385588ef6a4b5fea6c952eaa34b0be2c.whl`

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

### M5 — isolated `kiminn` installation (PASS)

Verified at `2026-08-04 19:33 UTC+8`.

Success criteria:

- `kiminn` uses the tuned binary without modifying or replacing the existing `kimi` executable, configuration, sessions, or state;
- interactive invocations start in auto permission mode with Sol and xhigh thinking by default;
- prompt mode remains usable despite Kimi's explicit `--prompt` / `--auto` conflict;
- user and workspace AGENTS.md plus generic and workspace skills are discovered through the normal Kimi paths;
- a real tool-calling request reaches port 2234 and the TUI exposes the effective mode, model, and effort.

Recovery boundary: the whole installation is contained under `/Users/noelbao/.kiminn` plus the single entrypoint `/Users/noelbao/.local/bin/kiminn`; the existing `/Users/noelbao/.kimi-code` tree requires no rollback.

Evidence:

- `/Users/noelbao/.kiminn/bin/kimi` is a byte-identical snapshot of the tuned `0.31.1` binary at SHA-256 `95a32c2d5f6908c7b7dd1c70da981a6ea9197d5683bea3dcd8f00484e346aec1`;
- `/Users/noelbao/.local/bin/kiminn` pins `KIMI_CODE_HOME=/Users/noelbao/.kiminn` and injects `--auto` for interactive invocations; explicit prompt or permission flags bypass that default so valid CLI combinations remain valid;
- dedicated config validation passed and selects `local-openai-2234/gpt-5.6-sol`, xhigh thinking, native Responses compaction, the per-session cache header, a 258000 input/context cap, and the same Terra/Luna alternatives;
- prompt RBV session `session_3511bd01-5c24-4c9d-abac-0d4412ca6185` executed Bash without an approval stop, printed `KIMINN_AUTO_TOOL_OK`, and returned `KIMINN_PROMPT_RBV_OK`;
- its wire facts record `permission.set_mode = "auto"`, `model = "gpt-5.6-sol"`, and `thinkingEffort = "xhigh"`; gateway requests `e4e648e06bc44a0db240f0d1a7f1f97d` and `97c7a3eb628e46008820390880880b84` shared one explicit session identity, progressed from `new_assignment` to `sticky_hit`, and completed with HTTP 200;
- the injected prompt identifies `/Users/noelbao/.kiminn/AGENTS.md` and `/Volumes/K/Works/kimi-code/AGENTS.md`, and enumerates workspace `.agents/skills` including `agent-core-dev`, `gen-changesets`, and `write-tui`; normal discovery also retains user `~/.agents/skills`;
- interactive TUI session `session_03d71907-d457-4660-aadc-aa7183570c95` visibly rendered `auto`, `GPT-5.6 Sol (local 2234)`, and `thinking: xhigh` in its footer;
- the original Kimi config, binary, and AGENTS.md checksums remain unchanged; the copied AGENTS.md snapshot matches the original at SHA-256 `e6377e8c1db1a8cc9e6537ec2a2954377a02703c91a8248f914940e1308d3e8d`.

### M6a — upstream sync and shared session interoperability (PASS)

Verified at `2026-08-05 05:18 UTC+8`.

Success criteria:

- merge current `MoonshotAI/main` without pushing to or mutating the upstream remote;
- only an explicitly configured host (the isolated `kiminn` wrapper) discovers both session homes;
- new sessions land in the canonical `~/.kimi-code` session home, while existing fallback sessions resume and mutate in their original directory;
- duplicate IDs across homes fail closed, and the unsupported v2 engine fails explicitly rather than ignoring the override;
- focused contract tests, typechecks, diff check, lint, and a checkpoint commit pass.

Recovery boundary: remove `KIMI_CODE_SESSION_HOME` from the isolated wrapper and revert the M6a checkpoint. No file under `~/.kimi-code` is changed by the implementation milestone.

Evidence:

- merge commit `54aece9c1e8b1d80b4da963408fc50b1e01bd231` joins the prior fork work with upstream `8db7d42f23472a692eb389a0e0e5a3e18aa1b94d`;
- a composite session-store mechanism is activated only by the SDK's optional `sessionHomeDir`; without it, the original single-home code path remains unchanged;
- public-harness contract tests prove canonical-home creation/discovery, fallback-home resume, origin-bound rename, duplicate-ID `session.storage_conflict`, and v2 fail-closed behavior;
- protocol, agent-core, SDK, and CLI typechecks passed; 39 SDK tests and 32 CLI tests passed; changed-file lint has zero errors (unrelated pre-existing warnings remain in untouched lines).

### M6b — shared OAuth mechanism (PASS)

Verified at `2026-08-05 05:21 UTC+8`.

Success criteria:

- an explicitly configured v1 host can resolve managed Kimi OAuth from another Kimi home while retaining its own config/default model;
- shared OAuth is usable for status, refresh, usage, and model requests without copying credentials;
- explicit login/logout from the borrowing host cannot delete or reprovision the credential owner's account;
- the existing `~/.kimi-code` path and default behavior remain unchanged when no auth-home override is supplied;
- contract tests and typechecks pass before the mechanism checkpoint.

Recovery boundary: remove `KIMI_CODE_AUTH_HOME` from the isolated wrapper and revert the M6b checkpoint. The implementation does not copy or rewrite the canonical credential file.

Evidence:

- the optional SDK `authHomeDir` selects the OAuth toolkit's credential root while `configPath` remains under the isolated runtime home;
- borrowing clients reject `/login` and `/logout` with public error `auth.credentials_read_only`; refresh writes remain in the canonical OAuth store so normal token rotation continues to work;
- v2 rejects a distinct auth home explicitly because its engine-owned auth service cannot yet honor this split;
- live inventory found canonical file-backed OAuth under `~/.kimi-code/credentials` with mode `0600`; no credential content was printed;
- protocol, agent-core, SDK, and CLI typechecks passed; 43 focused SDK tests and 34 CLI tests passed.

### M6c — isolated rebuild, configuration, and real RBV (PASS)

Verified at `2026-08-05 05:36 UTC+8`.

Success criteria:

- rebuild and install only the isolated `kiminn` binary, preserving the existing `~/.kimi-code` binary, configuration, and default behavior;
- keep `kiminn` interactive defaults at auto / Sol / xhigh while exposing Kimi K3 and K3 256 through the canonical Coding Plan OAuth;
- prove bidirectional session discovery and origin-bound storage through both the interactive picker and real exports;
- re-prove Sol, Terra, and Luna image input against the live port 2234 gateway and inspect the local observability UI on desktop and mobile;
- pass focused regressions, native smoke, changeset validation, rollback capture, and push only the fork feature branch.

Recovery boundary: restore `/Users/noelbao/.kiminn` from `/Users/noelbao/.kiminn/backups/shared-session-oauth-20260805-0524/`, or remove `KIMI_CODE_SESSION_HOME` and `KIMI_CODE_AUTH_HOME` from the isolated wrapper. No rollback of the canonical Kimi binary or configuration is required.

Evidence:

- checkpoint commits `559617fc1` and `4fbb2260d` implement the isolated session and OAuth mechanisms; `9c99bf54f` closes the top-level login-path escape and adds the CLI changeset;
- `/Users/noelbao/.kiminn/bin/kimi` is version `0.32.0`, built from `9c99bf54f73b31a57e816f74182f593e7db55cc0`, and has SHA-256 `a91f1063a9be8298de347c8e92a0fe0b47445525dfa3dcbb4c7a5619e7120d33`; `kiminn doctor` and native SEA smoke passed;
- the isolated wrapper points runtime state at `~/.kiminn`, new sessions at `~/.kimi-code`, and managed auth at `~/.kimi-code`; it injects auto only for interactive invocations;
- the isolated config retains `local-openai-2234/gpt-5.6-sol` and xhigh as defaults and adds selectable `kimi-code/k3` and `kimi-code/k3-256k` aliases without changing the canonical config;
- the canonical Kimi binary remains SHA-256 `c3009019e0f8f0e6c30550643b78ebd0c91815423b915352fcd0914945950a42`, and its config remains SHA-256 `e8e084faca80e5395efed2703e075e2e55553eadf080c8539006dff51a6ac13e`;
- real K3 and K3-256 requests selected the exact managed models and reached the official Kimi Coding Plan API through the canonical OAuth, but both terminated with HTTP 403 because the account has reached its billing-cycle usage limit; this is an external quota limitation, not a fallback or local auth/config failure;
- normal managed-token refresh rotated the canonical credential to SHA-256 `22d9b2d626c1950a724df6c47e41fc97a1328f27cd91d6413797c047b34d4a04`; the source remained `~/.kimi-code/credentials/kimi-code.json` with mode `0600`, and no credential was copied or printed;
- a default real turn returned exact `KIMINN_DEFAULT_SOL_XHIGH_OK`; its wire facts prove OpenAI Responses, `gpt-5.6-sol`, xhigh, and the local 2234 alias;
- installed `kiminn` image turns returned exact `GPT_5_6_SOL_IMAGE_BLUE_OK`, `GPT_5_6_TERRA_IMAGE_BLUE_OK`, and `GPT_5_6_LUNA_IMAGE_BLUE_OK`; each wire transcript contains `ReadMediaFile`, image content, the expected model, and xhigh effort;
- `/sessions` displayed canonical and fallback homes together, selected fallback session `session_3511bd01-5c24-4c9d-abac-0d4412ca6185`, restored its prior transcript, and visibly reported `Resumed session`; original `kimi` also exported a new `kiminn` session, while `kiminn` exported that fallback session, and both archives passed ZIP inspection;
- new K3 RBV sessions were written to the canonical session index and not the isolated fallback index, while resuming the fallback kept its origin binding;
- the loopback gateway remained healthy on `127.0.0.1:2234`; the local dashboard snapshot reported four selected sessions, seven successful requests, 232127 input tokens, 62464 cached input tokens, 287 output tokens, and a 26.9% cache-hit ratio across Sol, Terra, and Luna;
- desktop and mobile browser RBV of `http://127.0.0.1:2234/dashboard` passed; the UI exposes readiness, alive-session state, model/effort, safe session hashes, usage, cache, outcome, and latency without prompts, raw session IDs, credentials, emails, or account IDs;
- final gates passed: four relevant typechecks; session-store 26 tests; SDK 64 tests; CLI 23 tests; Responses 83 tests; legacy compaction 107 passing tests plus existing skips/expected failures; v2 compaction 89 tests; native SEA smoke; and changeset status with only a patch bump for `@moonshot-ai/kimi-code`;
- `gen-docs` could not run because its required `docs/scripts/sync-changelog.mjs` is absent from the upstream-synced tree; no replacement script or unrelated manual docs drift was introduced. The CLI-facing behavior is recorded in `.changeset/isolate-session-auth-homes.md` and this action ledger.

### M7 — kiminn-only GPT subagents and resume-safe compaction (PASS)

Verified at `2026-08-05 06:43 UTC+8`.

Success criteria:

- preserve every builtin agent profile unchanged and expose only three new isolated names: `gpt-coder-tasker`, `gpt-reviewer`, and `gpt-planner`;
- bind the three file-defined profiles to Luna/max, Sol/xhigh, and Sol/max respectively through an opt-in mechanism that is inert for canonical Kimi;
- make Agent and AgentSwarm share the same exact profile binding, while an explicit primary/secondary tool choice retains precedence;
- before an already-over-window resumed conversation calls OpenAI's native compact endpoint, detect that the full compact input cannot fit and use the existing shrinking summary fallback before the next generation;
- rebuild/install only `~/.kiminn/bin/kimi`, preserve rollback copies and canonical `~/.kimi-code` hashes, then RBV exact routing, AgentSwarm, compaction, gateway observability, and default auto/Sol/xhigh behavior.

Recovery boundary: restore `/Users/noelbao/.kiminn` files from `/Users/noelbao/.kiminn/backups/gpt-subagents-20260805-062610/`; the canonical Kimi installation and configuration must require no rollback.

Evidence:

- builtin `coder`, `explore`, and `plan` source files are untouched; exact `model` / `thinking_effort` fields are carried only by file-defined profiles;
- the new mechanism is gated by `agent-profile-model-binding`, default false, and the live enablement exists only in `~/.kiminn/config.toml`;
- checkpoint commit `6808c5310` implements both engines, focused regressions, and two patch changesets without modifying a builtin agent profile;
- installed profiles are exactly `gpt-coder-tasker` (Luna/max), `gpt-reviewer` (Sol/xhigh), and `gpt-planner` (Sol/max); their SHA-256 values are `bd921f18…`, `77c92075…`, and `05e2152d…`;
- real Agent session `session_e3c3cef2-2c6d-42ce-8e55-e3c3f3e95ac1` spawned `gpt-coder-tasker`; the child wire records OpenAI Responses, `gpt-5.6-luna`, and `max`, then the parent returned exact `PARENT_AGENT_OK`;
- real AgentSwarm session `session_de93c74e-4bdb-4288-8bc7-b5394a2b5dbf` spawned two `gpt-reviewer` children; both wires record OpenAI Responses, `gpt-5.6-sol`, and `xhigh`, and the parent returned exact `PARENT_SWARM_OK`;
- real Agent session `session_9562d8e2-1954-4636-b85c-29abb9ff2089` spawned `gpt-planner`; its child wire records OpenAI Responses, `gpt-5.6-sol`, and `max`, and the parent returned exact `PARENT_PLANNER_OK`;
- a controlled real resume used the installed binary, the live 2234 gateway, the same persisted session, and an isolated 40k test cap to reproduce the production over-window state without spending 258k tokens: native compact was skipped at `54,788 > 40,000`, summary compaction reduced `35,789` to `20,264`, `full_compaction.complete` preceded the next loop request, and the resumed turn returned exact `RESUME_COMPACT_PREFLIGHT_OK`;
- that RBV first exposed an internal-default `max_output_tokens` request rejected truthfully by the gateway. The corrected client marks only its internal 128k compaction default as provider-optional (`maxTokens = null` on Responses); explicit model/env output caps remain hard caps and the gateway contract was not weakened or redeployed;
- focused final suites passed: V1 169 tests plus one existing skip and V2 228 tests; both agent-core typechecks, changed-file lint with zero errors, diff check, native SEA build, native smoke, `kiminn doctor`, and changeset status passed;
- native compact preflight logs the model, estimated input tokens, effective window, message count, and `summary_compaction` fallback without logging conversation content;
- OpenAI's documented constraint is that the full `/responses/compact` input must itself fit the model context window, so an already-over-limit session cannot be repaired by sending the same oversized input to that endpoint;
- the installed isolated binary SHA-256 is `f6b858368de74fac3529d737677f5dbef943453ace2aff3f74d6ea75b34b6bc4`; the wrapper remains `6729dac0…`, the isolated config remains `706a623b…`, and its interactive defaults remain auto / Sol / xhigh;
- canonical `~/.kimi-code/bin/kimi` remains `c3009019…` and canonical `~/.kimi-code/config.toml` remains `e8e084fa…`; no canonical default mode, builtin agent, credential, or gateway artifact changed;
- the post-RBV gateway snapshot was READY with four eligible accounts, zero in-flight requests, and a persistent ledger of 65/65 successful requests with zero failures; the local dashboard remains `http://127.0.0.1:2234/dashboard`;
- prior M4 and M6c live evidence remains valid for Sol, Terra, and Luna image input through both the gateway and installed `kiminn`;
- `gen-docs` remains blocked by the missing required `docs/scripts/sync-changelog.mjs`; no auto-synced changelog was edited manually.

### M8 — upstream sync and isolated kiminn redeploy (PASS)

Verified at `2026-08-06 07:11 UTC+8`.

Success criteria:

- merge the latest `MoonshotAI/main` into the fork feature branch without mutating upstream;
- preserve the fork's OpenAI Responses flags and isolated session/OAuth mechanisms through the merge;
- rebuild and replace only `~/.kiminn/bin/kimi`, leaving the current canonical `~/.kimi-code/bin/kimi` and isolated config untouched;
- preserve shared canonical sessions and OAuth despite upstream making agent-core-v2 the CLI default;
- RBV a new turn, resume, exact GPT child routing, and live 2234 observability before pushing the fork branch.

Recovery boundary: restore `kimi.before`, `config.toml.before`, and `kiminn.before` from `/Users/noelbao/.kiminn/backups/upstream-sync-20260806/`. The canonical Kimi install and gateway need no rollback.

Evidence:

- merge commit `12dc3ae6bcaf66e48a98a9020964647be332bbd8` has parents `09443cf4199b044150b75613b96d7177ba661f31` and upstream `d1ded01b7c50c9847440f4645fe13f588becdc66`; the upstream tip is an ancestor and no upstream push occurred;
- the only merge conflict was the legacy flag registry: obsolete upstream `acp-v2` remained deleted, while fork-only `agent-profile-model-binding` and `openai-responses-compaction` stayed registered; the SDK's public feature-metadata test was updated to cover both retained flags;
- upstream now defaults CLI surfaces to agent-core-v2, but v2 truthfully rejects distinct `sessionHomeDir` and `authHomeDir`; the isolated wrapper therefore pins `KIMI_CODE_LEGACY_FLAG=1` so shared sessions/OAuth continue working, while canonical `kimi` retains upstream's new v2 default;
- typechecks passed for agent-core, agent-core-v2, CLI, and node SDK; v2 import-boundary lint passed across 1,088 files; focused gates passed 169 V1 tests plus one skip, 228 V2 tests, 82 CLI tests, and 17 SDK tests;
- the native SEA build and native smoke passed at version `0.33.0`; installed `~/.kiminn/bin/kimi` SHA-256 is `b5f7a3dbe3b7b15981d3fff48486766b6b64bf56ca8c04df10609802629f0f6e`;
- `kiminn doctor` passed; new session `session_41f3517e-afde-4e9f-9dab-ec7ba64af98e` returned exact `KIMINN_UPSTREAM_SYNC_OK`, then resumed from canonical storage and returned exact `KIMINN_UPSTREAM_RESUME_OK`;
- Agent RBV session `session_65a8d42f-c67c-4727-b578-84e043b5ca87` spawned `gpt-coder-tasker`; child wire facts prove provider `openai-responses`, model `gpt-5.6-luna`, alias `local-openai-2234/gpt-5.6-luna`, and effort `max`, while the parent remained Sol/xhigh and returned exact `PARENT_AGENT_OK`;
- both RBV sessions exist under `~/.kimi-code/sessions` and not under `~/.kiminn`; the isolated config stayed SHA-256 `706a623ba8b37a7b218acea5a3eb2866faff15f1f3dfc4cfa3003c3da80cb386`;
- the current canonical binary stayed SHA-256 `befb752584de4be1e7fb5a6ec28dbc153fef19da8787a2ceb134039b5579063f`; no canonical config, mode, session implementation, credential, or gateway artifact was changed;
- live `127.0.0.1:2234` health and dashboard snapshot passed: gateway READY, four fresh eligible accounts, zero in-flight requests, and the latest Sol/xhigh Responses session completed 4/4 requests with HTTP 200 and a 48.1% cache-hit ratio; the local UI remains `http://127.0.0.1:2234/dashboard`;
- unauthenticated `/pool/usage` still returns the designed `admin_auth_unavailable` response; this is not a dashboard failure because the separate loopback-only `/dashboard/api/snapshot` is the intended no-admin read surface.

### M9 — agent-core-v2 split homes and isolated kiminn activation (PASS)

Verified at `2026-08-06 09:06 UTC+8`.

Success criteria:

- remove the isolated wrapper's legacy-engine pin only after agent-core-v2 supports a canonical primary session home, an isolated fallback session home, and borrowed canonical OAuth;
- preserve canonical `~/.kimi-code` binary, config, default mode, and builtin behavior;
- prove new/create, primary resume, fallback resume, interactive selection, borrowed OAuth, GPT Agent/AgentSwarm routing, Responses image input, native compaction, and 2234 observability against live runtimes;
- fix every defect exposed by RBV, pass regression/build gates, and push only the fork branch.

Recovery boundary: restore `kimi`, `config.toml`, and `kiminn-wrapper` from `/Users/noelbao/.kiminn/backups/v2-split-homes-20260806-084949/`. The canonical Kimi install and the 2234 gateway require no rollback.

Evidence:

- commits `a063daabc`, `ba9d45bec`, and `3e23526d6` add v2 multi-home ownership, borrowed-auth protection, split-home propagation across native print/provider/export surfaces, and zero-timeout AgentSwarm semantics;
- agent-core-v2 scans both homes authoritatively, writes new sessions to the configured primary, keeps resumed/deleted/fork source data bound to its owning root, rejects duplicate IDs as `session.storage_conflict`, and logs multi-home mode with `sessionHomeCount=2`;
- the first live print-mode RBV exposed that native v2 `kimi -p` bypassed the SDK harness and omitted split-home inputs; failed evidence session `session_cefe627d-7cb1-4df4-886a-e1c6cfee8ebb` remains under `~/.kiminn` for inspection, while the corrected session `session_a787daf3-b528-4377-b574-b8f2439f85e9` exists only under `~/.kimi-code` and resumed successfully;
- fallback session `session_3511bd01-5c24-4c9d-abac-0d4412ca6185` resumed and mutated in `~/.kiminn` without creating a canonical duplicate; the interactive `kiminn -S` PTY displayed the shared canonical session selector and exited cleanly;
- K3 selected the exact `kimi-code/k3` model and reached the managed Coding Plan API through borrowed canonical OAuth; the resulting HTTP 403 is the account's billing-cycle quota limit, not a login/config fallback; explicit `kiminn login` then failed closed with `auth.credentials_read_only`, and the credential hash stayed `6fe842b3bd325c1e2e5175eeae645f1b016faff8c5d868a4af78bfd0d7b0e85a` before/after that attempt;
- Agent session `session_0af706a4-fac5-4275-8158-a35b63876ca3` records main Sol/xhigh and `gpt-coder-tasker` Luna/max with `provider=openai_responses` and `maxTokens=258000`; reviewer swarm session `session_b8455fba-0886-423f-b143-6e87e374bfc7` completed 2/2 on Sol/xhigh, and planner swarm session `session_b705c02d-5cb9-4fc4-8df1-0ca7a50f039f` completed 2/2 on Sol/max;
- RBV exposed that print mode's configured `timeout_ms=0` meant unbounded for Agent but immediate `setTimeout(0)` for AgentSwarm; the corrected batch scheduler treats non-positive timeouts as unbounded, with a dedicated 24-hour fake-clock contract test;
- valid PNG requests to `/v1/responses` completed with HTTP 200 and exact markers for `gpt-5.6-sol`, `gpt-5.6-terra`, and `gpt-5.6-luna`; the initial invalid 1x1 fixture truthfully returned HTTP 400 for all three and was replaced rather than misclassified as a modality failure;
- direct `/v1/responses/compact` returned HTTP 200 and `object=response.compaction` with `message` plus `compaction_summary`, using input context without an extra compaction prompt; installed v2 TUI `/compact` on the controlled canonical session reduced `324 → 138` displayed tokens, while logs record native `openai_responses` compaction in 3825 ms with 12013 input and 138 output tokens and wire begin/apply/complete facts;
- the final installed isolated binary is version `0.33.0`, SHA-256 `05df1aa8525632578a3e63c9646237599dd99c64f8d49050cd82fa9ea10c8cff`; wrapper SHA-256 is `6729dac05340fc0da2cb7c153db9f71a55234d49123eac71d106ed6495555693`, contains no `KIMI_CODE_LEGACY_FLAG`, and retains interactive auto mode; isolated config remains `706a623ba8b37a7b218acea5a3eb2866faff15f1f3dfc4cfa3003c3da80cb386`;
- canonical binary remains `befb752584de4be1e7fb5a6ec28dbc153fef19da8787a2ceb134039b5579063f` and canonical config remains `e8e084faca80e5395efed2703e075e2e55553eadf080c8539006dff51a6ac13e`; no canonical default mode or implementation was changed;
- final gateway snapshot was READY with four fresh eligible accounts, 17 active retained sessions, zero in-flight requests, and selected-window totals of 64 requests, 61 successes, three failures, 1,148,073 input tokens, 505,856 cached tokens, 10,108 output tokens, and a 44.1% cache-hit ratio; `http://127.0.0.1:2234/dashboard` returned HTTP 200 and exposes hashed sessions, model/effort, usage, cache, outcome, latency, and account quota;
- final full suites passed 4,748 agent-core-v2 tests, 350 node-SDK tests plus one todo, and 2,573 CLI tests plus two skips; post-RBV focused fixes passed 55 swarm tests and 66 split-home CLI tests, while relevant typechecks, docs build, native SEA builds, native smoke, and diff checks also passed.

### M10 — upstream sync through `0b2e803d5` (PASS)

Verified at `2026-08-07 22:17 UTC+8`.

Success criteria:

- merge the latest `MoonshotAI/main` into the fork feature branch without mutating upstream;
- retain the fork's split session/auth homes, exact profile model binding, native Responses compaction harness, and owning-home SDK behavior while accepting upstream's new session read-model and live-outcome behavior;
- keep the merge free of whole-file formatter noise and conflict markers;
- pass the affected package typechecks, import boundary, focused regressions, and full-suite evidence before pushing only the fork branch.

Recovery boundary: revert merge commit `18f70383775c1645680fb1c385217b40440180a2` on the fork branch. No installed `kiminn`, canonical `~/.kimi-code`, or local gateway artifact was changed by this milestone.

Evidence:

- merge commit `18f70383775c1645680fb1c385217b40440180a2` has parents `255d946577ee01065619d843af8ec21ba4425c76` and upstream `0b2e803d5e71afaab45212bb2ee6117ecbf8bbc9`; it incorporates 23 upstream-only commits;
- six conflicts were resolved across session-index multi-home reads, exact subagent profile bindings, the provider test harness, zero-timeout swarm coverage, SDK session listing, and SDK integration tests;
- the combined session index uses upstream's single-flight authoritative scan and pending-write fold in single-home mode, while multi-home mode keeps authoritative ownership checks and fails closed on duplicate session IDs;
- the exact profile binding now also carries upstream's user-facing display alias; SDK listings keep both owning-home session paths and upstream's live `lastTurnReason` overlay;
- three relevant typechecks passed; v2 import-boundary verification passed across 1,130 files; focused gates passed 358 v2 tests, 44 SDK tests, and 37 CLI tests, plus the regenerated config-manifest contract;
- full v2 evidence passed 4,912 non-manifest tests and the manifest test separately; the full SDK suite passed 355 tests plus one todo; the full CLI run passed 2,669 tests plus two skips, and its two resource-contention telemetry timeouts passed 3/3 when rerun alone;
- formatter noise was removed by rebuilding the six conflict files from Git's three-way merge tree and reapplying only the semantic resolutions; diff checks and a final conflict-marker scan passed.

### M11 — upstream MCP auth probe sync (PASS)

Verified at `2026-08-08 04:14 UTC+8`.

Success criteria:

- merge upstream `437a1b8ba` into the fork feature branch without mutating upstream;
- preserve the fork's separate auth-home and session-home behavior while accepting the SDK's connection-based MCP auth probe;
- pass the affected agent-core and SDK typechecks plus focused and full SDK tests before pushing only the fork branch.

Recovery boundary: revert merge commit `da08e084aac6ad947c5ceaae6702a39f2b1d0173` on the fork branch. No installed `kiminn`, canonical `~/.kimi-code`, or local gateway artifact was changed.

Evidence:

- merge commit `da08e084aac6ad947c5ceaae6702a39f2b1d0173` has parents `bc7a69dea4e74fe1c719a500c8a6264d57eb4fd2` and upstream `437a1b8ba1b7e0f6662bdadc669564fdc58c3f5a`;
- the one upstream commit, `fix(sdk): probe MCP auth status through connection (#2731)`, merged cleanly with no conflicts;
- agent-core and node-SDK typechecks passed; three focused MCP/SDK files passed 115 tests; the full SDK suite passed 355 tests plus one todo.

### M12 — isolated `kiminn` v0.34.0 deployment (PASS)

Verified at `2026-08-08 06:35 UTC+8`.

Success criteria:

- build the merged fork branch as a native binary and replace only the isolated `kiminn` installation;
- retain the isolated config, wrapper, canonical session/auth homes, and canonical Kimi installation unchanged;
- RBV a new OpenAI Responses turn, resume it from canonical storage, exercise the new MCP HTTP auth challenge probe, and inspect the live 2234 dashboard;
- record an exact recoverable backup and installed-build receipt.

Recovery boundary: restore the binary and supporting snapshots from `/Users/noelbao/.kiminn/backups/upstream-mcp-auth-probe-20260808-0414/`. The canonical Kimi installation and local gateway need no rollback.

Evidence:

- the native SEA build and native smoke passed at version `0.34.0`; installed `/Users/noelbao/.kiminn/bin/kimi` SHA-256 is `8546a0592c2a90d2ff63dff9a3d6ef77dcf3d41747ab63957f4d7f1225337467`;
- `kiminn doctor` passed, and the real installed CLI returned exact `KIMINN_UPSTREAM_437A_RBV_OK` for a new turn and exact `KIMINN_UPSTREAM_437A_RESUME_OK` after resuming session `session_1477ba83-b0b1-4bdf-8376-284d0c37e1b3`;
- the session exists only under canonical `~/.kimi-code/sessions`; its two wire requests prove provider `openai_responses`, model `gpt-5.6-sol`, effort `xhigh`, and `maxTokens=258000`, and both turns ended `completed`;
- a real loopback HTTP MCP probe through the built merged node SDK classified a normal 404 endpoint as `not-applicable` and an unmarked 401 endpoint as `oauth-required`, exercising upstream commit `437a1b8ba`'s connection-based detection;
- the 2234 post-resume snapshot was READY with five fresh quota records, three new-session-eligible accounts, zero in-flight requests, and the selected Sol/xhigh session at 2/2 HTTP 200 successes; `http://127.0.0.1:2234/dashboard` returned HTTP 200;
- isolated config SHA-256 remained `706a623ba8b37a7b218acea5a3eb2866faff15f1f3dfc4cfa3003c3da80cb386` and wrapper SHA-256 remained `6729dac05340fc0da2cb7c153db9f71a55234d49123eac71d106ed6495555693`; the isolated AGENTS snapshot was refreshed to the canonical content at SHA-256 `6630ba000285c945d0f0b89c3e030f1849918e98ea7eb275bb542344dca25cf4`;
- canonical binary SHA-256 remained `9f4337e10da47843f6b550474012a53ba8b30dd665f83b176a5cd479c5f7e859`, canonical config remained `4ecbe992296a21c2063c31103da5f8cad58bef2f5aa0e180d1bae84927b8bf95`, and canonical AGENTS remained `6630ba000285c945d0f0b89c3e030f1849918e98ea7eb275bb542344dca25cf4`;
- `/Users/noelbao/.kiminn/install-receipt.toml` records source commit `3cebe0a776721b0b552f7479b24df70e636d2d0d`, upstream `437a1b8ba1b7e0f6662bdadc669564fdc58c3f5a`, the installed hash, split-home ownership, and rollback path.

### M13 — canonical Kimi 2234 configuration removal (PASS)

Verified at `2026-08-08 16:20 UTC+8`.

Success criteria:

- remove only the localhost-2234 provider, its three GPT-5.6 model aliases, and its dedicated Responses-compaction flag from canonical `~/.kimi-code/config.toml`;
- preserve the canonical Kimi default, managed provider/models, permissions, credentials, sessions, logs, and binary;
- retain the complete 2234 configuration and behavior in isolated `kiminn`;
- prove both the canonical provider catalog and rendered model selector contain only managed Kimi choices.

Recovery boundary: restore `/Users/noelbao/.kimi-code/backups/remove-local-2234-20260808-161819/config.toml` to `/Users/noelbao/.kimi-code/config.toml`. The backup is byte-identical to the pre-change config at SHA-256 `4ecbe992296a21c2063c31103da5f8cad58bef2f5aa0e180d1bae84927b8bf95`.

Evidence:

- the surgical diff removes exactly `[providers.local-openai-2234]`, the Sol/Terra/Luna `local-openai-2234/*` model blocks, and the otherwise-empty `[experimental] openai-responses-compaction` section;
- canonical `default_model = "kimi-code/k3-256k"`, thinking effort `high`, the managed OAuth provider, all four managed models, permissions, credentials, pre-existing sessions, and binaries were not rewritten or removed;
- canonical `kimi doctor` passed and `kimi provider list` reports only `managed:kimi-code`, four models, and default `kimi-code/k3-256k`;
- the real canonical agent-core-v2 TUI `/model` selector rendered exactly K2.7 Coding, K2.7 Coding Highspeed, K3, and K3-256k, with no localhost or GPT-5.6 choices; no model request or session was created during this v2 check;
- a preliminary legacy-selector check created one empty diagnostic session with no turns; after backing up its two files under the M13 recovery directory, the public legacy SDK deleted that exact session and confirmed `before=1`, `after=0`, leaving the session index's normal delete tombstone rather than an inconsistent manual removal;
- the post-change canonical config SHA-256 is `b4d4f9f0e7eaa4f19b6ccf21d6653d9c6e845035e57b541ea3885903b159ba69`;
- isolated `kiminn provider list` still reports `local-openai-2234` with three models plus the managed Kimi provider with four models, `kiminn doctor` passed, and its config SHA-256 remains `706a623ba8b37a7b218acea5a3eb2866faff15f1f3dfc4cfa3003c3da80cb386`;
- historical session/wire/log/user-history records and binary capability strings were deliberately preserved: they are evidence, not active model-catalog configuration.

### M14 — upstream session-local profile catalog sync (PASS)

Verified at `2026-08-09 05:35 UTC+8`.

Success criteria:

- fetch and merge the current upstream `01c74e937` without mutating upstream;
- preserve the fork's exact file-profile model/thinking bindings while accepting session-local builtin profile cloning;
- pass affected and full agent-core regressions, rebuild/install only isolated `kiminn`, and preserve canonical `kimi`;
- RBV the installed binary through a real custom tasker delegation and live 2234 observability.

Recovery boundary: revert merge commit `e49f4c1e66dbac187c41d7666e7aa4f5034ff2df` on the fork branch and restore `/Users/noelbao/.kiminn` from `/Users/noelbao/.kiminn/backups/upstream-profile-catalog-20260809-053417/`. No canonical Kimi or gateway rollback is required.

Evidence:

- upstream advanced by exactly one commit, `01c74e9372fcbbbe99614e859b53b505ed1664a8 fix(agent-core): isolate builtin profile catalogs per session (#2740)`; merge commit `e49f4c1e66dbac187c41d7666e7aa4f5034ff2df` completed automatically with no conflicts;
- upstream clones builtin profile objects, tool arrays, disallowed-tool arrays, and delegation edges per session; the fork's exact `model` and `thinkingEffort` fields remain preserved by the object spread and file-profile projection;
- agent-core typecheck passed, the combined profile catalog file passed 40/40 tests, and the full agent-core suite passed 225 files with 4,141 tests, three expected failures, 30 skips, and one todo;
- native SEA build, code-sign verification, and native smoke passed at version `0.34.0`; isolated binary SHA-256 is `904af369da1288b630ee936aeda561e7fba1b61f91cf2db3c002602009f65275`;
- installed `kiminn doctor` passed; session `session_b34be432-e2b0-4a39-aa2b-6f619d669cb4` invoked `gpt-coder-tasker`, the child returned exact `TASKER_SESSION_LOCAL_OK`, and the parent returned exact `KIMINN_PROFILE_CATALOG_RBV_OK`;
- wire facts prove the parent remained OpenAI Responses Sol/xhigh/258000 and the child used OpenAI Responses Luna/max/258000; both turns completed;
- the live 2234 dashboard was READY with zero in-flight requests; the corresponding explicit-affinity Responses session completed 3/3 requests with HTTP 200;
- isolated config and wrapper hashes remain `706a623ba8b37a7b218acea5a3eb2866faff15f1f3dfc4cfa3003c3da80cb386` and `6729dac05340fc0da2cb7c153db9f71a55234d49123eac71d106ed6495555693`;
- canonical binary remains `9f4337e10da47843f6b550474012a53ba8b30dd665f83b176a5cd479c5f7e859`; its current config is the clean pre-2234 configuration at SHA-256 `15ca0bd8058389b9f676d32c55ab50cee6e48a631fddac84faaf0d11e9a0ea9d`, with no localhost model aliases.

### M15 — live AGENTS link and Digital Noel capability audit (PASS)

Verified at `2026-08-10 07:38 UTC+8`.

Success criteria:

- replace the stale isolated AGENTS snapshot with a live symlink to `~/AGENTS.md` without changing canonical Kimi;
- preserve a byte-exact rollback copy and reflect the link in the isolated install receipt;
- use the real v2 SDK catalogs to audit Digital Noel MCP and skill availability for both Kimi homes without creating sessions or exposing credentials.

Recovery boundary: replace `/Users/noelbao/.kiminn/AGENTS.md` with `/Users/noelbao/.kiminn/backups/agents-link-20260810-073711/AGENTS.md`. The pre-link snapshot SHA-256 is `6630ba000285c945d0f0b89c3e030f1849918e98ea7eb275bb542344dca25cf4`.

Evidence:

- `/Users/noelbao/.kiminn/AGENTS.md` is now a symlink to `/Users/noelbao/AGENTS.md`, matching canonical `/Users/noelbao/.kimi-code/AGENTS.md`; all three resolve to SHA-256 `5b38763d912b7a078e95c7be49d143e677d2485aceda341a19b3486b2ba5313c` at verification time;
- the isolated install receipt records the live source, link target, target hash at link time, and dedicated rollback path; `kiminn doctor` remains PASS;
- the session-less v2 SDK catalog reports `digital-noel-memory` for both `kimi-code` and `kiminn`, sourced from `/Users/noelbao/.agents/skills/digital-noel-memory/SKILL.md`;
- the same SDK global-MCP inventory reports `digital_noel_memory`, `new_asr_transcriptions`, and `noel_tmux_partner_mesh` for canonical `kimi-code`, but zero global MCP registrations for `kiminn` because `/Users/noelbao/.kiminn/mcp.json` is absent;
- Codex ATK has both `/Users/noelbao/.codex-atk/skills/digital-noel-memory/SKILL.md` and an enabled `mcp_servers.digital_noel_memory` registration; the current Codex runtime exposes Digital Noel MCP tools, although its exposed tool set does not include the skill document's newer `memory_start_session` or `memory_context_pack` methods;
- no MCP config, credentials, sessions, or source code were changed during this audit.

### M16 — kiminn 2234 session usage and account observability (PASS)

Intent:

- extend isolated `kiminn` `/usage` with the localhost-2234 account selected for the current kiminn session, that exact account's quota windows / remaining capacity / reset time, and session cache-hit statistics;
- add a compact TUI status presentation for the selected safe account label and cache-hit rate while keeping the full detail in `/usage`;
- keep canonical `kimi` behavior and configuration unchanged.

Design constraints:

- keep the client mechanism provider-configurable; do not hardcode port `2234` or a gateway-specific wire shape into generic TUI components;
- use a loopback-only, read-only observability contract to join kiminn's stable session affinity to the gateway's selected account and quota record;
- expose only a safe local account label and aggregate usage facts; never surface account IDs, email addresses, tokens, authorization headers, raw sticky keys, or other credentials in `/v1/*`, the TUI, logs, or telemetry;
- preserve the gateway data-plane boundary: ordinary `/v1/*` responses must continue to omit `X-Pool-Auth-Label` and other routing internals;
- distinguish `not observed yet`, gateway unavailable, session unknown, stale quota, missing upstream usage, and zero cache hits instead of collapsing them into zero or success;
- compute cache hit rate from observed usage records and report the observed / missing-usage request counts so the denominator is auditable.

Promotion criteria and RBV:

- before the first model request, `/usage` and the compact TUI status show a truthful `not observed yet` state without breaking existing local token/context usage;
- after a real Responses request, the UI resolves the exact gateway-selected safe account label, joins the same account's fresh quota data, and matches the live gateway snapshot;
- after resuming the same session, the stable affinity and accumulated request/cache counters remain associated with that session;
- a real request with upstream cached-input usage changes the displayed cache-hit numerator and rate; missing usage remains explicitly counted rather than guessed;
- gateway-down, stale-quota, session-missing, and account-switch/migration paths degrade visibly and recover after the gateway becomes healthy;
- canonical `kimi` retains its managed-Kimi `/usage` behavior and contains no localhost-2234 UI or configuration changes.

Recovery boundary: revert client commit `0697d50d5` and gateway commit `b383c5c` independently; restore the isolated binary/config from `/Users/noelbao/.kiminn/backups/m16-m18-20260810-0811/` and use the gateway deployer's optimistic rollback from artifact `09b8dbd1…` to `f395b5cc…`.

Evidence:

- the gateway deploy adapter ran every fixed release gate and activated loopback-only wheel `09b8dbd1ceb537acb27c3e875474017b851a0ced489d92a86457e6a171c7eab5.whl` from commit `b383c5c59c202ba8435c7451fd9b055c27ea059d`; PID `17059` has verified argv/ancestry and binds only `127.0.0.1:2234`;
- before any request, `GET /dashboard/api/session` with a new session identity returned HTTP 404 and `state=not_observed`; the endpoint is read-only, loopback-only, `no-store`, hashes the raw affinity locally, and returns no credential, email, account ID, or raw sticky key;
- real installed session `session_32ba77f5-f2db-4296-8454-878c8727b99b` returned exact `KIMINN_M16_PROVIDER_OBSERVABILITY_OK`; its exact join returned safe account `codex-leo`, fresh weekly quota `93.0%`, one successful request, `usage observed 1 · missing 0`, and `0 / 27.3k` cached-input tokens;
- Human-PoV TUI capture showed `/usage` with the same account/quota/cache facts and the footer `account=codex-leo cache=0.0%`; the video-RBV session later showed `27,136 / 56,060` cached input tokens (`48.4%`) and the exact selected account `codex-fst`, proving the cached numerator and session-specific routing move from live facts;
- provider observability, usage panel, and footer focused tests pass `41/41`, including `not_observed`, endpoint unavailable, invalid payload, stale quota, missing usage, and opt-in/default display; the installed config is the only profile with `observability_url`;
- canonical `kimi` binary/config/TUI hashes remained `9f4337e1…`, `858fd6b5…`, and `c6b3b653…`; `kimi doctor` passes, provider listing contains only `managed:kimi-code`, and canonical config contains no `2234` or GPT-5.6 alias.

### M17 — kiminn tmux pane identity (PASS)

Intent:

- show `pane_id=%nn` in the isolated kiminn TUI when the process environment contains a valid `TMUX_PANE=%nn` value;
- omit the field entirely outside tmux or when the value is absent/invalid;
- keep canonical `kimi` behavior unchanged.

Promotion criteria and RBV:

- a real kiminn process launched inside tmux renders the exact pane identifier from its own environment without shelling out or guessing from the active pane;
- two simultaneous panes display their respective IDs, including when one pane is not currently focused;
- a real kiminn process launched outside tmux shows no empty placeholder or stale pane ID;
- resize/re-render and session resume preserve the correct display, and the value is not written into model prompts, API headers, session history, or telemetry.

Recovery boundary: revert client commit `9c06ba901`, restore `tui.toml` and the binary from `/Users/noelbao/.kiminn/backups/m16-m18-20260810-0811/`; no gateway or canonical Kimi rollback is required.

Evidence:

- the installed TUI read `TMUX_PANE=%216` directly and rendered exact `pane_id=%216` beside the provider facts; no subprocess lookup or active-pane inference is present;
- two simultaneous panes rendered their own identities `%218` and `%219`; after resizing from `220x48` to `200x44`, both re-rendered with the same respective IDs while showing independent session account/cache facts;
- a real TUI launched with `TMUX_PANE` absent omitted the pane slot entirely, with no empty placeholder; strict parsing also rejects malformed values;
- exact session-record searches found none of `%216`, `%218`, `%219`, `pane_id=`, or `TMUX_PANE`, proving the UI-only identity was not persisted into prompts/history; focused tests cover opt-in, default-hidden, valid, absent, and malformed cases.

### M18 — managed Kimi K3 max video fallback (PASS)

Intent:

- let a localhost-2234 kiminn session use `ReadMediaFile` on video even though Sol/Terra/Luna expose image input but no video input;
- analyze only the video through borrowed canonical Coding Plan OAuth on `kimi-code/k3` at `max` effort, return text to the parent tool call, and keep the main agent on its selected 2234 model;
- preserve normal image delivery through the active Responses model and leave canonical `kimi` unchanged.

Design constraints:

- gate the generic mechanism behind `video-media-fallback`, default off, and activate it only in `/Users/noelbao/.kiminn/config.toml`;
- bind fallback model/effort as provider policy (`video_fallback_model`, `video_fallback_effort`) while keeping upload/request mechanics inside the media domain;
- preserve the existing file-access approval boundary and forward the tool's actual `question`; do not send video bytes to localhost 2234 or switch/persist the parent model;
- emit an inspectable tool-result note with the fallback model and effort, and fail visibly when upload or analysis fails.

Promotion criteria and RBV:

- a real valid MP4 is read from an installed kiminn session whose parent wire remains Sol/xhigh;
- K3 receives the video and actual user question at max effort, returns a grounded result, and the parent completes from that tool result;
- image input remains on the original path; no fallback is registered unless the feature flag and provider policy are present;
- native build/smoke, focused media tests, typechecks, doctor, split-home storage, and canonical-isolation checks pass.

Recovery boundary: revert commit `9b203e9f2`, restore `/Users/noelbao/.kiminn` from `/Users/noelbao/.kiminn/backups/m16-m18-20260810-0811/`, and leave the gateway/canonical installation untouched.

Evidence:

- a generated 1-second H.264 `320x240` solid-blue MP4 (SHA-256 `7b37dc93…`) was inspected with `ffprobe`, then removed after RBV;
- installed session `session_c667bb2e-c2f6-4b82-b1c4-882e2c03021d` bound the parent to `local-openai-2234/gpt-5.6-sol` at `xhigh`, called `ReadMediaFile` with the exact question `What is the dominant color throughout this video?`, and recorded `<system>Video analyzed by fallback model kimi-code/k3 at max effort.</system>`;
- K3 returned a grounded solid-blue description and the parent returned exact `VIDEO_FALLBACK_BLUE_OK`; the gateway observed only two Sol/xhigh Responses requests for the parent session, with no video request routed through 2234;
- media contracts pass `54/54`, including question forwarding, upload, `thinkingEffort=max`, fallback result, image non-routing, feature flag/provider wiring, and no-capability registration; the added tool-schema field moved the full-compaction fixture baseline from `14,365` to the real `14,414`, after which the complete v2 suite passed `4,919/4,919`; both agent-core typechecks and the v2 import-boundary check pass;
- native SEA build, code-sign verification, smoke, `kiminn doctor`, config parse, and provider listing pass; installed binary/config/TUI hashes are `0553bcd4…`, `8576f4ea…`, and `09d7953c…`, and the wrapper remains `6729dac0…`;
- `/Users/noelbao/.kiminn/install-receipt.toml` records exact source/gateway artifacts, feature policy, RBV sessions, hashes, split homes, and rollback path; the two temporary tmux sessions and MP4 were cleaned up.

Local recovery:

- pre-change Kimi config: `/Users/noelbao/.kimi-code/backups/openai-responses-20260804-0550/config.toml`;
- pre-change Kimi binary: `/Users/noelbao/.kimi-code/backups/openai-responses-20260804-0550/kimi`;
- pre-change gateway wheel: `/Users/noelbao/Library/Application Support/openai-api-gateway/releases/2234/releases/24db43a15ec0d74e5566dabdba877b469bd22f5c758f99a9203c1a2d4dfefa55.whl`.
- isolated install receipt: `/Users/noelbao/.kiminn/install-receipt.toml`.
