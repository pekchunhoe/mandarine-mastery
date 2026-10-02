# Master essay integration — 2 October 2026

The local app now uses `data/Mandarin_Essay_Master_1000_Titles.xlsx` as its authoritative essay source. No commit, push or deployment was performed. No applicable `AGENTS.md` was found in the project or its ancestor directories.

## Workbook audit

The actual workbook has exactly two sheets, `EssayTitles` and `EssayContents`, with 1,000 rows each.

All 18 title columns are imported: `id`, `title`, `title_pinyin`, `grade`, `category`, `theme`, `essay_type`, `difficulty`, `description`, `suggested_keywords`, `suggested_phrases`, `writing_guidance`, `activity_tags`, `min_words`, `max_words`, `active`, `sort_order`, `notes`.

All 10 content columns are imported: `content_id`, `essay_id`, `content_title`, `content`, `word_count`, `level`, `version`, `active`, `sort_order`, `notes`.

`EssayTitles.id` is the stable title key. `EssayContents.essay_id` is its foreign key; `content_id` identifies the model. `grade` and `level` agree for every pair. Contents are joined by ID, independently of sheet row order. Every non-empty `content_title` also matches its paired title in this workbook.

| Standard | Titles | Model essays |
| --- | ---: | ---: |
| 1 | 100 | 100 |
| 2 | 140 | 140 |
| 3 | 180 | 180 |
| 4 | 190 | 190 |
| 5 | 190 | 190 |
| 6 | 200 | 200 |
| Total | 1,000 | 1,000 |

There are 1,000 unique title IDs, 1,000 unique title strings and 1,000 unique content IDs. All title/content records are active. There are no empty essays, missing models, orphan models, multiple active models per title, or Standard mismatches. All 300 previous title IDs, titles and Standards remain compatible; all 300 previous content IDs survive. Import adds 700 titles and 700 models and updates the 300 previous model texts.

The 15 essay types are 命题作文, 想象作文, 看图作文, 写人作文, 状物作文, 记叙文, 写景作文, 观察日记, 日记, 应用文, 说明文, 游记, 读后感, 议论文 and 演讲稿.

### Actual discrepancies and empty fields

One content record, `p6-6211-548c-4eba-5de5-667a-80fd-7684-4e00-6b21-76f8-9047-c01` (《我和人工智能的一次相遇》), supplies `word_count=206`; its actual Han count is 204. Its text includes two Latin letters. The source count and essay remain unchanged, and the runtime retains the independent `hanCharacterCount=204`. The import report records this discrepancy.

Actual Han lengths range from 181 to 300. Separately, 223 content notes record segmented Chinese word counts from 127 to 193. These are different units; neither whitespace splitting nor a global 150-word minimum is appropriate. Notes, punctuation and paragraph structure remain preserved. All 1,000 imported texts match the source exactly after documented CRLF/CR → LF normalization; there is no trimming or rewriting of essay content.

700 titles have empty keywords and source writing guidance. All 1,000 have empty pinyin, descriptions and suggested phrases; min/max word limits are also blank. These remain empty rather than being filled with invented master metadata. Runtime questions, paragraph analysis, plan labels, sentence starters and checklists are explicitly local scaffolding. Non-narrative genres use genre-aware wording and formats; selected Standard is used in vocabulary recommendations, writing length messages, direct AI context and copied external prompts.

## Activities and compatibility

| Consumer | Catalogue mapping and behavior |
| --- | --- |
| 要点导写 (`guidedEssay`) | Title ID → active content `essayId`; draft key stays `guided-essay:<contentId>`. All 1,000 titles are accessible through grade/category/theme/type/difficulty/search filters. Model content appears only through explicit progressive help or reveal; it never auto-fills the pupil editor. |
| 范文学习 (`modelEssay`) | Same title/content services and ID pairing; full original paragraphs, actual Standard/type, vocabulary support and existing sentence speech/highlighting/auto-scroll. Changing title cancels old playback and highlights. |
| 小小作文挑战 (`essay`) | Central title ID, genre-aware local plan, original vocabulary recommendations and explicitly expanded model references. |
| 把想法变成一段话 (`paragraphBuilder`) | Same title ID/model relationship, independent paragraph draft storage. |
| 故事计划 (`planner`) | Same title ID/model relationship; local plan labels adapt for non-narrative genres. |
| 作文助手 (`assistant`) | Same title ID/model relationship; independent draft copy from compatible old saves. |
| 词语寻宝 (`treasure`) | Existing central category lookup for 帮助别人 vocabulary topics; no model-essay dependency or behavior change needed. |
| Vocabulary/settings topic options | Existing central title service now exposes the imported catalogue. Vocabulary topic metadata remains intact. |

Story Chain, sentence exercises and unrelated vocabulary activities keep their own datasets. No vocabulary records were removed or changed by this integration; production contains the existing 1,721 vocabulary records.

Writing selects use stable title IDs instead of array positions. Filters retain the current title and editor even when the selected title is outside the results. Search updates only options/counts, leaving the focused input and IME composition connected. Only the selected model is rendered; the app does not render 1,000 model essays into the DOM. Title/content services use ID indexes for lookups.

Old `composition:<grade>:<lesson>:<index-or-title>` and `paragraph:...` drafts are copied into `<activityId>:<grade>:<lesson>:<essayId>` keys. Matching first uses stored essay ID; old saves lacking IDs use their unique saved title metadata, never their position in a filtered array. Original keys remain recoverable, and new keys take precedence on later loads. Different activities receive independent copies. Unmatched and custom-title drafts remain available in teacher review and learning-data export/restore. Guided drafts keep every saved pupil paragraph even when a revised model has fewer paragraphs; extra pupil paragraphs remain editable. Per-activity and per-route remembered title IDs survive reload.

The old workbook path, duplicate title-only import writer and 300-record catalogue assertions were removed. Both generated JSON files were regenerated. Old generated records are absent from runtime delivery; historical backups remain recovery artifacts and are not bundled. Current Gemini model configuration, routing and API settings remain intact. Import/display make no Gemini calls. Example-copy actions still copy examples only; guided full-copy copies only the pupil's complete current draft.

## Build and cache delivery

Build compares the actual workbook with both JSON datasets and rejects stale generated data. `dist/data/essay-titles.json` and `dist/data/essay-contents.json` match runtime/source data. Source `.xlsx` files are excluded from production delivery. Essay assets appear in the generated Service Worker manifest and contribute to its content hash and `version.json`. Existing Vercel no-cache headers, network-first caching, update notice and user-triggered reload remain unchanged. No localStorage clearing or forced reload was added.

The production browser check used a real Service Worker for asset caching and offline draft reload. The update-notice simulation used a separate context with Service Workers blocked so the version response could be intercepted reliably; the built watcher displayed the notice without reloading, and the pupil draft survived clicking its reload button.

## Verification

| Command/check | Result |
| --- | --- |
| `npm run essays:update` | Imported 1,000 titles and 1,000 contents; 0 removals; 1 count discrepancy reported. Previous datasets backed up in `docs/essay-title-backups/`. |
| `npm test` | 200 tests passed, 0 failed/skipped; includes source fidelity for every record, IDs, pairing, distribution, filter combinations, migration, genre scaffolds and AI metadata. |
| `npm run test:essay-browser` | 8 tests passed against development and again against the local production build. First/middle/last records, every Standard and every genre; full model pairing/reveal, no auto-insertion, draft isolation/reload, filter combinations, typing/backspace/clear, simulated Chinese IME, direct/copy prompt metadata and responsive layout. |
| `node --test tests/essay-production-browser.mjs` | 2 tests passed: actual built asset delivery/cache, offline draft restoration, update notice/reload, mocked model speech sequence/highlights, conditional auto-scroll and stale playback cancellation. |
| `npm run test:ai-browser` | 83 existing regression tests passed; direct server requests, model routing, errors/retry/cache, external immediate prompt copying, example-only copying, pupil speech and vocabulary support. Responses are mocked; no live Gemini generation. |
| `npm run test:navigation-browser` | 19 tests passed; saved drafts, helper return, history, reload, storage denial, responsive controls. |
| `npm run test:browser` | Existing general regression suite passed, including writing restore/export, unrelated activities and offline core activity. |
| `npm run test:extended` | Existing extended suite passed, including model speech/highlights, treasure, Story Chain, backup export/restore and responsive writing. |
| `npm run test:vocabulary-dialog` | Existing dialog suite passed, including draft/editor preservation, lookup, keyboard access and responsive layouts. |
| `npm run build` | Passed; 66 static assets. |
| `npm run check:ai-security` | Passed; 64 client assets scanned without Gemini credentials/SDK/server imports. |
| `git diff --check` | Passed. |

Browser tests ran in headless Microsoft Edge with emulated phone portrait (390×844), phone landscape (844×390), tablet (768×1024) and desktop (1440×900) sizes. Existing AI/navigation regressions also cover narrower widths. Screenshots were visually reviewed. Chinese IME checks synthesize composition/input events; physical-device IME and native voice quality were not manually tested. Speech events use a deterministic mock. Live Gemini generation and the deployed site's updated catalogue were not tested. The live reference URL could not be accessed through the available web tool; local source and built application checks completed. The in-app Browser backend was unavailable, so the requested repository browser test harness was used.

There are no remaining local integration blockers. No deployment was requested or performed.

## Regeneration

After updating the same workbook, run this exact command:

```sh
npm run essays:update
```

Then run `npm test` and `npm run build`, or use `npm run essays:release` for import + unit tests + build. For development browser tests, start `npm run dev` in one terminal and run `npm run test:essay-browser` in another. To check production, run `npm run build`, serve it with `PORT=4183 node tools/serve.mjs --dist` (PowerShell: `$env:PORT='4183'; node tools/serve.mjs --dist`), then `node --test tests/essay-production-browser.mjs`. Use `TEST_URL=http://localhost:4183/` to point the other browser suites at the built app.

## Files changed

- Pipeline/delivery: `tools/essay-title-import.mjs`, `tools/build.mjs`, `sw.js`, `package.json`.
- Generated data: `data/essay-titles.json`, `data/essay-contents.json`. The user-supplied `data/Mandarin_Essay_Master_1000_Titles.xlsx` is the unchanged source; the user's removal of `data/master-essay-titles.xlsx` remains intact.
- Activities/services: `activities/essayTraining.js`, `activities/writing.js`, `js/essay-title-service.js`, `js/essay-content-service.js`, `js/essay-training-service.js`, new `js/essay-draft-service.js`, `js/storage.js`, `js/tutor-actions.js`, `server/gemini.js`.
- Tests: `tests/essay-title-import.test.mjs`, `tests/essay-topics.test.mjs`, `tests/essay-training.test.mjs`, `tests/ai-teacher-browser.mjs`, `tests/guided-tutor-browser.mjs`, new `tests/essay-master.test.mjs`, `tests/essay-master-browser.mjs`, `tests/essay-production-browser.mjs`.
- Documentation: `README.md`, `docs/essay-titles.md`, this report.
- Recovery artifacts: `docs/essay-title-backups/essay-titles-2026-10-02T02-23-24-820Z.json`, `docs/essay-title-backups/essay-contents-2026-10-02T02-23-24-820Z.json`.

Detailed logs, the machine-readable import report and browser screenshots are retained under ignored `test-results/`. Built assets are under ignored `dist/`.
