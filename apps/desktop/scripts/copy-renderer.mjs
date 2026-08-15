// Stage the web app's prerendered output for packaging.
//
// electron-builder can pull a fileset from outside the package (`from:`), but
// it cannot then resolve `asarUnpack` patterns against those files - they have
// to live under the package directory. So the bundle is copied in rather than
// referenced in place.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(packageRoot, '../web/.output/public');
const destination = path.join(packageRoot, 'renderer');

if (!fs.existsSync(source)) {
  console.error(
    `No renderer bundle at ${source}.\nRun \`pnpm --filter @unimem/web generate\` first.`
  );
  process.exit(1);
}

// Replace rather than merge: a stale asset left behind from a previous build
// would be packaged and served over app:// alongside the current one.
fs.rmSync(destination, { recursive: true, force: true });
fs.cpSync(source, destination, { recursive: true });

console.log(`Staged renderer bundle -> ${path.relative(packageRoot, destination)}`);
