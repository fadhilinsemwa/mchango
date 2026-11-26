// Deliberate breaks. Each entry removes or spoils ONE safety line in a throw-away
// copy of the project, then runs the test that is supposed to guard it.
// The test must go red. If it stays green, the safety line is unguarded.

import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const BREAKS = [
  {
    name: "an SMS amount with cents is rounded instead of refused",
    file: "parse.js",
    find: "if (cents !== '00') return refuse('fraction'); // never rounded",
    replace: "",
    test: "tests/parse.test.mjs",
  },
  {
    name: "eatIso uses the machine's own time zone",
    file: 'parse.js',
    find: 'new Date(ms + EAT_MS)',
    replace: 'new Date(ms - new Date(ms).getTimezoneOffset() * 60000)',
    test: 'tests/time.test.mjs',
    tz: 'America/Los_Angeles',
  },
];

function runTest(dir, test, tz) {
  const run = spawnSync(process.execPath, ['--test', test], {
    cwd: dir,
    env: { ...process.env, TZ: tz ?? 'UTC' },
    encoding: 'utf8',
  });
  return run.status === 0;
}

export function runBreaks() {
  const dir = mkdtempSync(join(tmpdir(), 'mchango-breaks-'));
  let ok = true;
  try {
    cpSync(ROOT, dir, {
      recursive: true,
      filter: (src) => !src.includes('/.git') && !src.includes('/node_modules'),
    });
    for (const b of BREAKS) {
      const path = join(dir, b.file);
      const original = readFileSync(path, 'utf8');
      const found = original.split(b.find).length - 1;
      let verdict;
      if (found !== 1) {
        verdict = `CANNOT BREAK: the line was found ${found} times in ${b.file}`;
        ok = false;
      } else if (!runTest(dir, b.test, b.tz)) {
        verdict = `CANNOT JUDGE: ${b.test} is red before the break`;
        ok = false;
      } else {
        writeFileSync(path, original.replace(b.find, b.replace));
        const stayedGreen = runTest(dir, b.test, b.tz);
        writeFileSync(path, original);
        verdict = stayedGreen ? `STAYED GREEN: nothing guards this line (${b.test})` : `red, as it must be (${b.test})`;
        if (stayedGreen) ok = false;
      }
      console.log(`${verdict.startsWith('red') ? 'ok  ' : 'FAIL'}  ${b.name} -> ${verdict}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(`${BREAKS.length} deliberate breaks checked`);
  return ok;
}
