import { readdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const root = new URL('../dist/', import.meta.url);
let count = 0;
async function inspect(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
    assert.ok(
      !['server', 'api', '.env', '.env.local', 'node_modules'].includes(entry.name),
      `Server asset in client build: ${entry.name}`,
    );
    if (entry.isDirectory()) await inspect(url);
    else if (/\.(?:js|mjs|html|json|css|map)$/.test(entry.name)) {
      const text = await readFile(url, 'utf8');
      // Never include offending text in diagnostics: it could itself be a secret.
      if (
        /GEMINI_API_KEY|@google\/genai|generativelanguage\.googleapis\.com|AIza[0-9A-Za-z_-]{35}|(?:VITE_|NEXT_PUBLIC_)\w*GEMINI|You are AI老师|system_instruction|vocabularyCandidates/.test(
          text,
        )
      )
        throw new Error('Server-only content detected in client asset: ' + entry.name);
      if (process.env.GEMINI_API_KEY)
        assert.ok(!text.includes(process.env.GEMINI_API_KEY), 'Secret found in client build');
      count++;
    }
  }
}
await inspect(root);
const paths = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { encoding: 'utf8' },
)
  .split('\0')
  .filter(Boolean);
for (const path of paths) {
  if (!/\.(?:js|mjs|json|html|md|css|txt)$/.test(path) && !path.startsWith('.env')) continue;
  const text = await readFile(new URL('../' + path, import.meta.url), 'utf8');
  if (/AIza[0-9A-Za-z_-]{35}/.test(text))
    throw new Error('Possible credential in repository file: ' + path);
}
const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0');
assert.ok(
  !tracked.some((path) => /^\.env(?:$|\.)/.test(path) && path !== '.env.example'),
  'Secret environment file is tracked',
);
assert.equal(
  (await readFile(new URL('../.env.example', import.meta.url), 'utf8')).trim().replaceAll('\r', ''),
  'GEMINI_API_KEY=\nGEMINI_FAST_MODEL=gemini-3.5-flash-lite\nGEMINI_ADVANCED_MODEL=gemini-3.6-flash\nGEMINI_MODEL=\nAI_CLIENT_RPM=4',
);
console.log(`PASS: ${count} client assets scanned; no Gemini credentials, SDK or server modules.`);
