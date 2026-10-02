# 300-essay deployment diagnosis — 2 October 2026

**Confirmed cause: the public domain still serves the pre-integration 300-essay release. The local integration and locally served production build expose all 1,000 essays correctly.** Publishing/promoting the integration build is the remaining fix for the public site. No commit, push or deployment was performed during this investigation.

No applicable `AGENTS.md` was found in the project or ancestor directories. The previous [integration report](essay-master-integration.md) was read. Its statement that nothing was committed/pushed/deployed describes that earlier session. At the start of this investigation the working tree was clean and HEAD was already `d71a44dce1ecf12fc11ca1531249f59c388224a5` (`Integrate 1000 Mandarin essay titles and model essays`). The local `origin/master` tracking ref also points there; no fetch was performed, so this is not a fresh assertion about the remote server.

## Reproduction and release identity

Both activities were opened with empty search and every catalogue filter set to 全部. Browser checks used isolated headless Microsoft Edge contexts; no existing user browser data was modified.

| Environment | Build identity | 要点导写 | 范文学习 | Titles / contents delivered |
| --- | --- | ---: | ---: | ---: |
| Development, `http://127.0.0.1:4173/` | Source at `d71a44d`; development version placeholder | 1,000 | 1,000 | 1,000 / 1,000 |
| Production, `http://127.0.0.1:4183/` | `huawen-lab-a34ae265c58d` | 1,000 | 1,000 | 1,000 / 1,000 |
| Public, `https://mandarine-mastery.vercel.app/` | `huawen-lab-cc33657d3757` | **300** | **300** | **300 / 300** |

The public browser displays “300 个有范文的题目” and has exactly 300 unique selectable IDs in each activity. Every newly added sample below returns zero search results and is unavailable for selection on the public site. The same samples pass locally, including their complete model text and actual Standard/genre.

Direct public GETs with `cache: 'no-store'` returned HTTP 200. Both `/data/essay-titles.json` and `/data/essay-contents.json` were **byte-identical to `a21194d`**, the pre-integration commit. The public title service, content service and `activities/essayTraining.js` also matched that revision byte-for-byte. This establishes the old source family; the precise deployed Git SHA is not exposed in `version.json` and the Vercel dashboard was not accessed.

Public data hashes (SHA-256):

- Titles: `0f1e3c549603b7e87571658b4dcbbbd944020c9257d7c5a185eb37b12d61a8a0`
- Contents: `8adf071692bbf731f368fd73e4f4213726a27aca1364f5fcd54aedc40ba79221`

The original diagnostic requests for both data files returned `x-vercel-cache: MISS`, `age: 0` and `Cache-Control: no-cache, must-revalidate`, yet still delivered 300 records. `/version.json`, `/js/deployment-version.js` and `/sw.js` all identify `huawen-lab-cc33657d3757`. A fresh browser installed that Service Worker, with one matching cache containing 300 titles and 300 contents. Thus the observed fault exists at production delivery even without any pre-existing iPad cache. There was no observed mixture of a new release and old essay assets. The particular iPad's private cache was not inspected.

## Full data trace

| Stage | Local result and path |
| --- | --- |
| Source workbook | `data/Mandarin_Essay_Master_1000_Titles.xlsx`: `EssayTitles` 1,000 rows, `EssayContents` 1,000 rows |
| Converter | `tools/essay-title-import.mjs`: `readEssayWorkbookData` → `normalizeRows` / `normalizeContentRows` → ID relationship audit |
| Generated data | `data/essay-titles.json` and `data/essay-contents.json`: 1,000 active records each, identical to normalized workbook data |
| Production build | `tools/build.mjs` rejects workbook/JSON mismatch, audits Standard totals, copies generated JSON to `dist/data/`; source workbooks are excluded |
| Delivery | Local `/data/essay-titles.json` and `/data/essay-contents.json` contain 1,000 each; **public versions at these same paths contain 300 each** |
| Runtime loader | `js/essay-title-service.js` and `js/essay-content-service.js` directly import those JSON assets as modules; local ID indexes retain all records |
| Shared catalogue | `allModelTopics` / `filteredTopics` in `activities/essayTraining.js` join active titles with active contents by `title.id` → `content.essayId` |
| Filters and search | Both activities use that shared path. Explicit grade/category/theme/type/difficulty filters, then search of the whole matching catalogue |
| Count and selector | Count comes from the joined filtered array's length; all results are rendered as options with stable title IDs. No 300-record cap, pagination or title-array slice |
| Full model lookup | Selected title ID → active content lookup → stable `contentId` → original paragraphs; only the selected essay is rendered |

The records do **not** become 300 anywhere in the current local pipeline. The divergence is the release serving the public asset URLs.

| Standard | Local source, generated data, production and both filtered UIs | Public data |
| --- | ---: | ---: |
| 1 | 100 | 50 |
| 2 | 140 | 50 |
| 3 | 180 | 50 |
| 4 | 190 | 50 |
| 5 | 190 | 50 |
| 6 | 200 | 50 |
| Total | 1,000 | 300 |

No alternate legacy dataset or fallback loader is used by the current activities. Historical backups remain under `docs/essay-title-backups/`, outside build inputs. Other `slice` operations concern vocabulary suggestions, sentence scaffolding or pupil paragraphs, not catalogue membership. The converter parses active flags into booleans, grade/difficulty into numeric values, and validates numeric content levels against title Standards. The activity join does not filter by optional guidance, keywords, pinyin or content level.

The 700 added titles have empty keywords/guidance and still appear. All titles have empty pinyin. No source metadata was invented or borrowed. Guided writing initially sets its visible grade filter from global settings; choosing 全部 removes that restriction. A real Standard 1 lesson and global 初级 were retained during the new UI tests: with catalogue filters cleared both activities still exposed 1,000. Selecting a Standard 6 title retained its own Standard/genre despite the activity's global grade. Filter/search changes retained the selected essay and pupil writing; an explicitly labelled current option outside the results is excluded from the matching count.

## New regression fixtures and changes

Fixtures are read from the workbook and compared by stable ID against `docs/essay-title-backups/essay-titles-2026-10-02T02-23-24-820Z.json`. That backup contains 300 distinct IDs; the set difference contains 700. Array position is never used to decide whether an essay is new. The final three physical workbook rows are tested separately.

| Standard | New title used in both UIs | Stable ID |
| --- | --- | --- |
| 1 | 爱笑的妹妹 | `p1-extra-0301` |
| 2 | 笑眯眯的食堂阿姨 | `p2-extra-0351` |
| 3 | 把旧衣服变成布袋的阿姨 | `p3-extra-0441` |
| 4 | 总把工具借给邻居的修车师傅 | `p4-extra-0571` |
| 5 | 把山林当课堂的自然导览员 | `p5-extra-0711` |
| 6 | 在失败后重新开店的邻居 | `p6-extra-0851` |
| 6, tail | 没有人监督时的一次决定 | `p6-extra-0998` |
| 6, tail | 我和竞争对手共同完成的修补 | `p6-extra-0999` |
| 6, last | 我为一次冲动留下补救的时间 | `p6-extra-1000` |

Files added/changed:

- `tests/essay-catalogue-fixtures.mjs`: workbook-derived fixtures and legacy-ID comparison.
- `tests/essay-catalogue.test.mjs`: all added IDs, optional metadata, active joins and stable model lookups.
- `tests/essay-catalogue-browser.mjs`: both real activities; 1,000 unique options/counts, all Standard totals, exact/partial Chinese searches, tail titles, full essay content, actual Standard/genre, combined filters, clearing search, empty results, focused-input identity, IME suppression before commit, retained selection, draft preservation and reload.
- `tools/verify-essay-deployment.mjs`: read-only asset verification against the workbook, joined counts, distributions, source code and release consistency; nonzero exit for stale/mixed/missing assets. Optional `--url=` and `--output=` arguments. It is a delivery check, not a substitute for the UI suite.
- `package.json`: `test:essay-catalogue` and `essays:verify-deployment` commands.
- `README.md` and this report: diagnosis, verification and deployment instructions.

No application, converter, generated essay data, draft storage, Gemini routing, Service Worker or update code was changed. The local runtime already passes; changing its displayed number or rewriting its loader would not repair the old public release.

## Validation and draft safety

| Check | Result |
| --- | --- |
| `npm test` | **PASS: 201** unit/data tests |
| New catalogue UI suite on development | **PASS: 4** tests |
| New catalogue + existing essay-master + production-browser suites on served production | **PASS: 14** tests |
| Existing AI teacher, guided tutor and navigation suites on served production | **PASS: 102** tests (83 AI/guided, 19 navigation) |
| `npm run build` | **PASS**, 66 static assets; unchanged build `huawen-lab-a34ae265c58d` |
| Delivery checker against served production | **PASS**, complete workbook fidelity, 1,000 joined IDs, expected distribution, matching versions/code |
| Delivery checker against public deployment | **FAIL**, 300 titles/contents and old activity/loaders; release components agree with one another |
| New UI suite against public deployment | **FAIL: all 4**, immediately detecting “300” where “1000” is required |
| Public read-only browser diagnosis | Reproduced both 300-option selectors, missing new-title searches and 300-record Service Worker cache |
| `npm run check:ai-security` | **PASS**, 64 client assets checked |
| `git diff --check` | **PASS** |

The production tests verify actual Service Worker-cached data and offline draft restoration. The existing update test intercepts `version.json` in a separate context with Service Workers blocked, verifies an update notice without automatic reload, and restores the pupil draft after the user-triggered reload. This is a simulated update notice, not a claim that a new public release was deployed. No cache clearing, blanket worker unregistering, localStorage removal or forced reload was introduced or used to repair the catalogue.

Existing tests cover original legacy saves, independent migrated drafts, autosave, retained extra pupil paragraphs, direct Gemini request/model routing, external prompt copying, example-only copying, sentence speech/highlighting, paragraph boundaries and responsive layouts. AI responses and speech events are mocked. Actual Gemini generation, native iPad speech/IME and a physical iPad were not tested. IME events are synthesized and verify no option redraw during composition. Broader general/extended/vocabulary suites were not rerun because no application code changed. Local tablet screenshots were visually inspected.

Detailed HTTP headers, hashes, live snapshots and screenshots are retained in ignored `test-results/catalogue-live/`. Other logs are `test-results/catalogue-{unit,build,dev,production,existing}.log` and `test-results/catalogue-production-delivery.json`. The earlier baseline production run also passed all 10 existing essay UI tests before any changes.

## Exact remaining deployment actions

1. In the Vercel project serving `mandarine-mastery.vercel.app`, select source containing integration commit `d71a44dce1ecf12fc11ca1531249f59c388224a5`. The current local branch is `master`. Check the project's connected repository, production branch and selected commit; those dashboard settings were not accessible here. Do not redeploy the old `a21194d` source. Include this session's test/tool/report additions in a later commit/push only when authorized.
2. Build that source using the existing `vercel.json`: `npm run build`, output directory `dist`. The workbook and both generated JSON files are already correct; regeneration is unnecessary unless the workbook changes. With the present static source the expected version is `huawen-lab-a34ae265c58d`.
3. Create a production deployment of that source, or promote an existing verified deployment containing it, and ensure the public domain is assigned to it. This deployment/promotion remains **unperformed and requires the user's explicit deployment instruction**.
4. After deployment, run the checks below against the public domain. Require both to pass; asset counts alone are insufficient. Confirm the public version, module and worker agree and both activities show the 1,000 matching options and expected Standard totals.
5. On the iPad, allow existing autosave to finish, then use the existing “应用已更新，请重新载入页面” notice when ready. The existing watcher checks on focus/online/visibility and periodically. Verify the pupil's selected title/draft after the voluntary reload. Do not clear site data or reload while the pupil is writing. An old page cannot receive a new build notice until the new build is actually deployed.

Local production reproduction (PowerShell, first terminal):

```powershell
npm test
npm run build
$env:PORT='4183'
node tools/serve.mjs --dist
```

Second terminal:

```powershell
$env:TEST_URL='http://127.0.0.1:4183/'
node --test tests/essay-catalogue-browser.mjs tests/essay-master-browser.mjs tests/essay-production-browser.mjs
npm run essays:verify-deployment -- --url=http://127.0.0.1:4183/
```

Public acceptance checks after an authorized deployment:

```powershell
npm run essays:verify-deployment
$env:TEST_URL='https://mandarine-mastery.vercel.app/'
npm run test:essay-catalogue
```

**Live verification is FAIL until a correct release is deployed and these public checks pass.**
