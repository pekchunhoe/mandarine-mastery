import { mkdir, copyFile } from 'node:fs/promises';
await mkdir(new URL('../vendor/', import.meta.url), { recursive: true });
await copyFile(
  new URL('../node_modules/xlsx/xlsx.mjs', import.meta.url),
  new URL('../vendor/xlsx.mjs', import.meta.url),
);
await copyFile(
  new URL('../node_modules/xlsx/LICENSE', import.meta.url),
  new URL('../vendor/xlsx-LICENSE.txt', import.meta.url),
);
