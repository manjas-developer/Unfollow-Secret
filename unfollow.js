const TOKEN =
  (typeof process !== "undefined" && process.env?.UNFOLLOW_TOKEN) ||
  "YOUR_GITHUB_PERSONAL_ACCESS_TOKEN";

const DRY_RUN =
  typeof process !== "undefined" && process.env?.DRY_RUN === "1";

const API_BASE = "https://api.github.com";
const PER_PAGE = 100;
const FETCH_CONCURRENCY = 8;
const UNFOLLOW_CONCURRENCY = 3;
const MAX_RETRIES = 4;
const REQUEST_TIMEOUT_MS = 15000;

const headers = {
  "Authorization": `Bearer ${TOKEN}`,
  "Accept": "application/vnd.github+json",
  "User-Agent": "Unfollow-Script"
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function userKey(user) {
  return user.id ?? user.login.toLowerCase();
}

function parseLinkHeader(header) {
  const links = {};
  if (!header) return links;

  for (const part of header.split(",")) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="([^"]+)"/);
    if (match) {
      links[match[2]] = match[1];
    }
  }
  return links;
}

function getRetryDelayMs(res, attempt, bodyText = "") {
  const retryAfter = res?.headers?.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000;
    }
    const dateMs = Date.parse(retryAfter);
    if (Number.isFinite(dateMs)) {
      return Math.max(0, dateMs - Date.now());
    }
  }

  if (res?.headers?.get("x-ratelimit-remaining") === "0") {
    const resetEpoch = Number(res.headers.get("x-ratelimit-reset"));
    if (Number.isFinite(resetEpoch) && resetEpoch > 0) {
      return Math.min(Math.max(1000, resetEpoch * 1000 - Date.now() + 500), 65000);
    }
  }

  const baseMs = res?.status === 403 || res?.status === 429 ? 2000 : 500;
  const jitter = Math.floor(Math.random() * 250);
  if (bodyText.toLowerCase().includes("secondary rate limit")) {
    return Math.min(30000, baseMs * 2 ** (attempt + 1) + jitter);
  }
  return Math.min(30000, baseMs * 2 ** attempt + jitter);
}

async function fetchWithRetry(url, options = {}) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const signal =
      !options.signal &&
      typeof AbortSignal !== "undefined" &&
      typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        : options.signal;

    try {
      const res = await fetch(url, { ...options, headers, signal });

      const isRateLimited =
        res.status === 429 ||
        (res.status === 403 &&
          (res.headers.get("retry-after") !== null ||
            res.headers.get("x-ratelimit-remaining") === "0"));

      let bodyText = "";
      if (
        res.status === 403 &&
        !isRateLimited &&
        attempt < MAX_RETRIES &&
        typeof res.clone === "function"
      ) {
        try {
          bodyText = await res.clone().text();
        } catch {
          bodyText = "";
        }
      }
      const isSecondaryLimit = bodyText.toLowerCase().includes("rate limit");
      const isTransient = res.status >= 500 && res.status < 600;

      if ((isRateLimited || isSecondaryLimit || isTransient) && attempt < MAX_RETRIES) {
        await sleep(getRetryDelayMs(res, attempt, bodyText));
        continue;
      }

      return res;
    } catch (err) {
      if (attempt >= MAX_RETRIES) {
        throw err;
      }
      await sleep(getRetryDelayMs(null, attempt));
    }
  }
}

async function runPool(items, concurrency, worker) {
  if (items.length === 0) return [];
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) break;
      results[index] = await worker(items[index], index);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, runWorker));
  return results;
}

async function fetchJsonOrThrow(url) {
  const res = await fetchWithRetry(url);
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const detail = errBody.message ? `: ${errBody.message}` : "";
    throw new Error(`HTTP Error ${res.status} while fetching ${url}${detail}`);
  }
  return res;
}

// Fetches all pages concurrently using Link rel="last", falling back to rel="next"
async function fetchAllPages(endpointPath) {
  const pageUrl = page => `${API_BASE}${endpointPath}?per_page=${PER_PAGE}&page=${page}`;
  const firstRes = await fetchJsonOrThrow(pageUrl(1));
  const firstData = await firstRes.json();
  const firstLinks = parseLinkHeader(firstRes.headers.get("link"));

  const pages = [firstData];
  let trailingNextUrl = null;
  let usedParallelLast = false;

  if (firstLinks.last) {
    const lastPage = Number(new URL(firstLinks.last).searchParams.get("page"));
    if (Number.isInteger(lastPage) && lastPage > 1) {
      usedParallelLast = true;
      const pageNumbers = Array.from({ length: lastPage - 1 }, (_, i) => i + 2);
      const remaining = await runPool(pageNumbers, FETCH_CONCURRENCY, async p => {
        const res = await fetchJsonOrThrow(pageUrl(p));
        const data = await res.json();
        return { data, links: parseLinkHeader(res.headers.get("link")) };
      });
      for (const item of remaining) {
        pages.push(item.data);
      }
      trailingNextUrl = remaining[remaining.length - 1]?.links.next ?? null;
    }
  }

  if (!usedParallelLast && firstLinks.next) {
    trailingNextUrl = firstLinks.next;
  }

  while (trailingNextUrl) {
    const res = await fetchJsonOrThrow(trailingNextUrl);
    pages.push(await res.json());
    trailingNextUrl = parseLinkHeader(res.headers.get("link")).next ?? null;
  }

  const byId = new Map();
  let duplicateCount = 0;

  for (const page of pages) {
    for (const user of page) {
      const key = userKey(user);
      if (byId.has(key)) {
        duplicateCount++;
      } else {
        byId.set(key, user);
      }
    }
  }

  return {
    users: Array.from(byId.values()),
    byId,
    duplicateCount
  };
}

// Direct 1-to-1 check: does `userLogin` follow `targetLogin`? (204 = yes, 404 = no)
async function doesUserFollow(userLogin, targetLogin) {
  const url = `${API_BASE}/users/${encodeURIComponent(userLogin)}/following/${encodeURIComponent(targetLogin)}`;
  const res = await fetchWithRetry(url);
  if (res.status === 204) return true;
  if (res.status === 404) return false;
  return true;
}

async function fetchMeOptional() {
  try {
    const res = await fetchWithRetry(`${API_BASE}/user`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function unfollowUser(user) {
  if (DRY_RUN) {
    console.log(`[DRY RUN] Would unfollow: @${user.login}`);
    return { ok: true };
  }

  const url = `${API_BASE}/user/following/${encodeURIComponent(user.login)}`;
  const res = await fetchWithRetry(url, { method: "DELETE" });

  if (res.status === 204) {
    console.log(`[-] Unfollowed: @${user.login}`);
    return { ok: true };
  }

  const errBody = await res.json().catch(() => ({}));
  const detail = errBody.message ? ` - ${errBody.message}` : "";
  console.log(`[!] Failed to unfollow @${user.login} (Status: ${res.status}${detail})`);
  return { ok: false };
}

async function unfollowNonFollowers() {
  const startedAt = Date.now();
  try {
    if (!TOKEN || TOKEN === "YOUR_GITHUB_PERSONAL_ACCESS_TOKEN") {
      throw new Error(
        "Missing GitHub token. Set UNFOLLOW_TOKEN (or GitHub Actions secret UNFOLLOW_TOKEN) or replace TOKEN in unfollow.js."
      );
    }

    console.log("Fetching ALL following and followers across all pages...");

    const [following, followers, me] = await Promise.all([
      fetchAllPages("/user/following"),
      fetchAllPages("/user/followers"),
      fetchMeOptional()
    ]);

    console.log(
      `Total Following: ${following.users.length} | Total Followers: ${followers.users.length}\n`
    );

    let candidates = following.users.filter(user => !followers.byId.has(userKey(user)));

    // Only verify 1-to-1 if duplicate users across pages indicate the follower list shifted mid-fetch
    if (followers.duplicateCount > 0 && me?.login && candidates.length > 0) {
      console.log(
        `Follower list shifted during fetch; verifying ${candidates.length} candidate(s)...`
      );
      const checks = await runPool(candidates, FETCH_CONCURRENCY, async user => ({
        user,
        followsBack: await doesUserFollow(user.login, me.login)
      }));
      candidates = checks.filter(c => !c.followsBack).map(c => c.user);
    }

    if (candidates.length === 0) {
      console.log("Done! Unfollowed 0 user(s) in total.");
      return;
    }

    const results = await runPool(candidates, UNFOLLOW_CONCURRENCY, unfollowUser);
    const unfollowedCount = results.filter(r => r.ok).length;
    const failedCount = results.length - unfollowedCount;
    const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(2);

    console.log(
      `\nDone in ${elapsedSec}s! Unfollowed ${unfollowedCount} user(s) in total.` +
        (failedCount > 0 ? ` (${failedCount} failed)` : "")
    );
  } catch (err) {
    console.error("Error running script:", err.message);
    if (typeof process !== "undefined") {
      process.exitCode = 1;
    }
  }
}

unfollowNonFollowers();
