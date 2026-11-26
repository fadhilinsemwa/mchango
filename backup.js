// backup.js — the copy of one list as a file, and the checks on a file that comes back.
// Pure: no page, no storage. A file that is opened is NOT trusted: one thing wrong
// refuses the whole file, and nothing on the phone changes.

import { MAX_AMOUNT, MAX_NAME, eatIso } from './parse.js?v=1.1.3';

export const SCHEMA = 1;
export const MAX_FILE_BYTES = 2_000_000;
const METHODS = ['sms', 'cash'];
const NETWORKS = ['mpesa', 'mixx', 'airtel', 'halopesa', null];
const DAY_MS = 24 * 60 * 60 * 1000;

// ---------- making the copy ----------

export function buildBackup({ event, people, payments }, nowMs) {
  return { app: 'mchango', schema: SCHEMA, exportedAt: eatIso(nowMs), event, people, payments };
}

/** mchango-<list name>-<date>.txt — a .txt, because Android refuses to share .json files. */
export function backupFileName(event, nowMs) {
  const slug = event.name
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .toLowerCase();
  return `mchango-${slug || 'orodha'}-${eatIso(nowMs).slice(0, 10)}.txt`;
}

/**
 * Is it time to remind the treasurer to save a copy?
 * 'never'   : there is something to lose and no copy was ever saved
 * 'changes' : 10 changes or more since the last copy
 * 'days'    : 3 days or more since the last copy, and something changed since
 */
export function backupDue(event, nowMs) {
  const changes = event.changesSinceBackup ?? 0;
  if (changes === 0) return null;
  if (!event.lastBackupAt) return 'never';
  if (changes >= 10) return 'changes';
  return nowMs - Date.parse(event.lastBackupAt) >= 3 * DAY_MS ? 'days' : null;
}

// ---------- checking a file that is opened ----------

const isText = (v) => typeof v === 'string';
const isId = (v) => isText(v) && /^[A-Za-z0-9-]{1,64}$/.test(v);
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/; // also line breaks: one line per person

export function validIso(v) {
  const m = isText(v) && /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)\+03:00$/.exec(v);
  if (!m) return false;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const back = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d &&
    back.getUTCHours() === h && back.getUTCMinutes() === mi && back.getUTCSeconds() === s && y >= 2000;
}
const validName = (v) => isText(v) && v.trim().length >= 1 && v.length <= MAX_NAME && !CONTROL.test(v);
const wholeBetween = (v, low) => Number.isInteger(v) && v >= low && v <= MAX_AMOUNT;

/**
 * Check the text of a file. Returns { ok: true, data } with a clean copy that holds
 * only the fields we know, or { ok: false, reason }, with reason one of:
 * big, parse, app, schema, shape, ids, ref, name, phone, amount, kind, date.
 */
export function checkBackup(text) {
  const no = (reason) => ({ ok: false, reason });
  if (!isText(text)) return no('parse');
  if (new TextEncoder().encode(text).length >= MAX_FILE_BYTES) return no('big');
  let file;
  try {
    file = JSON.parse(text);
  } catch {
    return no('parse');
  }
  if (file === null || typeof file !== 'object' || file.app !== 'mchango') return no('app');
  if (!Number.isInteger(file.schema) || file.schema < 1) return no('app');
  if (file.schema > SCHEMA) return no('schema');
  const { event: e, people, payments } = file;
  if (e === null || typeof e !== 'object' || !Array.isArray(people) || !Array.isArray(payments)) return no('shape');
  if (![e, ...people, ...payments].every((x) => x !== null && typeof x === 'object' && isId(x.id))) return no('shape');

  const ids = [e, ...people, ...payments].map((x) => x.id);
  if (new Set(ids).size !== ids.length) return no('ids');

  if (!validName(e.name)) return no('name');
  if (e.target !== null && !wholeBetween(e.target, 1)) return no('amount');
  if (!validIso(file.exportedAt) || !validIso(e.createdAt)) return no('date');
  if (e.lastChangeAt !== undefined && !validIso(e.lastChangeAt)) return no('date');
  const event = { id: e.id, name: e.name, target: e.target, createdAt: e.createdAt };
  if (e.lastChangeAt) event.lastChangeAt = e.lastChangeAt;

  const cleanPeople = [];
  const known = new Set();
  for (const p of people) {
    if (p.eventId !== e.id) return no('ref'); // a person of some other list
    if (!validName(p.name)) return no('name');
    if (p.phone !== null && !(isText(p.phone) && /^255[67]\d{8}$/.test(p.phone))) return no('phone');
    if (!wholeBetween(p.pledge, 0)) return no('amount');
    if (typeof p.removed !== 'boolean') return no('shape');
    if (!validIso(p.createdAt)) return no('date');
    known.add(p.id);
    cleanPeople.push({
      id: p.id, eventId: p.eventId, name: p.name, phone: p.phone, pledge: p.pledge,
      removed: p.removed, createdAt: p.createdAt,
    });
  }

  const cleanPayments = [];
  for (const y of payments) {
    if (y.eventId !== e.id) return no('ref');
    if (!known.has(y.personId)) return no('ref'); // a payment that belongs to nobody in the file
    if (!wholeBetween(y.amount, 1)) return no('amount');
    if (!METHODS.includes(y.method) || !NETWORKS.includes(y.network)) return no('kind');
    if (y.txId !== null && !(isText(y.txId) && /^[A-Za-z0-9]{1,40}$/.test(y.txId))) return no('kind');
    if (typeof y.undone !== 'boolean') return no('shape');
    if (!validIso(y.paidAt) || !validIso(y.createdAt)) return no('date');
    cleanPayments.push({
      id: y.id, eventId: y.eventId, personId: y.personId, amount: y.amount, method: y.method,
      network: y.network, txId: y.txId, paidAt: y.paidAt, undone: y.undone, createdAt: y.createdAt,
    });
  }
  return { ok: true, data: { exportedAt: file.exportedAt, event, people: cleanPeople, payments: cleanPayments } };
}

/**
 * The same list under new IDs, so it can never land on top of something already on
 * the phone. People and payments always get new IDs; the list keeps its own ID only
 * when `keepEventId` is true. `uuid` makes one new ID.
 */
export function withNewIds({ event, people, payments }, uuid, keepEventId = false) {
  const eventId = keepEventId ? event.id : uuid();
  const personIds = new Map(people.map((p) => [p.id, uuid()]));
  return {
    event: { ...event, id: eventId },
    people: people.map((p) => ({ ...p, id: personIds.get(p.id), eventId })),
    payments: payments.map((y) => ({ ...y, id: uuid(), eventId, personId: personIds.get(y.personId) })),
  };
}

/** A name with a note after it, e.g. "Harusi (kabla ya kubadilisha)", never over 80 characters. */
export function nameWith(name, suffix) {
  return `${name.slice(0, MAX_NAME - suffix.length - 1).trim()} ${suffix}`;
}
