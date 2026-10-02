# Vercel XLSX build fix — 2 October 2026

The build failure at `089831334e34e00ac986a3442c7c67119d85f6dd` is a dependency bootstrap error. `tools/essay-title-import.mjs` statically imported `../vendor/xlsx.mjs`, but `vendor/` contains generated browser assets, not tracked source dependencies. Node resolves static imports before executing `tools/prepare-vocabulary.mjs`, so that script cannot create the missing file in time during a clean build.

No applicable `AGENTS.md` was found in the repository or ancestor directories. No commit, staging, push or deployment was performed.

## Evidence and smallest fix

- `vendor/xlsx.mjs` exists locally (1,008,308 bytes), alongside `vendor/xlsx-LICENSE.txt` (11,355 bytes).
- `git ls-files vendor` returns no files.
- `git check-ignore -v vendor/xlsx.mjs vendor/xlsx-LICENSE.txt` identifies `.gitignore:6:vendor/` for both files.
- Filename/case is correct: the existing file and package export are both `xlsx.mjs`. This is an absent generated file, not a Linux case mismatch.
- `tools/prepare-vocabulary.mjs`, present since the initial project commit, copies `node_modules/xlsx/xlsx.mjs` and `node_modules/xlsx/LICENSE` to `vendor/` for browser delivery. Local vendor files have the same SHA-256 hashes as these package files.
- `package.json` and `package-lock.json` already declare SheetJS **0.20.3**, from `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`, with lockfile integrity `sha512-oLDq3jw7AcLqKWH2AhCpVTZl8mf6X2YReP+Neh0SJUzV/BdZYjth94tG5toiMB1PPrYtxOCfaoUCkvtuH+3AJA==`.
- No `.vercelignore` exists. `vercel.json` builds with `npm run build`, publishing `dist`. No deployment rule independently excludes a tracked XLSX library.

Changed `tools/essay-title-import.mjs` to `import * as XLSX from 'xlsx'`. The package's ESM export resolves to that same `xlsx.mjs`. Updated the direct XLSX imports in `tests/essay-title-import.test.mjs` and `tests/vocabulary.test.mjs` consistently. Those are the only executable changes; this report is the fourth changed file.

No dependency version, lockfile, ignore rule, workbook, generated essay data, validation, browser loader or build sequence changed. The build still generates and ships the browser library and Apache licence from the installed package. Committing a second copy of the library is unnecessary.

## Clean checkout verification

Two isolated temporary directories outside the project were used, preventing Node from falling back to this project's `node_modules`:

1. `C:\Users\User\AppData\Local\Temp\mandarine-clean-xvc1yh`: exported the 203 tracked files from `0898313`; no vendor, node_modules or dist directory. Installed with `npm ci --cache .npm-cache --no-audit --no-fund` using a fresh cache. The **unmodified build failed with the exact `ERR_MODULE_NOT_FOUND` for vendor/xlsx.mjs**. Applied only the three import changes. Directly reading the workbook then returned 1,000 title rows and 1,000 content rows while vendor was still absent; build succeeded. The tracked input comparison found only the three intended changes (normalizing Windows line endings; comparing workbooks byte-for-byte). Runtime: Node v24.18.0.
2. `C:\Users\User\AppData\Local\Temp\mandarine-node24-clean-IMrsat`: separate local Git clone at `0898313`, checked out with `core.autocrlf=false`, then overlaid the same three files. Again started without vendor, node_modules, dist or an npm cache, and installed from the unchanged lockfile. Built and tested using official **Node v24.21.0**, downloaded to a separate temporary tools directory and checked against the published SHA-256 checksum. Runtime archive: `node-v24.21.0-win-x64.zip`, SHA-256 `158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541`.

No ignored library, existing installed dependency directory, credentials or previous build output was copied into either checkout. The tracked generated JSON files are intentional deployment inputs and were independently validated against the tracked workbook. Logs and dependencies were created during verification.

| Check | Result |
| --- | --- |
| Fresh `npm ci` in each checkout | PASS; unchanged locked SheetJS 0.20.3 |
| Clean `npm run build`, including Node v24.21.0 | PASS; 66 static assets |
| `npm test` in each checkout | PASS; 201 tests each |
| Served production essay catalogue/master/production suites | PASS; 14 tests on each build |
| Existing AI teacher/guided tutor/navigation suites | PASS; 102 tests on the first clean build |
| Production delivery checker | PASS; complete workbook fidelity, joined IDs, source code and version/Service Worker agreement |
| `npm run check:ai-security` | PASS in the real repository and second clean Git checkout; 64 client assets |
| `git diff --check` | PASS |

The security scanner needs Git metadata, so it could not run inside the first archive-only directory; it passed in the second clean Git checkout. The final Node v24.21.0 build identifies itself as `huawen-lab-a34ae265c58d`, matching the existing correct production assets. Neither that identity nor the essay count was hard-coded by this fix.

The clean output contains 1,000 active titles and 1,000 correctly paired model essays. Standard totals are **100, 140, 180, 190, 190, 200**. Both 要点导写 and 范文学习 use all 1,000 unique IDs; workbook-derived new titles, final rows, exact/partial searches, filters, selections and full model content pass the actual UI tests.

`git ls-files --error-unmatch` confirmed both master workbooks, both essay JSON files, vocabulary JSON, package/lockfile, build script, preparation script and importer are tracked. All other build inputs were supplied by the clean checkout or fresh lockfile install; no additional machine-only build dependency was found. Generated `vendor/xlsx.mjs` and `dist/vendor/xlsx.mjs` match the freshly installed package (`1a0fb062ee9781b13f6687371b202aaefc53b6ce55b530c027e01f9c087b77db`), and the generated licence matches the package licence (`4d2a38ac35cda06a555c84074a819d413339cd3691b822cae50f8f322fe01f64`).

Drafts, original saves, migration backups, autosave, AI routing/copy actions and Service Worker/update code were not changed. Existing tests passed for draft restoration, offline cached use, the voluntary update notice/reload, search focus/IME, speech/highlighting and AI behavior. Browser tests use isolated Edge contexts; AI and speech responses are mocked. No user browser data was cleared. Tests ran on Windows; Linux/Vercel execution, physical iPad input and live Gemini generation were not performed. No public-deployment success is claimed.

Logs are retained in the two temporary checkouts (`npm-ci.log`, `fixed-build.log`, `clean-unit.log`, `clean-essay-browser.log`, `clean-delivery.json`; first checkout also `baseline-build.log` and `clean-existing-browser.log`). Copies of the main logs and checkout evidence are retained under the repository's ignored `test-results/xlsx-clean-build/` and `test-results/clean-build-inputs.json`.

## Commands for the owner

Stage exactly this fix and report, review, commit and push when ready (not executed):

```powershell
git add -- tools/essay-title-import.mjs tests/essay-title-import.test.mjs tests/vocabulary.test.mjs docs/vercel-xlsx-build-fix.md
git diff --cached --check
git diff --cached
git commit -m "Fix XLSX dependency resolution in clean Vercel builds"
git push origin master
```

The next deployment must build the new commit using the existing `npm run build` / `dist` configuration. After an authorized deployment, run `npm run essays:verify-deployment` and run `npm run test:essay-catalogue` with `TEST_URL=https://mandarine-mastery.vercel.app/` to verify the public catalogue.
