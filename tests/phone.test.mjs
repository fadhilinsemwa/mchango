import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normPhone, fmt } from '../parse.js';

test('every 06x and 07x prefix is stored as 255…', () => {
  for (const lead of ['6', '7']) {
    for (let second = 0; second <= 9; second++) {
      const local = `0${lead}${second}0000901`;
      assert.equal(normPhone(local), `255${lead}${second}0000901`, local);
    }
  }
});

test('the same number written five ways gives one stored form', () => {
  const want = '255700000901';
  for (const typed of [
    '0700000901',
    '255700000901',
    '+255700000901',
    '0700 000 901',
    '+255 700-000-901',
    ' 0700-000-901 ',
  ]) {
    assert.equal(normPhone(typed), want, typed);
  }
});

test('anything that is not a Tanzanian mobile number is kept out', () => {
  for (const typed of [
    '',
    '0700',
    '070000090', // one digit short
    '07000009011', // one digit long
    '0800000901', // not 06 or 07
    '0222000901', // landline
    '700000901', // no leading 0 or 255
    '256700000901', // another country
    '+2550700000901', // 255 and 0 together
    '07000009O1', // letter O
    'Zawadi',
    '0700.000.901',
  ]) {
    assert.equal(normPhone(typed), null, JSON.stringify(typed));
  }
  assert.equal(normPhone(null), null);
  assert.equal(normPhone(undefined), null);
  assert.equal(normPhone(700000901), null);
});

test('money is grouped in threes', () => {
  assert.equal(fmt(0), '0');
  assert.equal(fmt(500), '500');
  assert.equal(fmt(5000), '5,000');
  assert.equal(fmt(50000), '50,000');
  assert.equal(fmt(1450000), '1,450,000');
  assert.equal(fmt(1000000000), '1,000,000,000');
});
