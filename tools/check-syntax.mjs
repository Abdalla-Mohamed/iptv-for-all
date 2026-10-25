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

// APIs that do not exist in Chromium 53 (webOS 4.0/4.5). Syntax checks cannot see these, so scan the app's own code.
const BANNED = [
  [/Object\.(entries|values|fromEntries)\b/, 'Object.entries/values/fromEntries'], [/\.(padStart|padEnd|trimStart|trimEnd|replaceAll|matchAll)\(/, 'newer String methods'],
  [/\.(finally|flat|flatMap)\(/, 'Promise.finally / Array.flat'], [/Promise\.allSettled|globalThis|queueMicrotask|structuredClone|AbortController|\bfetch\(/, 'newer globals (fetch, AbortController ...)'],
  [/ResizeObserver|IntersectionObserver|requestIdleCallback|DecompressionStream/, 'newer observers / streams'], [/\.closest\(|\.scrollTo\(|\.(append|prepend|replaceWith|before|after)\(/, 'newer DOM methods'],
  [/scrollIntoView\(\{/, 'scrollIntoView options']
];
let bad = 0;
for (const f of files.filter((f) => !f.includes(`${path.sep}vendor${path.sep}`))) {
  const src = fs.readFileSync(f, 'utf8').split('\n');
  src.forEach((line, i) => BANNED.forEach(([re, what]) => {
    if (re.test(line.replace(/\/\/.*$/, ''))) { bad++; console.error(`${path.relative(process.cwd(), f)}:${i + 1}: ${what} is not available on webOS 4 (Chromium 53)`); }
  }));
}

for (const f of files) {
  try { acorn.parse(fs.readFileSync(f, 'utf8'), { ecmaVersion: 2015, sourceType: 'script' }); }
  catch (e) { bad++; console.error(`${path.relative(process.cwd(), f)}: ${e.message}`); }
}
console.log(bad ? `${bad} problem(s) for Chromium 53` : `OK: ${files.length} files are ES2015-clean and use no APIs newer than Chromium 53`);
process.exit(bad ? 1 : 0);
