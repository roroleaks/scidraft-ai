// test_vancouver_ref.js
const assert = require('assert');

// ─────────────────────────────────────────────────────────────
// REFERENCE GENERATION & VANCOUVER FORMATTING ENGINE
// ─────────────────────────────────────────────────────────────

function cleanHtmlText(str) {
  if (!str) return '';
  return String(str)
    .replace(/<\/?[^>]+(>|$)/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function normalizeDoi(doi) {
  if (!doi) return '';
  return String(doi)
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .trim();
}

/**
 * Standardize single author name to: "Surname Initials" without internal periods.
 * Examples:
 *   "Raouf Roshdy" -> "Roshdy R"
 *   "John A. Smith" -> "Smith JA"
 *   "Smith, John A." -> "Smith JA"
 *   "Smith J.A." -> "Smith JA"
 *   "van der Valk, P." -> "van der Valk P"
 */
function normalizeAuthorName(raw) {
  if (!raw) return '';
  let s = cleanHtmlText(String(raw)).trim();
  s = s.replace(/\s+/g, ' ');

  // If already formatted like "Surname Initials" (e.g., "Roshdy R", "Smith JA")
  const mAlready = s.match(/^([A-Za-zÀ-ÿ\-']+(?:\s+[a-z]{1,4}\b)*)\s+([A-Z]{1,4})\.?$/);
  if (mAlready) {
    return `${mAlready[1]} ${mAlready[2].replace(/\./g, '')}`;
  }

  // If "Surname, Firstname Middlename" or "Surname, Initials"
  if (s.includes(',')) {
    const parts = s.split(',').map(p => p.trim());
    const surname = parts[0];
    const given = parts.slice(1).join(' ').trim();
    if (!given) return surname;
    // Extract initials from given name tokens
    const initials = given
      .replace(/[^A-Za-zÀ-ÿ\s]/g, '')
      .split(/\s+/)
      .filter(Boolean)
      .map(w => w[0].toUpperCase())
      .join('');
    return `${surname} ${initials}`.trim();
  }

  // If "Firstname [Middlename] Surname"
  const tokens = s.split(/\s+/).filter(Boolean);
  if (tokens.length === 1) {
    return tokens[0];
  }

  // Check if last token is already uppercase initials (e.g. "Smith J.A.")
  const lastClean = tokens[tokens.length - 1].replace(/\./g, '');
  if (/^[A-Z]{1,4}$/.test(lastClean)) {
    const surname = tokens.slice(0, -1).join(' ');
    return `${surname} ${lastClean}`;
  }

  // Standard: "Firstname Middlename Surname" -> Surname = last token, initials = preceding tokens
  const surname = tokens[tokens.length - 1];
  const givenTokens = tokens.slice(0, -1);
  const initials = givenTokens
    .map(t => t.replace(/[^A-Za-zÀ-ÿ]/g, ''))
    .filter(Boolean)
    .map(w => w[0].toUpperCase())
    .join('');
  return `${surname} ${initials}`.trim();
}

/**
 * Parses raw author list input (string or array) into normalized author strings.
 */
function parseRawAuthors(authorsInput) {
  if (!authorsInput) return [];
  if (Array.isArray(authorsInput)) {
    return authorsInput
      .map(a => typeof a === 'object' && a !== null ? (a.name || a.authorName || `${a.lastName || ''} ${a.firstName || ''}`.trim()) : String(a))
      .map(normalizeAuthorName)
      .filter(Boolean);
  }

  const str = cleanHtmlText(String(authorsInput)).trim();
  if (!str || str === 'Unknown Authors' || str === '—' || str.toLowerCase() === 'anonymous') {
    return [];
  }

  // Clean out connecting words
  const cleanStr = str.replace(/\band\b/gi, ',').trim();

  // Split by semicolon if present
  if (cleanStr.includes(';')) {
    return cleanStr.split(/\s*;\s*/).map(normalizeAuthorName).filter(Boolean);
  }

  // If comma separated: determine if authors are "Surname, Firstname" pairs or "Surname Initials" list
  const commaTokens = cleanStr.split(/\s*,\s*/).filter(Boolean);
  
  // If tokens look like ["Smith JA", "Roshdy R", "Doe J"]
  const allLookAbbr = commaTokens.every(t => /^[A-Za-zÀ-ÿ\-']+\s+[A-Z]{1,4}\.?$/.test(t.trim()) || t.split(' ').length <= 2);
  if (allLookAbbr && commaTokens.length > 1) {
    return commaTokens.map(normalizeAuthorName).filter(Boolean);
  }

  // If tokens are pairs of Surname, Given Name: ["Smith", "John A.", "Roshdy", "Raouf"]
  if (commaTokens.length >= 2 && commaTokens.length % 2 === 0) {
    const pairs = [];
    let isPair = true;
    for (let i = 0; i < commaTokens.length; i += 2) {
      // First is surname (single word), second is given/initials
      if (commaTokens[i].split(/\s+/).length > 2) {
        isPair = false;
        break;
      }
      pairs.push(`${commaTokens[i]}, ${commaTokens[i + 1]}`);
    }
    if (isPair) {
      return pairs.map(normalizeAuthorName).filter(Boolean);
    }
  }

  return commaTokens.map(normalizeAuthorName).filter(Boolean);
}

/**
 * Requirement 1: Author Formatting
 * - 1 to 6 authors: list all authors separated by commas.
 * - > 6 authors: list the first 6 authors, followed by ", et al."
 * - If no author is supplied, use institutional source or default to "Anonymous."
 */
function formatVancouverAuthors(paper) {
  const authorsList = parseRawAuthors(paper.authors);

  if (authorsList.length === 0) {
    const institution = cleanHtmlText(paper.institution || paper.corporateAuthor || paper.organization || '');
    if (institution) {
      return institution.endsWith('.') ? institution : `${institution}.`;
    }
    return 'Anonymous.';
  }

  if (authorsList.length <= 6) {
    return `${authorsList.join(', ')}.`;
  }

  // > 6 authors: first 6, followed by ", et al."
  const first6 = authorsList.slice(0, 6).join(', ');
  return `${first6}, et al.`;
}

/**
 * Requirement 2 & 3: Journal & Publication Anatomy + Identifiers & Linking
 * Format: Author(s). Title. JournalAbbr. Year;Volume(Issue):Pages.
 * Edge cases:
 * - Missing Issue: Year;Volume:Pages.
 * - Missing Volume & Issue: Year;Pages. or Year;Published online [Date].
 * - Missing Pages: Use article number or e-locator (e.g., e0123456).
 * Identifiers:
 * - doi:10.xxxx/xxxx.
 * - PMID: xxxxxxxx.
 */
function formatVancouverReference(paper, num = null, options = { htmlLinks: false }) {
  let out = num !== null && num !== undefined ? `${num}. ` : '';

  // 1. Author(s)
  const authorsStr = formatVancouverAuthors(paper);
  out += authorsStr + ' ';

  // 2. Title
  const title = cleanHtmlText(paper.title || '').trim().replace(/\.$/, '');
  if (title) {
    out += `${title}. `;
  }

  // 3. Journal Abbreviation
  const journalRaw = paper.journalAbbr || paper.medlineAbbr || paper.journal || '';
  const journalAbbr = cleanHtmlText(journalRaw).trim().replace(/\.$/, '');
  if (journalAbbr) {
    out += `${journalAbbr}. `;
  }

  // 4. Publication Anatomy (Year;Volume(Issue):Pages.)
  const year = paper.year || (paper.pubDate ? new Date(paper.pubDate).getFullYear() : null) || '2024';
  const vol = (paper.volume || '').toString().trim();
  const issue = (paper.issue || '').toString().trim();
  const pages = (paper.pages || paper.pageRange || '').toString().trim();
  const articleNum = (paper.articleNumber || paper.elocationId || paper.elocator || '').toString().trim();
  const pageOrElocator = pages || articleNum;
  const pubDateOnline = paper.publishedOnlineDate || paper.electronicPubDate || paper.onlineDate || null;

  let pubAnatomy = '';
  if (vol && issue && pageOrElocator) {
    pubAnatomy = `${year};${vol}(${issue}):${pageOrElocator}.`;
  } else if (vol && !issue && pageOrElocator) {
    pubAnatomy = `${year};${vol}:${pageOrElocator}.`;
  } else if (vol && issue && !pageOrElocator) {
    pubAnatomy = `${year};${vol}(${issue}).`;
  } else if (vol && !issue && !pageOrElocator) {
    pubAnatomy = `${year};${vol}.`;
  } else if (!vol && !issue && pageOrElocator) {
    pubAnatomy = `${year};${pageOrElocator}.`;
  } else if (pubDateOnline) {
    pubAnatomy = `${year};Published online ${pubDateOnline}.`;
  } else {
    pubAnatomy = `${year}.`;
  }

  out += pubAnatomy;

  // 5. Identifiers & Linking
  const cleanDoi = normalizeDoi(paper.doi);
  const cleanPmid = paper.pmid ? String(paper.pmid).trim() : '';

  if (cleanDoi) {
    const doiText = `doi:${cleanDoi}.`;
    if (options.htmlLinks) {
      out += ` <a href="https://doi.org/${encodeURIComponent(cleanDoi)}" target="_blank" rel="noopener">${doiText}</a>`;
    } else {
      out += ` ${doiText}`;
    }
  }

  if (cleanPmid) {
    const pmidText = `PMID: ${cleanPmid}.`;
    if (options.htmlLinks) {
      out += ` <a href="https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(cleanPmid)}/" target="_blank" rel="noopener">${pmidText}</a>`;
    } else {
      out += ` ${pmidText}`;
    }
  }

  return out.trim();
}

/**
 * Requirement 4: In-Text Numbering Engine
 * Pass 1: Parse the draft manuscript text, detect all cited keys in chronological order of appearance.
 * Pass 2: Assign [1], [2], [3] sequentially. Re-order the reference list array to match this exact sequence.
 * Pass 3: Flag any reference present in the bibliography that was never cited in the body text with an in-editor warning.
 */
class InTextNumberingEngine {
  /**
   * Runs the 3-pass citation renumbering and ordering algorithm.
   * @param {Object} manuscript Object containing draft sections (intro, methods, results, discussion, etc.) or string.
   * @param {Array} bibliography Array of candidate paper records.
   * @returns {Object} { updatedManuscript, orderedReferences, uncitedReferences, warnings }
   */
  static process(manuscript, bibliography) {
    const papers = Array.isArray(bibliography) ? [...bibliography] : [];
    
    // Helper to get text representation across sections
    const getSectionTexts = () => {
      if (typeof manuscript === 'string') return [manuscript];
      const sections = [];
      if (manuscript.title) sections.push({ key: 'title', text: manuscript.title });
      if (manuscript.abstractObj) {
        for (const [k, v] of Object.entries(manuscript.abstractObj)) {
          sections.push({ key: `abstractObj.${k}`, text: v });
        }
      }
      if (manuscript.intro) sections.push({ key: 'intro', text: manuscript.intro });
      if (manuscript.methods) sections.push({ key: 'methods', text: manuscript.methods });
      if (manuscript.results) sections.push({ key: 'results', text: manuscript.results });
      if (manuscript.discussion) sections.push({ key: 'discussion', text: manuscript.discussion });
      if (manuscript.conclusion) sections.push({ key: 'conclusion', text: manuscript.conclusion });
      return sections;
    };

    // PASS 1: Parse manuscript text, detect all cited keys in chronological order of appearance
    const citationRegex = /\[(\d+(?:,\s*\d+)*)\]/g;
    const orderedCitedKeys = [];
    const seenKeysSet = new Set();

    const sections = getSectionTexts();
    for (const sec of sections) {
      let match;
      citationRegex.lastIndex = 0;
      while ((match = citationRegex.exec(sec.text)) !== null) {
        const rawNums = match[1].split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
        for (const rawNum of rawNums) {
          // rawNum corresponds to 1-based initial index or candidate key
          if (!seenKeysSet.has(rawNum)) {
            seenKeysSet.add(rawNum);
            orderedCitedKeys.push(rawNum);
          }
        }
      }
    }

    // PASS 2: Assign [1], [2], [3] sequentially. Re-order the reference list array to match this exact sequence.
    const keyToNewSequentialNum = new Map();
    const orderedReferences = [];

    orderedCitedKeys.forEach((oldNum, idx) => {
      const newNum = idx + 1;
      keyToNewSequentialNum.set(oldNum, newNum);

      // Resolve original paper by 1-based index
      const paperIndex = oldNum - 1;
      const paper = papers[paperIndex];
      if (paper) {
        orderedReferences.push({
          num: newNum,
          paper,
          origIdx: paperIndex,
          text: formatVancouverReference(paper, newNum)
        });
      }
    });

    // Re-map citation numbers in the manuscript text
    const renumberSectionText = (text) => {
      if (!text) return '';
      return text.replace(/\[(\d+(?:,\s*\d+)*)\]/g, (fullMatch, numsStr) => {
        const nums = numsStr.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
        const newNums = nums.map(n => keyToNewSequentialNum.get(n) || n);
        // Sort and deduplicate citation numbers in in-text callout
        const uniqueSorted = [...new Set(newNums)].sort((a, b) => a - b);
        return `[${uniqueSorted.join(',')}]`;
      });
    };

    let updatedManuscript;
    if (typeof manuscript === 'string') {
      updatedManuscript = renumberSectionText(manuscript);
    } else {
      updatedManuscript = { ...manuscript };
      if (updatedManuscript.title) updatedManuscript.title = renumberSectionText(updatedManuscript.title);
      if (updatedManuscript.abstractObj) {
        updatedManuscript.abstractObj = { ...updatedManuscript.abstractObj };
        for (const [k, v] of Object.entries(updatedManuscript.abstractObj)) {
          updatedManuscript.abstractObj[k] = renumberSectionText(v);
        }
      }
      if (updatedManuscript.intro) updatedManuscript.intro = renumberSectionText(updatedManuscript.intro);
      if (updatedManuscript.methods) updatedManuscript.methods = renumberSectionText(updatedManuscript.methods);
      if (updatedManuscript.results) updatedManuscript.results = renumberSectionText(updatedManuscript.results);
      if (updatedManuscript.discussion) updatedManuscript.discussion = renumberSectionText(updatedManuscript.discussion);
      if (updatedManuscript.conclusion) updatedManuscript.conclusion = renumberSectionText(updatedManuscript.conclusion);
      updatedManuscript.references = orderedReferences;
    }

    // PASS 3: Flag any reference present in the bibliography that was never cited in the body text with an in-editor warning
    const uncitedReferences = [];
    const warnings = [];

    papers.forEach((paper, index) => {
      const oneBasedKey = index + 1;
      if (!seenKeysSet.has(oneBasedKey)) {
        uncitedReferences.push({
          origIdx: index,
          paper,
          title: paper.title || 'Untitled',
          authors: formatVancouverAuthors(paper)
        });
        warnings.push(`Reference candidate #${oneBasedKey} ("${(paper.title || 'Untitled').substring(0, 60)}…") is present in the bibliography candidate pool but was never cited in the manuscript body text.`);
      }
    });

    return {
      updatedManuscript,
      orderedReferences,
      uncitedReferences,
      warnings,
      isFullyGrounded: uncitedReferences.length === 0,
      totalCited: orderedCitedKeys.length,
      totalCandidates: papers.length
    };
  }
}

// ─────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────

async function runTests() {
  console.log('--- STARTING VANCOUVER ICMJE / NLM REFERENCE ENGINE TESTS ---');

  // Test 1: Author Formatting
  {
    console.log('\n[Test 1] Author Formatting Standardization');

    // Name normalization: "Surname Initials" without internal periods
    assert.strictEqual(normalizeAuthorName('Raouf Roshdy'), 'Roshdy R');
    assert.strictEqual(normalizeAuthorName('John A. Smith'), 'Smith JA');
    assert.strictEqual(normalizeAuthorName('Smith, John A.'), 'Smith JA');
    assert.strictEqual(normalizeAuthorName('Smith J.A.'), 'Smith JA');
    assert.strictEqual(normalizeAuthorName('Roshdy R'), 'Roshdy R');

    // 1 to 6 authors: list all separated by commas
    const paper1 = { authors: 'Raouf Roshdy' };
    assert.strictEqual(formatVancouverAuthors(paper1), 'Roshdy R.');

    const paper3 = { authors: 'Raouf Roshdy, John A. Smith, Jane Doe' };
    assert.strictEqual(formatVancouverAuthors(paper3), 'Roshdy R, Smith JA, Doe J.');

    const paper6 = { authors: 'A One, B Two, C Three, D Four, E Five, F Six' };
    assert.strictEqual(formatVancouverAuthors(paper6), 'One A, Two B, Three C, Four D, Five E, Six F.');

    // > 6 authors: list first 6, followed by ", et al."
    const paper7 = { authors: 'A One, B Two, C Three, D Four, E Five, F Six, G Seven' };
    assert.strictEqual(formatVancouverAuthors(paper7), 'One A, Two B, Three C, Four D, Five E, Six F, et al.');

    // No author supplied: fallback to institution or Anonymous
    const paperInst = { authors: '', institution: 'World Health Organization' };
    assert.strictEqual(formatVancouverAuthors(paperInst), 'World Health Organization.');

    const paperAnon = { authors: '' };
    assert.strictEqual(formatVancouverAuthors(paperAnon), 'Anonymous.');

    console.log('  ✔ Name normalization ("Surname Initials" without periods) passed');
    console.log('  ✔ 1-6 authors separated by commas passed');
    console.log('  ✔ > 6 authors capped at 6 + ", et al." passed');
    console.log('  ✔ Institution / Anonymous fallback passed');
  }

  // Test 2: Journal & Publication Anatomy
  {
    console.log('\n[Test 2] Journal & Publication Anatomy Edge Cases');

    // Standard: Year;Volume(Issue):Pages.
    const refStd = formatVancouverReference({
      authors: 'Raouf Roshdy',
      title: 'Comparative efficacy of inositol in PCOS',
      journal: 'Reprod Biomed Online',
      year: 2023,
      volume: '46',
      issue: '2',
      pages: '112-120'
    });
    assert.strictEqual(refStd, 'Roshdy R. Comparative efficacy of inositol in PCOS. Reprod Biomed Online. 2023;46(2):112-120.');

    // Edge Case 1: Missing Issue -> Year;Volume:Pages.
    const refNoIssue = formatVancouverReference({
      authors: 'Raouf Roshdy',
      title: 'Study without issue',
      journal: 'Lancet',
      year: 2022,
      volume: '399',
      pages: '45-50'
    });
    assert.strictEqual(refNoIssue, 'Roshdy R. Study without issue. Lancet. 2022;399:45-50.');

    // Edge Case 2: Missing Volume & Issue -> Year;Pages.
    const refNoVolIssue = formatVancouverReference({
      authors: 'Raouf Roshdy',
      title: 'Supplement study',
      journal: 'BMJ',
      year: 2021,
      pages: 'e065432'
    });
    assert.strictEqual(refNoVolIssue, 'Roshdy R. Supplement study. BMJ. 2021;e065432.');

    // Edge Case 3: Missing Volume & Issue with Published online Date -> Year;Published online [Date].
    const refOnline = formatVancouverReference({
      authors: 'Raouf Roshdy',
      title: 'Early online release',
      journal: 'Nat Med',
      year: 2024,
      publishedOnlineDate: 'Oct 15'
    });
    assert.strictEqual(refOnline, 'Roshdy R. Early online release. Nat Med. 2024;Published online Oct 15.');

    // Edge Case 4: Missing Pages -> Use article number or e-locator (e.g., e0123456)
    const refElocator = formatVancouverReference({
      authors: 'Raouf Roshdy',
      title: 'Open access study',
      journal: 'PLoS One',
      year: 2023,
      volume: '18',
      issue: '4',
      elocationId: 'e0123456'
    });
    assert.strictEqual(refElocator, 'Roshdy R. Open access study. PLoS One. 2023;18(4):e0123456.');

    console.log('  ✔ Standard Year;Volume(Issue):Pages. verified');
    console.log('  ✔ Missing Issue: Year;Volume:Pages. verified');
    console.log('  ✔ Missing Volume & Issue: Year;Pages. / Year;Published online [Date]. verified');
    console.log('  ✔ Missing Pages: article number / e-locator e0123456 verified');
  }

  // Test 3: Identifiers & Linking
  {
    console.log('\n[Test 3] Persistent Identifiers & Linking');

    const refWithDoiAndPmid = formatVancouverReference({
      authors: 'Smith JA',
      title: 'Trial of metformin',
      journal: 'N Engl J Med',
      year: 2023,
      volume: '388',
      pages: '100-110',
      doi: '10.1056/NEJMoa2211223',
      pmid: '37123456'
    });
    assert.strictEqual(refWithDoiAndPmid, 'Smith JA. Trial of metformin. N Engl J Med. 2023;388:100-110. doi:10.1056/NEJMoa2211223. PMID: 37123456.');

    // HTML links option
    const refHtml = formatVancouverReference({
      authors: 'Smith JA',
      title: 'Trial of metformin',
      journal: 'N Engl J Med',
      year: 2023,
      volume: '388',
      pages: '100-110',
      doi: '10.1056/NEJMoa2211223',
      pmid: '37123456'
    }, 1, { htmlLinks: true });

    assert(refHtml.includes('<a href="https://doi.org/10.1056%2FNEJMoa2211223" target="_blank" rel="noopener">doi:10.1056/NEJMoa2211223.</a>'));
    assert(refHtml.includes('<a href="https://pubmed.ncbi.nlm.nih.gov/37123456/" target="_blank" rel="noopener">PMID: 37123456.</a>'));

    console.log('  ✔ Plain text doi:10.xxxx/xxxx. and PMID: xxxxxxxx. verified');
    console.log('  ✔ HTML resolver links verified');
  }

  // Test 4: In-Text Numbering Engine (Pass 1, Pass 2, Pass 3)
  {
    console.log('\n[Test 4] 3-Pass In-Text Numbering Engine');

    const candidatePapers = [
      { title: 'Paper Alpha (Initial #1)', authors: 'Author One', year: 2020 },
      { title: 'Paper Beta (Initial #2)', authors: 'Author Two', year: 2021 },
      { title: 'Paper Gamma (Initial #3)', authors: 'Author Three', year: 2022 },
      { title: 'Paper Delta (Initial #4 - Uncited)', authors: 'Author Four', year: 2023 }
    ];

    // Manuscript where Paper Gamma (#3) is cited FIRST, then Paper Alpha (#1), then Paper Beta (#2)
    const draft = {
      intro: 'First sentence cites gamma [3]. Second sentence cites alpha and gamma [1, 3].',
      results: 'Results section cites beta [2].'
    };

    const res = InTextNumberingEngine.process(draft, candidatePapers);

    // Pass 1 & 2 verification:
    // First cited was #3 -> must become [1]
    // Second newly cited was #1 -> must become [2]
    // Third newly cited was #2 -> must become [3]
    assert.strictEqual(res.updatedManuscript.intro, 'First sentence cites gamma [1]. Second sentence cites alpha and gamma [1,2].');
    assert.strictEqual(res.updatedManuscript.results, 'Results section cites beta [3].');

    // Bibliography array re-ordered to match exact sequential appearance:
    assert.strictEqual(res.orderedReferences.length, 3);
    assert.strictEqual(res.orderedReferences[0].num, 1);
    assert.strictEqual(res.orderedReferences[0].paper.title, 'Paper Gamma (Initial #3)');

    assert.strictEqual(res.orderedReferences[1].num, 2);
    assert.strictEqual(res.orderedReferences[1].paper.title, 'Paper Alpha (Initial #1)');

    assert.strictEqual(res.orderedReferences[2].num, 3);
    assert.strictEqual(res.orderedReferences[2].paper.title, 'Paper Beta (Initial #2)');

    // Pass 3 verification:
    // Paper Delta (#4) was never cited in draft
    assert.strictEqual(res.uncitedReferences.length, 1);
    assert.strictEqual(res.uncitedReferences[0].title, 'Paper Delta (Initial #4 - Uncited)');
    assert.strictEqual(res.warnings.length, 1);
    assert(res.warnings[0].includes('Paper Delta (Initial #4 - Uncited)'));
    assert.strictEqual(res.isFullyGrounded, false);

    console.log('  ✔ Pass 1: Detected chronological appearance [3, 1, 2]');
    console.log('  ✔ Pass 2: Re-mapped in-text citations to [1, 2, 3] and re-ordered bibliography');
    console.log('  ✔ Pass 3: Flagged uncited reference (Paper Delta) with in-editor warning');
  }

  console.log('\n======================================================');
  console.log(' ALL VANCOUVER ICMJE / NLM FORMATTING TESTS PASSED ✔');
  console.log('======================================================');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
