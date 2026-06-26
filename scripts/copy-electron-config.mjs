// Copies the data/config JSON the Electron MAIN process reads at runtime into
// dist-electron/config/. `tsc` does not copy .json files to its outDir, and
// electron-builder packages dist-electron/**, so these copies make the files
// available both in dev (electron runs from dist-electron) and when packaged.
//
// Run after `tsc -p tsconfig.electron.json` (see the electron:compile/build scripts).
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'dist-electron', 'config');
mkdirSync(outDir, { recursive: true });

// [source, destination] relative to the repo root.
const files = [
  ['electron/config/default-settings.json', 'dist-electron/config/default-settings.json'],
  // languages.json's single source of truth is the renderer model folder.
  ['src/app/core/models/languages.json', 'dist-electron/config/languages.json'],
];

for (const [from, to] of files) {
  copyFileSync(join(root, from), join(root, to));
  console.log(`copied ${from} -> ${to}`);
}
