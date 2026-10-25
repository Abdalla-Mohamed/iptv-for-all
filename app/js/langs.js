/* Language helpers for audio / subtitle choice: "ara", "ar-SA", "Arabic (5.1)" all mean Arabic.
 * Works in the browser and in Node (for tests).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.IPTV = root.IPTV || {}).Langs = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // iso2, iso3 codes (bibliographic + terminological) and English names
  var TABLE = [
    ['en', ['eng'], ['english']],
    ['ar', ['ara'], ['arabic']],
    ['fr', ['fra', 'fre'], ['french', 'français', 'francais']],
    ['es', ['spa'], ['spanish', 'español', 'espanol', 'castilian']],
    ['de', ['deu', 'ger'], ['german', 'deutsch']],
    ['tr', ['tur'], ['turkish', 'türkçe', 'turkce']],
    ['it', ['ita'], ['italian', 'italiano']],
    ['pt', ['por'], ['portuguese', 'português', 'portugues']],
    ['ru', ['rus'], ['russian']],
    ['fa', ['fas', 'per'], ['persian', 'farsi']],
    ['ur', ['urd'], ['urdu']],
    ['hi', ['hin'], ['hindi']],
    ['nl', ['nld', 'dut'], ['dutch', 'nederlands']],
    ['pl', ['pol'], ['polish']],
    ['ku', ['kur'], ['kurdish']],
    ['zh', ['zho', 'chi'], ['chinese', 'mandarin', 'cantonese']],
    ['ja', ['jpn'], ['japanese']],
    ['ko', ['kor'], ['korean']]
  ];

  var byCode = {}, byName = [];
  TABLE.forEach(function (row) {
    byCode[row[0]] = row[0];
    row[1].forEach(function (c) { byCode[c] = row[0]; });
    row[2].forEach(function (n) { byName.push([n, row[0]]); });
  });

  /** Menu entries for the settings screens: value '' means "no preference". */
  var OPTIONS = [{ value: '', label: 'None' }].concat(TABLE.map(function (r) {
    return { value: r[0], label: r[2][0].charAt(0).toUpperCase() + r[2][0].slice(1) };
  }));

  /** "ARA", "ar-SA", "Arabic (5.1)", "fre" -> 'ar' / 'fr'; '' if not recognised. */
  function key(s) {
    if (!s) return '';
    s = String(s).toLowerCase().trim();
    var code = s.split(/[-_ ]/)[0];
    if (byCode[code]) return byCode[code];
    for (var i = 0; i < byName.length; i++) {
      if (s.indexOf(byName[i][0]) >= 0) return byName[i][1];
    }
    return '';
  }

  /** The language of a track object {lang, language, label, name}; first field that resolves wins. */
  function ofTrack(t) {
    return key(t.lang) || key(t.language) || key(t.label) || key(t.name);
  }

  /** Index of the first track in `tracks` that matches the preferred language code, or -1. */
  function pick(tracks, pref) {
    if (!pref) return -1;
    for (var i = 0; i < tracks.length; i++) if (ofTrack(tracks[i]) === pref) return i;
    return -1;
  }

  /** Human label: "Arabic", "English (commentary)" etc. Falls back to the raw label or "Track n". */
  function label(t, n) {
    var k = ofTrack(t), raw = t.label || t.name || '';
    if (/handler|core media|^audio$|^und$/i.test(raw)) raw = '';       // muxer boilerplate, not a title
    var nice = '';
    if (k) for (var i = 0; i < TABLE.length; i++) if (TABLE[i][0] === k) nice = TABLE[i][2][0].charAt(0).toUpperCase() + TABLE[i][2][0].slice(1);
    if (nice && raw && key(raw) !== k) return nice + ' (' + raw + ')';
    if (nice && raw && raw.toLowerCase() !== nice.toLowerCase() && raw.length > nice.length) return raw;
    return nice || raw || 'Track ' + (n + 1);
  }

  return { key: key, ofTrack: ofTrack, pick: pick, label: label, OPTIONS: OPTIONS };
});
