import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eatIso, smsTimeIso } from '../parse.js';

// These tests run under three machine time zones (see tests/run.mjs).
// The answers must be the same in all of them.

test('eatIso gives East Africa Time whatever zone the machine is in', () => {
  assert.equal(eatIso(0), '1970-01-01T03:00:00+03:00');
  assert.equal(eatIso(Date.UTC(2026, 10, 26, 9, 5, 7)), '2026-11-26T12:05:07+03:00');
});

test('eatIso rolls over to the next day, month and year at 21:00 UTC', () => {
  assert.equal(eatIso(Date.UTC(2026, 8, 30, 22, 30, 0)), '2026-10-01T01:30:00+03:00');
  assert.equal(eatIso(Date.UTC(2026, 11, 31, 21, 0, 0)), '2027-01-01T00:00:00+03:00');
  assert.equal(eatIso(Date.UTC(2026, 11, 31, 20, 59, 59)), '2026-12-31T23:59:59+03:00');
});

test('an SMS time is read as written', () => {
  assert.equal(smsTimeIso(17, 9, 26, 2, 14, 'PM'), '2026-09-17T14:14:00+03:00');
  assert.equal(smsTimeIso('1', '10', '26', '1', '30', 'AM'), '2026-10-01T01:30:00+03:00');
  assert.equal(smsTimeIso(9, 11, 26, 5, 13, 'pm'), '2026-11-09T17:13:00+03:00');
});

test('12 AM is midnight and 12 PM is noon', () => {
  assert.equal(smsTimeIso(2, 10, 26, 12, 15, 'AM'), '2026-10-02T00:15:00+03:00');
  assert.equal(smsTimeIso(2, 10, 26, 12, 15, 'PM'), '2026-10-02T12:15:00+03:00');
  assert.equal(smsTimeIso(2, 10, 26, 11, 59, 'PM'), '2026-10-02T23:59:00+03:00');
});

test('an impossible date or time is refused', () => {
  assert.equal(smsTimeIso(31, 2, 26, 6, 10, 'PM'), null);
  assert.equal(smsTimeIso(29, 2, 26, 6, 10, 'PM'), null); // 2026 is not a leap year
  assert.equal(smsTimeIso(31, 4, 26, 6, 10, 'PM'), null);
  assert.equal(smsTimeIso(0, 5, 26, 6, 10, 'PM'), null);
  assert.equal(smsTimeIso(1, 13, 26, 6, 10, 'PM'), null);
  assert.equal(smsTimeIso(1, 5, 26, 13, 10, 'PM'), null);
  assert.equal(smsTimeIso(1, 5, 26, 0, 10, 'AM'), null);
  assert.equal(smsTimeIso(1, 5, 26, 6, 60, 'PM'), null);
  assert.equal(smsTimeIso(1, 5, 26, 6, 10, 'XM'), null);
});

test('29 February exists in a leap year', () => {
  assert.equal(smsTimeIso(29, 2, 28, 6, 10, 'PM'), '2028-02-29T18:10:00+03:00');
});
