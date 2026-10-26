# 造句积木 — scenario-aware AI Teacher verification

26 October 2026, Asia/Kuala_Lumpur. Implemented and validated locally. No commit, push or deployment.

## Root cause

Free writing already sent `situation`, but teaching instructions did not consistently make it the primary source of content. The empty-draft hint bypassed Gemini and returned generic questions and a pattern. Block mode sent the fixed label “用积木造句” instead of a student scenario. The previous exact-keyword guard could accept an unrelated model simply because it contained the target. A request/dialog was invalidated on keyword-mode changes and navigation, but not scenario or sentence edits.

## Shared context and lifecycle

`buildSentenceTeacherContext()` reads the existing scenario selector/custom-scenario input and returns one snapshot with:

- `topic`: the committed active keyword, from the existing authoritative getter.
- `keywordMode`: `builtin` or `custom`.
- `situation`: the actual selected scenario or the trimmed custom text.
- `studentSentence`: the current partial/complete writing, or the current assembled block sentence.
- `studentYearLevel`: a valid available Standard from settings, falling back to the built-in item when settings use mixed years.

All five actions use this same function. Vocabulary candidate IDs are the only action-specific addition. There is no second scenario state or duplicate wire field. Block mode reuses the existing native scenario selector and custom input; scenario fields are preserved through tile redraws. The existing keyword modes, input/editor, vocabulary, difficulty and drafts remain in place.

Requests retain a context fingerprint. Scenario, sentence and block edits abort stale help and close its dialog; the response guard also checks the fingerprint before rendering. Keyword/mode changes retain their workspace cancellation. Input elements are not redrawn on typing, and editing never starts an API call. Draft/scenario changes are saved through the existing persistence path.

An empty scenario gives “请先填写‘我想写的情境’，让 AI老师根据你的想法提供帮助。” before any network request. Check/expand/vivid still require an existing sentence. Hint can now use a described scenario with an empty draft and return two useful examples; vocabulary help can also start from the described scenario.

## Five distinct teaching purposes

The shared Chinese instruction identifies the target, actual scenario, existing writing and available year. It makes the scenario the main content source, prohibits changing important supplied facts, treats input as learning material rather than instructions, requires specific teaching advice, and retains exact-keyword and natural-Mandarin rules.

| Button | Updated purpose and response |
| --- | --- |
| 💡 给我提示 | Three specific questions about the event, actions/feelings and development/outcome, plus exactly two distinct scenario-based model sentences. Optional short patterns remain available. |
| 🔍 检查句子 | Preserve the exact original; check keyword use, grammar, naturalness and expression of the scenario. Give applicable strengths, concrete issues, optional style improvements and a complete suggested revision. A grammatically correct but brief sentence is not falsely marked wrong. |
| 🌱 帮我扩写 | Retain gradual expansion levels, prioritize details supplied in the scenario and explain each addition in `focus`. Unknown details stay conditional or blank. |
| ✨ 写得更生动 | Use suitable verbs, feelings, sensory detail or natural flow while preserving the event. Explain the chosen technique and retain the student's try-yourself scaffold. |
| 📚 推荐好词 | Recommend approximately 4–6 appropriate words/expressions, explain their specific scenario use, and give two distinct complete examples using recommendations and the exact target. Individual recommendation expressions need not contain the target. |

The richer schema is selected for current sentence-context requests carrying keyword-mode metadata. Older clients retain their existing response contract. Guided-essay schemas and teaching instructions are unchanged. Prompt and schema tests exercise the installed Gemini SDK using mocked fetch responses for all five actions. Model routing, token caps and SDK retry settings are unchanged.

## Tested long-run outputs

These are explicit mocked responses exercised through the server and browser, not claims about a live Gemini generation.

Target: **坚持**. Scenario: **运动会参加长跑比赛，跑到一半觉得很累，想放弃，后来听到同学们为我加油，我终于跑到了终点。** Original: **我坚持跑到了终点。** Standard: **3**.

1. **给我提示** asks “跑到一半时，你有多累？”、“听到同学加油后，你怎么想？”、“你怎样继续跑到终点？” Its two examples are:
   - 虽然我跑到一半已经很累，但听到同学们的加油声后，我还是坚持跑到了终点。
   - 听到同学们的加油声后，我重新鼓起勇气，坚持跑到了终点。
2. **检查句子** recognizes that the original is grammatical and expresses the outcome, and optionally suggests adding classmates' cheering to connect it more clearly to the scenario. Revision: **听到同学们的加油声后，我重新鼓起勇气，坚持跑到了终点。**
3. **帮我扩写** first adds tiredness during the race: **长跑比赛进行到一半时，我虽然觉得很累，还是坚持跑到了终点。** The next level adds the cheering as the reason to continue, using the first hint example above.
4. **写得更生动** uses **听到同学们的加油声后，我重新鼓起勇气，坚持跑到了终点。** It explains the relevant psychological description and provides a fill-in structure retaining 坚持.
5. **推荐好词** recommends **气喘吁吁、咬紧牙关、鼓起勇气、全力以赴**, with definitions and scenario-specific usage explanations. Optional physical details are explicitly conditional. The two examples are:
   - 听到同学们的加油声后，我重新鼓起勇气，坚持跑到了终点。
   - 如果当时已经气喘吁吁，可以写听到加油声后，我仍坚持跑到了终点。

The same workflow is exercised with the existing built-in **尽力** and custom **坚持**. Original student text is preserved even when it lacks the newly selected target.

## Validation and limits

The existing exact-keyword check remains independent of relevance checks. Each sentence within each model field is checked, including the new hint/vocabulary `examples`, revisions, expansion levels, vivid examples, templates and vocabulary usages. Literal characters and their order are required; synonyms, approximations and a keyword elsewhere in the response do not pass. Student originals and ordinary explanatory feedback are separate from model sentences. Two required examples must also be distinct.

The shared server/browser scenario guard rejects bounded, explicit problems:

- For a stated long-running event, standalone homework/piano/studying routine examples absent from the scenario are rejected, including the three unacceptable examples from the request.
- An explicit successful finish cannot become “没能跑到终点” or an explicit final abandonment.
- A sentence opening with a different weekday is rejected when the scenario supplies one unambiguous weekday. 星期天 and 星期日 are treated as the same day.

Checks run per individual sentence, so a relevant first sentence does not excuse an unrelated second one. Negations, family cheering, hypothetical routines and relevant recollections are covered to avoid obvious false positives. Vocabulary examples are checked before filtering and again after resolving recommendations. Browser validation runs before caching or displaying a successful response.

**These checks do not prove semantic relevance or grammatical correctness.** They do not use an overlap score as proof, and do not comprehensively detect changed people, locations, causes, quantities, omissions or subtle contradictions. For example, an unrelated drawing model may not trigger a bounded guard. The primary relevance/meaning controls remain the explicit shared/action instructions and the student's or teacher's review. No additional semantic-verification API calls were introduced. Live Gemini quality was not tested.

A detected keyword or scenario failure uses the same existing loop: **at most two total upstream attempts**, even when the two failures are different kinds. Both attempts share the deadline and cancellation; each acquires the existing limiter. Both responses are validated. Continued failure shows a friendly error and manual retry, without presenting rejected models or editing the student's work. Malformed output retains its existing handling. The browser does not add an automatic retry. Cache identity includes scenario, draft, mode, keyword and year; the namespace was advanced for the new teaching format.

## Verification results

All automated Gemini calls were mocked. No real Gemini tokens were consumed.

| Command/check | Result |
| --- | --- |
| `npm test` | **220 passed**, including 10 new scenario tests. |
| `npm run test:sentence-scenario-browser` | **12 passed**: all five buttons in both modes, relevant structured results, missing context, partial writing, in-flight/completed result invalidation for all five, blocks, IME, retries, copy safety and responsive dialogs. |
| `npm run test:sentence-builder-browser` | **19 passed**: previous keyword-mode, draft, block, progress, copy and layout regressions. |
| `npm run test:ai-browser` | **83 passed**: sentence and guided-essay AI workflows, hybrid vocabulary, caching, security, dialog behavior and responsive regressions. |
| `npm run test:navigation-browser` | **19 passed**: navigation, state recovery and saved work. |
| `npm run test:browser` | **All 24 checks passed**, including other activities, progress/reset behavior, responsive screens and offline reload; no browser JavaScript errors. |
| `npm run build` | **Passed**: 68 static assets; built-in vocabulary remains **1,721** records. |
| `npm run check:ai-security` | **Passed**: 66 client assets scanned; no Gemini credentials, SDK or server modules in client output. |
| `git diff --check` | **Passed**. |

Scenario fixtures cover school, family, sports, friendship, accidents, celebrations and everyday experiences. Scenario and partial-writing changes, mode/year changes, mixed keyword/scenario retry failures, malicious-input boundaries and duplicate models are covered. Existing drafts, scenarios, self-checks and built-in progress remain intact.

New layout checks cover 320×740 phone portrait, 844×390 phone landscape, 768×1024 tablet portrait, 1024×768 tablet landscape and 1366×900 desktop. No horizontal page/dialog overflow was observed; screenshots were inspected. Synthetic Chinese composition verifies stable scenario-input identity, focus, persistence and no automatic requests. Physical mobile IMEs and native iPadOS Safari were not tested.

There is no external-AI copy-prompt feature in 造句积木, so none was added. Existing sentence/example copying makes no Gemini request. The unrelated guided-essay external-AI menu is preserved and covered by existing browser tests.

## Exact files modified

- `activities/sentenceBuilder.js`
- `components/ai-teacher.js`
- `js/ai-teacher.js`
- `js/sentence-keyword.js`
- `js/sentence-teacher-context.js` (new)
- `js/tutor-actions.js`
- `server/ai-contract.js`
- `server/ai-handler.js`
- `server/gemini.js`
- `package.json`
- `tests/guided-tutor-browser.mjs`
- `tests/tutor-fixtures.mjs`
- `tests/sentence-scenario.test.mjs` (new)
- `tests/sentence-scenario-browser.mjs` (new)
- `tests/sentence-scenario-fixtures.mjs` (new)
- `docs/sentence-scenario-teacher-report.md` (new)

Generated build output, test logs and screenshots remain ignored artifacts. Vocabulary datasets, unrelated activity source, deployment configuration, endpoints, model selection and rate-limit settings were not changed.
