import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSms } from '../parse.js';

const { samples } = JSON.parse(
  readFileSync(new URL('./fixtures/sms.json', import.meta.url), 'utf8'),
);
const sample = (id) => samples.find((s) => s.id === id);

test('the sample file is the one we expect', () => {
  assert.equal(samples.length, 16);
  assert.equal(new Set(samples.map((s) => s.id)).size, 16);
  assert.equal(samples.filter((s) => s.expect.ok).length, 9);
});

// One test per sample, so a failure names the message.
for (const s of samples) {
  if (s.expect.ok) {
    test(`reads: ${s.id}`, () => {
      assert.deepEqual(parseSms(s.text), s.expect);
    });
  } else {
    test(`refuses (${s.expect.reason}): ${s.id}`, () => {
      const got = parseSms(s.text);
      assert.equal(got.ok, false);
      assert.equal(got.reason, s.expect.reason);
      assert.equal('amount' in got, false);
      assert.equal('txId' in got, false);
    });
  }
}

test('the balance is never part of what is read', () => {
  for (const s of samples.filter((x) => x.expect.ok)) {
    const got = parseSms(s.text);
    assert.deepEqual(
      Object.keys(got).sort(),
      ['amount', 'network', 'ok', 'paidAt', 'payerName', 'payerPhone', 'shape', 'txId'],
    );
    const balance = /(?:Salio|balance)[^T]*Tsh([\d,]+)/.exec(s.text)[1].replace(/,/g, '');
    if (Number(balance) !== got.amount) {
      assert.equal(JSON.stringify(got).includes(balance), false, s.id);
    }
  }
});

test('an amount with cents is refused, not rounded', () => {
  const got = parseSms(sample('till_in_fraction_refused').text);
  assert.deepEqual(got, { ok: false, reason: 'fraction' });
});

test('extra spaces, line breaks and non-breaking spaces do not matter', () => {
  const s = sample('till_in_other_network_payer');
  const messy = '  ' + s.text.replace('Umelipwa ', 'Umelipwa\n').replace(' kutoka kwa ', ' kutoka  kwa  ') + '\n';
  assert.deepEqual(parseSms(messy), s.expect);
});

test('a message is only read from its first character', () => {
  const s = sample('till_in_other_network_payer');
  assert.equal(parseSms('FWD: ' + s.text).ok, false);
  assert.equal(parseSms('Nimetuma. ' + s.text).ok, false);
});

test('a payer number that is not a mobile number is left empty, the payment still reads', () => {
  const s = sample('till_in_other_network_payer');
  const got = parseSms(s.text.replace('255700000902', '255222000902'));
  assert.equal(got.ok, true);
  assert.equal(got.payerPhone, null);
  assert.equal(got.amount, 500);
});

test('an amount of 0 or above the limit is refused', () => {
  const s = sample('till_in_other_network_payer');
  assert.deepEqual(parseSms(s.text.replace('Tsh500.00', 'Tsh0.00')), { ok: false, reason: 'amount' });
  assert.deepEqual(
    parseSms(s.text.replace('Tsh500.00', 'Tsh1,000,000,001.00')),
    { ok: false, reason: 'amount' },
  );
  assert.equal(parseSms(s.text.replace('Tsh500.00', 'Tsh1,000,000,000.00')).amount, 1000000000);
});

test('money going out is refused in every wording we know', () => {
  for (const text of [
    'AB1CD2EF3G Imethibitishwa. Umelipa Tsh2,000.00 kwa DUKA LA MFANO mnamo 9/11/26 4:30 PM.',
    'AB1CD2EF3G Confirmed. Tsh2,000.00 sent to 255700000911 - AMANI FARAJA on 9/11/26 at 4:30 PM.',
    'AB1CD2EF3G Imethibitishwa. Umetuma Tsh2,000.00 kwa 255700000911 - AMANI FARAJA mnamo 9/11/26 4:30 PM.',
  ]) {
    assert.deepEqual(parseSms(text), { ok: false, reason: 'outgoing' }, text);
  }
});

test('an unknown message is not guessed, but hands back what it did find', () => {
  const got = parseSms('Umepokea TZS 25,000 kutoka 0700000912 FURAHA. Kumbukumbu 12345678.');
  assert.deepEqual(got, {
    ok: false,
    reason: 'unknown',
    found: { amount: 25000, payerPhone: '255700000912' },
  });
});

test('an unknown message with cents hands back no amount', () => {
  const got = parseSms('Umepokea Tsh25,000.50 kutoka 0700000912.');
  assert.deepEqual(got.found, { payerPhone: '255700000912' });
});

test('a one-time code hands back nothing', () => {
  assert.deepEqual(parseSms(sample('not_a_payment_otp').text), {
    ok: false,
    reason: 'unknown',
    found: {},
  });
});

test('nothing, nonsense and very long text are unknown', () => {
  for (const text of ['', '   ', 'Habari', 'x'.repeat(1001), null, undefined, 42]) {
    assert.deepEqual(parseSms(text), { ok: false, reason: 'unknown', found: {} });
  }
});
