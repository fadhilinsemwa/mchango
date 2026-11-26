// One version everywhere. Every script, style, manifest and icon address carries
// ?v=<VERSION>, in the page, in each import, in the manifest and in sw.js's list,
// so a cache can never pair a new page with old code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { VERSION } from '../app.js';

const root = new URL('../', import.meta.url);
const read = (name) => readFileSync(new URL(name, root), 'utf8');
const SCRIPTS = readdirSync(root).filter((f) => f.endsWith('.js') && f !== 'sw.js');
const swList = () => {
  const list = /const FILES = \[([^\]]+)\]/.exec(read('sw.js'))[1];
  return [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
};

/** Every address the page, the scripts and the manifest ask for: [where, address]. */
function references() {
  const refs = [];
  for (const [, url] of read('index.html').matchAll(/(?:src|href)="([^"]+)"/g)) refs.push(['index.html', url]);
  for (const file of SCRIPTS) {
    for (const [, url] of read(file).matchAll(/from '(\.[^']+)'/g)) refs.push([file, url]);
  }
  for (const icon of JSON.parse(read('manifest.webmanifest')).icons) refs.push(['manifest.webmanifest', icon.src]);
  return refs;
}

test('the page, sw.js and app.js name the same version', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(/data-version="([^"]+)"/.exec(read('index.html'))[1], VERSION);
  assert.equal(/const VERSION = '([^']+)'/.exec(read('sw.js'))[1], VERSION);
});

test('every file the page loads carries the current version and a relative address', () => {
  const refs = references();
  assert.equal(refs.length >= 12, true, `only ${refs.length} references found`);
  for (const [file, url] of refs) {
    assert.equal(url.endsWith('?v=' + VERSION), true, `${file} loads ${url} without ?v=${VERSION}`);
    assert.equal(/^(?:[a-z]+:)?\/\//.test(url) || url.startsWith('/'), false, `${file}: ${url} is not relative`);
    assert.equal(existsSync(new URL(url.split('?')[0], root)), true, `${file}: ${url} is not in the folder`);
  }
});

test("sw.js keeps exactly the files the page needs, each with the current version", () => {
  const list = swList();
  assert.deepEqual(list.slice(0, 2), ['./', 'index.html']); // the page itself has no ?v=: it is never cached by address
  const versioned = list.slice(2);
  for (const url of versioned) {
    assert.equal(url.endsWith('?v=' + VERSION), true, `sw.js keeps ${url} without ?v=${VERSION}`);
    assert.equal(existsSync(new URL(url.split('?')[0], root)), true, `sw.js keeps ${url}, which is not in the folder`);
  }
  assert.equal(new Set(list).size, list.length, 'a file is listed twice');
  // Nothing the page asks for may be missing from the list (it would fail with no network) ...
  const asked = new Set(references().map(([, url]) => url.replace(/^\.\//, '')));
  asked.add('manifest.webmanifest?v=' + VERSION);
  assert.deepEqual([...asked].sort(), [...versioned].sort());
  // ... and every script in the folder is one the page asks for.
  for (const file of SCRIPTS) assert.equal(versioned.includes(`${file}?v=${VERSION}`), true, `${file} is not kept by sw.js`);
});

test('the manifest opens the page from its own folder, with both icon sizes', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.name, 'Mchango ya tov');
  assert.equal(m.start_url, './');
  assert.equal(m.scope, './');
  assert.equal(m.display, 'standalone');
  assert.deepEqual(m.icons.map((i) => i.sizes), ['192x192', '512x512']);
  for (const icon of m.icons) {
    const png = readFileSync(new URL(icon.src.split('?')[0], root));
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes); // the real size of the picture
  }
});

test('the offline worker is registered so that the browser always asks the server for it afresh', () => {
  // The default (updateViaCache 'imports') makes the browser skip its cache for sw.js itself, so a cache
  // lifetime put on sw.js by a server or a CDN cannot hold a new version back. 'all' would undo that.
  const code = read('app.js');
  assert.match(code, /sw\.register\('sw\.js'\)/);
  assert.equal(/updateViaCache/.test(code), false);
});
