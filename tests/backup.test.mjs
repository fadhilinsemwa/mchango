import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBackup, backupFileName, backupDue, checkBackup, withNewIds, nameWith, validIso, MAX_FILE_BYTES,
} from '../backup.js';
import { summarise } from '../store.js';

const NOW = Date.parse('2026-11-26T09:00:00+03:00');
const at = '2026-11-20T10:00:00+03:00';

function wedding() {
  const event = {
    id: 'e-1', name: 'Harusi ya Zawadi na Tumaini', target: 5000000, createdAt: at,
    lastBackupAt: null, changesSinceBackup: 4, lastChangeAt: '2026-11-25T18:00:00+03:00',
  };
  const person = (id, name, pledge, more = {}) => ({
    id, eventId: 'e-1', name, phone: null, pledge, removed: false, createdAt: at, ...more,
  });
  const pay = (id, personId, amount, more = {}) => ({
    id, eventId: 'e-1', personId, amount, method: 'cash', network: null, txId: null,
    paidAt: at, undone: false, createdAt: at, ...more,
  });
  return {
    event,
    people: [
      person('p-1', 'Furaha Amani', 100000, { phone: '255700000901' }),
      person('p-2', 'Upendo Faraja', 100000),
      person('p-3', 'Amani Tumaini', 200000, { removed: true }),
    ],
    payments: [
      pay('y-1', 'p-1', 100000, { method: 'sms', network: 'mpesa', txId: 'AB12CD34EF' }),
      pay('y-2', 'p-2', 50000),
      pay('y-3', 'p-2', 20000, { undone: true }),
    ],
  };
}
const fileOf = (list = wedding()) => buildBackup(list, NOW);
const textOf = (file) => JSON.stringify(file);
/** Spoil one thing in a good file and say why it must be refused. */
const refused = (spoil, reason) => {
  const file = fileOf();
  spoil(file);
  assert.deepEqual(checkBackup(textOf(file)), { ok: false, reason });
};

test('round trip: what is saved is what comes back', () => {
  const list = wedding();
  const got = checkBackup(textOf(buildBackup(list, NOW)));
  assert.equal(got.ok, true);
  assert.equal(got.data.exportedAt, '2026-11-26T09:00:00+03:00');
  assert.deepEqual(got.data.people, list.people);
  assert.deepEqual(got.data.payments, list.payments);
  assert.deepEqual(got.data.event, {
    id: 'e-1', name: 'Harusi ya Zawadi na Tumaini', target: 5000000, createdAt: at,
    lastChangeAt: '2026-11-25T18:00:00+03:00',
  });
  const before = summarise(list.people, list.payments);
  const after = summarise(got.data.people, got.data.payments);
  assert.deepEqual([after.pledged, after.paid, after.owed], [before.pledged, before.paid, before.owed]);
  assert.deepEqual([after.pledged, after.paid, after.owed], [200000, 150000, 50000]);
});

test('the file is a .txt named after the list and the East Africa date', () => {
  assert.equal(backupFileName({ name: 'Harusi ya Zawadi na Tumaini' }, NOW), 'mchango-harusi-ya-zawadi-na-tumaini-2026-11-26.txt');
  // 23:30 in London on the 25th is already the 26th in Dar es Salaam.
  assert.equal(backupFileName({ name: 'Msiba' }, Date.parse('2026-11-25T23:30:00Z')), 'mchango-msiba-2026-11-26.txt');
  assert.equal(backupFileName({ name: '../../<x>' }, NOW), 'mchango-x-2026-11-26.txt');
  assert.equal(backupFileName({ name: '***' }, NOW), 'mchango-orodha-2026-11-26.txt');
});

test('a file from a newer version is refused, an older one is read', () => {
  refused((f) => { f.schema = 2; }, 'schema');
  refused((f) => { f.schema = 0; }, 'app');
  refused((f) => { f.schema = '1'; }, 'app');
  refused((f) => { f.app = 'other'; }, 'app');
});

test('a corrupt file is refused', () => {
  const half = textOf(fileOf()).slice(0, 200);
  assert.deepEqual(checkBackup(half), { ok: false, reason: 'parse' });
  assert.deepEqual(checkBackup(''), { ok: false, reason: 'parse' });
  assert.deepEqual(checkBackup(undefined), { ok: false, reason: 'parse' });
  assert.deepEqual(checkBackup('null'), { ok: false, reason: 'app' });
  assert.deepEqual(checkBackup('[]'), { ok: false, reason: 'app' });
  refused((f) => { delete f.people; }, 'shape');
  refused((f) => { f.payments = {}; }, 'shape');
  refused((f) => { f.event = null; }, 'shape');
  refused((f) => { f.people[0] = null; }, 'shape');
  refused((f) => { f.people[0].removed = 'no'; }, 'shape');
  refused((f) => { f.payments[0].undone = 0; }, 'shape');
  refused((f) => { f.people[0].id = 7; }, 'shape');
  refused((f) => { f.event.id = 'a b'; }, 'shape');
});

test('an oversize file is refused before it is read', () => {
  const big = textOf({ ...fileOf(), filler: 'x'.repeat(MAX_FILE_BYTES) });
  assert.deepEqual(checkBackup(big), { ok: false, reason: 'big' });
  // Counted in bytes, not letters: 700,000 three-byte letters are over 2 MB.
  assert.deepEqual(checkBackup(textOf({ ...fileOf(), filler: '€'.repeat(700000) })), { ok: false, reason: 'big' });
});

test('an orphan payment is refused: its person is not in the file', () => {
  refused((f) => { f.payments[1].personId = 'p-99'; }, 'ref');
  refused((f) => { f.people.splice(1, 1); }, 'ref');
});

test('a wrong eventId is refused, on a person and on a payment', () => {
  refused((f) => { f.people[0].eventId = 'e-2'; }, 'ref');
  refused((f) => { f.payments[0].eventId = 'e-2'; }, 'ref');
  refused((f) => { delete f.payments[0].eventId; }, 'ref');
});

test('amounts: 0, a fraction, a number too big to be whole, a negative pledge', () => {
  refused((f) => { f.payments[0].amount = 0; }, 'amount');
  refused((f) => { f.payments[0].amount = 1000.5; }, 'amount');
  refused((f) => { f.payments[0].amount = '1000'; }, 'amount');
  refused((f) => { f.payments[0].amount = 1000000001; }, 'amount');
  refused((f) => { f.people[0].pledge = -1; }, 'amount');
  refused((f) => { f.people[0].pledge = null; }, 'amount');
  refused((f) => { f.event.target = 0; }, 'amount');
  // 2^53 + 1 cannot be held exactly; it must not slip in as some other number.
  const text = textOf(fileOf()).replace('"amount":50000', '"amount":9007199254740993');
  assert.deepEqual(checkBackup(text), { ok: false, reason: 'amount' });
  const ok = fileOf();
  ok.people[0].pledge = 0;
  ok.payments[0].amount = 1000000000;
  ok.event.target = null;
  assert.equal(checkBackup(textOf(ok)).ok, true);
});

test('duplicate ids are refused, also across people and payments', () => {
  refused((f) => { f.people[1].id = 'p-1'; }, 'ids');
  refused((f) => { f.payments[2].id = 'y-1'; }, 'ids');
  refused((f) => { f.payments[2].id = 'p-1'; }, 'ids');
  refused((f) => { f.people[0].id = 'e-1'; }, 'ids');
});

test('names: empty, too long, or holding a line break or control character', () => {
  refused((f) => { f.people[0].name = ''; }, 'name');
  refused((f) => { f.people[0].name = '   '; }, 'name');
  refused((f) => { f.people[0].name = 'x'.repeat(81); }, 'name');
  refused((f) => { f.people[0].name = 'Furaha\nAmani — 900,000 ✅'; }, 'name');
  refused((f) => { f.people[0].name = 'Furaha\u0007'; }, 'name');
  refused((f) => { f.people[0].name = 'Furaha\u2028Amani'; }, 'name');
  refused((f) => { f.people[0].name = 12; }, 'name');
  refused((f) => { f.event.name = 'Harusi\r\nMsiba'; }, 'name');
  const ok = fileOf();
  ok.people[0].name = 'x'.repeat(80);
  assert.equal(checkBackup(textOf(ok)).ok, true);
});

test('a name that looks like HTML is kept as the text it is', () => {
  const file = fileOf();
  file.people[0].name = '<img src=x onerror="alert(1)">';
  const got = checkBackup(textOf(file));
  assert.equal(got.ok, true);
  assert.equal(got.data.people[0].name, '<img src=x onerror="alert(1)">');
});

test('phones, kinds of payment and dates must be ones we know', () => {
  refused((f) => { f.people[0].phone = '0700000901'; }, 'phone');
  refused((f) => { f.people[0].phone = '255800000901'; }, 'phone');
  refused((f) => { f.people[0].phone = 255700000901; }, 'phone');
  refused((f) => { f.payments[0].method = 'card'; }, 'kind');
  refused((f) => { f.payments[0].network = 'bank'; }, 'kind');
  refused((f) => { f.payments[0].txId = '<b>'; }, 'kind');
  refused((f) => { f.payments[0].paidAt = '2026-02-31T10:00:00+03:00'; }, 'date');
  refused((f) => { f.payments[0].paidAt = 'yesterday'; }, 'date');
  refused((f) => { f.payments[0].createdAt = '2026-11-20T10:00:00Z'; }, 'date');
  refused((f) => { f.people[0].createdAt = null; }, 'date');
  refused((f) => { f.event.createdAt = '2026-11-20'; }, 'date');
  refused((f) => { f.exportedAt = 1; }, 'date');
  refused((f) => { f.event.lastChangeAt = '2026-13-01T10:00:00+03:00'; }, 'date');
  assert.equal(validIso('2028-02-29T23:59:59+03:00'), true);
  assert.equal(validIso('2027-02-29T23:59:59+03:00'), false);
  assert.equal(validIso('2026-11-20T24:00:00+03:00'), false);
});

test('fields we do not know are dropped, never carried onto the phone', () => {
  const file = fileOf();
  file.people[0].__proto__ = { evil: 1 };
  file.people[0].note = 'x';
  file.payments[0].extra = { a: 1 };
  file.event.html = '<script>';
  const got = checkBackup(textOf(file));
  assert.equal(got.ok, true);
  assert.deepEqual(Object.keys(got.data.people[0]), ['id', 'eventId', 'name', 'phone', 'pledge', 'removed', 'createdAt']);
  assert.deepEqual(Object.keys(got.data.payments[0]).includes('extra'), false);
  assert.deepEqual(Object.keys(got.data.event), ['id', 'name', 'target', 'createdAt', 'lastChangeAt']);
});

test('id clash: the copy gets new ids everywhere and still adds up', () => {
  const { data } = checkBackup(textOf(fileOf()));
  let n = 0;
  const copy = withNewIds(data, () => 'new-' + ++n);
  const oldIds = new Set([data.event, ...data.people, ...data.payments].map((x) => x.id));
  const newIds = [copy.event, ...copy.people, ...copy.payments].map((x) => x.id);
  assert.equal(new Set(newIds).size, 7);
  assert.equal(newIds.some((id) => oldIds.has(id)), false);
  assert.equal(copy.people.every((p) => p.eventId === copy.event.id), true);
  assert.equal(copy.payments.every((y) => y.eventId === copy.event.id), true);
  // each payment still points at the same person, under that person's new id
  const nameOf = (list, y) => list.people.find((p) => p.id === y.personId).name;
  assert.deepEqual(copy.payments.map((y) => nameOf(copy, y)), data.payments.map((y) => nameOf(data, y)));
  const a = summarise(data.people, data.payments);
  const b = summarise(copy.people, copy.payments);
  assert.deepEqual([b.pledged, b.paid, b.owed], [a.pledged, a.paid, a.owed]);
  // the file's own data is left as it was
  assert.equal(data.event.id, 'e-1');
  assert.equal(data.payments[0].personId, 'p-1');
});

test('replace: the list keeps its id, people and payments still get new ones', () => {
  const { data } = checkBackup(textOf(fileOf()));
  let n = 0;
  const copy = withNewIds(data, () => 'new-' + ++n, true);
  assert.equal(copy.event.id, 'e-1');
  assert.equal(copy.people.some((p) => p.id.startsWith('p-')), false);
  assert.equal(copy.payments.some((y) => y.id.startsWith('y-')), false);
  assert.equal(copy.people.every((p) => p.eventId === 'e-1'), true);
});

test('replace keeps a copy: its name says so and never passes 80 characters', () => {
  assert.equal(nameWith('Harusi ya Zawadi', '(kabla ya kubadilisha)'), 'Harusi ya Zawadi (kabla ya kubadilisha)');
  const long = nameWith('x'.repeat(80), '(kabla ya kubadilisha)');
  assert.equal(long.length, 80);
  assert.equal(long.endsWith(' (kabla ya kubadilisha)'), true);
});

test('the reminder: never saved, 10 changes, or 3 days with a change', () => {
  const last = '2026-11-25T09:00:00+03:00'; // one day before NOW
  assert.equal(backupDue({ lastBackupAt: null, changesSinceBackup: 0 }, NOW), null);
  assert.equal(backupDue({ lastBackupAt: null, changesSinceBackup: 1 }, NOW), 'never');
  assert.equal(backupDue({ lastBackupAt: last, changesSinceBackup: 9 }, NOW), null);
  assert.equal(backupDue({ lastBackupAt: last, changesSinceBackup: 10 }, NOW), 'changes');
  const old = '2026-11-23T09:00:00+03:00'; // exactly three days before NOW
  assert.equal(backupDue({ lastBackupAt: old, changesSinceBackup: 1 }, NOW), 'days');
  assert.equal(backupDue({ lastBackupAt: old, changesSinceBackup: 0 }, NOW), null);
  assert.equal(backupDue({ lastBackupAt: old, changesSinceBackup: 1 }, NOW - 1000), null);
});
