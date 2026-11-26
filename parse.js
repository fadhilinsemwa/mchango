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
