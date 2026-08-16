// Server sources use Nitro's extensionless relative imports, which its bundler
// resolves and Node's ESM loader refuses. The emitted test build is run
// directly by `node --test`, so the extensions have to be put back.
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('../.test-dist/', import.meta.url).pathname;

for (const file of fs.readdirSync(root, { recursive: true })) {
  const full = path.join(root, file);
  if (!full.endsWith('.js') || !fs.statSync(full).isFile()) continue;

  fs.writeFileSync(
    full,
    fs
      .readFileSync(full, 'utf8')
      .replace(/(from\s+['"])(\.\.?\/[^'"]*?)(['"])/g, (match, open, spec, close) =>
        spec.endsWith('.js') ? match : `${open}${spec}.js${close}`
      )
  );
}
