# 华文词语训练营

从认词、造句到作文，一步一步学会用词。

A Mandarin learning lab for Malaysian SJK(C) Years 1–6, initially supplied with Year 3–4 vocabulary. Vanilla HTML, CSS and JavaScript modules with an optional server-side AI teacher. All non-AI learning activities work without a key or backend.

## Gemini AI老师 setup

The Guided Writing Tutor supports 造句积木 (给我提示、检查句子、帮我扩写、写得更生动、推荐好词) and 要点导写 (给我提示、推荐好词、帮我扩写、写得更生动、下一步怎么写、检查这一段、作文体检). It guides independent revision and never inserts or replaces writing. Sentence checks distinguish actual errors from optional style suggestions. Paragraph review checks the active student paragraph. Sentence hints can start from the actual keyword/scenario without a draft; sentence-required actions and essays shorter than 50 meaningful characters are rejected locally before quota is consumed. Paragraph hints can start from the selected title alone.

Use Node.js 22 or newer (the project already uses JSON import attributes). Install with `npm ci`. Copy `.env.example` to `.env.local` and set these **server-only** variables:

```dotenv
GEMINI_API_KEY=your-server-key
GEMINI_FAST_MODEL=gemini-3.5-flash-lite
GEMINI_ADVANCED_MODEL=gemini-3.6-flash
GEMINI_MODEL=
AI_CLIENT_RPM=12
```

All direct AI actions in 造句积木 and 要点导写, including paragraph/essay review, are pinned server-side to `gemini-3.5-flash-lite` with explicit `thinking_level: 'minimal'`. Browser model names and the legacy model environment overrides cannot redirect these two activities. The existing `GEMINI_FAST_MODEL`, `GEMINI_ADVANCED_MODEL` and `GEMINI_MODEL` settings remain supported by unscoped model-selection integrations. `AI_CLIENT_RPM` defaults to 12 and accepts whole settings from 1 to 12. A lower setting lowers both the per-client and shared-instance allowance. Missing, invalid, zero or above-12 settings fall back to 12; configuration cannot raise the instance ceiling above 12. `npm run dev` serves both the app and `/api/gemini` at `http://localhost:4173`. Restart after changing environment files. Shell environment variables take precedence over `.env.local`, then `.env`. Never use `VITE_*`, `NEXT_PUBLIC_*`, browser storage or a committed environment file for the key.

For the existing GitHub → Vercel workflow, keep `npm run build` and output directory `dist`. The ESM function is `api/gemini.js`; server modules are excluded from static build output. The owner's already-configured Vercel `AI_CLIENT_RPM=12` is compatible; preserve it and `GEMINI_API_KEY`. Keep legacy model variables if other integrations need them; these two activities use the fixed model above. Mark production/preview secrets sensitive where supported. Both this code and the changed environment value require a new deployment: [Vercel environment changes apply only to new deployments](https://vercel.com/docs/environment-variables). No remote settings, commits, pushes or deployments were made by this local implementation.

The SDK is pinned to `@google/genai` 2.23.0. The adapter uses Google's [recommended Interactions API](https://ai.google.dev/gemini-api/docs/interactions-overview), [structured output](https://ai.google.dev/gemini-api/docs/structured-output), and the current [Flash model](https://ai.google.dev/gemini-api/docs/models). It sets `store: false`, uses no conversation history or tools, and retains standard safety safeguards. Only writing, action-specific exercise context and up to 16 server-resolved vocabulary candidates are sent; Gemini receives only each candidate's ID, word and Chinese definition. Personal information typed into an essay is still part of that submitted text; students are reminded not to include it.

One primary endpoint, `POST /api/gemini`, accepts eleven predefined actions: `sentence_hint`, `paragraph_hint`, `sentence_check`, `sentence_expand`, `sentence_vivid`, `vocabulary_help`, `essay_next_step`, `paragraph_expand`, `paragraph_vivid`, `paragraph_review`, `essay_review`. Public action constants/input rules live in `js/tutor-actions.js`; prompts and output schemas remain in `server/ai-contract.js`. Requests contain only `{action, activity, context}` with action-specific fields. The server revalidates independently and rejects unexpected output fields.

In 要点导写, 给我一点提示 is separate teacher-provided scaffolding. It may show writing points, sentence starters and reference text, but it is never submitted as AI context. The distinct AI老师 给我提示 action (`paragraph_hint`) accepts only `selectedTitle`, `paragraphStage`, `currentStudentParagraph`, and ordered `previousStudentParagraphs`. The first paragraph maps to `opening` (no previous text); intermediate paragraphs map to `result` (all prior student paragraphs); the final paragraph maps to `ending` (all prior student paragraphs, at least the opening and result). This uses the existing numeric paragraph positions, independently of reference-derived visible labels such as 开头、结果、感受与结尾. Missing or punctuation-only required earlier writing is rejected locally. Requests retain the existing total context limit, with at most 20 earlier paragraphs of 2000 characters each.

Every 要点导写 AI action requires the actual `selectedTitle` alongside the student's writing. Missing, blank or punctuation-only titles are rejected locally and independently on the server, without a Gemini call. The title anchors natural thematic relevance, not repeated keywords: prompts preserve relevant creative ideas and supporting details, gently flag meaningful drift, and avoid inventing new events to force a match. Paragraph review uses its existing strengths/issues fields for 切题 feedback; essay review evaluates `categories.topicRelevance` against the selected title alone. Local scaffold fields remain excluded from every action. Sentence Builder's contracts remain unchanged.

`paragraph_hint` uses FAST (`gemini-3.5-flash-lite`) with a 650-token cap. Its validated result contains 2–4 `ideas`, 1–2 short `examples` (at most 80 characters and two sentences each, no paragraph breaks), and a brief `studentTask` displayed as 小提醒. The prompt forbids complete paragraphs and forced moral lessons. Other paragraph actions receive `selectedTitle`, `studentParagraph`, and, where continuity helps, one `previousStudentParagraph`; 作文体检 receives only `selectedTitle` and `studentEssay`. Guided-essay vocabulary receives the title, current student paragraph and authoritative candidate IDs. Candidate retrieval remains based on student writing; Gemini chooses relevant words and supplements using both the writing and title. For all seven actions, title and relevant student writing affect the existing five-minute cache; local writing points, hints and examples do not.

Hybrid vocabulary recommendations share one server resolver and card UI across Sentence Builder's free-writing and block-building modes and Guided Essay's current paragraph. Relevant curated candidates are preferred. Gemini may supplement them with Chinese words/phrases, pinyin, Chinese definitions, contextual examples and reasons, targeting 5–8 relevant terms without a fixed source ratio. Selected IDs are validated against server-resolved candidates; stored fields remain authoritative. Generated terms matching any published library word resolve to that stored record. Returned cards carry `source: "library"` or `source: "ai"`; generated cards need no ID and use the same arbitrary-text pronunciation controls. Exact expressions and known library synonyms are deduplicated, and the prompt also asks Gemini to avoid semantic duplicates. Invalid supplements are filtered independently; a partially filtered malformed response is displayed but not cached.

Guided Essay's expansion and vivid-writing tools use the selected title, active student paragraph and at most one immediately preceding student paragraph, with no local scaffold. They offer concise suggestions, a reference version, an explanation and a copy button. Copying or dismissing feedback never edits the draft. Empty or punctuation-only paragraphs are rejected locally; vivid-writing also requires at least six composition characters. Whole-essay review remains in the separate full-essay area. Model routing, output caps, timeouts, rate limits and cancellation are unchanged by title-aware guidance.

The server validates the activity/action before selecting the fixed Flash-Lite model for all eleven action IDs (twelve activity/action pairs). There is no student model selector or automatic model fallback. Limits remain 500 characters per sentence, 2000 per paragraph, 6000 per essay, 8000 total context characters, 32 KiB JSON body, 16 vocabulary candidates, and 18,000 output characters plus bounded schema fields. Action-specific output caps, prompts and structured schemas are preserved, including 1200 tokens for paragraph review and 1800 for essay review. SDK retries remain disabled. Only a detected invalid keyword/scenario model can cause one additional validation attempt; both attempts consume the shared allowance and deadline. Provider 429/503 errors are returned without automatic network retries. The browser keeps successful exact normalized requests in memory for five minutes; changed input misses the cache, and errors/cancellations are never cached. Upstream cutoff remains 35 seconds, browser timeout 40 seconds and Vercel duration 40 seconds. Stale results cannot replace current feedback. Provider processing already underway may still incur usage. Logs and `Server-Timing` expose preparation, admission, zero queue time, upstream, validation, retry and total durations plus the actual attempt count. Browser Performance entries retain one content-free network timing per activity/action. No writing, keys or client identifiers are logged; no AI result is saved to the draft.

The rolling-window limiter shares at most 12 actual attempts in the previous 60 seconds across both activities and clients of one function instance, including validation retries. The 13th attempt is rejected until capacity expires. Per-client allowance also defaults to 12; lower configured limits are honored. Four simultaneous calls are allowed. There is no request queue or ordinary-request spacing delay: excess concurrency fails immediately with a one-second busy hint, while actual RPM exhaustion reports the earliest safe window expiry. Vercel proxy addresses are ephemerally hashed for local throttling only; local development uses a shared bucket. Limits and provider cooldowns reset on cold start and are not distributed. Provider 429 quota errors are distinguished from application limits; bounded `Retry-After`/structured retry guidance is honored across the warm handler, with conservative 60-second quota/5-second unavailable cooldowns when no guidance is supplied. The browser never automatically retries and keeps Copy Prompt available; manual retry becomes available after cooldown. Device-only vocabulary additions become eligible for server recommendations after publication.

The owner reports project quotas of **15 RPM, 250,000 TPM and 500 RPD** for Flash-Lite. The 12-attempt target reserves three RPM of headroom for a single isolated instance; it does not impose a five-second response delay. No shared quota store exists in this checkout. Multiple Vercel instances (for example, two admitting 12 each), cold starts or other callers of the same project can collectively exceed 15 RPM. TPM/RPD are not tracked locally, and [Google applies quota per project across API keys](https://ai.google.dev/gemini-api/docs/rate-limits). Strict coordination would require one shared atomic rolling counter before every upstream attempt, including retries, keyed by project/model across production and preview. No new service or paid infrastructure was added. See the [final configuration and verification report](docs/ai-speed-report.md) for evidence and remaining deployment requirements.

For local measurements without provider calls, run `node tools/benchmark-ai-teacher.mjs`. It reports controlled admission and mock-only p50/p95 handler timing. See [the pre-change audit](docs/ai-speed-audit.md) for the confirmed original limits; these timings are not measurements of real Gemini latency.

Verification (no paid Gemini calls): `npm test`, `npm run test:ai-browser` with the dev server running, `npm run build`, and `npm run check:ai-security`. Existing browser regression scripts remain available. Automated fixtures verify the contract and UI, not live-model teaching quality; a configured deployment still needs an educator's live-content review.

## Add and manage vocabulary

The human-editable master vocabulary library is **`data/master-vocabulary.xlsx`**. The app reads the generated runtime dataset **`data/vocabulary.json`**; browser changes are local to one device and are not published automatically.

## Adding New Vocabulary

1. Open `data/master-vocabulary.xlsx` in Excel.
2. Add or edit vocabulary rows. Keep existing IDs; leave `id` empty for a genuinely new word.
3. Save the workbook.
4. From the project root, run:

   ```sh
   npm run vocabulary:update
   ```

   The command blocks a replacement that would remove more than 25 records or more than 10% of the library. For a deliberate large deletion only, run `npm run vocabulary:update -- --allow-removals`.

5. Review the validation summary, then run `npm test` and `npm run build` and check the new vocabulary in the app.
6. Commit and push `data/master-vocabulary.xlsx`, `data/vocabulary.json`, and any other intentional source changes. Vercel then rebuilds the updated runtime data.

**DO EDIT:** `data/master-vocabulary.xlsx`  
**DO NOT NORMALLY EDIT MANUALLY:** `data/vocabulary.json`  
**GENERATED DURING BUILD:** `dist/data/vocabulary.json`

The teacher master workbook is source-only and is not copied into `dist`.

Read **[the teacher vocabulary guide](docs/vocabulary-library.md)** for validation rules, column aliases, stable IDs, duplicate handling, and the advanced one-off importer. A ready-to-edit **[CSV template](templates/vocabulary-template.csv)** is included.

## Adding Essay Titles and Model Essays

1. Open `data/Mandarin_Essay_Master_1000_Titles.xlsx`.
2. In `EssayTitles`, add or edit one title per row. Give a new title a permanent, unique ID; never reuse or change an existing ID.
3. In `EssayContents`, add or edit one model essay per row. Give it a permanent unique `content_id`, link it with the existing `EssayTitles.id` in `essay_id`, and put the whole essay in the `content` cell. Several model essays may share one `essay_id`.
4. Save the workbook.
5. Run `npm run essays:update`.
6. Run `npm test` and `npm run build` before deployment, or run `npm run essays:release` for all three steps.

**DO EDIT:** `data/Mandarin_Essay_Master_1000_Titles.xlsx`<br>
**DO NOT EDIT MANUALLY:** `data/essay-titles.json` or `data/essay-contents.json` (generated)  
**GENERATED DURING BUILD:** `dist/data/essay-titles.json` and `dist/data/essay-contents.json`

Do not manually copy either generated dataset into `dist`; `npm run build` does that automatically.

The importer validates both worksheets and their ID relationship before replacing either generated JSON, then preserves both previous files in `docs/essay-title-backups/`. It blocks a removal of more than 25 records or more than 10% of either library; use `npm run essays:update -- --allow-removals` only after reviewing an intentional bulk deletion. See [the essay-title guide](docs/essay-titles.md) for the complete schema and the character-count rule.

To diagnose an old deployed catalogue, run `npm run essays:verify-deployment` (read-only; defaults to the public site). It checks workbook fidelity, joined counts, Standard totals, deployed application code and build/Service Worker consistency, and exits unsuccessfully for the old 300-essay release. Run `npm run test:essay-catalogue` against a production build served on port 4183; set `TEST_URL` to test a different server. These UI tests derive new titles by comparing workbook IDs with the original 300-title backup. See [the catalogue deployment diagnosis](docs/essay-catalogue-deployment.md) for evidence, full commands and remaining deployment actions.

## Run locally

Use Node.js 20 or newer. In this project folder:

```sh
npm ci
npm run dev
```

Open **http://localhost:4173**. The app must be served over HTTP/HTTPS, rather than opened by double-clicking `index.html`, because it uses ES modules and a cached JSON dataset. Install dependencies before first use; the local build copies the pinned Excel parser into static assets.

## Deploy to Vercel

Import this folder as the project root. Use:

- Framework preset: **Other**
- Build command: **npm run build**
- Output directory: **dist**
- Environment variables: **none**

`vercel.json` contains the build and output settings. `npm run build` generates a standalone static deployment in `dist/`, including a content-versioned offline cache. The original Excel file is not required at build time or in the browser. No deployment or public publishing is performed by this project automatically.

## Learning activities

The dashboard connects seven stages: **认词 → 懂词 → 记词 → 造句 → 扩句 → 段落 → 作文**.

There are 23 activity choices, plus the shared **我会不会？** self-assessment after activities:

- Recognition and memory: 闪电认词、生字配词、词语侦探、语境填空、记忆翻牌、限时词语挑战.
- Sentence production: 句子拼图、造句积木、句子扩建师、句子升级站、句子医生、一词多句.
- Meaning: 看情境选词、词语分类、词语关系网.
- Paragraphs and writing: 连句成段、段落建造器、作文词语任务、作文结构地图、作文升级助手、要点导写、范文学习、连接词训练、故事接龙、词语寻宝.

**今日10分钟** carries the same five focus words through recognition, context, typed recall, independent sentences and a small paragraph. The time labels are guidance, not enforced deadlines. Free practice can start at any stage. Timed recognition, matching and cloze are optional.

**今日复习** prioritizes recent unresolved errors, weak words, overdue practice and recognition without production. It mixes easier words into the queue and reduces the priority of words just successfully practised. **我的弱词** provides direct retry, sentence-writing and writing-bag actions.

## Authoritative dataset and content safeguards

The supplied file actually used was:

`华小三四年级_造句词语表_逐词自然造句_彻底修正版.xlsx`

The prompt's `(1)` suffix was not present on the supplied file. Its original two sheets were migrated without record loss into the flat central `data/vocabulary.json`. The migration baseline is:

| Source | Character rows | Vocabulary relationships | Lessons                             |
| ------ | -------------: | -----------------------: | ----------------------------------- |
| 三年级 |             79 |                      237 | Blank in the workbook; not invented |
| 四年级 |            109 |                      327 | 1–20                                |
| Total  |            188 |                      564 |                                     |

IDs retain **grade + source character + word**. Duplicate words such as 钥匙 and 仓库 keep their source relationships. Progress can be aggregated by identical word, and repeated equivalent answers do not earn duplicate credit across source characters.

Original reference sentences are preserved verbatim in the JSON. Inspection found source problems, including **“这里的山谷长得十分茂盛”**, **“这里的献花长得十分茂盛”** and **“我们小心地沿着铺路向前走”**. `data/content.js` supplies separately labelled teaching examples for 12 words with errors, overgeneralizations or unhelpful templates. Word cards retain the original sentence and explain the change; Teacher Mode lists all changes. The Excel file itself is never modified.

Content coverage is deliberately explicit:

- All 564 vocabulary relationships support word cards, recognition, recall and independent writing.
- 348 source entries have safe phrase/chunk ordering. Unsupported sentence boundaries use a clearly labelled independent-writing alternative.
- Curated content includes 12 multi-combination sentence builders, 8 expansion sets, 35 cloze distractor sets, 8 multi-context word sets, 6 illustrated text scenarios and 4 paragraph-ordering stories.
- For a narrow lesson without reviewed distractors, cloze uses **look → hide → recall**, rather than asserting that arbitrary alternatives are semantically wrong.
- For unannotated semantic categories or scenarios, the app provides an open explanation task and records reading practice; it does not claim to validate the explanation.
- Sentence Doctor uses reviewed errors or an explicitly accidental duplicated word. Free corrections outside the provided model are referred to a teacher.
- Supplemental words in authored narrative text are ordinary language, but target vocabulary and selectable source records remain within the chosen grade/lesson.

To preview a supplied workbook, then apply the reviewed data (Windows, macOS or Linux):

```sh
npm run import-vocabulary -- "D:\path\to\vocabulary.xlsx"
# Review test-results/vocabulary-import-report.json first.
npm run import-vocabulary -- "D:\path\to\vocabulary.xlsx" --write
npm test
```

The shared importer supports Chinese/English headings, normalization, stable IDs and duplicate previews. Default writes merge and skip existing entries; `--duplicates=update` updates supplied columns. Each write saves a backup. Browser imports use a worker and IndexedDB; student lessons consume bundled JSON. See the teacher guide before using replacement mode.

## Mastery and honest writing support

Practice weights are recognition **2**, context **4**, typed recall **7**, guided construction **9**, independent sentence practice **14**, paragraph practice **22** and explicit teacher review **25**. Correctness history also affects the resulting percentage.

Evidence gates prevent recognition from substituting for production:

| Highest evidence available                       | Maximum mastery |
| ------------------------------------------------ | --------------: |
| Recognition alone                                |             24% |
| Context selection                                |             44% |
| Typed recall                                     |             59% |
| Guided construction                              |             64% |
| Independent sentence practice                    |             84% |
| Sentence + recall + paragraph practice           |             89% |
| The above plus a teacher-confirmed paragraph use |            100% |

Free writing earns **practice evidence**, not a claim of semantic correctness. Eligibility checks require more than an isolated target word, punctuation and sufficient text. Exact copies of a target's reference sentence do not earn independent sentence credit. Hints reduce XP slightly; they do not erase successful evidence. Repeating the same normalized answer for the same word and activity on one day does not farm XP.

The writing assistant counts Chinese characters, paragraphs and target-word appearances; highlights targets; flags repeated connectors, repeated sentences and sentences exceeding 55 characters; and provides a student checklist. **It never generates an AI score or declares arbitrary grammar correct.** Opening, development and ending are self-check items, not automated semantic judgments. `js/writing-checks.js` exposes a separate optional service boundary for a future real language-analysis backend.

Teachers can read locally saved compositions and explicitly confirm selected word usages. Teacher Mode has no authentication and is intended for supervised use on a shared device, not formal assessment security.

## Persistence, privacy and accessibility

Progress, grade/lesson, settings, XP, badges, favorites, review history and writing drafts are local to this browser. Backups can be exported/imported as JSON; compositions can be exported as text. There is no server synchronization or student account.

**重做本题** resets only current selections. **重置学习记录** requires confirmation and clears the app's local progress and drafts. Imported data is sanitized; corrupt/unavailable storage is handled without a blank application, and save failures show an explicit warning.

Touch, mouse and keyboard are supported. Drag interactions also have a tap/button alternative. The interface includes visible focus, text feedback, reduced-motion styles, readable Chinese typography and responsive layouts from 320px upward. Optional Mandarin speech is user initiated and disabled when the device has no appropriate voice.

The service worker caches the full static app after its first successful load. Offline practice works in browsers permitting service workers. Device speech availability and browser storage restrictions can differ; no external image or AI service is required.

## Project structure

```text
index.html
styles/          # Typography, layout, components, activities and breakpoints
js/              # App routing, state, storage, mastery, speech and checks
activities/      # Separate activity engines
components/      # Word-card modal, pointer dragging and garden illustration
data/            # Original vocabulary JSON and separately authored pedagogy
tools/           # Static server, build and workbook importer
tests/           # Data, mastery, writing and browser verification
docs/            # Verification notes
dist/            # Generated deployment output
```

## Verification

```sh
npm ci
npm test
npm run dev
# In another terminal:
npm run test:browser
npm run test:extended
npm run test:vocabulary-browser
npm run build
```

Browser tests use installed Microsoft Edge in headless mode on Windows. Elsewhere they use Playwright Chromium (`npx playwright install chromium`); `BROWSER_CHANNEL` can select another installed Chromium channel. The test browser uses an isolated temporary profile.

See `docs/verification.md` for test scope and limits. Screenshots and machine-readable reports are generated in `test-results/` and excluded from deployment.
