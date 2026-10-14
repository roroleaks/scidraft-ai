const https = require('https');

const S2_DEFAULT_KEY = 's2k-0rcC3ztnxRdNGsOKL1SNvwbOPnSaRh4qHBT9qe7A';

function queryS2(targetPath, apiKey, attempt = 0) {
  return new Promise((resolve, reject) => {
    const s2Req = https.request({
      hostname: 'api.semanticscholar.org',
      path: targetPath,
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'User-Agent': 'SciDraft-AI/2.0 (Academic Research Assistant)'
      }
    }, (s2Res) => {
      let data = '';
      s2Res.on('data', chunk => data += chunk);
      s2Res.on('end', () => {
        if (s2Res.statusCode === 429 && attempt < 2) {
          // Automatic exponential backoff retry on 429 burst limit
          setTimeout(() => {
            queryS2(targetPath, apiKey, attempt + 1).then(resolve).catch(reject);
          }, 1400 * (attempt + 1));
          return;
        }
        resolve({
          statusCode: s2Res.statusCode,
          headers: s2Res.headers,
          body: data
        });
      });
    });

    s2Req.on('error', (err) => {
      if (attempt < 2) {
        setTimeout(() => {
          queryS2(targetPath, apiKey, attempt + 1).then(resolve).catch(reject);
        }, 1200);
        return;
      }
      reject(err);
    });

    s2Req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  try {
    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const query = urlObj.searchParams.get('query') || '';
    const limit = urlObj.searchParams.get('limit') || '30';
    const fields = urlObj.searchParams.get('fields') || 'paperId,title,authors,year,abstract,venue,publicationVenue,journal,externalIds,openAccessPdf,citationCount,publicationTypes,fieldsOfStudy';
    const year = urlObj.searchParams.get('year') || '';
    const paperId = urlObj.searchParams.get('paperId') || '';
    const userKey = req.headers['x-api-key'] || urlObj.searchParams.get('key') || S2_DEFAULT_KEY;

    let targetPath = '';
    if (paperId) {
      targetPath = `/graph/v1/paper/${encodeURIComponent(paperId)}?fields=${encodeURIComponent(fields)}`;
    } else {
      targetPath = `/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${encodeURIComponent(limit)}&fields=${encodeURIComponent(fields)}`;
      if (year) targetPath += `&year=${encodeURIComponent(year)}`;
    }

    const result = await queryS2(targetPath, userKey);
    res.statusCode = result.statusCode;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(result.body);
  } catch (err) {
    console.error('S2 Proxy Error:', err);
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Failed to reach Semantic Scholar upstream', details: err.message }));
  }
};
