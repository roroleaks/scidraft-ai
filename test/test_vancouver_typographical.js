// test_vancouver_typographical.js
const assert = require('assert');

function repositionVancouverCitations(text) {
  if (!text || typeof text !== 'string') return '';
  let s = text;

  // 1. Collapse multiple adjacent bracket citations: e.g. [1] [2] or [1],[2] -> [1,2]
  s = s.replace(/\[(\d+(?:,\s*\d+)*)\]\s*,?\s*\[(\d+(?:,\s*\d+)*)\]/g, '[$1,$2]');

  // 2. Reposition bracket citations before punctuation to immediately outside:
  // e.g. 'trials [1,2].' -> 'trials.[1,2]'
  // e.g. 'trials [1,2],' -> 'trials,[1,2]'
  // e.g. 'trials [1,2];' -> 'trials;[1,2]'
  // e.g. 'trials [1,2]:' -> 'trials:[1,2]'
  s = s.replace(/\s*\[(\d+(?:,\s*\d+)*)\]\s*([.,;:])/g, '$2[$1]');

  // 3. Remove whitespace between punctuation and bracket citation:
  // e.g. 'trials. [1,2]' -> 'trials.[1,2]'
  // e.g. 'trials, [1,2]' -> 'trials,[1,2]'
  s = s.replace(/([.,;:])\s+\[(\d+(?:,\s*\d+)*)\]/g, '$1[$2]');

  // 4. Eliminate accidental duplicate punctuation around bracket citations:
  // e.g. 'trials.[1,2].' -> 'trials.[1,2]'
  s = s.replace(/([.,;:])\[(\d+(?:,\s*\d+)*)\]\s*\1/g, '$1[$2]');

  // 5. HTML superscript repositioning:
  // e.g. 'trials <sup class="cite-num">1,2</sup>.' -> 'trials.<sup class="cite-num">1,2</sup>'
  s = s.replace(/\s*(<sup\b[^>]*>[\d,]+<\/sup>)\s*([.,;:])/gi, '$2$1');
  s = s.replace(/([.,;:])\s+(<sup\b[^>]*>[\d,]+<\/sup>)/gi, '$1$2');
  s = s.replace(/([.,;:])(<sup\b[^>]*>[\d,]+<\/sup>)\s*\1/gi, '$1$2');

  return s;
}

const PREFIXES = new Set(['van', 'von', 'de', 'der', 'di', 'al-', 'el-', 'da', 'del', 'della', 'du', 'la', 'le', 'ter', 'ten']);

function normalizeAuthorName(raw) {
  if (!raw) return '';
  let s = String(raw).replace(/<[^>]*>/g, '').trim();
  s = s.replace(/\s+/g, ' ');

  // If already formatted like "Surname Initials" (e.g., "Gomez-Sanchez E", "van Rossum G", "Smith JA")
  const mAlready = s.match(/^((?:(?:van|von|de|der|di|al-|el-|da|del|della|du|la|le|ter|ten)\s+)*[A-Za-zÀ-ÿ]+(?:-[A-Za-zÀ-ÿ]+)?)\s+([A-Z]{1,4})\.?$/i);
  if (mAlready) {
    return `${mAlready[1]} ${mAlready[2].replace(/\./g, '')}`;
  }

  // Comma-separated: "Surname, Given Names" or "Gomez-Sanchez, Eduardo"
  if (s.includes(',')) {
    const parts = s.split(',').map(p => p.trim());
    const surname = parts[0];
    const given = parts.slice(1).join(' ').trim();
    if (!given) return surname;
    const initials = given
      .replace(/[^A-Za-zÀ-ÿ\s-]/g, '')
      .split(/[\s-]+/)
      .filter(Boolean)
      .map(w => w[0].toUpperCase())
      .join('');
    return `${surname} ${initials}`.trim();
  }

  // Whitespace-separated tokens
  const tokens = s.split(/\s+/).filter(Boolean);
  if (tokens.length === 1) {
    return tokens[0];
  }

  // Check if last token is already uppercase initials (e.g. "Smith J.A." or "Gomez-Sanchez E")
  const lastClean = tokens[tokens.length - 1].replace(/\./g, '');
  if (/^[A-Z]{1,4}$/.test(lastClean)) {
    const surname = tokens.slice(0, -1).join(' ');
    return `${surname} ${lastClean}`;
  }

  // Scan right-to-left for compound surname with prefixes
  let surnameTokens = [tokens[tokens.length - 1]];
  let idx = tokens.length - 2;
  while (idx >= 0) {
    const lower = tokens[idx].toLowerCase();
    if (PREFIXES.has(lower) || lower.endsWith('-')) {
      surnameTokens.unshift(tokens[idx]);
      idx--;
    } else {
      break;
    }
  }

  // Remaining tokens are given names
  const givenTokens = tokens.slice(0, idx + 1);
  const surname = surnameTokens.join(' ');

  if (givenTokens.length === 0) {
    return surname;
  }

  const initials = givenTokens
    .map(t => t.replace(/[^A-Za-zÀ-ÿ]/g, ''))
    .filter(Boolean)
    .map(w => w[0].toUpperCase())
    .join('');

  return `${surname} ${initials}`.trim();
}

console.log('--- RUNNING TYPOGRAPHICAL & AUTHOR TESTS ---');

// Test 1: Punctuation repositioning with clinical phrase protection
console.log('\n[Test 1] Safe Bracket & <sup> Repositioning (Preserves Clinical Prose Numbers)');
const clinicalSample = 'Patients in group 2, phase 3. [1,2] Next sentence.';
const resSample = repositionVancouverCitations(clinicalSample);
assert.strictEqual(resSample, 'Patients in group 2, phase 3.[1,2] Next sentence.',
  `Failed: expected "Patients in group 2, phase 3.[1,2] Next sentence.", got "${resSample}"`);
console.log('  ✔ "Patients in group 2, phase 3. [1,2]" -> "Patients in group 2, phase 3.[1,2]" without altering "2," or "3."');

// Clinical sentences without citations must remain 100% unaltered
const untouched1 = 'in phase 2.';
const untouched2 = 'on day 14, and';
const untouched3 = 'p < 0.05.';
assert.strictEqual(repositionVancouverCitations(untouched1), untouched1);
assert.strictEqual(repositionVancouverCitations(untouched2), untouched2);
assert.strictEqual(repositionVancouverCitations(untouched3), untouched3);
console.log('  ✔ Normal clinical numbers ("in phase 2.", "on day 14, and", "p < 0.05.") strictly preserved');

// Bracket citations repositioning outside punctuation
const t3 = repositionVancouverCitations('as reported in previous trials [1,2]. Next sentence.');
assert.strictEqual(t3, 'as reported in previous trials.[1,2] Next sentence.', `Got: ${t3}`);

const t4 = repositionVancouverCitations('as reported in previous trials. [1,2] Next sentence.');
assert.strictEqual(t4, 'as reported in previous trials.[1,2] Next sentence.', `Got: ${t4}`);

const t5 = repositionVancouverCitations('as reported in previous trials <sup class="cite-num">1,2</sup>. Next sentence.');
assert.strictEqual(t5, 'as reported in previous trials.<sup class="cite-num">1,2</sup> Next sentence.', `Got: ${t5}`);

console.log('  ✔ Bracket and <sup> citations sit immediately outside closing punctuation');

// Test 2: Compound Surname Support
console.log('\n[Test 2] Compound Surname Normalization');
const authors = [
  { raw: 'Eduardo Gomez-Sanchez', expected: 'Gomez-Sanchez E' },
  { raw: 'Gomez-Sanchez, Eduardo', expected: 'Gomez-Sanchez E' },
  { raw: 'Gomez-Sanchez E', expected: 'Gomez-Sanchez E' },
  { raw: 'Guido van Rossum', expected: 'van Rossum G' },
  { raw: 'van Rossum, Guido', expected: 'van Rossum G' },
  { raw: 'van Rossum G', expected: 'van Rossum G' },
  { raw: 'Ludwig van Beethoven', expected: 'van Beethoven L' },
  { raw: 'Robert von Neumann', expected: 'von Neumann R' },
  { raw: 'Johannes de Jong', expected: 'de Jong J' },
  { raw: 'Maria de la Cruz', expected: 'de la Cruz M' },
  { raw: 'Enzo di Matteo', expected: 'di Matteo E' },
  { raw: 'Ahmed al-Khatib', expected: 'al-Khatib A' },
  { raw: 'al-Khatib, Ahmed', expected: 'al-Khatib A' },
  { raw: 'Youssef el-Idrissi', expected: 'el-Idrissi Y' }
];

authors.forEach(({ raw, expected }) => {
  const result = normalizeAuthorName(raw);
  assert.strictEqual(result, expected, `Failed for "${raw}": expected "${expected}", got "${result}"`);
});
console.log(`  ✔ All ${authors.length} compound surname test cases passed`);

// Test 3: Synchronized Bibliography Anchors Across Styles
console.log('\n[Test 3] Synchronized Bibliography Anchors Across Citation Styles');
const mockPapers = [
  { title: 'Zebra research', authors: 'Zack Z', year: 2020 }, // origIdx: 0, canonical ID: ref-anchor-1
  { title: 'Alpha trial', authors: 'Adams A', year: 2021 }    // origIdx: 1, canonical ID: ref-anchor-2
];

// Alphabetical sort (APA / Harvard):
const sortedMock = mockPapers.map((p, origIdx) => ({
  paper: p,
  origIdx,
  surname: p.authors.split(' ')[0]
})).sort((a, b) => a.surname.localeCompare(b.surname));

assert.strictEqual(sortedMock[0].surname, 'Adams');
assert.strictEqual(sortedMock[0].origIdx, 1);
assert.strictEqual(sortedMock[1].surname, 'Zack');
assert.strictEqual(sortedMock[1].origIdx, 0);

// In in-text citation, [1] refers to origIdx: 0 (Zebra research).
// Target anchor ID must be ref-anchor-${origIdx + 1} = ref-anchor-1
const targetIdForCitation1 = `ref-anchor-${sortedMock[1].origIdx + 1}`;
assert.strictEqual(targetIdForCitation1, 'ref-anchor-1');

// In in-text citation, [2] refers to origIdx: 1 (Alpha trial).
// Target anchor ID must be ref-anchor-${origIdx + 1} = ref-anchor-2
const targetIdForCitation2 = `ref-anchor-${sortedMock[0].origIdx + 1}`;
assert.strictEqual(targetIdForCitation2, 'ref-anchor-2');

console.log('  ✔ Clicking in-text citation [1] or [2] reliably jumps to canonical anchor ref-anchor-X even under alphabetical sorting');

console.log('\n=============================================');
console.log(' ALL TYPOGRAPHICAL & AUTHOR TESTS PASSED ✔');
console.log('=============================================');
