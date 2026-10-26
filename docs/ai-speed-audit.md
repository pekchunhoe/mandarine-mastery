# AI Teacher speed audit — findings before implementation

26 October 2026, Asia/Kuala_Lumpur. This audit was recorded before changing runtime behavior.

Historical baseline only. The active configuration is now 12 attempts per rolling 60 seconds per instance; see the [final verification report](ai-speed-report.md).

- `server/ai-rate-limit.js` sets `DEFAULT_CLIENT_RPM = 4`; `.env.example` and README also specify 4. The limiter uses a fixed 60-second window, 40 total attempts per function instance and four simultaneous attempts. Both activities already share the handler's limiter instance. Each validation retry reacquires capacity.
- There is no ordinary-request 15-second sleep, queue, front-end AI debounce or SDK backoff. Requests fail immediately when capacity is unavailable. Front-end cooldown occurs only after a controlled rate-limit retry interval. The essay's short autosave timer does not delay AI requests.
- The fixed-window limiter gives concurrency rejection the same remaining-window cooldown as rate exhaustion. This can unnecessarily block the UI after a short-lived busy condition.
- `paragraph_review` and `essay_review` route to `gemini-3.6-flash` by default with minimal thinking. Other actions default to `gemini-3.5-flash-lite`, leave thinking at the model default, and permit fast/legacy environment overrides. The two target activities expose five sentence actions and seven guided-essay actions, including whole-essay review.
- The SDK uses the Interactions API with `maxRetries: 0`, stateless requests and bounded structured output. Only keyword/scenario validation failures can trigger one additional upstream attempt. There is no automatic HTTP 429/503 retry loop.
- Server cutoff is 35 seconds, browser timeout 40 seconds and Vercel function duration 40 seconds. Successful exact requests are cached in browser memory for five minutes. Closing/changing context cancels requests and prevents stale rendering.
- Both application limit exhaustion and provider 429 errors currently become `AI_RATE_LIMIT`; upstream retry guidance is not propagated. A general unavailable message does not mention the existing local Copy Prompt alternative.
- Logs contain selected model and aggregate duration, but do not break out preparation, admission, upstream attempts, validation or retry time. No persistent/distributed rate-limit store exists. IP-based limits are instance-local and reset on cold start; they are not globally enforced across Vercel instances or other project users.
- This checkout has only `.env.example`; no Gemini key or relevant model/RPM override is configured in the execution shell. No authenticated Google AI Studio quota integration is available. Real provider latency, usage tier, production environment overrides and current project quotas cannot be independently measured here. No live API traffic will be generated to test throughput.

Confirmed bottleneck: application-side capacity of four attempts per minute can cause rejected requests and cooldowns. It does not itself make an admitted single Gemini generation slower. Review model selection, default thinking and prompt/output sizes are plausible contributors to individual response time; their real latency contribution is unmeasured.

The planned local comparison separates controlled admission/queue tests and mocked handler p50/p95 from real upstream latency. Provider quota compatibility remains an explicit verification limitation.

## Baseline captured before runtime changes

The local-only benchmark admitted 4 of 20 attempts spaced three seconds apart on a controlled clock and rejected 16. After 10 warmups, 100 no-network handler samples per action gave sentence-check p50/p95 **0.254/0.402 ms**, and paragraph-review p50/p95 **0.238/0.465 ms**. These measure mock handler overhead, not Google inference. Sentence check resolved to `gemini-3.5-flash-lite`; paragraph review resolved to `gemini-3.6-flash`.

A subsequent [official documentation check](https://ai.google.dev/gemini-api/docs/whats-new-gemini-3.6) confirmed that Flash-Lite already defaults to minimal thinking. Making that setting explicit is a routing/configuration guarantee, not evidence of a speed improvement for existing Flash-Lite calls.
