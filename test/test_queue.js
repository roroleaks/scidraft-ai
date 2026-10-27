// test_queue.js
const assert = require('assert');

class AsyncRateLimitedQueue {
  constructor(options = {}) {
    this.signal = options.signal || null;
    this.s2ApiKey = options.s2ApiKey || null;
    this.delays = {
      epmc: options.delays?.epmc ?? 150,
      s2: options.delays?.s2 ?? (options.s2ApiKey ? 200 : 1000),
      crossref: options.delays?.crossref ?? 150,
      default: options.delays?.default ?? 150
    };
    this.maxRetries = options.maxRetries ?? 3;
    this.concurrency = Math.max(1, options.concurrency ?? 2);
    this.onProgress = options.onProgress || null;
    this.fetchImpl = options.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);

    this.chains = {
      epmc: Promise.resolve(),
      s2: Promise.resolve(),
      crossref: Promise.resolve(),
      default: Promise.resolve()
    };

    this.lastDispatch = { epmc: 0, s2: 0, crossref: 0, default: 0 };
    this.pausedUntil = { epmc: 0, s2: 0, crossref: 0, queue: 0, default: 0 };
    this.activeTimers = new Set();
    this.isAborted = false;

    this.total = 0;
    this.completed = 0;
    this.verified = 0;
    this.apiErrors = 0;

    this.pendingQueue = [];

    if (this.signal) {
      if (this.signal.aborted) {
        this.abort();
      } else {
        this.abortListener = () => this.abort();
        this.signal.addEventListener('abort', this.abortListener, { once: true });
      }
    }
  }

  abort() {
    this.isAborted = true;

    for (const timer of this.activeTimers) {
      clearTimeout(timer);
    }
    this.activeTimers.clear();

    let abortErr;
    if (typeof DOMException !== 'undefined') {
      abortErr = new DOMException('Aborted', 'AbortError');
    } else {
      abortErr = new Error('Aborted');
      abortErr.name = 'AbortError';
    }

    const pending = this.pendingQueue.splice(0, this.pendingQueue.length);
    for (const item of pending) {
      if (item && item.reject) item.reject(abortErr);
    }

    this.resetProgress();
  }

  resetProgress() {
    this.total = 0;
    this.completed = 0;
    this.verified = 0;
    this.apiErrors = 0;
  }

  _sleep(ms) {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      if (this.isAborted || this.signal?.aborted) {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        return reject(err);
      }
      let timer = null;
      const onAbort = () => {
        if (timer) clearTimeout(timer);
        this.activeTimers.delete(timer);
        const err = new Error('Aborted');
        err.name = 'AbortError';
        reject(err);
      };
      timer = setTimeout(() => {
        this.activeTimers.delete(timer);
        if (this.signal) this.signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      this.activeTimers.add(timer);
      if (this.signal) {
        this.signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  pause(endpoint, durationMs) {
    const until = Date.now() + Math.max(0, durationMs);
    if (endpoint && endpoint !== 'all') {
      this.pausedUntil[endpoint] = Math.max(this.pausedUntil[endpoint] || 0, until);
    } else {
      this.pausedUntil.queue = Math.max(this.pausedUntil.queue || 0, until);
    }
  }

  parseRetryAfter(res) {
    if (!res || !res.headers) return null;
    let headerVal = null;
    if (typeof res.headers.get === 'function') {
      headerVal = res.headers.get('Retry-After');
    } else if (res.headers['retry-after']) {
      headerVal = res.headers['retry-after'];
    }
    if (!headerVal) return null;

    const seconds = parseFloat(headerVal);
    if (!isNaN(seconds) && seconds >= 0) {
      return Math.round(seconds * 1000);
    }
    const dateMs = Date.parse(headerVal);
    if (!isNaN(dateMs)) {
      return Math.max(0, dateMs - Date.now());
    }
    return null;
  }

  calculateBackoff(endpoint, attempt, retryAfterMs = null) {
    if (retryAfterMs !== null && retryAfterMs > 0) {
      return retryAfterMs;
    }
    const baseDelay = this.delays[endpoint] || this.delays.default || 150;
    const jitter = Math.random() * 200;
    return Math.round((baseDelay * Math.pow(2, attempt)) + jitter);
  }

  async fetchWithRateLimit(endpoint, url, init = {}) {
    const ep = endpoint in this.chains ? endpoint : 'default';

    const task = async () => {
      let attempt = 0;
      while (true) {
        if (this.isAborted || this.signal?.aborted) {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          throw err;
        }

        const now = Date.now();
        const minDelay = this.delays[ep] ?? this.delays.default;
        const last = this.lastDispatch[ep] || 0;
        const pauseTime = Math.max(this.pausedUntil[ep] || 0, this.pausedUntil.queue || 0);
        const earliest = Math.max(last + minDelay, pauseTime);
        const waitBefore = earliest - now;
        if (waitBefore > 0) {
          await this._sleep(waitBefore);
        }

        this.lastDispatch[ep] = Date.now();

        try {
          const fetchFn = this.fetchImpl || fetch;
          const mergedInit = { ...init, signal: this.signal || init.signal };
          const res = await fetchFn(url, mergedInit);

          if (res && (res.status === 429 || res.status === 503)) {
            if (attempt < this.maxRetries) {
              const retryAfterMs = this.parseRetryAfter(res);
              const backoffMs = this.calculateBackoff(ep, attempt, retryAfterMs);
              this.pause(ep, backoffMs);
              await this._sleep(backoffMs);
              attempt++;
              continue;
            }
          }
          return res;
        } catch (err) {
          if (err.name === 'AbortError' || this.isAborted || this.signal?.aborted) {
            throw err;
          }
          if (attempt < this.maxRetries) {
            const backoffMs = this.calculateBackoff(ep, attempt);
            this.pause(ep, backoffMs);
            await this._sleep(backoffMs);
            attempt++;
            continue;
          }
          throw err;
        }
      }
    };

    const nextPromise = this.chains[ep].then(task, task);
    this.chains[ep] = nextPromise.catch(() => {});
    return nextPromise;
  }

  async processAll(items, workerFn) {
    if (this.isAborted || this.signal?.aborted) {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      throw err;
    }

    this.total = items.length;
    this.completed = 0;
    this.verified = 0;
    this.apiErrors = 0;

    if (items.length === 0) return [];

    const results = new Array(items.length);
    this.pendingQueue = items.map((item, index) => ({ item, index }));

    const runWorker = async () => {
      while (this.pendingQueue.length > 0) {
        if (this.isAborted || this.signal?.aborted) {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          throw err;
        }

        const task = this.pendingQueue.shift();
        if (!task) break;

        const { item, index } = task;
        try {
          const res = await workerFn(item, index, this);
          results[index] = res;

          this.completed++;
          if (res && res.valid) this.verified++;
          if (res && (res.status === 'API Error' || res.status === 'Rate Limited' || res.status === 'Network Error')) {
            this.apiErrors++;
          }

          const percent = Math.round((this.completed / this.total) * 100);
          const update = {
            completed: this.completed,
            total: this.total,
            percent,
            paper: item,
            result: res,
            verifiedCount: this.verified,
            apiErrorCount: this.apiErrors,
            message: `Validating reference ${this.completed} of ${this.total} (${percent}%)`
          };

          if (typeof this.onProgress === 'function') {
            this.onProgress(update);
          }

          if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
            try {
              window.dispatchEvent(new CustomEvent('scidraft:validation-progress', { detail: update }));
            } catch (_) {}
          }
        } catch (err) {
          if (err.name === 'AbortError' || this.isAborted || this.signal?.aborted) {
            throw err;
          }
          const errResult = { valid: false, status: 'API Error', error: err.message, cached: false };
          results[index] = errResult;
          this.completed++;
          this.apiErrors++;
          const percent = Math.round((this.completed / this.total) * 100);
          const update = {
            completed: this.completed,
            total: this.total,
            percent,
            paper: item,
            result: errResult,
            verifiedCount: this.verified,
            apiErrorCount: this.apiErrors,
            message: `Validating reference ${this.completed} of ${this.total} (${percent}%)`
          };
          if (typeof this.onProgress === 'function') this.onProgress(update);
        }
      }
    };

    const actualConcurrency = Math.min(this.concurrency, items.length);
    const workers = [];
    for (let c = 0; c < actualConcurrency; c++) {
      workers.push(runWorker());
    }

    await Promise.all(workers);
    return results;
  }
}

// ─────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────
async function runTests() {
  console.log('--- STARTING ASYNC RATE LIMITED QUEUE TESTS ---');

  // Test 1: Configurable Delays
  {
    console.log('\n[Test 1] Rate limit inter-request delay enforcement');
    const timestamps = [];
    const mockFetch = async (url) => {
      timestamps.push(Date.now());
      return { ok: true, status: 200, json: async () => ({}) };
    };

    // Test EPMC: min delay 150ms
    const epmcQueue = new AsyncRateLimitedQueue({
      delays: { epmc: 150 },
      fetchImpl: mockFetch
    });

    const startEpmc = Date.now();
    await Promise.all([
      epmcQueue.fetchWithRateLimit('epmc', 'https://epmc.org/api/1'),
      epmcQueue.fetchWithRateLimit('epmc', 'https://epmc.org/api/2'),
      epmcQueue.fetchWithRateLimit('epmc', 'https://epmc.org/api/3')
    ]);
    const durationEpmc = Date.now() - startEpmc;
    console.log(`  EPMC 3 requests duration: ${durationEpmc}ms (expected >= 300ms)`);
    assert(durationEpmc >= 280, `EPMC calls should be spaced by ~150ms each (got ${durationEpmc}ms)`);

    // Test S2 unauth: default 1000ms delay
    const s2UnauthQueue = new AsyncRateLimitedQueue({
      s2ApiKey: null
    });
    assert.strictEqual(s2UnauthQueue.delays.s2, 1000, 'Unauth S2 delay should default to 1000ms');

    // Test S2 authenticated: 200ms delay
    const s2AuthQueue = new AsyncRateLimitedQueue({
      s2ApiKey: 'test-api-key'
    });
    assert.strictEqual(s2AuthQueue.delays.s2, 200, 'Auth S2 delay should default to 200ms');
    console.log('  ✔ Delays configured correctly: EPMC=150ms, S2 unauth=1000ms, S2 auth=200ms');
  }

  // Test 2: Exponential Backoff & Jitter on 429
  {
    console.log('\n[Test 2] Exponential backoff with jitter on HTTP 429');
    let callCount = 0;
    const mock429Fetch = async () => {
      callCount++;
      if (callCount < 3) {
        return {
          ok: false,
          status: 429,
          headers: { get: (h) => null }
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true })
      };
    };

    // Use shorter base delay for fast test
    const queue = new AsyncRateLimitedQueue({
      delays: { epmc: 30 },
      maxRetries: 3,
      fetchImpl: mock429Fetch
    });

    // Test formula calculation
    const base = 100;
    const testQueue = new AsyncRateLimitedQueue({ delays: { default: base } });
    for (let attempt = 0; attempt < 3; attempt++) {
      const wait = testQueue.calculateBackoff('default', attempt);
      const minExpected = base * Math.pow(2, attempt);
      const maxExpected = minExpected + 200;
      assert(wait >= minExpected && wait <= maxExpected + 1,
        `Attempt ${attempt} backoff ${wait} outside [${minExpected}, ${maxExpected}]`);
    }
    console.log('  ✔ Exponential backoff formula (base * 2^attempt + jitter) verified');

    const res = await queue.fetchWithRateLimit('epmc', 'https://example.com/test');
    assert.strictEqual(callCount, 3, 'Should have retried twice after two 429s and succeeded on 3rd attempt');
    assert.strictEqual(res.status, 200);
    console.log('  ✔ HTTP 429 retry succeeded on 3rd attempt');
  }

  // Test 3: Parse 'Retry-After' Header (Seconds & Date)
  {
    console.log('\n[Test 3] Parsing Retry-After header');
    const queue = new AsyncRateLimitedQueue();

    // Integer seconds
    const resSec = { headers: { get: (h) => (h === 'Retry-After' ? '3' : null) } };
    assert.strictEqual(queue.parseRetryAfter(resSec), 3000, 'Retry-After: "3" should be 3000ms');

    // Float seconds
    const resFloat = { headers: { get: (h) => (h === 'Retry-After' ? '1.5' : null) } };
    assert.strictEqual(queue.parseRetryAfter(resFloat), 1500, 'Retry-After: "1.5" should be 1500ms');

    // HTTP Date header
    const targetDate = new Date(Date.now() + 5000).toUTCString();
    const resDate = { headers: { get: (h) => (h === 'Retry-After' ? targetDate : null) } };
    const parsedDate = queue.parseRetryAfter(resDate);
    assert(parsedDate >= 4000 && parsedDate <= 6000, `Parsed date should be ~5000ms from now (got ${parsedDate}ms)`);
    console.log('  ✔ Retry-After header parsed accurately (seconds and HTTP Date)');
  }

  // Test 4: AbortController Wiring
  {
    console.log('\n[Test 4] AbortController wiring and immediate queue clearance');
    const ac = new AbortController();
    const queue = new AsyncRateLimitedQueue({
      signal: ac.signal,
      delays: { default: 50 }
    });

    const papers = [
      { id: 1, title: 'Paper 1' },
      { id: 2, title: 'Paper 2' },
      { id: 3, title: 'Paper 3' },
      { id: 4, title: 'Paper 4' },
      { id: 5, title: 'Paper 5' }
    ];

    let itemsStarted = 0;
    const processPromise = queue.processAll(papers, async (p) => {
      itemsStarted++;
      if (itemsStarted === 2) {
        // Trigger abort mid-flight
        ac.abort();
      }
      await queue._sleep(100);
      return { valid: true };
    });

    let caughtError = null;
    try {
      await processPromise;
    } catch (e) {
      caughtError = e;
    }

    assert(caughtError !== null, 'Queue should throw on abort');
    assert.strictEqual(caughtError.name, 'AbortError', 'Thrown error must be AbortError');
    assert.strictEqual(queue.pendingQueue.length, 0, 'Pending queue memory must be cleared immediately upon abort');
    assert.strictEqual(queue.total, 0, 'Counters must be reset upon abort');
    console.log('  ✔ AbortSignal immediately aborts queue, rejects pending tasks, and purges memory');
  }

  // Test 5: UI Progress Sync
  {
    console.log('\n[Test 5] UI Progress Sync formatting and live emission');
    const progressEvents = [];
    const queue = new AsyncRateLimitedQueue({
      concurrency: 1,
      delays: { default: 10 },
      onProgress: (evt) => {
        progressEvents.push(evt);
      }
    });

    const papers = [
      { id: 1, title: 'Alpha trial study' },
      { id: 2, title: 'Beta cohort study' },
      { id: 3, title: 'Gamma meta-analysis' }
    ];

    await queue.processAll(papers, async (p, idx) => {
      return { valid: idx !== 1, status: idx !== 1 ? 'Verified ✔' : 'Unresolved' };
    });

    assert.strictEqual(progressEvents.length, 3, 'Should emit progress event for each completed paper');
    assert.strictEqual(progressEvents[0].message, 'Validating reference 1 of 3 (33%)');
    assert.strictEqual(progressEvents[1].message, 'Validating reference 2 of 3 (67%)');
    assert.strictEqual(progressEvents[2].message, 'Validating reference 3 of 3 (100%)');
    assert.strictEqual(progressEvents[2].verifiedCount, 2);

    console.log('  ✔ Progress updates emitted matching format: "Validating reference ${completed} of ${total} (${percent}%)"');
  }

  console.log('\n========================================');
  console.log(' ALL 5 QUEUE CONTROLLER TESTS PASSED ✔');
  console.log('========================================');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
