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
    name: "typed text is put on the page as HTML",
    file: "app.js",
    find: "else el.append(document.createTextNode(String(kid)));",
    replace: "else el.insertAdjacentHTML('beforeend', String(kid));",
    test: "tests/browser.mjs",
  },
  {
    name: "a transaction ID recorded twice is accepted",
    file: "store.js",
    find: "if (dup) return { action: 'duplicate', dup };\n  }\n  return { action: 'save' };",
    replace: "}\n  return { action: 'save' };",
    test: "tests/totals.test.mjs",
  },
  {
    name: "what a person owes can go below zero",
    file: "store.js",
    find: "Math.max(person.pledge - got, 0)",
    replace: "person.pledge - got",
    test: "tests/totals.test.mjs",
  },
  {
    name: "a removed person is still counted",
    file: "store.js",
    find: "if (person.removed) continue;",
    replace: "",
    test: "tests/totals.test.mjs",
  },
  {
    name: "an undone payment is still counted",
    file: "store.js",
    find: "if (pay.undone) continue;",
    replace: "",
    test: "tests/totals.test.mjs",
  },
  {
    name: "the same payment saved twice is recorded twice",
    file: "store.js",
    find: "if (existing.some((p) => p.id === payment.id)) return { action: 'nothing' };",
    replace: "",
    test: "tests/totals.test.mjs",
  },
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
  const args = test.endsWith('browser.mjs') ? [test] : ['--test', test];
  const run = spawnSync(process.execPath, args, {
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
