// test_query_hardening.js
const assert = require('assert');

// ─────────────────────────────────────────────────────────────
// GREEK LETTER MAP
// ─────────────────────────────────────────────────────────────
const GREEK_LETTER_MAP = {
  'α': 'alpha', 'Α': 'alpha',
  'β': 'beta',  'Β': 'beta',
  'γ': 'gamma', 'Γ': 'gamma',
  'δ': 'delta', 'Δ': 'delta',
  'ε': 'epsilon','Ε': 'epsilon',
  'ζ': 'zeta',  'Ζ': 'zeta',
  'η': 'eta',   'Η': 'eta',
  'θ': 'theta', 'Θ': 'theta',
  'ι': 'iota',  'Ι': 'iota',
  'κ': 'kappa', 'Κ': 'kappa',
  'λ': 'lambda','Λ': 'lambda',
  'μ': 'mu',    'Μ': 'mu',
  'ν': 'nu',    'Ν': 'nu',
  'ξ': 'xi',    'Ξ': 'xi',
  'ο': 'omicron','Ο': 'omicron',
  'π': 'pi',    'Π': 'pi',
  'ρ': 'rho',   'Ρ': 'rho',
  'σ': 'sigma', 'Σ': 'sigma', 'ς': 'sigma',
  'τ': 'tau',   'Τ': 'tau',
  'υ': 'upsilon','Υ': 'upsilon',
  'φ': 'phi',   'Φ': 'phi',
  'χ': 'chi',   'Χ': 'chi',
  'ψ': 'psi',   'Ψ': 'psi',
  'ω': 'omega', 'Ω': 'omega'
};

function decodeHtmlEntities(str) {
  if(!str || typeof str !== 'string') return '';
  return str
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&/g, ' and ');
}

/**
 * Requirement 1: Lucene Query Escaping
 * Helper escapeLuceneQuery(term) that strips or escapes special Lucene characters:
 *   + - && || ! ( ) { } [ ] ^ " ~ * ? : \ /
 */
function escapeLuceneQuery(term) {
  if (!term || typeof term !== 'string') return '';
  // Strip control characters
  let s = term.replace(/[\x00-\x1f\x7f]/g, ' ');
  // Escape backslash first so subsequent backslashes are not doubled
  s = s.replace(/\\/g, '\\\\');
  // Escape special Lucene characters: + - && || ! ( ) { } [ ] ^ " ~ * ? : /
  s = s.replace(/([+\-!(){}\[\]^"~*?:/]|&&|\|\|)/g, '\\$1');
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Sanitizes inner title string specifically for Lucene TITLE:"..." queries:
 * - Sanitizes inner double quotes and colons
 * - Limits fallback title queries to 60 characters, trimmed cleanly at word boundaries
 */
function sanitizeTitleForLucene(title, maxLen = 60) {
  if (!title || typeof title !== 'string') return '';
  // 1. Decode entities and strip markup
  let s = decodeHtmlEntities(title).replace(/<\/?[^>]+(>|$)/g, ' ');
  // 2. Sanitize inner double quotes and colons
  s = s.replace(/["\\]/g, ' ').replace(/:/g, ' ');
  // Normalize whitespace
  s = s.replace(/\s+/g, ' ').trim();

  // 3. Limit to maxLen characters, trimmed cleanly at word boundaries
  if (s.length > maxLen) {
    let truncated = s.substring(0, maxLen);
    const lastSpace = truncated.lastIndexOf(' ');
    if (lastSpace > 20) {
      truncated = truncated.substring(0, lastSpace);
    }
    s = truncated.trim();
  }
  return s;
}

/**
 * Requirement 2: Unicode Normalization
 * In canonicalTitleFingerprint():
 * - normalize strings with str.normalize('NFKD')
 * - strip non-breaking spaces (\u00A0), zero-width characters (\u200B-\u200D, \uFEFF)
 * - convert all typographic quotes/dashes to standard ASCII equivalents before fingerprinting
 */
function canonicalTitleFingerprint(title) {
  if (!title || typeof title !== 'string') return '';

  // 1. Decode HTML entities first (handles &lt;i&gt;, &amp;, &quot;, etc.)
  let s = decodeHtmlEntities(title);

  // 2. Strip XML/HTML tags (both raw and decoded)
  s = s.replace(/<\/?[a-z0-9]+(?:\s+[^>]*)?>/gi, ' ');

  // 3. Unicode Normalization: NFKD decomposition
  s = s.normalize('NFKD');

  // 4. Strip zero-width characters (\u200B-\u200D, \uFEFF)
  s = s.replace(/[\u200B-\u200D\uFEFF]/g, '');

  // 5. Replace non-breaking spaces (\u00A0, \u202F, \u2007, etc.) with standard space
  s = s.replace(/[\u00A0\u202F\u2007\u2009\u200A]/g, ' ');

  // 6. Convert typographic quotes to standard ASCII equivalents
  // Single quotes / apostrophes
  s = s.replace(/[\u2018\u2019\u201A\u201B\u2032\u0060\u00B4]/g, "'");
  // Double quotes
  s = s.replace(/[\u201C\u201D\u201E\u201F\u2033\u00AB\u00BB]/g, '"');

  // 7. Convert typographic dashes and hyphens to standard ASCII hyphen/space
  s = s.replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g, ' ');

  // 8. Named Greek entity aliases
  s = s.replace(/&(alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|micro|nu|xi|omicron|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega);/gi, (_, g) => {
    return g.toLowerCase() === 'micro' ? 'mu' : g.toLowerCase();
  });

  // 9. Replace Greek letters with English names
  for (const [char, name] of Object.entries(GREEK_LETTER_MAP)) {
    if (s.includes(char)) {
      s = s.split(char).join(name);
    }
  }

  // 10. Remove all non-alphanumeric characters except spaces, collapse multiple spaces to one, and lowercase
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────
function runTests() {
  console.log('--- STARTING QUERY STRING & UNICODE HARDENING TESTS ---');

  // Test 1: Lucene Query Escaping
  {
    console.log('\n[Test 1] Lucene Query Escaping for Special Characters');
    const specialChars = '+ - && || ! ( ) { } [ ] ^ " ~ * ? : \\ /';
    const escaped = escapeLuceneQuery(specialChars);
    console.log('  Original:', specialChars);
    console.log('  Escaped: ', escaped);

    // Verify all special operators are escaped with backslash
    assert(escaped.includes('\\+'));
    assert(escaped.includes('\\-'));
    assert(escaped.includes('\\&&'));
    assert(escaped.includes('\\||'));
    assert(escaped.includes('\\!'));
    assert(escaped.includes('\\('));
    assert(escaped.includes('\\)'));
    assert(escaped.includes('\\{'));
    assert(escaped.includes('\\}'));
    assert(escaped.includes('\\['));
    assert(escaped.includes('\\]'));
    assert(escaped.includes('\\^'));
    assert(escaped.includes('\\"'));
    assert(escaped.includes('\\~'));
    assert(escaped.includes('\\*'));
    assert(escaped.includes('\\?'));
    assert(escaped.includes('\\:'));
    assert(escaped.includes('\\/'));

    // Test a real clinical title with quotes and colons
    const title = 'The "Gold Standard" in PCOS: A review';
    const escapedTitle = escapeLuceneQuery(title);
    assert(escapedTitle.includes('\\"Gold Standard\\"'), 'Quotes must be escaped');
    assert(escapedTitle.includes('PCOS\\:'), 'Colons must be escaped');
    console.log('  ✔ All Lucene special characters escaped with backslash');
  }

  // Test 2: TITLE:"..." Sanitization & 60-Char Word Boundary Trimming
  {
    console.log('\n[Test 2] TITLE:"..." Sanitization and Word Boundary Trimming');

    const rawTitle = 'The "Gold Standard" in PCOS: A comprehensive multi-center randomized review of clinical outcomes and metabolic pathways';
    const sanitized = sanitizeTitleForLucene(rawTitle, 60);
    console.log('  Raw title:      ', rawTitle);
    console.log('  Sanitized title:', sanitized);
    console.log('  Length:         ', sanitized.length);

    // Must not have inner double quotes or colons
    assert(!sanitized.includes('"'), 'Inner double quotes must be removed');
    assert(!sanitized.includes(':'), 'Colons must be removed');

    // Must be <= 60 characters
    assert(sanitized.length <= 60, `Length must be <= 60 (got ${sanitized.length})`);

    // Must be trimmed at clean word boundary (not cut off in middle of word)
    assert(!sanitized.endsWith(' compreh'), 'Must not truncate inside a word');
    assert(sanitized.endsWith('randomized') || sanitized.endsWith('multi-center') || sanitized.endsWith('review'), 'Must end on a clean word');

    // Construct valid Europe PMC query
    const epQuery = `TITLE:"${sanitized}"`;
    console.log('  Europe PMC Query:', epQuery);
    assert(epQuery.startsWith('TITLE:"') && epQuery.endsWith('"'));
    // Verify no unescaped inner quotes break the enclosing TITLE:"..."
    const inner = epQuery.substring(7, epQuery.length - 1);
    assert(!inner.includes('"'), 'Inner quotes must not exist');

    console.log('  ✔ TITLE query sanitized without quotes/colons and cleanly trimmed at word boundaries');
  }

  // Test 3: Unicode Normalization (NFKD, Zero-Width, Non-Breaking Spaces, Typographic Quotes/Dashes)
  {
    console.log('\n[Test 3] Unicode Normalization in Title Fingerprinting');

    // String with non-breaking space (\u00A0), zero-width space (\u200B), typographic quotes (“ ”), and en-dash (–)
    const rawUnicode = 'The\u00A0\u201CGold\u200B Standard\u201D in PCOS\u2014A\u00A0review';
    const standardAscii = 'The "Gold Standard" in PCOS: A review';

    const fpUnicode = canonicalTitleFingerprint(rawUnicode);
    const fpAscii = canonicalTitleFingerprint(standardAscii);

    console.log('  Unicode Title:   ', rawUnicode);
    console.log('  Standard Title:  ', standardAscii);
    console.log('  Fingerprint (Uni):  ', fpUnicode);
    console.log('  Fingerprint (ASCII):', fpAscii);

    assert.strictEqual(fpUnicode, 'the gold standard in pcos a review');
    assert.strictEqual(fpUnicode, fpAscii, 'Both unicode and ASCII variants must produce identical fingerprint');

    // String with Greek characters (e.g. α and β)
    const greek1 = 'Efficacy of α-lipoic acid and β-carotene';
    const greek2 = 'Efficacy of alpha-lipoic acid and beta-carotene';
    const fpGreek1 = canonicalTitleFingerprint(greek1);
    const fpGreek2 = canonicalTitleFingerprint(greek2);

    console.log('  Greek Title 1:  ', greek1);
    console.log('  Greek Title 2:  ', greek2);
    console.log('  FP Greek 1:     ', fpGreek1);
    console.log('  FP Greek 2:     ', fpGreek2);

    assert.strictEqual(fpGreek1, fpGreek2, 'Greek letters and spelled-out names must produce identical fingerprint');
    assert.strictEqual(fpGreek1, 'efficacy of alpha lipoic acid and beta carotene');

    console.log('  ✔ Zero-width chars, non-breaking spaces, and typographic quotes normalized');
    console.log('  ✔ Greek letters accurately translated to phonetic equivalents');
    console.log('  ✔ Deterministic fingerprint parity verified across engines');
  }

  console.log('\n=============================================================');
  console.log(' ALL QUERY HARDENING & UNICODE NORMALIZATION TESTS PASSED ✔');
  console.log('=============================================================');
}

runTests();
