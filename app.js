// app.js — the screens. Every word shown comes from the table `t` below
// (Kiswahili first, English second); nothing is written inline.
// Every piece of text reaches the page as text, never as HTML.

import { fmt, normPhone, parseQuick, parseSms } from './parse.js?v=0.1.0';
import * as store from './store.js?v=0.1.0';
import { buildShare, whatsappLink } from './share.js?v=0.1.0';
import { MAX_FILE_BYTES, backupDue, backupFileName, buildBackup, checkBackup, nameWith } from './backup.js?v=0.1.0';

export const VERSION = '0.1.0';

// key: [Kiswahili, English]
export const t = {
  appTitle: ['Mchango ya tov', 'Mchango by tov'],
  langSwitch: ['English', 'Kiswahili'],
  myLists: ['Orodha zangu', 'My lists'],
  intro: [
    'Andika ahadi na malipo ya mchango wako, kisha tuma orodha safi kwenye kundi la WhatsApp.',
    'Write down the pledges and payments of your contribution, then send a clean list to the WhatsApp group.',
  ],
  onPhoneOnly: ['Orodha inakaa kwenye simu yako tu', 'The list stays on your phone only'],
  noMoney: [
    'Mchango ya tov haishiki wala kutuma pesa. Ni daftari lako tu.',
    'Mchango by tov never holds or sends money. It is only your notebook.',
  ],
  helpLoss: [
    'Orodha inaweza kupotea ukipoteza simu, ukifuta kumbukumbu za kivinjari, au simu ikizifuta yenyewe. Hifadhi nakala mara kwa mara.',
    'A list can be lost if you lose the phone, clear the browser data, or the phone clears it by itself. Save a copy often.',
  ],
  noStorage: [
    'Simu hii haiwezi kuhifadhi orodha hapa (huenda umefungua dirisha la faragha). Hakuna kitakachohifadhiwa.',
    'This phone cannot save a list here (you may be in a private window). Nothing will be saved.',
  ],
  persistRefused: [
    'Simu inaweza kufuta orodha hii yenyewe. Hifadhi nakala.',
    'The phone may clear this list by itself. Save a copy.',
  ],
  closeTabs: [
    'Funga kurasa nyingine za Mchango, kisha fungua upya.',
    'Close the other Mchango pages, then open this one again.',
  ],
  startNew: ['Anza mchango mpya', 'Start a new list'],
  eventName: ['Jina la mchango', 'Name of the contribution'],
  eventNameHint: ['Mfano: Harusi ya Zawadi na Tumaini', 'Example: Wedding of Zawadi and Tumaini'],
  targetLabel: ['Lengo, TZS (si lazima)', 'Target, TZS (optional)'],
  save: ['Hifadhi', 'Save'],
  back: ['Rudi', 'Back'],
  more: ['Zaidi', 'More'],
  editEvent: ['Badilisha jina au lengo', 'Change the name or target'],
  target: ['Lengo', 'Target'],
  pledged: ['Ahadi', 'Pledged'],
  paidIn: ['Zimelipwa', 'Paid in'],
  owed: ['Bado', 'Still owed'],
  st_bado: ['bado', 'not yet'],
  st_sehemu: ['sehemu', 'part'],
  st_amemaliza: ['amemaliza', 'paid up'],
  extra: ['zaidi', 'extra'],
  search: ['Tafuta jina', 'Search a name'],
  addPerson: ['Ongeza mtu', 'Add a person'],
  recordPay: ['Weka malipo', 'Record a payment'],
  emptyPeople: [
    'Bado hakuna mtu. Anza kwa kuongeza watu na ahadi zao.',
    'No one yet. Start by adding people and what they pledged.',
  ],
  noMatch: ['Hakuna jina hilo', 'No such name'],
  name: ['Jina', 'Name'],
  phone: ['Namba ya simu (si lazima)', 'Phone number (optional)'],
  pledge: ['Ahadi, TZS', 'Pledge, TZS'],
  quickMode: ['Ongeza wengi kwa mara moja', 'Add many at once'],
  quickLabel: ['Mstari mmoja kwa kila mtu: jina, kisha ahadi', 'One line per person: the name, then the pledge'],
  quickHint: ['Mfano: Furaha Amani 50,000', 'Example: Furaha Amani 50,000'],
  quickAdd: ['Ongeza wote', 'Add them all'],
  unread: ['Haikusomeka', 'Could not be read'],
  addedCount: ['Wameongezwa: {n}', 'Added: {n}'],
  saved: ['Imehifadhiwa', 'Saved'],
  phoneKeptOut: [
    'Namba ya simu haikueleweka, kwa hiyo haikuhifadhiwa.',
    'The phone number was not understood, so it was not saved.',
  ],
  sameName: [
    'Tayari kuna mtu mwenye jina hili. Ukitaka kumwongeza hata hivyo, gusa Hifadhi tena.',
    'Someone with this name is already on the list. To add them anyway, tap Save again.',
  ],
  nameBad: ['Andika jina, herufi 1 hadi 80.', 'Type a name, 1 to 80 letters.'],
  amountBad: [
    'Andika kiasi kizima kati ya 1 na 1,000,000,000.',
    'Type a whole amount between 1 and 1,000,000,000.',
  ],
  pledgeBad: [
    'Andika ahadi kati ya 0 na 1,000,000,000.',
    'Type a pledge between 0 and 1,000,000,000.',
  ],
  pasteSms: ['Bandika SMS ya malipo hapa', 'Paste the payment SMS here'],
  readSms: ['Soma SMS', 'Read the SMS'],
  smsNote: [
    'Mchango haiwezi kuthibitisha kwamba malipo ni ya kweli. Bandika SMS iliyoingia kwenye simu yako mwenyewe tu.',
    'Mchango cannot prove that a payment is real. Paste only an SMS that came into your own phone.',
  ],
  orCash: ['Au andika kwa mkono', 'Or type it in'],
  cash: ['Taslimu', 'Cash'],
  amount: ['Kiasi, TZS', 'Amount, TZS'],
  who: ['Nani amelipa?', 'Who paid?'],
  choosePerson: ['Chagua mtu', 'Choose a person'],
  newPayer: ['Mtu mpya, hayupo kwenye orodha', 'A new person, not on the list'],
  newPayerName: ['Jina la mtu mpya', 'Name of the new person'],
  possibly: ['Huenda ni: {name}', 'Possibly: {name}'],
  phoneMatches: ['Namba ya simu inalingana na {name}.', 'The phone number matches {name}.'],
  smsRead: ['SMS imesomeka: TZS {amount}, {name}, {when}', 'The SMS was read: TZS {amount}, {name}, {when}'],
  confirmPay: ['Thibitisha malipo', 'Confirm the payment'],
  sms_unknown: [
    'SMS hii haikusomeka. Andika malipo kwa mkono hapa chini.',
    'This SMS could not be read. Type the payment in below.',
  ],
  sms_outgoing: [
    'SMS hii ni ya pesa iliyotoka, si mchango ulioingia.',
    'This SMS is about money going out, not a contribution coming in.',
  ],
  sms_loan: ['SMS hii ni ya kulipa deni, si mchango.', 'This SMS is a loan repayment, not a contribution.'],
  sms_fraction: [
    'Kiasi cha SMS hii kina senti. Andika malipo kwa mkono hapa chini.',
    'The amount in this SMS has cents. Type the payment in below.',
  ],
  sms_bad_date: [
    'Tarehe ya SMS hii haipo kwenye kalenda. Andika malipo kwa mkono hapa chini.',
    'The date in this SMS does not exist. Type the payment in below.',
  ],
  sms_amount: ['Kiasi cha SMS hii hakikubaliki.', 'The amount in this SMS cannot be accepted.'],
  duplicate: [
    'Malipo haya yameshaandikwa: {name}, {when}. Hakuna kilichohifadhiwa.',
    'This payment is already recorded: {name}, {when}. Nothing was saved.',
  ],
  payments: ['Malipo', 'Payments'],
  noPayments: ['Bado hajalipa.', 'No payment yet.'],
  undo: ['Tengua', 'Undo'],
  restore: ['Rudisha', 'Restore'],
  undone: ['imetenguliwa', 'undone'],
  removePerson: ['Ondoa kwenye orodha', 'Remove from the list'],
  restorePerson: ['Rudisha kwenye orodha', 'Put back on the list'],
  removed: ['ameondolewa', 'removed'],
  removedPeople: ['Walioondolewa ({n})', 'Removed people ({n})'],
  deleteList: ['Futa orodha hii', 'Delete this list'],
  delete1: [
    'Kufuta orodha kunafuta watu wote na malipo yote ya mchango huu. Haiwezi kurudishwa.',
    'Deleting the list deletes every person and every payment of this contribution. It cannot be brought back.',
  ],
  deleteGoOn: ['Endelea kufuta', 'Go on and delete'],
  delete2: ['Una uhakika? Orodha "{name}" itafutwa kabisa.', 'Are you sure? The list "{name}" will be gone for good.'],
  deleteYes: ['Ndiyo, futa kabisa', 'Yes, delete it for good'],
  deleteNo: ['Hapana, iache', 'No, keep it'],
  deleted: ['Orodha imefutwa.', 'The list was deleted.'],
  share: ['Sambaza', 'Share'],
  shareTitle: ['Sambaza orodha', 'Share the list'],
  whoToList: ['Nani aonekane kwenye orodha?', 'Who should the list show?'],
  optPaid: ['Jumla na waliolipa', 'Totals and those who have paid'],
  optOwing: ['Jumla na ambao bado', 'Totals and those who still owe'],
  owingWarn: [
    'Orodha ya ambao bado inaweza kumwaibisha mtu kwenye kundi kubwa. Itume kwa kamati tu.',
    'A list of who still owes can embarrass someone in a big group. Send it to the committee only.',
  ],
  withAmounts: ['Onyesha kiasi kwa kila jina', 'Show the amount beside each name'],
  preview: ['Hivi ndivyo itakavyoonekana WhatsApp', 'This is how it will look on WhatsApp'],
  paidHeader: ['Waliolipa ({n}):', 'Paid ({n}):'],
  owingHeader: ['Bado ({n}):', 'Still owe ({n}):'],
  stillOwes: ['bado {amount}', '{amount} to go'],
  owesLine: ['bado {amount}', 'owes {amount}'],
  shareFooter: ['Imetengenezwa bure na mchango.tov.co.tz', 'Made free with mchango.tov.co.tz'],
  sendWa: ['Tuma WhatsApp', 'Send on WhatsApp'],
  copy: ['Nakili', 'Copy'],
  copied: ['Imenakiliwa', 'Copied'],
  notFound: ['Orodha hii haipo kwenye simu hii.', 'This list is not on this phone.'],
  backup: ['Hifadhi nakala', 'Save a copy'],
  backupWhy: [
    'Nakala ni faili moja lenye orodha hii yote. Ukipoteza simu, utaifungua kwenye simu nyingine.',
    'A copy is one file that holds this whole list. If you lose the phone, you open it on another phone.',
  ],
  backupPrivacy: [
    'Faili hili lina majina na namba za simu za wachangiaji. Litume kwako mwenyewe tu.',
    'This file holds the names and phone numbers of the contributors. Send it only to yourself.',
  ],
  backupSend: ['Tuma nakala WhatsApp', 'Send the copy on WhatsApp'],
  backupSendHint: [
    'Chagua namba yako mwenyewe, ili nakala ikae nje ya simu hii.',
    'Choose your own number, so the copy lives off this phone.',
  ],
  backupDownload: ['Pakua', 'Download'],
  backupDone: ['Nakala imehifadhiwa.', 'The copy was saved.'],
  lastBackup: ['Nakala ya mwisho: {when}', 'Last copy: {when}'],
  neverBackedUp: ['Orodha hii bado haina nakala.', 'This list has no copy yet.'],
  due_never: ['Orodha hii bado haina nakala. Hifadhi nakala sasa.', 'This list has no copy yet. Save a copy now.'],
  due_changes: [
    'Umebadilisha mara {n} tangu nakala ya mwisho ({when}). Hifadhi nakala.',
    'You made {n} changes since the last copy ({when}). Save a copy.',
  ],
  due_days: [
    'Nakala ya mwisho ni ya {when}, na orodha imebadilika mara {n} tangu hapo. Hifadhi nakala.',
    'The last copy is from {when}, and the list changed {n} times since. Save a copy.',
  ],
  openBackup: ['Fungua nakala', 'Open a copy'],
  openLabel: ['Chagua faili la nakala', 'Choose the copy file'],
  openHint: [
    'Jina la faili linaanza na "mchango-". Kama ulilituma WhatsApp, lihifadhi kwanza kwenye simu, kisha lichague hapa.',
    'The name of the file starts with "mchango-". If you sent it on WhatsApp, save it to the phone first, then choose it here.',
  ],
  importRefused: [
    'Faili halikufunguliwa na hakuna kilichobadilika: {why}.',
    'The file was not opened and nothing changed: {why}.',
  ],
  imp_big: ['ni kubwa mno (zaidi ya MB 2)', 'it is too big (over 2 MB)'],
  imp_parse: ['si nakala ya Mchango, au limeharibika', 'it is not a Mchango copy, or it is damaged'],
  imp_app: ['si nakala ya Mchango', 'it is not a Mchango copy'],
  imp_schema: [
    'limetoka kwenye toleo jipya zaidi la Mchango; fungua upya ukurasa huu kwanza',
    'it comes from a newer version of Mchango; reopen this page first',
  ],
  imp_shape: ['limekosa sehemu zake', 'parts of it are missing'],
  imp_ids: ['lina kitu kimoja mara mbili', 'something in it appears twice'],
  imp_ref: [
    'lina mtu au malipo yasiyo ya orodha hii',
    'it has a person or a payment that does not belong to this list',
  ],
  imp_name: ['lina jina lisilokubalika', 'it has a name that cannot be accepted'],
  imp_phone: ['lina namba ya simu isiyokubalika', 'it has a phone number that cannot be accepted'],
  imp_amount: ['lina kiasi kisichokubalika', 'it has an amount that cannot be accepted'],
  imp_kind: ['lina aina ya malipo isiyojulikana', 'it has an unknown kind of payment'],
  imp_date: ['lina tarehe isiyokubalika', 'it has a date that cannot be accepted'],
  previewTitle: ['Nakala hii ina:', 'This copy holds:'],
  people: ['Watu', 'People'],
  exportedOn: ['Ilihifadhiwa', 'Saved on'],
  openIt: ['Fungua orodha hii', 'Open this list'],
  imported: ['Orodha imefunguliwa.', 'The list was opened.'],
  clash: ['Orodha hii tayari ipo kwenye simu hii.', 'This list is already on this phone.'],
  asNew: ['Weka kama nakala mpya', 'Add it as a new copy'],
  replaceIt: ['Badilisha iliyopo', 'Replace the one here'],
  onPhone: ['Kwenye simu', 'On the phone'],
  inFile: ['Kwenye faili', 'In the file'],
  lastChange: ['Badiliko la mwisho', 'Last change'],
  phoneNewer: [
    'Angalia: orodha iliyo kwenye simu ni mpya kuliko faili. Ukibadilisha, yaliyoandikwa baada ya faili yatatoka kwenye orodha hii.',
    'Careful: the list on the phone is newer than the file. If you replace it, what was written after the file leaves this list.',
  ],
  replace1: [
    'Orodha iliyopo itahifadhiwa kwanza kwa jina "{name}", kisha faili litachukua nafasi yake.',
    'The list here is first kept under the name "{name}", then the file takes its place.',
  ],
  replaceGoOn: ['Endelea kubadilisha', 'Go on and replace'],
  replace2: [
    'Una uhakika? Faili litachukua nafasi ya orodha iliyopo.',
    'Are you sure? The file will take the place of the list here.',
  ],
  replaceYes: ['Ndiyo, badilisha', 'Yes, replace it'],
  replaceNo: ['Hapana, iache', 'No, leave it'],
  keptSuffix: ['(kabla ya kubadilisha)', '(before replacing)'],
  copySuffix: ['(nakala)', '(copy)'],
  updateReady: ['Toleo jipya lipo', 'A new version is here'],
  reopen: ['Fungua upya', 'Reopen'],
  iosInstall: [
    'Kwenye iPhone: kabla ya kuanza orodha, gusa kitufe cha Share, kisha "Add to Home Screen". Bila hivyo iPhone hufuta orodha baada ya siku 7 bila kufunguliwa.',
    'On iPhone: before you start a list, tap the Share button, then "Add to Home Screen". Otherwise the iPhone deletes the list after 7 days without a visit.',
  ],
  install: ['Weka Mchango kwenye skrini ya simu', 'Put Mchango on the phone screen'],
};

export const BANNED_WORDS = ['tovuti', 'PWA', 'stock', 'app', 'link', 'system', 'website', 'login', 'Shiriki'];

// ---------- small helpers ----------

let lang = 'sw';
const T = (key, vars = {}) => {
  const pair = t[key];
  if (!pair) throw new Error('no text for ' + key);
  return pair[lang === 'en' ? 1 : 0].replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
};
const tzs = (n) => 'TZS ' + fmt(n);
/** "2026-11-09T17:55:00+03:00" -> "9/11/26 17:55" (read from the text, no time zone involved) */
const when = (iso) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}/${iso.slice(2, 4)} ${iso.slice(11, 16)}`;

/** Build an element. Children that are not elements are added as TEXT. */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === false || value === null || value === undefined) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'value') el.value = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === false || kid === null || kid === undefined) continue;
    if (kid instanceof Node) el.append(kid);
    else el.append(document.createTextNode(String(kid)));
  }
  return el;
}

let fieldCount = 0;
/** A form field with a visible label. Returns { row, input }. */
function field(label, attrs, hint) {
  const id = 'f' + ++fieldCount;
  const input = h(attrs.rows ? 'textarea' : 'input', { id, class: 'input', autocomplete: 'off', ...attrs });
  const row = h('div', { class: 'field' }, h('label', { for: id }, label), input, hint && h('p', { class: 'hint' }, hint));
  return { row, input };
}
const button = (label, attrs = {}) => h('button', { type: 'button', class: 'btn', ...attrs }, label);
const note = (text, kind = 'info') =>
  h('p', { class: 'note ' + kind, role: kind === 'err' ? 'alert' : 'status' }, text);

// ---------- state and routing ----------

const state = { storageOk: true, persistRefused: false, blocked: false, flash: null, update: null, updating: false, install: null };
const go = (hash) => {
  if (location.hash === hash) render();
  else location.hash = hash;
};
const flash = (text, kind = 'ok') => {
  state.flash = { text, kind };
};

let renderRun = 0;
async function render() {
  const run = ++renderRun;
  const [path, query = ''] = (location.hash.replace(/^#/, '') || '/').split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(query);
  let view;
  try {
    if (!state.storageOk || parts.length === 0) view = await homeView();
    else if (parts[0] === 'new') view = newEventView();
    else if (parts[0] === 'open') view = openView();
    else if (parts[0] === 'e' && parts[1]) {
      const data = await store.loadEvent(parts[1]);
      if (!data) view = missingView();
      else if (parts[2] === 'add') view = addPersonView(data);
      else if (parts[2] === 'pay') view = payView(data, params.get('p'));
      else if (parts[2] === 'edit') view = editEventView(data);
      else if (parts[2] === 'share') view = shareView(data);
      else if (parts[2] === 'backup') view = backupView(data);
      else if (parts[2] === 'p' && parts[3]) view = personView(data, parts[3]);
      else view = eventView(data);
    } else view = await homeView();
  } catch (err) {
    console.error(err);
    state.storageOk = false;
    view = await homeView();
  }
  if (run !== renderRun) return;
  const root = document.getElementById('app');
  const banner = [];
  if (state.update) banner.push(updateBar());
  if (state.blocked) banner.push(note(T('closeTabs'), 'warn'));
  if (state.flash) banner.push(note(state.flash.text, state.flash.kind));
  state.flash = null;
  root.replaceChildren(...banner, view);
  document.documentElement.lang = lang;
  document.title = T('appTitle');
  window.scrollTo(0, 0);
}

function topBar(title, backHash, ...right) {
  return h(
    'header',
    { class: 'top' },
    backHash && h('a', { class: 'back', href: backHash, 'aria-label': T('back') }, '‹ ', T('back')),
    h('h1', { class: backHash ? 'small' : '' }, title),
    ...right,
  );
}

// ---------- screen 1: my lists ----------

async function homeView() {
  const langBtn = button(T('langSwitch'), {
    class: 'btn pill',
    onclick: () => {
      lang = lang === 'sw' ? 'en' : 'sw';
      try {
        localStorage.setItem('mchango.lang', lang);
      } catch {}
      render();
    },
  });
  const page = h('main', { class: 'page home' }, topBar(T('appTitle'), null, langBtn));
  if (!state.storageOk) {
    page.append(note(T('noStorage'), 'err'));
    return page;
  }
  if (state.persistRefused) page.append(note(T('persistRefused'), 'warn'));
  if (needsHomeScreen()) page.append(note(T('iosInstall'), 'warn'));
  const lists = await store.listEvents();
  if (lists.length === 0) {
    page.append(
      h('p', { class: 'lead' }, T('intro')),
      h('p', { class: 'fact' }, T('onPhoneOnly')),
      h('a', { class: 'btn primary block', href: '#/new' }, T('startNew')),
    );
  } else {
    page.append(
      h('h2', null, T('myLists')),
      h(
        'ul',
        { class: 'cards' },
        lists.map(({ event, totals }) =>
          h(
            'li',
            null,
            h(
              'a',
              { class: 'card', href: '#/e/' + event.id },
              h('span', { class: 'card-name' }, event.name),
              h(
                'span',
                { class: 'card-sum num' },
                `${T('paidIn')} ${fmt(totals.paid)} / ${T('pledged')} ${fmt(totals.pledged)}`,
              ),
            ),
          ),
        ),
      ),
      h('a', { class: 'btn primary block', href: '#/new' }, T('startNew')),
    );
  }
  page.append(h('a', { class: 'btn block', href: '#/open' }, T('openBackup')));
  if (state.install) {
    page.append(
      button(T('install'), {
        class: 'btn block',
        onclick: () => {
          state.install.prompt();
          state.install = null;
          render();
        },
      }),
    );
  }
  page.append(h('p', { class: 'hint foot' }, T('noMoney')), h('p', { class: 'hint foot' }, T('helpLoss')));
  return page;
}

function missingView() {
  return h('main', { class: 'page' }, topBar(T('appTitle'), '#/'), note(T('notFound'), 'warn'));
}

// ---------- new list, and changing its name or target ----------

function eventForm(event, onSaved) {
  const name = field(T('eventName'), { value: event?.name ?? '', maxlength: 80, required: true }, T('eventNameHint'));
  const target = field(T('targetLabel'), { value: event?.target ? fmt(event.target) : '', inputmode: 'numeric' });
  const problems = h('div', null);
  const submit = h('button', { type: 'submit', class: 'btn primary block' }, T('save'));
  const form = h('form', { class: 'form', novalidate: true }, name.row, target.row, problems, submit);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    problems.replaceChildren();
    const targetText = target.input.value.trim();
    const targetValue = targetText === '' ? null : store.typedAmount(targetText);
    if (!store.validName(name.input.value)) return problems.append(note(T('nameBad'), 'err'));
    if (targetText !== '' && !store.validAmount(targetValue)) return problems.append(note(T('amountBad'), 'err'));
    submit.disabled = true;
    await onSaved({ name: name.input.value, target: targetValue });
  });
  return form;
}

function newEventView() {
  return h(
    'main',
    { class: 'page' },
    topBar(T('startNew'), '#/'),
    eventForm(null, async (fields) => {
      const event = await store.createEvent(fields);
      go('#/e/' + event.id);
    }),
  );
}

function editEventView({ event }) {
  const home = '#/e/' + event.id;
  const zone = h('div', { class: 'danger' });
  const step0 = () =>
    zone.replaceChildren(button(T('deleteList'), { class: 'btn danger-btn block', onclick: step1 }));
  const step1 = () =>
    zone.replaceChildren(
      note(T('delete1'), 'warn'),
      button(T('deleteGoOn'), { class: 'btn danger-btn block', onclick: step2 }),
      button(T('deleteNo'), { class: 'btn block', onclick: step0 }),
    );
  const step2 = () =>
    zone.replaceChildren(
      note(T('delete2', { name: event.name }), 'err'),
      button(T('deleteYes'), {
        class: 'btn danger-btn block',
        onclick: async (e) => {
          e.currentTarget.disabled = true;
          await store.deleteEvent(event.id);
          flash(T('deleted'));
          go('#/');
        },
      }),
      button(T('deleteNo'), { class: 'btn block', onclick: step0 }),
    );
  step0();
  return h(
    'main',
    { class: 'page' },
    topBar(T('editEvent'), home),
    eventForm(event, async (fields) => {
      await store.updateEvent(event.id, fields);
      flash(T('saved'));
      go(home);
    }),
    zone,
  );
}

// ---------- screen 2: one contribution ----------

function figure(label, value, cls = '') {
  return h('div', { class: 'fig ' + cls }, h('span', { class: 'fig-label' }, label), h('span', { class: 'fig-value num' }, value));
}

function personRow(eventId, row) {
  const { person, paid, extra, status } = row;
  return h(
    'li',
    { 'data-name': store.normName(person.name) },
    h(
      'a',
      { class: 'row', href: `#/e/${eventId}/p/${person.id}` },
      h('span', { class: 'row-name' }, person.name),
      h(
        'span',
        { class: 'row-sum num' },
        `${fmt(paid)} / ${fmt(person.pledge)}`,
        extra > 0 && h('span', { class: 'row-extra' }, ` +${fmt(extra)} ${T('extra')}`),
      ),
      h('span', { class: 'chip st-' + status }, T('st_' + status)),
    ),
  );
}

function eventView({ event, people, payments }) {
  const base = '#/e/' + event.id;
  const sums = store.summarise(people, payments);
  const gone = people.filter((p) => p.removed);

  const totals = h(
    'section',
    { class: 'totals', 'aria-label': event.name },
    event.target !== null && figure(T('target'), tzs(event.target)),
    figure(T('pledged'), tzs(sums.pledged)),
    figure(T('paidIn'), tzs(sums.paid), 'key'),
    figure(T('owed'), tzs(sums.owed), 'key'),
  );
  // Once the totals scroll away, a slim bar keeps the two numbers that matter.
  const slim = h(
    'div',
    { class: 'slim', hidden: true },
    h('span', { class: 'num' }, `${T('paidIn')} ${tzs(sums.paid)}`),
    h('span', { class: 'num' }, `${T('owed')} ${tzs(sums.owed)}`),
  );
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => {
      slim.hidden = entry.isIntersecting;
    }).observe(totals);
  }

  const due = backupDue(event, Date.now());
  const last = event.lastBackupAt ? when(event.lastBackupAt) : '';
  const copyLine = h(
    'div',
    { class: 'copy-line' },
    due
      ? note(T('due_' + due, { n: event.changesSinceBackup, when: last }), 'warn')
      : h('p', { class: 'hint' }, last ? T('lastBackup', { when: last }) : T('neverBackedUp')),
    h('a', { class: 'btn quiet', href: base + '/backup' }, T('backup')),
  );

  const actions = h(
    'nav',
    { class: 'actions' },
    h('a', { class: 'btn', href: base + '/add' }, T('addPerson')),
    h('a', { class: 'btn primary', href: base + '/pay' }, T('recordPay')),
    h('a', { class: 'btn', href: base + '/share' }, T('share')),
  );

  const list = h('ul', { class: 'people' }, sums.rows.map((row) => personRow(event.id, row)));
  const nothing = h('div', { class: 'empty', hidden: true }, h('p', null, T('noMatch')), h('a', { class: 'btn', href: base + '/add' }, T('addPerson')));
  const search = field(T('search'), { type: 'search', enterkeyhint: 'search' });
  search.input.addEventListener('input', () => {
    const wanted = store.normName(search.input.value);
    let shown = 0;
    for (const li of list.children) {
      li.hidden = !li.dataset.name.includes(wanted);
      if (!li.hidden) shown++;
    }
    nothing.hidden = shown > 0;
  });

  const peopleCol = h('section', { class: 'col-people' });
  if (sums.rows.length === 0) {
    peopleCol.append(h('div', { class: 'empty' }, h('p', null, T('emptyPeople')), h('a', { class: 'btn', href: base + '/add' }, T('addPerson'))));
  } else {
    peopleCol.append(search.row, list, nothing);
  }
  if (gone.length > 0) {
    peopleCol.append(
      h(
        'details',
        { class: 'gone' },
        h('summary', null, T('removedPeople', { n: gone.length })),
        h(
          'ul',
          { class: 'people' },
          gone.map((person) =>
            h(
              'li',
              null,
              h(
                'a',
                { class: 'row greyed', href: `${base}/p/${person.id}` },
                h('span', { class: 'row-name' }, person.name),
                h('span', { class: 'chip' }, T('removed')),
              ),
            ),
          ),
        ),
      ),
    );
  }

  return h(
    'main',
    { class: 'page event' },
    topBar(event.name, '#/', h('a', { class: 'btn pill', href: base + '/edit' }, T('more'))),
    slim,
    h('div', { class: 'layout' }, h('aside', { class: 'col-side' }, totals, copyLine, actions), peopleCol),
  );
}

// ---------- screen 3: add people ----------

function addPersonView({ event, people }) {
  const home = '#/e/' + event.id;
  const name = field(T('name'), { maxlength: 80, required: true, autocapitalize: 'words' });
  const phone = field(T('phone'), { type: 'tel', inputmode: 'tel' });
  const pledge = field(T('pledge'), { inputmode: 'numeric', required: true });
  const problems = h('div', null);
  const submit = h('button', { type: 'submit', class: 'btn primary block' }, T('save'));
  const form = h('form', { class: 'form', novalidate: true }, name.row, phone.row, pledge.row, problems, submit);
  let warnedFor = null;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    problems.replaceChildren();
    const amount = store.typedAmount(pledge.input.value);
    if (!store.validName(name.input.value)) return problems.append(note(T('nameBad'), 'err'));
    if (!store.validPledge(amount)) return problems.append(note(T('pledgeBad'), 'err'));
    const wanted = store.normName(name.input.value);
    const clash = people.some((p) => !p.removed && store.normName(p.name) === wanted);
    if (clash && warnedFor !== wanted) {
      warnedFor = wanted;
      return problems.append(note(T('sameName'), 'warn'));
    }
    submit.disabled = true;
    const typedPhone = phone.input.value.trim();
    await store.addPeople(event.id, [{ name: name.input.value, phone: typedPhone, pledge: amount }]);
    const keptOut = typedPhone !== '' && normPhone(typedPhone) === null;
    flash(keptOut ? `${T('saved')}. ${T('phoneKeptOut')}` : T('saved'), keptOut ? 'warn' : 'ok');
    go(home);
  });

  const many = field(T('quickLabel'), { rows: 6, autocapitalize: 'words' }, T('quickHint'));
  const result = h('div', null);
  const addAll = button(T('quickAdd'), {
    class: 'btn primary block',
    onclick: async () => {
      const { people: good, unread } = parseQuick(many.input.value);
      if (good.length === 0 && unread.length === 0) return;
      addAll.disabled = true;
      await store.addPeople(event.id, good.map((p) => ({ ...p, phone: null })));
      addAll.disabled = false;
      result.replaceChildren(
        note(T('addedCount', { n: good.length }), 'ok'),
        unread.length > 0 &&
          h(
            'ul',
            { class: 'unread' },
            unread.map((u) => h('li', null, h('span', { class: 'chip st-bad' }, T('unread')), ' ', u.line)),
          ),
        h('a', { class: 'btn block', href: home }, T('back')),
      );
      many.input.value = unread.map((u) => u.line).join('\n');
    },
  });

  return h(
    'main',
    { class: 'page' },
    topBar(T('addPerson'), home),
    form,
    h('details', { class: 'quick' }, h('summary', null, T('quickMode')), many.row, addAll, result),
  );
}

// ---------- one person ----------

function personView({ event, people, payments }, personId) {
  const person = people.find((p) => p.id === personId);
  if (!person) return missingView();
  const home = '#/e/' + event.id;
  const here = `${home}/p/${person.id}`;
  const mine = payments.filter((p) => p.personId === person.id).sort((a, b) => b.paidAt.localeCompare(a.paidAt));

  const name = field(T('name'), { value: person.name, maxlength: 80, required: true });
  const phone = field(T('phone'), { value: person.phone ? '0' + person.phone.slice(3) : '', type: 'tel', inputmode: 'tel' });
  const pledge = field(T('pledge'), { value: fmt(person.pledge), inputmode: 'numeric', required: true });
  const problems = h('div', null);
  const submit = h('button', { type: 'submit', class: 'btn block' }, T('save'));
  const form = h('form', { class: 'form', novalidate: true }, name.row, phone.row, pledge.row, problems, submit);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    problems.replaceChildren();
    const amount = store.typedAmount(pledge.input.value);
    if (!store.validName(name.input.value)) return problems.append(note(T('nameBad'), 'err'));
    if (!store.validPledge(amount)) return problems.append(note(T('pledgeBad'), 'err'));
    submit.disabled = true;
    const typedPhone = phone.input.value.trim();
    await store.updatePerson(person.id, { name: name.input.value, phone: typedPhone, pledge: amount });
    const keptOut = typedPhone !== '' && normPhone(typedPhone) === null;
    flash(keptOut ? `${T('saved')}. ${T('phoneKeptOut')}` : T('saved'), keptOut ? 'warn' : 'ok');
    go(here);
  });

  const payList =
    mine.length === 0
      ? h('p', { class: 'hint' }, T('noPayments'))
      : h(
          'ul',
          { class: 'pays' },
          mine.map((pay) =>
            h(
              'li',
              { class: pay.undone ? 'greyed' : '' },
              h(
                'div',
                { class: 'pay-text' },
                h('span', { class: 'num pay-amount' }, tzs(pay.amount)),
                h('span', { class: 'hint' }, `${pay.method === 'cash' ? T('cash') : 'SMS ' + pay.txId} · ${when(pay.paidAt)}`),
                pay.undone && h('span', { class: 'chip' }, T('undone')),
              ),
              button(pay.undone ? T('restore') : T('undo'), {
                onclick: async (e) => {
                  e.currentTarget.disabled = true;
                  const verdict = await store.setUndone(pay.id, !pay.undone);
                  if (verdict.action === 'duplicate') {
                    const owner = people.find((p) => p.id === verdict.dup.personId);
                    flash(T('duplicate', { name: owner?.name ?? '', when: when(verdict.dup.paidAt) }), 'err');
                  }
                  go(here);
                },
              }),
            ),
          ),
        );

  return h(
    'main',
    { class: 'page' },
    topBar(person.name, home),
    person.removed && note(T('removed'), 'warn'),
    !person.removed && h('a', { class: 'btn primary block', href: `${home}/pay?p=${person.id}` }, T('recordPay')),
    h('h2', null, T('payments')),
    payList,
    form,
    button(person.removed ? T('restorePerson') : T('removePerson'), {
      class: 'btn block quiet',
      onclick: async (e) => {
        e.currentTarget.disabled = true;
        await store.updatePerson(person.id, { removed: !person.removed });
        go(person.removed ? here : home);
      },
    }),
  );
}

// ---------- screen 4: record a payment ----------

function payView({ event, people, payments }, presetPersonId) {
  const home = '#/e/' + event.id;
  const live = people.filter((p) => !p.removed).sort((a, b) => store.normName(a.name).localeCompare(store.normName(b.name)));
  // The id is made when the form opens: saving the same id twice does nothing.
  const draft = { id: crypto.randomUUID(), sms: null };

  const sms = field(T('pasteSms'), { rows: 4 });
  const smsResult = h('div', null);
  const amount = field(T('amount'), { inputmode: 'numeric', required: true });
  const method = h('p', { class: 'hint' }, T('cash'));

  const select = h('select', { id: 'who', class: 'input' });
  const fillSelect = (suggested = [], chosen = presetPersonId) => {
    select.replaceChildren(
      h('option', { value: '' }, T('choosePerson')),
      ...live.map((p) =>
        h('option', { value: p.id }, suggested.includes(p.id) ? T('possibly', { name: p.name }) : p.name),
      ),
      h('option', { value: 'new' }, T('newPayer')),
    );
    select.value = chosen && live.some((p) => p.id === chosen) ? chosen : '';
    select.dispatchEvent(new Event('change'));
  };
  const newName = field(T('newPayerName'), { maxlength: 80, autocapitalize: 'words' });
  newName.row.hidden = true;
  select.addEventListener('change', () => {
    newName.row.hidden = select.value !== 'new';
  });
  fillSelect();

  const duplicateNote = (dup) => {
    const owner = people.find((p) => p.id === dup.personId);
    return note(T('duplicate', { name: owner?.name ?? '', when: when(dup.paidAt) }), 'err');
  };

  const readBtn = button(T('readSms'), {
    class: 'btn block',
    onclick: () => {
      const got = parseSms(sms.input.value);
      draft.sms = null;
      amount.input.readOnly = false;
      method.textContent = T('cash');
      smsResult.replaceChildren();
      if (!got.ok) {
        smsResult.append(note(T('sms_' + got.reason), 'err'));
        if (got.found?.amount) amount.input.value = fmt(got.found.amount);
        return;
      }
      const verdict = store.checkNewPayment(payments, { id: draft.id, txId: got.txId });
      if (verdict.action === 'duplicate') return smsResult.append(duplicateNote(verdict.dup));
      draft.sms = got;
      amount.input.value = fmt(got.amount);
      amount.input.readOnly = true; // an SMS amount is what the SMS says
      method.textContent = `SMS ${got.txId} · ${when(got.paidAt)}`;
      const match = store.matchPayer(live, { phone: got.payerPhone, name: got.payerName });
      fillSelect(match.suggestions, match.how === 'phone' ? match.personId : null);
      newName.input.value = got.payerName;
      smsResult.append(note(T('smsRead', { amount: fmt(got.amount), name: got.payerName, when: when(got.paidAt) }), 'ok'));
      if (match.how === 'phone') {
        const owner = live.find((p) => p.id === match.personId);
        smsResult.append(note(T('phoneMatches', { name: owner.name }), 'info'));
      }
    },
  });

  const problems = h('div', null);
  const confirm = h('button', { type: 'submit', class: 'btn primary block' }, T('confirmPay'));
  const form = h(
    'form',
    { class: 'form', novalidate: true },
    h('h2', null, T('orCash')),
    amount.row,
    method,
    h('div', { class: 'field' }, h('label', { for: 'who' }, T('who')), select),
    newName.row,
    problems,
    confirm,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    problems.replaceChildren();
    const value = draft.sms ? draft.sms.amount : store.typedAmount(amount.input.value);
    if (!store.validAmount(value)) return problems.append(note(T('amountBad'), 'err'));
    if (select.value === '') return problems.append(note(T('choosePerson'), 'err'));
    let payer = null;
    if (select.value === 'new') {
      if (!store.validName(newName.input.value)) return problems.append(note(T('nameBad'), 'err'));
      payer = store.newPerson(event.id, { name: newName.input.value, phone: draft.sms?.payerPhone ?? null, pledge: 0 });
    }
    confirm.disabled = true; // no second tap while saving
    const payment = store.newPayment(draft.id, event.id, payer ? payer.id : select.value, {
      amount: value,
      method: draft.sms ? 'sms' : 'cash',
      network: draft.sms?.network ?? null,
      txId: draft.sms?.txId ?? null,
      paidAt: draft.sms?.paidAt,
    });
    const verdict = await store.savePayment(payment, payer);
    if (verdict.action === 'duplicate') {
      confirm.disabled = false;
      return problems.append(duplicateNote(verdict.dup));
    }
    flash(`${T('saved')}: ${tzs(value)}`);
    go(home);
  });

  return h(
    'main',
    { class: 'page' },
    topBar(T('recordPay'), home),
    h('section', { class: 'form' }, sms.row, h('p', { class: 'hint' }, T('smsNote')), readBtn, smsResult),
    form,
  );
}

// ---------- screen 5: share the list ----------

function shareView(data) {
  const home = '#/e/' + data.event.id;
  const options = { who: 'paid', amounts: true };
  const radio = (value, label) => {
    const input = h('input', { type: 'radio', name: 'who', id: 'who-' + value, value });
    input.checked = options.who === value;
    input.addEventListener('change', () => {
      options.who = value;
      draw();
    });
    return h('label', { class: 'choice', for: 'who-' + value }, input, h('span', null, label));
  };
  const amounts = h('input', { type: 'checkbox', id: 'with-amounts' });
  amounts.checked = true;
  amounts.addEventListener('change', () => {
    options.amounts = amounts.checked;
    draw();
  });
  const warning = note(T('owingWarn'), 'warn');
  const out = h('div', { class: 'parts' });

  function draw() {
    warning.hidden = options.who !== 'owing';
    out.replaceChildren(
      ...buildShare(data, options, T).map((text) => {
        const copyBtn = button(T('copy'), {
          onclick: async () => {
            try {
              await navigator.clipboard.writeText(text);
              copyBtn.textContent = T('copied');
            } catch {}
          },
        });
        return h(
          'section',
          { class: 'part' },
          // One element per line, so the text is shown exactly as it will be sent.
          h('div', { class: 'bubble' }, text.split('\n').map((l) => h('div', { class: 'bubble-line' }, l === '' ? '\u00a0' : l))),
          typeof navigator.share === 'function' &&
            button(T('share'), {
              class: 'btn primary block',
              onclick: async () => {
                try {
                  await navigator.share({ text });
                } catch {} // cancelled: the preview and the two buttons below stay
              },
            }),
          h(
            'div',
            { class: 'pair' },
            h('a', { class: 'btn', href: whatsappLink(text), target: '_blank', rel: 'noopener' }, T('sendWa')),
            copyBtn,
          ),
        );
      }),
    );
  }
  draw();

  return h(
    'main',
    { class: 'page' },
    topBar(T('shareTitle'), home),
    h(
      'fieldset',
      { class: 'choices' },
      h('legend', null, T('whoToList')),
      radio('paid', T('optPaid')),
      radio('owing', T('optOwing')),
    ),
    warning,
    h('label', { class: 'choice', for: 'with-amounts' }, amounts, h('span', null, T('withAmounts'))),
    h('h2', null, T('preview')),
    out,
  );
}

// ---------- screen 6: save a copy, open a copy ----------

function backupView(data) {
  const { event } = data;
  const here = `#/e/${event.id}/backup`;
  const make = () => {
    const now = Date.now();
    return new File([JSON.stringify(buildBackup(data, now))], backupFileName(event, now), { type: 'text/plain' });
  };
  const saved = async () => {
    await store.markBackedUp(event.id, Date.now());
    flash(T('backupDone'));
    go(here);
  };
  let canSend = false;
  try {
    canSend = typeof navigator.share === 'function' && navigator.canShare({ files: [make()] });
  } catch {}
  const send = button(T('backupSend'), {
    class: 'btn primary block',
    onclick: async () => {
      try {
        await navigator.share({ files: [make()] });
      } catch {
        return; // cancelled: nothing was saved, so nothing is marked
      }
      await saved();
    },
  });
  const download = button(T('backupDownload'), {
    class: canSend ? 'btn block' : 'btn primary block',
    onclick: async () => {
      const file = make();
      const url = URL.createObjectURL(file);
      const a = h('a', { href: url, download: file.name, hidden: true });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      await saved();
    },
  });
  return h(
    'main',
    { class: 'page' },
    topBar(T('backup'), '#/e/' + event.id),
    h('p', { class: 'lead' }, T('backupWhy')),
    h('p', { class: 'fact' }, event.lastBackupAt ? T('lastBackup', { when: when(event.lastBackupAt) }) : T('neverBackedUp')),
    note(T('backupPrivacy'), 'warn'),
    canSend && send,
    canSend && h('p', { class: 'hint' }, T('backupSendHint')),
    download,
    h('a', { class: 'btn block quiet', href: '#/open' }, T('openBackup')),
  );
}

function openView() {
  // The browser's own file button speaks the phone's language, not the page's:
  // it is kept out of sight and our own button opens it.
  const input = h('input', { type: 'file', id: 'copy-file', accept: '.txt,text/plain', hidden: true });
  const pick = h(
    'label',
    {
      class: 'btn primary block',
      for: 'copy-file',
      role: 'button',
      tabindex: '0',
      onkeydown: (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        input.click();
      },
    },
    T('openLabel'),
  );
  const out = h('div', { class: 'form' });
  input.addEventListener('change', async () => {
    out.replaceChildren();
    const file = input.files[0];
    if (!file) return;
    out.append(h('p', { class: 'hint picked' }, file.name));
    let got = { ok: false, reason: 'big' };
    if (file.size < MAX_FILE_BYTES) {
      try {
        got = checkBackup(await file.text());
      } catch {
        got = { ok: false, reason: 'parse' };
      }
    }
    if (!got.ok) return out.append(note(T('importRefused', { why: T('imp_' + got.reason) }), 'err'));
    out.append(...(await previewOf(got.data)));
  });
  return h('main', { class: 'page' }, topBar(T('openBackup'), '#/'), pick, input, h('p', { class: 'hint' }, T('openHint')), out);
}

/** What the file holds, shown BEFORE anything is put on the phone. */
async function previewOf(data) {
  const lastOf = (event, fallback) => event.lastChangeAt ?? fallback;
  const alive = (people) => people.filter((p) => !p.removed).length;
  const sums = store.summarise(data.people, data.payments);
  const mine = await store.loadEvent(data.event.id);
  const opened = (id) => {
    flash(T('imported'));
    go('#/e/' + id);
  };
  const facts = h(
    'section',
    { class: 'totals', 'aria-label': T('previewTitle') },
    figure(T('people'), alive(data.people)),
    figure(T('exportedOn'), when(data.exportedAt)),
    figure(T('pledged'), tzs(sums.pledged)),
    figure(T('paidIn'), tzs(sums.paid)),
  );
  const head = [h('h2', null, T('previewTitle')), h('p', { class: 'lead name' }, data.event.name), facts];
  if (!mine) {
    return [
      ...head,
      button(T('openIt'), {
        class: 'btn primary block',
        onclick: async (e) => {
          e.currentTarget.disabled = true;
          opened(await store.importList(data, 'new'));
        },
      }),
    ];
  }

  // The list is already here: show both, side by side. Nothing is ever merged.
  const here = store.summarise(mine.people, mine.payments);
  const phoneLast = lastOf(mine.event, mine.event.createdAt);
  const fileLast = lastOf(data.event, data.exportedAt);
  const line = (label, a, b) => h('tr', null, h('th', { scope: 'row' }, label), h('td', { class: 'num' }, a), h('td', { class: 'num' }, b));
  const versus = h(
    'table',
    { class: 'versus' },
    h('thead', null, h('tr', null, h('td', null), h('th', { scope: 'col' }, T('onPhone')), h('th', { scope: 'col' }, T('inFile')))),
    h(
      'tbody',
      null,
      line(T('people'), alive(mine.people), alive(data.people)),
      line(T('paidIn'), fmt(here.paid), fmt(sums.paid)),
      line(T('lastChange'), when(phoneLast), when(fileLast)),
    ),
  );
  const keepAs = nameWith(mine.event.name, T('keptSuffix'));
  const zone = h('div', { class: 'danger' });
  const step0 = () => zone.replaceChildren(button(T('replaceIt'), { class: 'btn danger-btn block', onclick: step1 }));
  const step1 = () =>
    zone.replaceChildren(
      note(T('replace1', { name: keepAs }), 'warn'),
      button(T('replaceGoOn'), { class: 'btn danger-btn block', onclick: step2 }),
      button(T('replaceNo'), { class: 'btn block', onclick: step0 }),
    );
  const step2 = () =>
    zone.replaceChildren(
      note(T('replace2'), 'err'),
      button(T('replaceYes'), {
        class: 'btn danger-btn block',
        onclick: async (e) => {
          e.currentTarget.disabled = true;
          opened(await store.importList(data, 'replace', { keepAs }));
        },
      }),
      button(T('replaceNo'), { class: 'btn block', onclick: step0 }),
    );
  step0();
  return [
    ...head,
    note(T('clash'), 'warn'),
    versus,
    phoneLast > fileLast && note(T('phoneNewer'), 'err'),
    button(T('asNew'), {
      class: 'btn primary block',
      onclick: async (e) => {
        e.currentTarget.disabled = true;
        opened(await store.importList(data, 'copy', { rename: nameWith(data.event.name, T('copySuffix')) }));
      },
    }),
    zone,
  ].filter(Boolean);
}

// ---------- working with no network, new versions, the phone's home screen ----------

/** iPhone clears a page's saved data after 7 days unless the page is on the Home Screen. */
function needsHomeScreen() {
  const onHomeScreen = navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) && !onHomeScreen;
}

function updateBar() {
  return h(
    'div',
    { class: 'note warn update', role: 'status' },
    h('span', null, T('updateReady')),
    button(T('reopen'), {
      onclick: (e) => {
        e.currentTarget.disabled = true;
        state.updating = true;
        const waiting = state.update?.waiting;
        if (waiting) waiting.postMessage('skip');
        else location.reload();
      },
    }),
  );
}

/** Keep the files on the phone (sw.js), and say so when a newer version has arrived. */
async function watchVersion() {
  const sw = navigator.serviceWorker;
  if (!sw) return;
  try {
    const reg = await sw.register('sw.js');
    const check = () => {
      if (!reg.waiting || !sw.controller || state.update) return;
      state.update = reg;
      // Added on top of the screen as it is: a form being filled is left alone.
      document.getElementById('app').prepend(updateBar());
    };
    check();
    reg.addEventListener('updatefound', () => reg.installing?.addEventListener('statechange', check));
    sw.addEventListener('controllerchange', () => {
      if (state.updating) location.reload();
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) reg.update().catch(() => {});
    });
  } catch {}
}

// ---------- start ----------

async function boot() {
  try {
    lang = localStorage.getItem('mchango.lang') === 'en' ? 'en' : 'sw';
  } catch {}
  try {
    await store.openDb({
      onBlocked: () => {
        state.blocked = true;
        render();
      },
      onVersionChange: () => location.reload(),
    });
  } catch {
    state.storageOk = false;
  }
  if (state.storageOk) {
    try {
      const kept = await navigator.storage?.persist?.();
      state.persistRefused = kept === false;
    } catch {}
  }
  window.addEventListener('hashchange', render);
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.install = e;
    if (document.querySelector('.page.home')) render();
  });
  await render();
  watchVersion();
}

if (typeof document !== 'undefined') boot();
