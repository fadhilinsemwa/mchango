// share.js — the short, clean text that goes to the committee's WhatsApp group.
// Pure: it builds text and nothing else. A phone number never appears in it.

import { fmt } from './parse.js?v=1.1.2';
import { summarise } from './store.js?v=1.1.2';

export const PART_SIZE = 40; // more people than this: the text is split into parts

/**
 * options.who: 'paid' (totals + people who have paid; the default)
 *              'owing' (totals + people who still owe; never the default)
 * options.amounts: whether each name carries its amount.
 * T(key, blanks) gives the words in the language the page is showing.
 * Returns the parts, each one a WhatsApp message.
 */
export function buildShare({ event, people, payments }, { who = 'paid', amounts = true } = {}, T) {
  const sums = summarise(people, payments);
  const firstPaid = new Map();
  for (const pay of payments) {
    if (pay.undone) continue;
    const seen = firstPaid.get(pay.personId);
    if (!seen || pay.paidAt < seen) firstPaid.set(pay.personId, pay.paidAt);
  }

  let rows;
  let line;
  if (who === 'owing') {
    rows = sums.rows.filter((r) => r.owes > 0);
    line = (r) => (amounts ? `${r.person.name} — ${T('owesLine', { amount: fmt(r.owes) })}` : r.person.name);
  } else {
    // In the order the money came in.
    rows = sums.rows
      .filter((r) => r.paid > 0)
      .sort((a, b) => firstPaid.get(a.person.id).localeCompare(firstPaid.get(b.person.id)));
    line = (r) => {
      if (!amounts) return r.person.name;
      const rest = r.owes > 0 ? ` (${T('stillOwes', { amount: fmt(r.owes) })})` : ' ✅';
      return `${r.person.name} — ${fmt(r.paid)}${rest}`;
    };
  }

  const title = event.name.replace(/[*\n\r]/g, ' ').replace(/\s+/g, ' ').trim();
  const head = [
    event.target !== null && `${T('target')}: TZS ${fmt(event.target)}`,
    `${T('pledged')}: TZS ${fmt(sums.pledged)}`,
    `${T('paidIn')}: TZS ${fmt(sums.paid)}`,
    `${T('owed')}: TZS ${fmt(sums.owed)}`,
    '',
    T(who === 'owing' ? 'owingHeader' : 'paidHeader', { n: rows.length }),
  ].filter((l) => l !== false);

  const count = Math.max(1, Math.ceil(rows.length / PART_SIZE));
  const parts = [];
  for (let part = 0; part < count; part++) {
    const lines = [`*${title}*${count > 1 ? ` (${part + 1}/${count})` : ''}`];
    if (part === 0) lines.push(...head);
    rows.slice(part * PART_SIZE, (part + 1) * PART_SIZE).forEach((r, i) => {
      lines.push(`${part * PART_SIZE + i + 1}. ${line(r)}`);
    });
    if (part === count - 1) lines.push('', T('shareFooter'));
    parts.push(lines.join('\n'));
  }
  return parts;
}

export const whatsappLink = (text) => 'https://wa.me/?text=' + encodeURIComponent(text);
