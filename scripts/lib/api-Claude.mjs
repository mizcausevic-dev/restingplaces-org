// Shared fetch layer for the data pipeline.
// Every response is cached raw to data/cache/ so later phases and QA
// spot-checks can verify provenance without refetching.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const CACHE_DIR = path.join(ROOT, 'data', 'cache');

export const USER_AGENT =
  'RestingPlacesBuild/0.1 (https://restingplaces.site; causevic.miz@gmail.com) node-fetch';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cachePath(bucket, key) {
  const hash = createHash('sha1').update(key).digest('hex');
  return path.join(CACHE_DIR, bucket, `${hash}.json`);
}

export async function cachedJson(bucket, url, { headers = {}, method = 'GET', body = null, retries = 5, delayMs = 0, timeoutMs = 30000 } = {}) {
  const key = method + ' ' + url + (body ? ' ' + body : '');
  const file = cachePath(bucket, key);
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    // not cached yet
  }
  // Real pre-existing bug, surfaced by the hours-Claude.mjs run: if every
  // attempt exhausts via the 429/503 branch below (repeated on an
  // overloaded shared instance like overpass-api.de), that branch
  // `continue`s without ever populating lastErr, so `throw lastErr` at the
  // end threw `undefined` instead of an Error — crashing any caller that
  // reads `err.message`. Seed a real Error up front so that can't happen.
  let lastErr = new Error(`cachedJson: exhausted ${retries} retries for ${url}`);
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      if (delayMs) await sleep(delayMs);
      // Bounded per-attempt timeout: plain fetch() has no default timeout,
      // so a stalled/half-open connection to a shared public instance (e.g.
      // overpass-api.de under load) can otherwise hang the whole process
      // indefinitely — real, hit during the 2,443-cemetery hours run, not
      // theoretical. AbortController turns that into a normal timeout error
      // that flows into this same retry/backoff path below.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
      let res;
      try {
        res = await fetch(url, {
          method,
          body,
          headers: { 'user-agent': USER_AGENT, ...headers },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (res.status === 429 || res.status === 503) {
        lastErr = new Error(`HTTP ${res.status} (rate-limited/unavailable) for ${url}`);
        const retryAfter = Number(res.headers.get('retry-after')) || 5 * (attempt + 1);
        await sleep(retryAfter * 1000);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const json = await res.json();
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify(json), 'utf8');
      return json;
    } catch (err) {
      lastErr = err;
      await sleep(2000 * (attempt + 1));
    }
  }
  throw lastErr;
}

export async function mwQuery(params, bucket = 'mediawiki') {
  const url =
    'https://en.wikipedia.org/w/api.php?' +
    new URLSearchParams({ format: 'json', formatversion: '2', maxlag: '5', ...params });
  return cachedJson(bucket, url, { delayMs: 120 });
}

export async function sparql(query, bucket = 'wdqs') {
  const url = 'https://query.wikidata.org/sparql';
  const body = new URLSearchParams({ query }).toString();
  return cachedJson(bucket, url + '#' + createHash('sha1').update(body).digest('hex'), {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/sparql-results+json',
    },
    delayMs: 1000,
    retries: 6,
  });
}

export function writeJson(relPath, data) {
  const file = path.join(ROOT, relPath);
  return mkdir(path.dirname(file), { recursive: true }).then(() =>
    writeFile(file, JSON.stringify(data, null, 2), 'utf8')
  );
}

export { ROOT };
