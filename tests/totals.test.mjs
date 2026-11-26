import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarise, statusOf, checkNewPayment, typedAmount, validAmount, validPledge } from '../store.js';

let n = 0;
const person = (name, pledge, more = {}) => ({
  id: 'p' + ++n, eventId: 'e1', name, phone: null, pledge, removed: false,
  createdAt: `2026-11-01T10:00:${String(n).padStart(2, '0')}+03:00`, ...more,
});
const pay = (who, amount, more = {}) => ({
  id: 'y' + ++n, eventId: 'e1', personId: who.id, amount, method: 'cash', network: null,
  txId: null, paidAt: '2026-11-02T10:00:00+03:00', undone: false, createdAt: '2026-11-02T10:00:00+03:00', ...more,
});

test('status is a word: bado, sehemu, amemaliza', () => {
  assert.equal(statusOf(50000, 0), 'bado');
  assert.equal(statusOf(50000, 1), 'sehemu');
  assert.equal(statusOf(50000, 49999), 'sehemu');
  assert.equal(statusOf(50000, 50000), 'amemaliza');
  assert.equal(statusOf(50000, 55000), 'amemaliza');
  assert.equal(statusOf(0, 0), 'bado');
  assert.equal(statusOf(0, 5000), 'amemaliza');
});

test('the worked example: pledged, paid in and still owed', () => {
  const furaha = person('Furaha Amani', 100000);
  const upendo = person('Upendo Faraja', 100000);
  const amani = person('Amani Tumaini', 200000);
  const zawadi = person('Zawadi Tumaini', 2800000);
  const got = summarise(
    [furaha, upendo, amani, zawadi],
    [pay(furaha, 60000), pay(furaha, 40000), pay(upendo, 50000), pay(amani, 200000)],
  );
  assert.equal(got.pledged, 3200000);
  assert.equal(got.paid, 350000);
  assert.equal(got.owed, 2850000);
  assert.deepEqual(got.rows.map((r) => [r.person.name, r.paid, r.owes, r.status]), [
    ['Zawadi Tumaini', 0, 2800000, 'bado'],
    ['Upendo Faraja', 50000, 50000, 'sehemu'],
    ['Amani Tumaini', 200000, 0, 'amemaliza'],
    ['Furaha Amani', 100000, 0, 'amemaliza'],
  ]);
});

test('paying more than the pledge is extra and never lowers what others owe', () => {
  const amani = person('Amani', 10000);
  const faraja = person('Faraja', 20000);
  const got = summarise([amani, faraja], [pay(amani, 15000)]);
  assert.equal(got.paid, 15000);
  assert.equal(got.owed, 20000); // not 15,000
  const row = got.rows.find((r) => r.person.id === amani.id);
  assert.equal(row.extra, 5000);
  assert.equal(row.owes, 0);
});

test('an undone payment is left out of every sum', () => {
  const amani = person('Amani', 10000);
  const got = summarise([amani], [pay(amani, 4000), pay(amani, 6000, { undone: true })]);
  assert.equal(got.paid, 4000);
  assert.equal(got.owed, 6000);
  assert.equal(got.rows[0].status, 'sehemu');
});

test('a removed person is left out of every sum and every row, with their payments', () => {
  const amani = person('Amani', 10000);
  const gone = person('Faraja', 50000, { removed: true });
  const got = summarise([amani, gone], [pay(amani, 10000), pay(gone, 30000)]);
  assert.equal(got.pledged, 10000);
  assert.equal(got.paid, 10000);
  assert.equal(got.owed, 0);
  assert.equal(got.rows.length, 1);
});

test('a payer added on the spot with pledge 0 counts as paid up', () => {
  const walkIn = person('Tumaini', 0);
  const got = summarise([walkIn], [pay(walkIn, 5000)]);
  assert.deepEqual([got.pledged, got.paid, got.owed], [0, 5000, 0]);
  assert.equal(got.rows[0].status, 'amemaliza');
  assert.equal(got.rows[0].extra, 5000);
});

test('an empty list sums to zero', () => {
  assert.deepEqual(summarise([], []), { pledged: 0, paid: 0, owed: 0, rows: [] });
});

test('saving the same payment twice does nothing (a double tap)', () => {
  const amani = person('Amani', 10000);
  const first = pay(amani, 5000);
  assert.deepEqual(checkNewPayment([], first), { action: 'save' });
  assert.deepEqual(checkNewPayment([first], { ...first }), { action: 'nothing' });
});

test('a transaction ID already recorded in this list is refused', () => {
  const amani = person('Amani', 10000);
  const first = pay(amani, 5000, { method: 'sms', txId: 'QM3RD8XKT5' });
  const again = pay(amani, 5000, { method: 'sms', txId: 'QM3RD8XKT5' });
  const got = checkNewPayment([first], again);
  assert.equal(got.action, 'duplicate');
  assert.equal(got.dup.id, first.id);
});

test('two cash payments are never duplicates of each other', () => {
  const amani = person('Amani', 10000);
  assert.deepEqual(checkNewPayment([pay(amani, 5000)], pay(amani, 5000)), { action: 'save' });
});

test('an undone SMS payment may be entered again (for the right person)', () => {
  const amani = person('Amani', 10000);
  const wrong = pay(amani, 5000, { method: 'sms', txId: 'QM3RD8XKT5', undone: true });
  const again = pay(amani, 5000, { method: 'sms', txId: 'QM3RD8XKT5' });
  assert.deepEqual(checkNewPayment([wrong], again), { action: 'save' });
});

test('amounts typed by hand: whole shillings within the limits', () => {
  assert.equal(typedAmount('50000'), 50000);
  assert.equal(typedAmount('50,000'), 50000);
  assert.equal(typedAmount(' 1 500 000 '), 1500000);
  for (const bad of ['', 'abc', '50.5', '-5', '5e3', '12345678901']) assert.equal(typedAmount(bad), null, bad);
  assert.equal(validAmount(1), true);
  assert.equal(validAmount(1000000000), true);
  for (const bad of [0, -1, 1000000001, 1.5, NaN, null, '5', 2 ** 53 + 1]) assert.equal(validAmount(bad), false);
  assert.equal(validPledge(0), true);
  assert.equal(validPledge(1000000001), false);
});
