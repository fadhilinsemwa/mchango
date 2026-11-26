// The whole check, in one command:  npm test   (or: node tests/run.mjs)
//
// 1. Every test file runs three times, with the machine pretending to be in three
//    time zones. Code that leans on the machine's own zone cannot pass all three.
// 2. No test may be skipped.
// 3. The page is driven in a real headless browser (tests/browser.mjs).
// 4. The deliberate breaks (tests/breaks.mjs): each safety line is removed once
//    and its test must go red. A safety line with no test guarding it is a failure.

import { spawnSync } from 'node:child_process';
import { runBreaks } from './breaks.mjs';

const ZONES = ['UTC', 'America/Los_Angeles', 'Africa/Dar_es_Salaam'];
const count = (out, word) => {
  const m = new RegExp(`^(?:ℹ|#) ${word} (\\d+)`, 'm').exec(out);
  return m ? Number(m[1]) : null;
};

let ok = true;
for (const tz of ZONES) {
  console.log(`\n=== tests with TZ=${tz} ===`);
  const run = spawnSync(process.execPath, ['--test', 'tests/*.test.mjs'], {
    env: { ...process.env, TZ: tz },
    encoding: 'utf8',
  });
  const out = run.stdout + run.stderr;
  console.log(out);
  const tests = count(out, 'tests');
  const fail = count(out, 'fail');
  const skipped = count(out, 'skipped');
  const todo = count(out, 'todo');
  const good = run.status === 0 && tests > 0 && fail === 0 && skipped === 0 && todo === 0;
  console.log(`TZ=${tz}: ${tests} tests, ${fail} failed, ${skipped} skipped -> ${good ? 'GREEN' : 'RED'}`);
  if (!good) ok = false;
}

console.log('\n=== the page in a real browser ===');
const browser = spawnSync(process.execPath, ['tests/browser.mjs'], { encoding: 'utf8' });
console.log(browser.stdout + browser.stderr);
if (browser.status !== 0) ok = false;

console.log('\n=== deliberate breaks ===');
if (!runBreaks()) ok = false;

console.log(ok ? '\nALL GREEN' : '\nFAILED');
process.exit(ok ? 0 : 1);
