# Mchango wa tov

Daftari la mchango kwenye simu yako: harusi, msiba, mahafali au matibabu.
Andika ahadi, weka malipo yanapoingia, kisha tuma orodha safi kwenye group la WhatsApp.

Fungua: **https://mchango.tov.co.tz** (bure, bila kujisajili).

*English is below.*

## Inafanya nini

- **Orodha ya watu na ahadi zao.** Andika mmoja mmoja, au wengi kwa mara moja: mstari mmoja kwa kila mtu,
  mfano `Zawadi Tumaini 50,000` au `Furaha 100k`.
- **Malipo.** Bandika SMS ya M-Pesa uliyopokea: Mchango inasoma kiasi, jina, namba na saa, kisha inakuonyesha
  ni nani kwenye orodha. Au andika kiasi cha taslimu mwenyewe. Hakuna kinachohifadhiwa kabla hujathibitisha.
- **Hesabu yenyewe.** Lengo, Ahadi, Zimelipwa, Bado. Kila mtu ana neno lake: *bado*, *sehemu* au *amemaliza*.
- **Sambaza.** Orodha fupi, safi, tayari kwa WhatsApp. Haina namba ya simu ya mtu yeyote.
- **Hifadhi nakala.** Tuma nakala ya orodha kwenye namba yako mwenyewe ya WhatsApp, au ipakue. Ukipoteza simu,
  unaifungua kwenye simu nyingine.
- **Inafanya kazi bila mtandao** baada ya kufunguliwa mara ya kwanza, na unaweza kuiweka kwenye skrini ya simu.

## Mambo ya kujua

- **Mchango wa tov haishiki, haitumi wala haiombi pesa.** Ni daftari lenye hesabu na kitufe cha kusambaza.
- **Orodha inakaa kwenye simu yako tu.** Hakuna seva inayoiona. Ukurasa unapakua faili zake zenyewe tu.
- **Orodha inaweza kupotea** ukipoteza simu, ukifuta kumbukumbu za kivinjari, au simu ikizifuta yenyewe.
  Hifadhi nakala mara kwa mara. Kwenye iPhone, weka ukurasa kwenye Home Screen **kabla** ya kuanza orodha:
  bila hivyo iPhone hufuta orodha baada ya siku 7 bila kufunguliwa.
- **Faili la nakala lina majina na namba za wachangiaji.** Litume kwako mwenyewe tu.
- **Mchango haiwezi kuthibitisha kwamba malipo ni ya kweli.** SMS itoke kwenye simu yako mwenyewe.
- Leo inasoma SMS za kupokea pesa za M-Pesa (Kiswahili na English). Mitandao mingine: andika kiasi mwenyewe.

## Tengeneza nakala yako

Hakuna cha kuweka kwenye kompyuta wala kujenga. Ni HTML, CSS na JavaScript tu.

1. Bonyeza **Fork** kwenye GitHub.
2. Nenda **Settings › Pages**, chagua tawi `main`, kisha hifadhi.
3. Baada ya dakika chache nakala yako ipo kwenye `https://<jina-lako>.github.io/mchango/`.

Kumbuka: kurasa zote za `<jina-lako>.github.io` zinatumia hifadhi moja ya kivinjari. Ukurasa mwingine wako
kwenye anwani hiyo unaweza kusoma orodha. Kwa matumizi ya kweli tumia anwani yake yenyewe.

Ukibadilisha chochote, badilisha pia namba ya toleo (`VERSION`) kila inapoonekana; `npm test` itakuambia
ulipoisahau. Hivyo simu zilizokwisha kuifungua hupata toleo jipya.

---

# Mchango by tov (English)

A contribution list that lives on the treasurer's phone. *Mchango* is the money a family and friends collect
for a wedding, a funeral, a graduation or a medical bill in Tanzania. One committee member writes down what
each person pledged, records the payments as they come in, and sends a short, clean list to the committee's
WhatsApp group.

Use it: **https://mchango.tov.co.tz** (free, no sign-up).

## What it does

- **People and pledges.** One at a time, or many at once: one line per person, such as `Zawadi Tumaini 50,000`
  or `Furaha 100k`.
- **Payments.** Paste an M-Pesa "money received" SMS: it reads the amount, name, number, time and transaction
  ID and suggests the person. Or type a cash amount. Nothing is saved before you confirm, and the same
  transaction cannot be recorded twice.
- **The arithmetic.** Target, Pledged, Paid in, Still owed. Status is always a word, never colour alone.
- **Share.** A short text for WhatsApp. It never carries anyone's phone number.
- **Save a copy.** Send the list as a file to your own WhatsApp number, or download it, and open it on
  another phone. A file coming back is treated as untrusted and checked in full before anything changes.
- **Works with no network** after the first visit, and can be put on the phone's home screen.

## What to know

- **It never holds, moves or requests money.** It is a notebook with arithmetic and a share button.
- **The list stays on the phone.** There is no server storage, no account and no analytics. The page only
  fetches its own files from its own address.
- **A list can be lost** with the phone, when browser data is cleared, or when the browser clears it by
  itself. Save a copy often. On iPhone, add the page to the Home Screen **before** starting a list: otherwise
  Safari deletes a site's data after 7 days without a visit.
- **The copy file holds contributors' names and numbers.** Send it only to yourself.
- **It cannot prove a payment is real.** Paste only an SMS from your own inbox.
- Today it reads M-Pesa "received" messages (Kiswahili and English). For other networks, type the amount.
  A real sample from another wallet is welcome as an issue, **with the number, name, transaction ID and
  amounts changed first**.

## Run your own copy

No install and no build step: plain HTML, CSS and JavaScript (ES modules), no run-time dependency.

1. Fork this repository.
2. In **Settings › Pages**, choose the `main` branch and save.
3. A few minutes later your copy is at `https://<you>.github.io/mchango/`.

Mind that every page under `<you>.github.io` shares one browser storage, so another page of yours at that
address could read the lists. For real use, give it an address of its own.

To try it on your computer:

```
node tests/serve.mjs 8080 . /
```

then open `http://localhost:8080/`.

## Files

| File | What it holds |
|---|---|
| `index.html`, `style.css` | the page and its look |
| `app.js` | the screens and every text (Kiswahili and English, in one table) |
| `parse.js` | reading a payment SMS, phone numbers, the many-lines-at-once entry, time in East Africa Time |
| `store.js` | the lists on the phone (IndexedDB) and the sums |
| `share.js` | the WhatsApp text |
| `backup.js` | making a copy file and checking one that comes back |
| `sw.js`, `manifest.webmanifest`, `icons/` | working with no network, and the home screen |
| `tests/` | the tests |

## Tests

```
npm test
```

Needs Node 22 or newer and Google Chrome; nothing is installed. It runs the unit tests under three time
zones, drives the page in a real browser at phone, tablet and desktop widths (also with the network off, and
from version 1 to version 2), and then breaks the code on purpose in eleven places to prove a test notices.

To check a copy that is already being served (every file byte for byte, then the whole run in the browser):

```
LIVE=https://<its address>/ node tests/browser.mjs
```

If you change anything, change the version (`VERSION`) everywhere it appears; `tests/version.test.mjs` tells
you where you forgot. That is how phones that already opened the page get the new version.

## Licence

MIT. See `LICENSE`.
