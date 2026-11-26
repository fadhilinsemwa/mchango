import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { t, BANNED_WORDS, VERSION } from '../app.js';

const read = (name) => readFileSync(new URL('../' + name, import.meta.url), 'utf8');

test('every text has a Kiswahili and an English form', () => {
  for (const [key, pair] of Object.entries(t)) {
    assert.equal(Array.isArray(pair) && pair.length === 2, true, key);
    for (const text of pair) assert.equal(typeof text === 'string' && text.trim() !== '', true, key);
  }
});

test('both forms of a text use the same blanks', () => {
  const blanks = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join();
  for (const [key, [sw, en]] of Object.entries(t)) assert.equal(blanks(sw), blanks(en), key);
});

test('no text uses a word from the banned list', () => {
  for (const [key, pair] of Object.entries(t)) {
    for (const text of pair) {
      for (const word of BANNED_WORDS) {
        assert.equal(new RegExp(`\\b${word}\\b`, 'i').test(text), false, `${key}: "${word}" in "${text}"`);
      }
    }
  }
});

test('no screen text is written outside the table', () => {
  // T('key') is the only way text reaches a screen: every key used must exist,
  // and no quoted Kiswahili sentence may sit in the code below the table.
  const code = read('app.js');
  const body = code.slice(code.indexOf('// ---------- small helpers')) + read('share.js');
  for (const [, key] of body.matchAll(/\bT\('(\w+)'(?! \+)/g)) assert.equal(key in t, true, key);
  for (const [, prefix] of body.matchAll(/\bT\('(\w+_)' \+/g)) {
    assert.equal(Object.keys(t).some((k) => k.startsWith(prefix)), true, prefix);
  }
  const quoted = [...body.matchAll(/'([^'\n]*)'/g)].map((m) => m[1]);
  const sentences = quoted.filter((s) => /^[A-Z][a-z]+ \w+ \w+/.test(s));
  assert.deepEqual(sentences, []);
});

test('every key in the table is used', () => {
  const code = read('app.js');
  const body = code.slice(code.indexOf('// ---------- small helpers')) + read('share.js');
  for (const key of Object.keys(t)) {
    const direct = body.includes(`'${key}'`);
    const built = /^(st|sms)_/.test(key) && body.includes(`T('${key.split('_')[0]}_' +`);
    assert.equal(direct || built, true, key);
  }
});

test('every file the page loads carries the current version', () => {
  const html = read('index.html');
  assert.equal(/data-version="([^"]+)"/.exec(html)[1], VERSION);
  const refs = [];
  for (const [, url] of html.matchAll(/(?:src|href)="([^"]+)"/g)) refs.push(['index.html', url]);
  for (const file of ['app.js', 'store.js', 'parse.js', 'share.js']) {
    for (const [, url] of read(file).matchAll(/from '(\.[^']+)'/g)) refs.push([file, url]);
  }
  assert.equal(refs.length >= 5, true);
  for (const [file, url] of refs) {
    if (url.startsWith('data:')) continue; // nothing is fetched for these
    assert.equal(url.endsWith('?v=' + VERSION), true, `${file} loads ${url} without ?v=${VERSION}`);
    assert.equal(/^(?:[a-z]+:)?\/\//.test(url) || url.startsWith('/'), false, `${file}: ${url} is not relative`);
  }
});
