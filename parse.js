// parse.js — reading what people type or paste. Pure functions only:
// no page, no storage, no network. Everything here is covered by tests/.

export const MAX_AMOUNT = 1_000_000_000; // the biggest pledge or payment we accept
export const MAX_NAME = 80;

// ---------- money ----------

/** 50000 -> "50,000". Whole shillings only. */
export function fmt(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// ---------- phone numbers ----------

/**
 * One way to store a Tanzanian mobile number: 255 + 9 digits starting 6 or 7.
 * Accepts 07…/06…, +255…, 255…, with spaces or dashes. Anything else -> null.
 */
export function normPhone(text) {
  if (typeof text !== 'string') return null;
  const digits = text.replace(/[\s-]/g, '');
  const m = /^(?:\+?255|0)([67]\d{8})$/.exec(digits);
  return m ? '255' + m[1] : null;
}

// ---------- time (always East Africa Time, UTC+3, never the phone's own zone) ----------

const EAT_MS = 3 * 60 * 60 * 1000;
const two = (n) => String(n).padStart(2, '0');

/** A clock reading (milliseconds since 1970) -> "2026-10-01T01:30:00+03:00". */
export function eatIso(ms) {
  const shifted = new Date(ms + EAT_MS);
  return shifted.toISOString().slice(0, 19) + '+03:00';
}

function daysInMonth(year, month) {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * The time printed in a payment SMS, "d/m/yy h:mm AM|PM", is already East Africa Time.
 * Built by hand, never with new Date(text). An impossible date or time -> null.
 */
export function smsTimeIso(day, month, yy, hour12, minute, ampm) {
  const nums = [day, month, yy, hour12, minute].map(Number);
  if (!nums.every(Number.isInteger)) return null;
  const [d, mo, y2, h, mi] = nums;
  const half = String(ampm).toUpperCase();
  if (half !== 'AM' && half !== 'PM') return null;
  const year = 2000 + y2;
  if (y2 < 0 || y2 > 99 || mo < 1 || mo > 12) return null;
  if (d < 1 || d > daysInMonth(year, mo)) return null;
  if (h < 1 || h > 12 || mi < 0 || mi > 59) return null;
  const hour24 = (h % 12) + (half === 'PM' ? 12 : 0);
  return `${year}-${two(mo)}-${two(d)}T${two(hour24)}:${two(mi)}:00+03:00`;
}

// ---------- quick add: many people at once, one per line ----------

// An amount is digits, optionally grouped in threes by a comma or a space
// (50000, 50,000, 50 000, 1 500 000), or digits followed by k (50k).
const AMOUNT = /^(?:\d{1,3}(?:[ ,]\d{3})+|\d+k?)$/i;
const SEPARATORS = ' ,-–—:';

function amountValue(text) {
  if (!AMOUNT.test(text)) return null;
  const thousands = /k$/i.test(text) ? 1000 : 1;
  return Number(text.replace(/[ ,k]/gi, '')) * thousands;
}

/**
 * One line, e.g. "Zawadi Tumaini 50,000". The LONGEST ending that is an amount is
 * the pledge; the rest is the name. Returns {name, pledge} or {why} when unreadable:
 * no_amount, zero, too_big, no_name, long_name.
 */
export function parseQuickLine(line) {
  const s = String(line).replace(/\s+/g, ' ').trim();
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && !SEPARATORS.includes(s[i - 1])) continue; // an amount starts a word
    // "50,00" or "1,50,000" is a mistyped amount, not a name ending in a number:
    // a comma straight after a digit never starts a new amount.
    if (i > 1 && s[i - 1] === ',' && /\d/.test(s[i - 2])) continue;
    const pledge = amountValue(s.slice(i));
    if (pledge === null) continue;
    const name = s.slice(0, i).replace(/[\s,\-–—:]+$/, '');
    if (pledge === 0) return { why: 'zero' };
    if (pledge > MAX_AMOUNT) return { why: 'too_big' };
    if (name === '') return { why: 'no_name' };
    if (name.length > MAX_NAME) return { why: 'long_name' };
    return { name, pledge };
  }
  return { why: 'no_amount' };
}

/** Many lines. Good lines become people; the others are handed back, never guessed. */
export function parseQuick(text) {
  const people = [];
  const unread = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const got = parseQuickLine(line);
    if (got.why) unread.push({ line: line.trim(), why: got.why });
    else people.push(got);
  }
  return { people, unread };
}
