#!/usr/bin/env node
// webOS 4 ships Chromium 53 (ES2015, no async/await, no object spread). Fail fast if app code or a vendored
// library (hls.js, mp4box.js) needs more than that.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'app', 'js');
const files = [];
(function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const f = path.join(dir, name);
    if (fs.statSync(f).isDirectory()) walk(f);
    else if (f.endsWith('.js')) files.push(f);
  }
})(appDir);

let bad = 0;
for (const f of files) {
  try { acorn.parse(fs.readFileSync(f, 'utf8'), { ecmaVersion: 2015, sourceType: 'script' }); }
  catch (e) { bad++; console.error(`${path.relative(process.cwd(), f)}: ${e.message}`); }
}
console.log(bad ? `${bad} file(s) use syntax newer than ES2015` : `OK: ${files.length} files are ES2015-clean`);
process.exit(bad ? 1 : 0);
