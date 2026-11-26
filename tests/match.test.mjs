import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchPayer, normName } from '../store.js';

const P = (id, name, phone = null, removed = false) => ({ id, name, phone, removed });
const people = [
  P('a', 'Furaha Amani', '255700000901'),
  P('b', 'Upendo Faraja'),
  P('c', 'Amani Tumaini Zawadi'),
  P('d', 'Zawadi', '255700000904'),
  P('gone', 'Faraja Zawadi', '255700000909', true),
];

test('names are compared in lower case with single spaces', () => {
  assert.equal(normName('  FURAHA   Amani '), 'furaha amani');
});

test('the payer phone wins, whatever the name says', () => {
  assert.deepEqual(matchPayer(people, { phone: '255700000901', name: 'SOMEONE ELSE' }), {
    how: 'phone', personId: 'a', suggestions: [],
  });
});

test('no phone match: the exact name, ignoring case and spaces', () => {
  assert.deepEqual(matchPayer(people, { phone: '255700000999', name: 'UPENDO  FARAJA' }), {
    how: 'name', personId: 'b', suggestions: [],
  });
});

test('every word of the shorter name inside the longer one is only a suggestion', () => {
  assert.deepEqual(matchPayer(people, { phone: null, name: 'AMANI ZAWADI' }), {
    how: null, personId: null, suggestions: ['c', 'd'], // "Zawadi" alone is inside it too
  });
  assert.deepEqual(matchPayer(people, { phone: null, name: 'UPENDO TUMAINI FARAJA' }), {
    how: null, personId: null, suggestions: ['b'],
  });
});

test('one shared word is enough only when it is the whole shorter name', () => {
  // "Zawadi" (d) is fully inside the SMS name; "Amani Tumaini Zawadi" (c) is not.
  assert.deepEqual(matchPayer(people, { phone: null, name: 'ZAWADI FURAHA' }).suggestions, ['d']);
});

test('nothing in common: the treasurer picks', () => {
  assert.deepEqual(matchPayer(people, { phone: '255700000999', name: 'TUMAINI UPENDO' }), {
    how: null, personId: null, suggestions: [],
  });
});

test('a removed person is never matched or suggested', () => {
  const got = matchPayer(people, { phone: '255700000909', name: 'FARAJA ZAWADI' });
  assert.equal(got.how, null);
  assert.equal(got.personId, null);
  assert.equal(got.suggestions.includes('gone'), false);
  assert.deepEqual(got.suggestions, ['d']); // only the living "Zawadi"
});

test('two people with the same phone or the same name: no automatic choice', () => {
  const twins = [P('x', 'Amani', '255700000901'), P('y', 'Amani', '255700000901')];
  assert.deepEqual(matchPayer(twins, { phone: '255700000901', name: 'AMANI' }), {
    how: null, personId: null, suggestions: ['x', 'y'],
  });
});

test('no name and no phone gives nothing', () => {
  assert.deepEqual(matchPayer(people, { phone: null, name: '' }), { how: null, personId: null, suggestions: [] });
  assert.deepEqual(matchPayer(people, { phone: null }), { how: null, personId: null, suggestions: [] });
});
