// store.js — the list itself: the arithmetic (pure, tested with node) and the
// saving on this phone (IndexedDB). Nothing here talks to a server.

import { MAX_AMOUNT, MAX_NAME, eatIso, normPhone } from './parse.js?v=1.1.0';
import { withNewIds } from './backup.js?v=1.1.0';

// ---------- arithmetic (pure) ----------

export const normName = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();

/** Always a word, never a colour alone. */
export function statusOf(pledge, paid) {
  if (paid <= 0) return 'bado';
  return paid < pledge ? 'sehemu' : 'amemaliza';
}

const RANK = { bado: 0, sehemu: 1, amemaliza: 2 };

/**
 * Totals and one row per person.
 * Removed people and undone payments are left out of every sum.
 * Paying more than the pledge never reduces what the others still owe.
 */
export function summarise(people, payments) {
  const paidBy = new Map();
  for (const pay of payments) {
    if (pay.undone) continue;
    paidBy.set(pay.personId, (paidBy.get(pay.personId) ?? 0) + pay.amount);
  }
  let pledged = 0;
  let paid = 0;
  let owed = 0;
  const rows = [];
  for (const person of people) {
    if (person.removed) continue;
    const got = paidBy.get(person.id) ?? 0;
    const owes = Math.max(person.pledge - got, 0);
    pledged += person.pledge;
    paid += got;
    owed += owes;
    rows.push({
      person,
      paid: got,
      owes,
      extra: Math.max(got - person.pledge, 0),
      status: statusOf(person.pledge, got),
    });
  }
  rows.sort(
    (a, b) =>
      RANK[a.status] - RANK[b.status] ||
      normName(a.person.name).localeCompare(normName(b.person.name)) ||
      a.person.createdAt.localeCompare(b.person.createdAt),
  );
  return { pledged, paid, owed, rows };
}

/**
 * Who sent this payment? Order: same phone -> same name -> a suggestion when every
 * word of the shorter name is in the longer one. Only `how: 'phone'` may be
 * pre-selected on screen; the treasurer always confirms.
 */
export function matchPayer(people, { phone, name }) {
  const live = people.filter((p) => !p.removed);
  if (phone) {
    const byPhone = live.filter((p) => p.phone === phone);
    if (byPhone.length === 1) return { how: 'phone', personId: byPhone[0].id, suggestions: [] };
  }
  const wanted = normName(name ?? '');
  if (wanted === '') return { how: null, personId: null, suggestions: [] };
  const exact = live.filter((p) => normName(p.name) === wanted);
  if (exact.length === 1) return { how: 'name', personId: exact[0].id, suggestions: [] };
  if (exact.length > 1) return { how: null, personId: null, suggestions: exact.map((p) => p.id) };
  const words = wanted.split(' ');
  const suggestions = live
    .filter((p) => {
      const theirs = normName(p.name).split(' ');
      const [short, long] = theirs.length <= words.length ? [theirs, words] : [words, theirs];
      return short.every((w) => long.includes(w));
    })
    .map((p) => p.id);
  return { how: null, personId: null, suggestions };
}

export const validAmount = (n) => Number.isInteger(n) && n >= 1 && n <= MAX_AMOUNT;
export const validPledge = (n) => Number.isInteger(n) && n >= 0 && n <= MAX_AMOUNT;
export const validName = (s) => typeof s === 'string' && s.trim().length >= 1 && s.trim().length <= MAX_NAME;

/** Digits typed by hand ("50,000", "50 000") -> 50000, or null. */
export function typedAmount(text) {
  const s = String(text).replace(/[\s,]/g, '');
  return /^\d{1,10}$/.test(s) ? Number(s) : null;
}

/**
 * Should this payment be saved, given the payments this list already holds?
 *  - the same id again (a double tap, a retry) -> nothing happens
 *  - a transaction ID that is already recorded and not undone -> refused as a duplicate
 */
export function checkNewPayment(existing, payment) {
  if (existing.some((p) => p.id === payment.id)) return { action: 'nothing' };
  if (payment.txId) {
    const dup = existing.find((p) => !p.undone && p.txId === payment.txId);
    if (dup) return { action: 'duplicate', dup };
  }
  return { action: 'save' };
}

// ---------- saving on this phone (IndexedDB) ----------

export const DB_NAME = 'mchango';
const DB_VERSION = 1;
let dbPromise = null;

const uuid = () => crypto.randomUUID();
const done = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('aborted'));
  });
const ask = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

/** hooks.onBlocked: other tabs must close. hooks.onVersionChange: this tab must reload. */
export function openDb(hooks = {}) {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined' || indexedDB === null) {
      reject(new Error('no-indexeddb'));
      return;
    }
    let request;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(err);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('events')) db.createObjectStore('events', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('people')) {
        db.createObjectStore('people', { keyPath: 'id' }).createIndex('eventId', 'eventId');
      }
      if (!db.objectStoreNames.contains('payments')) {
        const pay = db.createObjectStore('payments', { keyPath: 'id' });
        pay.createIndex('eventId', 'eventId');
        pay.createIndex('eventTx', ['eventId', 'txId']);
      }
    };
    request.onblocked = () => hooks.onBlocked?.();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        hooks.onVersionChange?.();
      };
      resolve(db);
    };
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

async function stores(mode, ...names) {
  const db = await openDb();
  const tx = db.transaction(names, mode);
  return { tx, s: Object.fromEntries(names.map((n) => [n, tx.objectStore(n)])) };
}

/** Every change counts towards the "save a copy" reminder. */
async function bump(s, eventId, by = 1) {
  const event = await ask(s.events.get(eventId));
  if (!event) throw new Error('no-event');
  event.changesSinceBackup = (event.changesSinceBackup ?? 0) + by;
  event.lastChangeAt = eatIso(Date.now());
  s.events.put(event);
}

export async function loadEvent(eventId) {
  const { s } = await stores('readonly', 'events', 'people', 'payments');
  const [event, people, payments] = await Promise.all([
    ask(s.events.get(eventId)),
    ask(s.people.index('eventId').getAll(eventId)),
    ask(s.payments.index('eventId').getAll(eventId)),
  ]);
  if (!event) return null;
  return { event, people, payments };
}

export async function listEvents() {
  const { s } = await stores('readonly', 'events', 'people', 'payments');
  const [events, people, payments] = await Promise.all([
    ask(s.events.getAll()),
    ask(s.people.getAll()),
    ask(s.payments.getAll()),
  ]);
  return events
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((event) => ({
      event,
      totals: summarise(
        people.filter((p) => p.eventId === event.id),
        payments.filter((p) => p.eventId === event.id),
      ),
    }));
}

export async function createEvent({ name, target }) {
  const event = {
    id: uuid(),
    name: name.trim(),
    target: target ?? null,
    createdAt: eatIso(Date.now()),
    lastBackupAt: null,
    changesSinceBackup: 0,
  };
  const { tx, s } = await stores('readwrite', 'events');
  s.events.put(event);
  await done(tx);
  return event;
}

export async function updateEvent(eventId, { name, target }) {
  const { tx, s } = await stores('readwrite', 'events');
  const event = await ask(s.events.get(eventId));
  if (!event) throw new Error('no-event');
  event.name = name.trim();
  event.target = target ?? null;
  s.events.put(event);
  await done(tx);
}

/** Only deleting a whole list destroys data. */
export async function deleteEvent(eventId) {
  const { tx, s } = await stores('readwrite', 'events', 'people', 'payments');
  for (const store of [s.people, s.payments]) {
    const keys = await ask(store.index('eventId').getAllKeys(eventId));
    for (const key of keys) store.delete(key);
  }
  s.events.delete(eventId);
  await done(tx);
}

export function newPerson(eventId, { name, phone, pledge }) {
  return {
    id: uuid(),
    eventId,
    name: name.replace(/\s+/g, ' ').trim(),
    phone: phone ? normPhone(phone) : null,
    pledge,
    removed: false,
    createdAt: eatIso(Date.now()),
  };
}

export async function addPeople(eventId, list) {
  const people = list.map((p) => newPerson(eventId, p));
  if (people.length === 0) return people;
  const { tx, s } = await stores('readwrite', 'events', 'people');
  for (const person of people) s.people.put(person);
  await bump(s, eventId, people.length);
  await done(tx);
  return people;
}

export async function updatePerson(personId, patch) {
  const { tx, s } = await stores('readwrite', 'events', 'people');
  const person = await ask(s.people.get(personId));
  if (!person) throw new Error('no-person');
  if ('name' in patch) person.name = patch.name.replace(/\s+/g, ' ').trim();
  if ('phone' in patch) person.phone = patch.phone ? normPhone(patch.phone) : null;
  if ('pledge' in patch) person.pledge = patch.pledge;
  if ('removed' in patch) person.removed = patch.removed;
  s.people.put(person);
  await bump(s, person.eventId);
  await done(tx);
}

/**
 * Save a payment. Returns { action: 'save' | 'nothing' | 'duplicate', dup? }.
 * `newPayer` (optional) adds the payer to the list in the same step.
 */
export async function savePayment(payment, newPayer = null) {
  const { tx, s } = await stores('readwrite', 'events', 'people', 'payments');
  const existing = await ask(s.payments.index('eventId').getAll(payment.eventId));
  const verdict = checkNewPayment(existing, payment);
  if (verdict.action === 'save') {
    if (newPayer) s.people.put(newPayer);
    s.payments.put(payment);
    await bump(s, payment.eventId, newPayer ? 2 : 1);
  }
  await done(tx);
  return verdict;
}

export function newPayment(id, eventId, personId, fields) {
  return {
    id,
    eventId,
    personId,
    amount: fields.amount,
    method: fields.method,
    network: fields.network ?? null,
    txId: fields.txId ?? null,
    paidAt: fields.paidAt ?? eatIso(Date.now()),
    undone: false,
    createdAt: eatIso(Date.now()),
  };
}

/** Undo or restore. Restoring is refused when the same transaction is recorded again meanwhile. */
export async function setUndone(paymentId, undone) {
  const { tx, s } = await stores('readwrite', 'events', 'payments');
  const payment = await ask(s.payments.get(paymentId));
  if (!payment) throw new Error('no-payment');
  let verdict = { action: 'save' };
  if (!undone && payment.txId) {
    const others = await ask(s.payments.index('eventId').getAll(payment.eventId));
    const dup = others.find((p) => p.id !== payment.id && !p.undone && p.txId === payment.txId);
    if (dup) verdict = { action: 'duplicate', dup };
  }
  if (verdict.action === 'save') {
    payment.undone = undone;
    s.payments.put(payment);
    await bump(s, payment.eventId);
  }
  await done(tx);
  return verdict;
}

// ---------- the copy (backup) ----------

/** A copy was saved just now: the reminder starts counting again. */
export async function markBackedUp(eventId, nowMs) {
  const { tx, s } = await stores('readwrite', 'events');
  const event = await ask(s.events.get(eventId));
  if (!event) throw new Error('no-event');
  event.lastBackupAt = eatIso(nowMs);
  event.changesSinceBackup = 0;
  s.events.put(event);
  await done(tx);
}

/**
 * Put a checked copy (see backup.js) on the phone, in ONE step: all of it or none of it.
 *  mode 'new'     : the list is not on this phone yet
 *  mode 'copy'    : it is; add the file beside it as a separate list (`rename` names it)
 *  mode 'replace' : it is; first keep the list that is here under the name `keepAs`,
 *                   then put the file in its place
 * People and payments always get new IDs, so a file can never land on top of
 * another list's records. Nothing is ever merged. Returns the ID of the opened list.
 */
export async function importList(data, mode, { rename = null, keepAs = null } = {}) {
  const { tx, s } = await stores('readwrite', 'events', 'people', 'payments');
  const here = await ask(s.events.get(data.event.id));
  if (mode === 'new' && here) throw new Error('already-here');
  if (mode === 'replace') {
    if (!here || !keepAs) throw new Error('nothing-to-replace');
    const [people, payments] = await Promise.all([
      ask(s.people.index('eventId').getAll(here.id)),
      ask(s.payments.index('eventId').getAll(here.id)),
    ]);
    const kept = withNewIds({ event: { ...here, name: keepAs }, people, payments }, uuid);
    s.events.put(kept.event);
    for (const p of kept.people) s.people.put(p);
    for (const y of kept.payments) s.payments.put(y);
    for (const p of people) s.people.delete(p.id);
    for (const y of payments) s.payments.delete(y.id);
  }
  const fresh = withNewIds(data, uuid, mode !== 'copy');
  // The file is the copy of this list: nothing has changed since it was saved.
  s.events.put({
    ...fresh.event,
    name: mode === 'copy' && rename ? rename : fresh.event.name,
    lastBackupAt: data.exportedAt,
    changesSinceBackup: 0,
  });
  for (const p of fresh.people) s.people.put(p);
  for (const y of fresh.payments) s.payments.put(y);
  await done(tx);
  return fresh.event.id;
}
