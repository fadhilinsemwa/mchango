import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuick, parseQuickLine } from '../parse.js';

const good = (line, name, pledge) =>
  assert.deepEqual(parseQuickLine(line), { name, pledge }, line);
const bad = (line, why) => assert.deepEqual(parseQuickLine(line), { why }, line);

test('a name and an amount, written the usual ways', () => {
  good('Zawadi 50000', 'Zawadi', 50000);
  good('Zawadi 50,000', 'Zawadi', 50000);
  good('Zawadi 50 000', 'Zawadi', 50000);
  good('Zawadi 1 500 000', 'Zawadi', 1500000);
  good('Zawadi 1,500,000', 'Zawadi', 1500000);
  good('Zawadi 50k', 'Zawadi', 50000);
  good('Zawadi 50K', 'Zawadi', 50000);
  good('Zawadi Tumaini 100,000', 'Zawadi Tumaini', 100000);
});

test('a comma, a dash or a colon between name and amount is optional', () => {
  good('Furaha Amani, 50,000', 'Furaha Amani', 50000);
  good('Furaha Amani - 50 000', 'Furaha Amani', 50000);
  good('Furaha Amani — 50k', 'Furaha Amani', 50000);
  good('Furaha Amani: 50000', 'Furaha Amani', 50000);
  good('Furaha Amani-50000', 'Furaha Amani', 50000);
});

test('extra spaces and tabs do not matter', () => {
  good('   Upendo   Faraja \t 20,000  ', 'Upendo Faraja', 20000);
});

test('the longest ending that is an amount is the pledge', () => {
  good('Amani 2', 'Amani', 2);
  good('Amani 2 500', 'Amani', 2500);
  good('Amani 2 50 000', 'Amani 2', 50000); // "2 50 000" is not grouped in threes
  good('Amani 2026 50 000', 'Amani 2026', 50000);
  good('Zawadi-Tumaini 50k', 'Zawadi-Tumaini', 50000);
  good('Faraja 1000000000', 'Faraja', 1000000000);
});

test('a line with no amount is handed back', () => {
  bad('Zawadi', 'no_amount');
  bad('Zawadi Tumaini', 'no_amount');
  bad('Zawadi 50,00', 'no_amount'); // not grouped in threes
  bad('Zawadi 1,50,000', 'no_amount'); // mistyped: never read as "Zawadi 1" with 50,000
  bad('Zawadi 5,0000', 'no_amount');
  bad('Zawadi50000', 'no_amount'); // no gap: could be part of the name
  bad('Zawadi 50000 Tumaini', 'no_amount'); // the amount must end the line
  bad('Zawadi 1.5m', 'no_amount');
  bad('Zawadi 50.5k', 'no_amount');
});

test('a pledge of 0 is handed back', () => {
  bad('Zawadi 0', 'zero');
  bad('Zawadi 000', 'zero');
  bad('Zawadi 0k', 'zero');
});

test('an amount with no name is handed back', () => {
  bad('50000', 'no_name');
  bad('- 50,000', 'no_name');
  bad('1 500 000', 'no_name');
});

test('too much money or too long a name is handed back', () => {
  bad('Zawadi 1000000001', 'too_big');
  bad('Zawadi 99999999999999999999', 'too_big');
  bad('Zawadi 2000000k', 'too_big');
  good('Z'.repeat(80) + ' 500', 'Z'.repeat(80), 500);
  bad('Z'.repeat(81) + ' 500', 'long_name');
});

test('many lines: good ones are kept, the rest are listed, blank lines ignored', () => {
  const pasted = [
    'Zawadi Tumaini 100,000',
    '',
    'Furaha Amani - 50k',
    'Upendo',
    '   ',
    'Amani 0',
    'Faraja Zawadi 20 000\r',
  ].join('\n');
  assert.deepEqual(parseQuick(pasted), {
    people: [
      { name: 'Zawadi Tumaini', pledge: 100000 },
      { name: 'Furaha Amani', pledge: 50000 },
      { name: 'Faraja Zawadi', pledge: 20000 },
    ],
    unread: [
      { line: 'Upendo', why: 'no_amount' },
      { line: 'Amani 0', why: 'zero' },
    ],
  });
});

test('two people may share a name', () => {
  assert.equal(parseQuick('Amani 5000\nAmani 7000').people.length, 2);
});

test('nothing typed gives nothing', () => {
  assert.deepEqual(parseQuick(''), { people: [], unread: [] });
});
