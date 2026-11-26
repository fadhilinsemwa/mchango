import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildShare, whatsappLink, PART_SIZE } from '../share.js';
import { t } from '../app.js';

const words = (col) => (key, blanks = {}) => t[key][col].replace(/\{(\w+)\}/g, (_, k) => String(blanks[k]));
const SW = words(0);
const EN = words(1);

let n = 0;
const person = (name, pledge, more = {}) => ({
  id: 'p' + ++n, eventId: 'e1', name, phone: '255700000901', pledge, removed: false,
  createdAt: `2026-11-01T10:00:00+03:00`, ...more,
});
const pay = (who, amount, minute, more = {}) => ({
  id: 'y' + ++n, eventId: 'e1', personId: who.id, amount, method: 'cash', network: null, txId: null,
  paidAt: `2026-11-02T10:${String(minute).padStart(2, '0')}:00+03:00`, undone: false,
  createdAt: '2026-11-02T10:00:00+03:00', ...more,
});
const event = { id: 'e1', name: 'Harusi ya Zawadi na Tumaini', target: 5000000 };

function wedding() {
  const furaha = person('Furaha Amani', 100000);
  const upendo = person('Upendo Faraja', 100000);
  const amani = person('Amani Tumaini', 200000);
  const zawadi = person('Zawadi Tumaini', 2800000);
  const gone = person('Faraja Zawadi', 900000, { removed: true });
  return {
    event,
    people: [zawadi, amani, upendo, furaha, gone],
    payments: [
      pay(furaha, 60000, 1), pay(upendo, 50000, 2), pay(amani, 200000, 3), pay(furaha, 40000, 4),
      pay(zawadi, 999999, 5, { undone: true }), pay(gone, 77777, 6),
    ],
  };
}

test('the default text: totals, then who has paid, in the order the money came in', () => {
  assert.deepEqual(buildShare(wedding(), {}, SW), [
    [
      '*Harusi ya Zawadi na Tumaini*',
      'Lengo: TZS 5,000,000',
      'Ahadi: TZS 3,200,000',
      'Zimelipwa: TZS 350,000',
      'Bado: TZS 2,850,000',
      '',
      'Waliolipa (3):',
      '1. Furaha Amani — 100,000 ✅',
      '2. Upendo Faraja — 50,000 (bado 50,000)',
      '3. Amani Tumaini — 200,000 ✅',
      '',
      'Imetengenezwa bure na mchango.tov.co.tz',
    ].join('\n'),
  ]);
});

test('with amounts off, the lines are names only', () => {
  const [text] = buildShare(wedding(), { amounts: false }, SW);
  assert.deepEqual(text.split('\n').slice(6, 10), [
    'Waliolipa (3):', '1. Furaha Amani', '2. Upendo Faraja', '3. Amani Tumaini',
  ]);
});

test('the second choice lists who still owes', () => {
  const [text] = buildShare(wedding(), { who: 'owing' }, SW);
  assert.deepEqual(text.split('\n').slice(6, 9), [
    'Bado (2):', '1. Zawadi Tumaini — bado 2,800,000', '2. Upendo Faraja — bado 50,000',
  ]);
  const [bare] = buildShare(wedding(), { who: 'owing', amounts: false }, SW);
  assert.deepEqual(bare.split('\n').slice(6, 9), ['Bado (2):', '1. Zawadi Tumaini', '2. Upendo Faraja']);
});

test('a phone number, a removed person and an undone payment never appear', () => {
  for (const options of [{}, { who: 'owing' }, { amounts: false }]) {
    const text = buildShare(wedding(), options, SW).join('\n');
    assert.equal(/255|0700/.test(text), false);
    assert.equal(text.includes('Faraja Zawadi'), false);
    assert.equal(/999,999|77,777/.test(text), false);
  }
});

test('no target: the Lengo line is left out', () => {
  const data = wedding();
  const [text] = buildShare({ ...data, event: { ...event, target: null } }, {}, SW);
  assert.equal(text.split('\n')[1], 'Ahadi: TZS 3,200,000');
});

test('nobody has paid yet: the text still makes sense', () => {
  const [text] = buildShare({ event, people: [person('Amani', 5000)], payments: [] }, {}, SW);
  assert.equal(text, [
    '*Harusi ya Zawadi na Tumaini*', 'Lengo: TZS 5,000,000', 'Ahadi: TZS 5,000', 'Zimelipwa: TZS 0',
    'Bado: TZS 5,000', '', 'Waliolipa (0):', '', 'Imetengenezwa bure na mchango.tov.co.tz',
  ].join('\n'));
});

test('someone who paid more than they pledged, or pledged nothing, gets the tick', () => {
  const amani = person('Amani', 10000);
  const walkIn = person('Tumaini', 0);
  const [text] = buildShare({ event, people: [amani, walkIn], payments: [pay(amani, 15000, 1), pay(walkIn, 5000, 2)] }, {}, SW);
  assert.match(text, /1\. Amani — 15,000 ✅\n2\. Tumaini — 5,000 ✅/);
});

function crowd(size) {
  const people = Array.from({ length: size }, (_, i) => person('Mtu ' + String(i + 1).padStart(3, '0'), 1000));
  return { event, people, payments: people.map((p, i) => pay(p, 1000, i % 60, { paidAt: `2026-11-02T${String(10 + Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00+03:00` })) };
}

test('40 people fit in one text; 41 are split into two parts', () => {
  assert.equal(PART_SIZE, 40);
  assert.equal(buildShare(crowd(40), {}, SW).length, 1);
  const parts = buildShare(crowd(41), {}, SW);
  assert.equal(parts.length, 2);
  const [one, two] = parts.map((p) => p.split('\n'));
  assert.equal(one[0], '*Harusi ya Zawadi na Tumaini* (1/2)');
  assert.equal(two[0], '*Harusi ya Zawadi na Tumaini* (2/2)');
  assert.equal(one[6], 'Waliolipa (41):');
  assert.equal(one.at(-1), '40. Mtu 040 — 1,000 ✅');
  assert.deepEqual(two, ['*Harusi ya Zawadi na Tumaini* (2/2)', '41. Mtu 041 — 1,000 ✅', '', 'Imetengenezwa bure na mchango.tov.co.tz']);
});

test('totals are in part 1 only, the closing line in the last part only', () => {
  const parts = buildShare(crowd(81), {}, SW);
  assert.equal(parts.length, 3);
  assert.deepEqual(parts.map((p) => p.includes('Zimelipwa:')), [true, false, false]);
  assert.deepEqual(parts.map((p) => p.includes('mchango.tov.co.tz')), [false, false, true]);
  assert.equal(parts[2].split('\n')[1], '81. Mtu 081 — 1,000 ✅');
});

test('a star or a line break in the list name cannot break the bold title', () => {
  const [text] = buildShare({ event: { ...event, name: 'Harusi *kubwa*\nya Zawadi' }, people: [], payments: [] }, {}, SW);
  assert.equal(text.split('\n')[0], '*Harusi kubwa ya Zawadi*');
});

test('the text follows the language of the page', () => {
  const [text] = buildShare(wedding(), {}, EN);
  assert.deepEqual(text.split('\n'), [
    '*Harusi ya Zawadi na Tumaini*',
    'Target: TZS 5,000,000',
    'Pledged: TZS 3,200,000',
    'Paid in: TZS 350,000',
    'Still owed: TZS 2,850,000',
    '',
    'Paid (3):',
    '1. Furaha Amani — 100,000 ✅',
    '2. Upendo Faraja — 50,000 (50,000 to go)',
    '3. Amani Tumaini — 200,000 ✅',
    '',
    'Made free with mchango.tov.co.tz',
  ]);
});

test('the WhatsApp address carries the whole text, encoded', () => {
  const [text] = buildShare(wedding(), {}, SW);
  const url = new URL(whatsappLink(text));
  assert.equal(url.origin + url.pathname, 'https://wa.me/');
  assert.equal(url.searchParams.get('text'), text);
});
