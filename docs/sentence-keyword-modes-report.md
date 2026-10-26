# 造句积木 keyword modes — local implementation report

Validation date: 26 October 2026 (Asia/Kuala_Lumpur). Local work only; no commit, push or deployment.

## Previous limitations

The activity required a built-in vocabulary item. Free-writing and block-building both sent that item's word as the AI `topic`. There was no custom target selector, no per-sentence check that AI examples retained the target, and the empty-draft local hint used a generic pattern. Custom work also needed protection from the session's built-in-word mastery and self-rating controls.

## UI and authoritative state

The existing activity now has a compact **选择词语方式** selector: **📚 内置词语** and **✏️ 自选词语**. First use defaults to built-in mode; later visits restore the saved mode. The existing built-in selection, random queue, difficulty, vocabulary records, curated blocks, and independent-writing route are retained.

Custom mode offers a labelled input, the requested example placeholder, and **开始造句**. Confirmation trims surrounding whitespace and rejects blank or over-80-character values. Editing or clearing the input does not change a confirmed target until another valid confirmation. Typing and confirmation never request Gemini. The fallback is the existing sentence editor and scenario picker, without fabricated definitions, pronunciation or dictionary examples.

One `activeKeyword()` getter derives the target from the mode and either `ctx.item.word` or the confirmed custom keyword. The highlighted target banner, workspace context, local helper and all five AI handlers use this target. The existing `topic` request field carries it to the shared API, so no competing request field or vocabulary record ID is needed for custom writing.

## AI actions audited

| Existing button | Action | Target handling |
| --- | --- | --- |
| 💡 给我提示 | `sentence_hint` | Active target in prompt, thinking guidance and sentence patterns; empty-draft guidance remains local. |
| 🔍 检查句子 | `sentence_check` | Target in prompt; suggested revisions checked; original student text preserved. |
| 🌱 帮我扩写 | `sentence_expand` | Target in prompt; every level's example checked separately. |
| ✨ 写得更生动 | `sentence_vivid` | Target in prompt; model and try-yourself template checked. |
| 📚 推荐好词 | `vocabulary_help` | Target in prompt; each generated usage and supplemental example checked. |

The existing non-AI **给我一点提示** helper also follows the custom target. **复制句子** still copies only the exact student text and makes no API request. There was no external-AI copy-prompt feature inside this activity.

The shared mandatory Chinese teaching instruction is appended only for sentence-builder requests. It preserves each action's original educational purpose, requires the exact target and appropriate contextual meaning, prohibits substitutions or splitting, preserves student originals, and asks for natural Mandarin suitable for Malaysian primary pupils. Full models belong in the existing structured example fields; explanation fields remain explanations.

## Validation and controlled retry

The shared validator checks every individual sentence in each structured model field, including multi-sentence field values, rather than checking the whole response. Matching is literal and case/character/punctuation sensitive: synonyms, reordered characters, inserted spaces and a target present only elsewhere do not pass. Sentence boundaries include Chinese terminators, question/exclamation marks, line breaks and ordinary full stops, while protecting punctuation inside the target and decimal numbers.

Quoted or explicitly labelled examples inside feedback are also checked. Explanations do not need to repeat the target. Student originals and quotations of student errors remain separate from models. Existing authoritative dictionary examples are preserved in the data and library; sentence-teacher recommendation cards show the validated contextual AI usage instead of presenting unrelated dictionary examples as target models.

Server validation runs before success is returned. Invalid target output receives at most one automatic regeneration. Both attempts share the existing deadline and cancellation, and each upstream call goes through the existing rate/concurrency limiter. The second response is validated again. Continued failure returns a friendly target-specific message and a manual retry button, without exposing the invalid models or altering student writing. Malformed responses and other errors retain their existing handling. Model routing, SDK retry settings and output-token caps remain unchanged.

The browser independently validates successful envelopes before caching or rendering. Its existing cache key already includes the target in the request context. It does not add an automatic retry, preventing multiplied retries across layers.

## Drafts, progress and lifecycle

Existing `sentence:<built-in ID>` and `builder:<built-in ID>` drafts stay in place. Custom drafts use `sentence:custom:<encoded exact target>` and preserve text, scenario, custom scenario and self-check independently. Preferences are stored in a separate compatible draft entry. Navigation, Back and reload recovery are tested.

Mode or target changes abort the old workspace controller, close its teacher dialog, invalidate pending results, and attach one fresh set of handlers. Input events save without replacing the input element. Built-in block selections return when switching back.

Custom completion saves a practice timestamp with the draft and counts completion within the session. It does not award mastery/XP to an unrelated built-in record. Built-in self-rating controls are omitted in custom completion, and skipping custom work does not change the queued built-in record's review date. Existing built-in progress is retained.

## Verification

All Gemini-related automated tests use mocked responses; no chargeable Gemini calls were made.

| Check | Result |
| --- | --- |
| `npm test` | 210 passed. Includes exact-match failures, all five actions and representative targets, model-field validation, explanation/original separation, one-retry ceiling, quota, deadline, cancellation, browser validation/cache and essay isolation. |
| `npm run test:sentence-builder-browser` | 19 passed. Includes both modes, empty/length validation, replacement, drafts, block restoration, target highlighting, no automatic requests, all five actions, missing-target and naturalness feedback, stale results and retry behavior. |
| `npm run test:ai-browser` | 83 passed. Existing sentence and guided-essay AI workflows, hybrid vocabulary, security, dialogs, copying, caching and responsive behavior. |
| `npm run test:navigation-browser` | 19 passed. Existing state, draft, progress and navigation behavior. |
| `npm run test:browser` | All 24 checks passed. General activities, writing, resets, responsive layouts and offline reload; no browser JavaScript errors. |
| `npm run build` | Passed: 67 static assets; vocabulary remains 1,721 records. |
| `npm run check:ai-security` | Passed: 65 client assets scanned; no Gemini credentials, SDK or server modules in client output. |
| `git diff --check` | Passed. |

New browser coverage checks 320×740 phone portrait, 844×390 phone landscape, 768×1024 tablet portrait, 1024×768 tablet landscape and 1366×900 desktop, including long phrases and touch-sized controls. Existing responsive checks also cover intermediate phone/tablet sizes. No horizontal overflow was observed. Phone and tablet screenshots were inspected; the target uses explicit dark text on a pale yellow background. The project has no separate dark theme to test.

Synthetic Chinese composition events verify that composing Enter cannot confirm the keyword, the focused keyword/sentence elements remain identical, and completed Chinese text is saved. Physical iOS/iPadOS/Android keyboards were not tested. Live Gemini quality and semantic/grammatical judgments were not tested; exact inclusion is an objective validation, not proof of correct meaning. Targets such as `因为……所以……` are deliberately literal, including the ellipses.

## Exact source files changed

- `activities/sentenceBuilder.js`
- `components/ai-teacher.js`
- `js/ai-teacher.js`
- `js/sentence-keyword.js` (new)
- `js/session.js`
- `js/tutor-actions.js`
- `server/ai-contract.js`
- `server/ai-handler.js`
- `server/gemini.js`
- `styles/activities.css`
- `tests/gemini.test.mjs`
- `tests/guided-tutor-browser.mjs`
- `tests/sentence-builder-browser.mjs`
- `tests/sentence-keyword.test.mjs` (new)
- `tests/tutor-fixtures.mjs`
- `docs/sentence-keyword-modes-report.md` (new)

Generated `dist/` output and `test-results/` logs/screenshots are ignored build/test artifacts. Vocabulary datasets, unrelated activity source, API endpoints, model routing and deployment configuration were not changed.
