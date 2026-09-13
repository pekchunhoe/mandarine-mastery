# Verification record

Validated on 10 September 2026 using Node.js and an isolated headless Microsoft Edge/Chromium browser on Windows.

## Data and content

- Extracted the supplied workbook reproducibly, with Chinese headers mapped to data fields.
- Verified every one of 564 word/source relationships: stable ID, source character inside its word, and target word inside its original sentence.
- Verified Year 3/4 totals, Year 4's 20 lessons, Year 3's blank lesson metadata and retained duplicate relationships.
- Checked that all 348 eligible sentence puzzles reconstruct their teaching sentence exactly. Added regressions against detaching possessive/plural fragments such as `我的校服` and `他们`.
- Inspected over 150 sampled sentences and all repeated sentence skeletons. Twelve vocabulary items use separately labelled editorial examples; original cells are retained.
- Verified curated components and distractors reference source vocabulary, and no prohibited metalinguistic template is generated.

## Logic

Unit tests cover evidence-gated mastery, production weights, duplicate-credit prevention, hint deductions, review prioritization, corrected-word rotation, malformed storage, unavailable storage, draft persistence, streaks, objective writing checks, punctuation normalization and escaped student input.

Recognition alone is capped at 24%. Automatically recorded writing practice cannot reach the final mastery band without explicit teacher review and prerequisite production/recall evidence.

## Browser checks

Requested responsive dimensions:

| Target           | Viewport    |
| ---------------- | ----------- |
| Small phone      | 320 × 740   |
| Phone            | 375 × 812   |
| Large phone      | 430 × 932   |
| Tablet portrait  | 768 × 1024  |
| Tablet landscape | 1024 × 768  |
| Laptop           | 1366 × 900  |
| Desktop          | 1920 × 1080 |

All activity screens were checked in both grades at 320px for empty content, JavaScript errors and horizontal overflow. Main screens were checked through portrait/landscape resizing. Dashboard screenshots cover all seven widths; sentence-building and essay screenshots cover phone/laptop layouts.

Functional scenarios include:

- Recognition retries, multi-answer collection and automatic weak-word records.
- Matching by mouse drag, genuine touch-pointer drag and tap → tap.
- Context choices, typed recall and punctuation/spacing tolerance.
- Phrase ordering with buttons and keyboard input.
- Distinct valid sentence-builder combinations and independent sentence drafts.
- Expansion, clear sentence repair and coherent paragraph ordering.
- Memory pairs with unambiguous word/sentence relationships.
- Semantic scenes with explanations, multi-category acceptance and explicit open-task fallbacks.
- Multiple contexts, word relationship cards and connectors.
- Story chaining, treasure missions and saved writing.
- The entire five-stage daily route through nine completed activities.
- Teacher lesson selection, difficulty and count, plus manual writing review.
- Refresh persistence, grade/lesson isolation, localStorage restore, progress export/import and storage-denial handling.
- Activity reset preservation, cancelled full reset and confirmed full reset.
- Offline dashboard reload and transition into a core activity.
- Optional timer expiry and absence of unrequested speech playback.

## Practical limits

These are browser-emulated phone/tablet dimensions, not tests on physical iPhones/iPads. Native iOS/Safari voice availability and device-specific touch behavior have not been independently verified. The standalone test browser was used because the in-app Browser runtime reported no available browsers.

Authored builders, expansions, distractors and narratives are finite curated content, with explicit recall/writing alternatives for unsupported words. Automated checks do not establish arbitrary semantic or grammatical correctness; teacher review remains part of the design.

`test-results/browser-report.json` and `test-results/extended-browser-report.json` contain the executed browser scenario outcomes. `npm test` reports the unit/content assertions. The application is packaged for static deployment; it has not been published to a Vercel account.

## Central vocabulary upgrade — 2026-09-11

Audit: vanilla ES modules, custom Node static server/build, Vercel `dist` output, service-worker offline caching. Vocabulary was a nested JSON array of 188 source characters / 564 records, loaded in `js/state.js`. All 23 routes received a shared session pool; topic/category/collocation word lists also existed in `data/content.js`. No backend or IndexedDB vocabulary store existed. Student progress already used stable source IDs in localStorage. The workspace had no `.git` repository.

Migration checks passed: 564 → 564 vocabulary records; 237 Year 3, 327 Year 4; all 188 source relationships, IDs, lesson values and original sentences preserved. Originals were copied to `docs/archive/` before migration. Runtime category/tag/topic/collocation lists now live in the central records. Authored exercise material remains separate teaching content.

Executed verification:

- `npm test`: **38 passing tests**, including original data/mastery/writing regressions and new schema, duplicate, filtering, search, random selection, overlay, malformed input and 10,000-record checks. Summarizing 10,000 learned-word progress records took 26 ms in the local performance test; subsequent practice and due-date edits remained visible.
- `npm run test:browser`: passed against the development server **and the generated `dist` site**. Includes all 23 activity screens at 320px for both original years, working answer flows, progress, touch/keyboard controls, writing and offline reloads.
- `npm run test:extended`: all extended activity/progress/backup/storage-denial scenarios passed.
- `npm run test:vocabulary-browser`: passed manual add/edit/delete, reload persistence, XLSX and CSV preview, cancellation, merge, skip, update, explicit replacement, JSON/CSV/XLSX export/reimport, combined filters, imported Year 6 vocabulary in every activity screen, topic relevance, missing-example fallbacks, malformed files and local reset.
- Browser large-file test: imported **10,000** synthetic test records, displayed 25 rows per page and 25 preview entries per page, searched and reloaded **10,566** local records. The synthetic records existed only in the isolated browser test profile; the deployed dataset remains 564.
- Node large-file test: 10,000-record validation/indexing/filtering/CSV round trip completed in approximately **0.6 seconds** in this environment. This is a local test measurement, not a cross-device performance guarantee.
- No horizontal overflow at 320×740, 812×375, 768×1024, 1024×768, 1366×900 and 1920×1080. Phone and desktop screenshots were visually inspected; viewport captures are in `test-results/vocabulary-*.png`.
- XLSX, traditional binary XLS, Chinese headings, punctuation, multiline cells and all metadata round-tripped in data tests. Formula cells, invalid JSON/CSV/workbooks, missing columns, empty rows, reserved/conflicting IDs and invalid lists were checked.
- The documented CLI template preview detected three valid records and wrote no vocabulary. A CLI write/update of the canonical JSON into itself produced a timestamped backup and **identical before/after SHA-256**.
- `npm run build`: passed, **45 static assets**, 564 vocabulary records. The build validates the central schema and IDs and includes the parser/worker/template in the offline cache. `vercel.json` retains the existing static deployment settings.

New browser results are in `test-results/vocabulary-browser-report.json`. No browser JavaScript errors were recorded by the three suites. The in-app browser was unavailable; isolated Microsoft Edge was used. Physical iOS/Safari and actual Vercel publishing were not performed. Years 1, 2, 5 and 6 are supported structurally and verified with imported test records; their real curriculum vocabulary still needs teacher-supplied data.
