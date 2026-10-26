# Gemini AI Teacher — final 12 RPM configuration and local verification

26 October 2026, Asia/Kuala_Lumpur. No commit, push or deployment. No live Gemini requests or quota probes were made.

**Final configuration:** 12 actual Gemini API attempts per rolling 60 seconds, shared by both activities within each warm function instance. The owner's already-configured Vercel `AI_CLIENT_RPM=12` is supported. This revision supersedes the earlier local speed configuration after the owner reported the project's actual Flash-Lite quotas: 15 RPM, 250,000 TPM and 500 RPD. These private quota values and the remote environment change are owner-supplied, not independently inspected.

**PASS — local acceptance checks.** Default/maximum 12, explicit env 12, shared accounting, all 12 Flash-Lite routes, educational regressions, immediate admission, build and credential scan passed. This acceptance uses the documented per-instance scope; project-wide coordination remains unavailable. Verification totals are 242 unit tests, 145 browser tests across the six regression suites below, and 24 broader browser workflow checks, with zero real Gemini calls.

## Findings and root cause

The [pre-change audit](ai-speed-audit.md) was recorded before changing runtime behavior. The suspected **4-RPM application restriction exists**: `DEFAULT_CLIENT_RPM = 4`, `.env.example` and README all used 4. The old limiter used a fixed 60-second window, 40 total attempts per instance and four concurrent calls. Both activities already shared that limiter; a validation retry already acquired another slot.

There was **no fixed 15-second ordinary-request delay, background AI queue or AI debounce**. Capacity rejection was immediate. The front end disabled AI buttons only after a controlled rate-limit response. A short-lived concurrency rejection incorrectly inherited the remaining minute's cooldown; that is a confirmed avoidable wait. Essay autosave's short timer is separate from AI handling.

Paragraph review and whole-essay review defaulted to `gemini-3.6-flash`; the remaining actions defaulted to Flash-Lite but could be redirected by environment overrides. Reviews already requested minimal thinking, and official documentation confirms Flash-Lite's default is also minimal. Thus excessive thinking was **not established** as the cause of slow admitted requests. No real upstream timing exists in this checkout, so the exact contribution of provider inference, transport or production quota cannot be determined. Raising RPM improves admission capacity; it does not prove that an individual Google generation is faster.

## Shared rolling allowance and concurrency

- Default and maximum environment-configurable allowance: **12 actual upstream attempts in the previous 60 seconds**, shared across both activities, buttons and clients of one function instance.
- Per-client default: **12**. `AI_CLIENT_RPM` accepts whole values from 1 through 12. A lower positive value lowers both per-client and shared-instance allowance. Absent, invalid, zero, negative, fractional and above-12 values fall back to 12. Values such as 13, 20 or 40 cannot raise the shared ceiling; raising it in the future requires a deliberate code/configuration change after confirming provider capacity.
- Every validation retry spends another attempt. Twelve attempts can mean fewer than twelve completed teaching responses. A 13th attempt in the rolling window returns `AI_RATE_LIMIT` / HTTP 429 without invoking Gemini.
- Four simultaneous calls remain allowed. A fifth fails immediately with a one-second busy hint, spends no provider attempt, and is not queued.
- The rolling window expires only timestamps older than 60 seconds, preventing a fixed-window reset burst. RPM exhaustion reports when enough capacity actually becomes available.
- A successful call releases only its concurrency slot. Attempt history remains counted, including cancelled/failed upstream work. Release is idempotent.

The handler uses one limiter instance across both activities, not separate budgets per button. Tests cover multiple Vercel-style proxy identities and show that a new identity does not create another instance-wide budget.

**Deployment limitation:** this is bounded in-memory protection in one warm function instance. It resets on cold start and is not shared among Vercel instances, regions, other applications or other callers of the same Google project. No centralized storage existed, and no paid infrastructure was added. Google quotas and any existing deployment-wide controls remain authoritative. The public endpoint's authentication behavior and hashed trusted-proxy identity handling are unchanged; IP-based buckets are not authenticated per-student accounts.

`api/gemini.js` creates one handler and limiter per warm instance. `server/ai-handler.js` reads `env.AI_CLIENT_RPM` (defaulting to `process.env`) when constructing that limiter; Vercel's explicit 12 therefore overrides the fallback with the same effective allowance. There is no conflicting environment default or per-action limiter. `server/ai-rate-limit.js` defines both defaults as 12 and bounds environment parsing; the existing handler also takes the minimum of the shared ceiling and configured value. Credentials were not changed.

## Project-wide quota scope and remaining risk

The source, dependencies, deployment configuration and available local environment configuration were inspected for a shared quota store. There is no Redis/Upstash/KV/database dependency, shared counter adapter or suitable configured store. The only provider client is `server/gemini.js`, reached through the common handler and `/api/gemini` endpoint. No other direct provider route was found in this app. External applications, AI Studio use or other keys for the same project cannot be enumerated from this checkout.

**The limit is per instance, not globally coordinated.** Two warm Vercel instances can each admit 12 attempts, allowing 24 collectively, above the reported 15-RPM project quota. New instances/cold starts, preview deployments or other callers of the same project can also consume the three-RPM headroom. Different client addresses cannot bypass the shared cap inside one instance, and admission increments synchronously before awaiting the SDK. Tests cover three concurrent batches of four and independent counters in two limiter instances.

The reported 250,000 TPM and 500 RPD remain provider-enforced; this limiter does not track tokens or daily project usage. Even one instance can exhaust a daily allowance under sustained use. A 429 may therefore persist beyond a minute; cooldown is not a promise that capacity has recovered. [Google documents RPM/TPM/RPD as project-level limits across API keys](https://ai.google.dev/gemini-api/docs/rate-limits).

The smallest practical future strict solution is one shared atomic rolling-window counter keyed by project/model, acquired immediately before **every** SDK attempt, including validation retries, across all relevant deployments/callers. A shared store or single quota gateway would need atomic admission, expiry and a conservative failure policy, preserving the local concurrency bound. No suitable shared infrastructure was available to reuse; none was provisioned and no paid service/subscription was introduced. Vercel request-level firewall rules alone would not account for the handler's second validation attempt or unrelated project traffic.

## Actual model mapping

Selection occurs on the server **after validating the activity/action pair**. All these pairs resolve to **`gemini-3.5-flash-lite`** with **`thinking_level: 'minimal'`**:

| Activity | Existing button/action |
| --- | --- |
| 造句积木 | 💡 给我提示 — `sentence_hint` |
| 造句积木 | 🔍 检查句子 — `sentence_check` |
| 造句积木 | 🌱 帮我扩写 — `sentence_expand` |
| 造句积木 | ✨ 写得更生动 — `sentence_vivid` |
| 造句积木 | 📚 推荐好词 — `vocabulary_help` |
| 要点导写 | 💡 给我提示 — `paragraph_hint` |
| 要点导写 | 📚 推荐好词 — `vocabulary_help` |
| 要点导写 | 🌱 帮我扩写 — `paragraph_expand` |
| 要点导写 | ✨ 写得更生动 — `paragraph_vivid` |
| 要点导写 | ➡️ 下一步怎么写？ — `essay_next_step` |
| 要点导写 | 🔍 检查这一段 — `paragraph_review` |
| 要点导写 | 作文体检 — `essay_review` |

The installed SDK's actual outbound payload is tested for all **12 pairs / 11 action IDs**, including hostile browser model fields and conflicting fast/advanced/legacy environment overrides. They cannot redirect these scopes. Unsupported-model errors return a friendly error without silently selecting another model. Unrelated/unscoped helper integrations retain their prior environment-based routing and thinking configuration.

The [official model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite) confirms the exact identifier. The [official migration guide](https://ai.google.dev/gemini-api/docs/whats-new-gemini-3.6) documents minimal thinking as supported and default for Flash-Lite. Only the installed SDK's supported `thinking_level` field is used; no sampling parameters or legacy thinking-budget fields were added.

## Latency and diagnostics

Ordinary admitted requests start without an application spacing timer or queue. Existing action prompts, keyword/scenario requirements, relevant essay context and response schemas were retained. No essential educational content was shortened to obtain a synthetic latency win. Token caps remain unchanged, including 1200 for paragraph review and 1800 for essay review.

Lightweight measurements now expose:

- Server arrival time and preparation duration.
- Time spent acquiring the limiter; queue time is explicitly zero because there is no queue.
- Aggregate upstream duration, validation duration, time spent on the second validation attempt and total duration.
- The actual selected model and number of SDK attempts.
- Browser network start/duration and success/error/cancellation outcome in one bounded, content-free Performance entry per activity/action.

Server logs contain a separate `AI teacher performance` record. Successful/error responses provide `Server-Timing`; the browser can pair network timing with server phases in DevTools. No writing, title, scenario, API key, system instruction or client identifier is logged. Existing sanitized SDK status/token diagnostics remain associated with the last actual attempt, while attempt counts and timings aggregate the request. Diagnostic operations do not create API calls or alter cache keys.

### Before/after measurements

`npm run benchmark:ai` uses a locally injected generator and controlled clock. It never constructs a Gemini client or sends network traffic. Latency samples below use 10 warmups and 100 samples per action. The controlled admission test offers 20 opportunities at three-second **fake-clock** increments to pressure the 12-attempt cap; this fixture is not an active 20-RPM target or a scheduling delay. Latency samples deliberately inject a high-capacity mock limiter to measure local handler overhead independently of admission.

| Measurement | Original baseline | Final configuration |
| --- | --- | --- |
| Default client allowance | 4/minute | 12/rolling 60 seconds |
| Shared instance allowance | 40/fixed minute | 12/rolling 60 seconds |
| Controlled minute: admitted/rejected | 4 / 16 | 12 / 8 |
| Ordinary spacing timer / queue | None / none | None / none |
| Concurrency rejection cooldown | Remainder of fixed minute | One second |
| Sentence-check model | Flash-Lite | Flash-Lite |
| Paragraph-review model | Gemini 3.6 Flash | Gemini 3.5 Flash-Lite |
| Local/mock sentence-check p50 / p95 | 0.254 / 0.402 ms | 0.588 / 1.385 ms |
| Local/mock paragraph-review p50 / p95 | 0.238 / 0.465 ms | 0.707 / 3.572 ms |
| Real Google p50 / p95 | Not measured | Not measured |

These are local scheduling/handler measurements, affected by concurrent local test load, and are not evidence of a change in Google inference speed. No percentage or real end-to-end latency improvement is claimed. The demonstrated improvement is removal of the four-attempt admission ceiling and excessive busy cooldown, plus the requested scoped model route. Permitted requests start immediately: 12 RPM does not require each response to wait five seconds.

## Retry and error behavior

SDK automatic retries remain disabled. The existing teaching-validation loop still permits **at most one additional attempt**, shared across keyword and scenario failures, with one existing 35-second upstream deadline. Browser timeout and Vercel function duration remain 40 seconds. Cancellation and stale-context checks remain intact.

HTTP 429/503 errors do **not** trigger an automatic network retry. Application RPM exhaustion, short-lived concurrency saturation, provider quota exhaustion, temporary unavailability and unsupported models have distinct safe handling. The provider's bounded `Retry-After` seconds/date, milliseconds and structured RetryInfo are honored; accepted guidance is up to one day. Missing/invalid guidance uses a conservative 60-second quota or five-second unavailable cooldown. This is backoff, not a promise that daily/token/billing capacity will recover at that time.

Provider backoff is shared across both activities in the warm handler. Blocked requests use zero provider attempts. Concurrent shorter failures cannot erase a longer existing quota backoff. The browser honors the interval without automatically retrying; the open error dialog's manual retry button becomes available after expiry. API-free Copy Prompt remains available while direct AI controls are cooling down, and unavailable messages direct students to it.

No raw provider message, stack trace or sensitive configuration is returned. No response-validation, input-size, origin, credential or security guard was weakened.

## Provider quota basis

The owner checked AI Studio for `gemini-3.5-flash-lite` and reported **15 RPM / 250,000 TPM / 500 RPD**. The final application allowance of **12** uses that report and reserves **3 RPM** for an isolated instance. The private dashboard was not independently inspected and no key or private environment file is configured in this checkout. Public documentation cannot verify this project's tier, usage or remote environment state.

The allowance reduces local request pressure but does not guarantee twelve successful responses per minute or project-wide quota protection. Provider quota, service capacity and other traffic remain authoritative. No quotas were bypassed and no identities, accounts, projects or keys were rotated.

## Usage and cost implications

The default per-client attempt allowance is three times the original value, so a client can potentially use more requests in a minute. The shared warm-instance ceiling is more conservative than the original total ceiling (12 versus 40), and retries are counted within it. Browser cache hits and all sentence/prompt copying consume no additional Gemini requests. Review calls use the requested Flash-Lite model; there is no automatic upgrade or paid infrastructure addition.

Actual charges depend on project pricing, input/output/thinking tokens, cache behavior and other project traffic. They were not measured or estimated as a currency amount. All benchmarks and automated tests used mocks and incurred no Gemini usage.

## Verification results

| Check | Result |
| --- | --- |
| `npm test` | **242 passed**, including 13 focused speed/rate/routing tests. |
| `npm run test:ai-speed-browser` | **3 passed**: 12 successes then the 13th limited across both activities with env 12 and safe drafts; provider cooldown/manual retry; API-free fallback copying. |
| `npm run test:ai-browser` | **83 passed**. |
| `npm run test:sentence-builder-browser` | **19 passed**. |
| `npm run test:sentence-scenario-browser` | **12 passed**. |
| `npm run test:sentence-copy-browser` | **9 passed**. |
| `npm run test:navigation-browser` | **19 passed**. |
| `npm run test:browser` | **All 24 checks passed**, including other activities, progress, resets, responsive layouts and offline reload. |
| `npm run benchmark:ai` | Controlled admission and local/mock p50/p95 recorded above; zero upstream requests. |
| `npm run build` | **Passed**: 69 static assets; vocabulary remains 1,721 records. |
| `npm run check:ai-security` | **Passed**: 67 client assets scanned; no Gemini credentials, SDK or server modules in client output. |
| `git diff --check` | **Passed**. |

Tests retain exact keyword enforcement, scenario context, essay title/current and previous writing context, structured parsing, bounded validation retry, duplicate-click prevention, cancellation, copy controls, drafts, autosave and progress. Existing responsive phone/tablet/desktop browser checks remain passing. Physical mobile IMEs and live teaching quality with the newly selected review model were not independently tested.

## Deployment requirements

The owner reports Vercel `AI_CLIENT_RPM` was already changed from 4 to **12**. Leave that value and the server-only key intact. No new variables, dependencies or service setup are required. Vercel supplies it through `process.env`; production and preview use their respective environment scopes.

A **new deployment is required** for both the updated code and environment value. [Vercel documents that environment changes apply only to new deployments](https://vercel.com/docs/environment-variables); a previous deployment does not acquire the new value. The owner will review, commit, push and deploy using the existing GitHub → Vercel workflow (`npm run build`, output `dist`, `api/gemini.js` with its existing 40-second duration). Do not restore the earlier higher RPM configuration. Remote environment state and deployment logs were not changed or inspected.

After deployment, review the safe model/attempt/timing diagnostics and Google project usage to confirm the intended environment and observe quota pressure. Live provider latency and educational quality are outside mock-test evidence. Strict project-wide admission remains a future shared-counter requirement as described above.

## Exact files changed for the final quota revision

These nine files were edited in this revision, on top of the existing uncommitted speed work:

- `.env.example` — example allowance 12.
- `server/ai-rate-limit.js` — defaults and environment maximum 12; explicit per-instance scope.
- `tools/check-ai-security.mjs` — validates the new example configuration.
- `tests/guided-tutor.test.mjs` — 12/default/lower/invalid/excessive configuration checks.
- `tests/ai-speed.test.mjs` — shared 12-attempt admission, concurrent accounting, rolling expiry, retry charging, multi-instance limitation and actual SDK routing for all 12 pairs.
- `tests/ai-speed-browser.mjs` — env 12 allows twelve requests, limits the thirteenth, preserves the draft.
- `README.md` — active configuration, quota scope and deployment instructions.
- `docs/ai-speed-audit.md` — identifies the original audit as a historical baseline and links this report.
- `docs/ai-speed-report.md` — final quota, verification, risks and file inventory.

## Complete uncommitted speed/configuration file inventory

This includes the prior speed work retained by this revision:

- `.env.example`
- `README.md`
- `server/ai-rate-limit.js`
- `server/gemini.js`
- `server/ai-handler.js`
- `server/ai-contract.js`
- `js/ai-teacher.js`
- `components/ai-teacher.js`
- `package.json`
- `tools/check-ai-security.mjs`
- `tools/benchmark-ai-teacher.mjs` (new)
- `tests/gemini.test.mjs`
- `tests/gemini-routing.test.mjs`
- `tests/guided-tutor.test.mjs`
- `tests/title-aware-tutor.test.mjs`
- `tests/ai-speed.test.mjs` (new)
- `tests/ai-speed-browser.mjs` (new)
- `docs/ai-speed-audit.md` (new)
- `docs/ai-speed-report.md` (new)

Generated build files and test logs remain ignored artifacts. API credentials, vocabulary, unrelated activity source, deployment configuration and production environment were not changed.
