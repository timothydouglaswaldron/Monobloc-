/* _filter.js — blocks guest notes that contain racial / ethnic slurs.
   Notes auto-publish now, so this is the only gate. We normalize leetspeak,
   accents, and repeated / separated letters to resist trivial evasion, then
   match a curated slur list. Tuned against common false positives:
     • the country "Niger" / "Nigeria" use a single g — the slur uses "gg"
     • innocent words like "snigger" / "niggard" are removed before the scan
     • short slurs that collide with normal words ("coon" in "raccoon",
       "spic" in "suspicious") are matched only as whole words.
   Underscore prefix = not routed as an endpoint, but importable. */

const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g', '@': 'a', '$': 's', '!': 'i', '|': 'i', '+': 't' };

const DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g');
function normalize(s) {
  const lower = String(s).toLowerCase().normalize('NFKD').replace(DIACRITICS, '');
  let out = '';
  for (const ch of lower) out += (LEET[ch] !== undefined ? LEET[ch] : ch);
  return out;
}

// Short slurs that collide with innocent substrings — matched as whole words only.
const WORD_SLURS = [
  'coon', 'coons', 'wop', 'wops', 'spic', 'spick', 'spics', 'spicks',
  'chink', 'chinks', 'jap', 'japs', 'dago', 'dagos', 'paki', 'pakis',
  'darkie', 'darky', 'darkies', 'sambo', 'sambos', 'abo', 'abos',
  'gook', 'gooks', 'kike', 'kikes', 'wog', 'wogs', 'gyppo', 'gippo',
  'wetback', 'wetbacks',
];
const WORD_RE = new RegExp('\\b(' + WORD_SLURS.join('|') + ')\\b');

// Slurs with no common innocent collisions — matched anywhere in the
// separator-stripped text, so spaced-out evasion ("n i g g e r") is caught.
const SUBSTRING_RE = [
  /nigg+[aeiou]/,        // nigga / nigger / etc. (double-g avoids "Niger"/"Nigeria")
  /chinky/,
  /beaner/,
  /raghead/,
  /towelhead/,
  /sandnig/,
  /kaff?ir/,
  /zipperhead/,
  /jigg?aboo/,
  /porchmonkey/,
  /spearchucker/,
];

// Innocent words that would otherwise trip the n-word substring test.
const SAFE_RE = /\b(snigger(s|ed|ing)?|niggard(ly|s)?)\b/g;

function hasSlur(input) {
  const spaced = normalize(input);
  if (WORD_RE.test(spaced)) return true;
  const despaced = spaced.replace(SAFE_RE, ' ').replace(/[^a-z]/g, '');
  return SUBSTRING_RE.some((re) => re.test(despaced));
}

module.exports = { hasSlur };
