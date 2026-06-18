import { cpoFeeds } from "./cpoFeeds.js";
import { fetchAndNormaliseCpoLocations } from "./normalise.js";
import { NormalisedChargerLocation } from "./types.js";

/**
 * How long cached charger data should be considered fresh.
 *
 * 60 seconds is a reasonable MVP value:
 * - avoids hammering the CPO open-data feed
 * - keeps data reasonably fresh for a driver-facing app
 *
 * Later, we may tune this per operator.
 */
const CACHE_TTL_MS = 60_000;

/**
 * The cached normalised charger locations.
 *
 * This is held in memory inside the running Render service.
 *
 * Important limitation:
 * If Render restarts the service, this cache disappears.
 * That is fine for the MVP. Later, we can move this to Postgres or Redis.
 */
let cachedLocations: NormalisedChargerLocation[] | null = null;

/**
 * Timestamp of the last successful cache refresh.
 *
 * Stored as milliseconds since Unix epoch.
 */
let cachedAtMs: number | null = null;

/**
 * Whether a cache refresh is currently running.
 *
 * This prevents multiple users from triggering several simultaneous
 * feed downloads at the same time.
 */
let refreshInProgress: Promise<NormalisedChargerLocation[]> | null = null;

/**
 * Returns all known charger locations.
 *
 * If the cache is fresh, this returns the cached data.
 * If the cache is missing or stale, it refreshes the cache first.
 */
export async function getCachedChargerLocations(): Promise<NormalisedChargerLocation[]> {
  if (isCacheFresh()) {
    return cachedLocations ?? [];
  }

  /**
   * If another request has already started a refresh, wait for that same
   * refresh rather than starting a duplicate one.
   */
  if (refreshInProgress) {
    return refreshInProgress;
  }

  refreshInProgress = refreshChargerCache();

  try {
    return await refreshInProgress;
  } finally {
    refreshInProgress = null;
  }
}

/**
 * Returns simple cache status information for debugging.
 */
export function getCacheStatus() {
  const now = Date.now();

  return {
    hasCachedLocations: cachedLocations !== null,
    cachedLocationCount: cachedLocations?.length ?? 0,
    cachedAt: cachedAtMs ? new Date(cachedAtMs).toISOString() : null,
    cacheAgeSeconds: cachedAtMs ? Math.round((now - cachedAtMs) / 1000) : null,
    cacheTtlSeconds: Math.round(CACHE_TTL_MS / 1000),
    isFresh: isCacheFresh(),
    refreshInProgress: refreshInProgress !== null
  };
}

/**
 * Forces the cache to be refreshed immediately.
 *
 * Useful for debugging or admin-style manual refreshes.
 */
export async function forceRefreshChargerCache(): Promise<NormalisedChargerLocation[]> {
  if (refreshInProgress) {
    return refreshInProgress;
  }

  refreshInProgress = refreshChargerCache();

  try {
    return await refreshInProgress;
  } finally {
    refreshInProgress = null;
  }
}

/**
 * Checks whether the current cache can be used.
 */
function isCacheFresh(): boolean {
  if (!cachedLocations || !cachedAtMs) {
    return false;
  }

  const cacheAgeMs = Date.now() - cachedAtMs;

  return cacheAgeMs < CACHE_TTL_MS;
}

/**
 * Downloads and normalises all configured CPO feeds.
 *
 * If one feed fails, the whole refresh currently fails.
 *
 * MVP note:
 * This is simple and clear.
 *
 * Future improvement:
 * We should let one failed CPO feed fail independently, while still keeping
 * successful feeds available.
 */
async function refreshChargerCache(): Promise<NormalisedChargerLocation[]> {
  console.log("Refreshing charger cache...");

  const nestedLocations = await Promise.all(
    cpoFeeds.map((feed) => fetchAndNormaliseCpoLocations(feed))
  );

  const allLocations = nestedLocations.flat();

  cachedLocations = allLocations;
  cachedAtMs = Date.now();

  console.log(`Charger cache refreshed with ${allLocations.length} locations.`);

  return allLocations;
}
