declare const process: {
  env: Record<string, string | undefined>;
};

import express from "express";
import { distanceKm } from "./geo.js";
import {
  forceRefreshChargerCache,
  getCachedChargerLocations,
  getCacheStatus
} from "./cache.js";
import { ChargerSearchResponse } from "./types.js";

/**
 * Create the Express application.
 *
 * Express is a lightweight web server framework for Node.js.
 */
const app = express();

/**
 * Tell Express to understand JSON request bodies.
 *
 * Our current GET endpoints do not need this much,
 * but it is useful once we add admin/sync/debug endpoints.
 */
app.use(express.json());

/**
 * Simple health check.
 *
 * Useful for:
 * - testing locally
 * - deployment platforms
 * - uptime monitors
 */
app.get("/health", (_req: any, res: any) => {
  res.json({
    ok: true
  });
});

/**
 * Main charger search endpoint.
 *
 * Example:
 * GET /chargers?lat=54.0&lon=-0.4&radiusKm=25
 */
app.get("/chargers", async (req: any, res: any) => {
  try {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    const radiusKm = Number(req.query.radiusKm ?? 25);

    /**
     * Validate required query parameters.
     */
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      res.status(400).json({
        error: "lat and lon query parameters are required"
      });
      return;
    }

    /**
     * Load all charger locations from our in-memory cache.
     *
     * If the cache is stale or empty, this will refresh it first.
     */
    const allLocations = await getCachedChargerLocations();

    /**
     * Filter to chargers within the requested radius.
     */
    const nearbyLocations = allLocations
      .filter((location) => {
        const distance = distanceKm(
          lat,
          lon,
          location.latitude,
          location.longitude
        );

        return distance <= radiusKm;
      })
      .sort((a, b) => {
        const distanceA = distanceKm(lat, lon, a.latitude, a.longitude);
        const distanceB = distanceKm(lat, lon, b.latitude, b.longitude);

        return distanceA - distanceB;
      });

    const response: ChargerSearchResponse = {
      locations: nearbyLocations
    };

    res.json(response);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Failed to load charger data"
    });
  }
});

/**
 * Debug endpoint showing cache status.
 *
 * Useful while developing because it tells us:
 * - whether the cache has data
 * - how old the data is
 * - whether a refresh is currently running
 */
app.get("/debug/cache-status", (_req: any, res: any) => {
  res.json(getCacheStatus());
});

/**
 * Debug endpoint to force a cache refresh.
 *
 * This is useful after changing feed configuration or normalisation logic.
 *
 * In a real public production app, this should be protected by an admin key.
 * For the MVP, it is okay, but we should remove or protect it later.
 */
app.post("/debug/refresh-cache", async (_req: any, res: any) => {
  try {
    const locations = await forceRefreshChargerCache();

    res.json({
      ok: true,
      locationCount: locations.length,
      cacheStatus: getCacheStatus()
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: String(error)
    });
  }
});

/**
 * Temporary debug endpoint.
 *
 * This fetches the first CPO feed and returns basic information about
 * the raw JSON shape. It helps us understand whether the operator returns:
 *
 * - an array directly
 * - an OCPI-style { data: [...] } wrapper
 * - something else
 *
 * Remove this endpoint once the feed is working and stable.
 */
app.get("/debug/raw-feed-shape", async (_req: any, res: any) => {
  try {
    /**
     * Importing here avoids keeping cpoFeeds in the main import list
     * unless this debug endpoint is actually called.
     */
    const { cpoFeeds } = await import("./cpoFeeds.js");

    const firstFeed = cpoFeeds[0];

    if (!firstFeed) {
      res.status(500).json({
        error: "No CPO feeds configured"
      });
      return;
    }

    const response = await fetch(firstFeed.locationsUrl, {
      method: "GET",
      headers: {
        Accept: "application/json"
      }
    });

    const rawJson = await response.json();

    const topLevelType = Array.isArray(rawJson) ? "array" : typeof rawJson;

    const data = Array.isArray(rawJson)
      ? rawJson
      : rawJson &&
          typeof rawJson === "object" &&
          "data" in rawJson &&
          Array.isArray((rawJson as any).data)
        ? (rawJson as any).data
        : undefined;

    const firstItem = data?.[0];

    res.json({
      feedName: firstFeed.name,
      feedUrl: firstFeed.locationsUrl,
      httpStatus: response.status,
      topLevelType,
      isArray: Array.isArray(rawJson),
      topLevelKeys:
        rawJson && typeof rawJson === "object" && !Array.isArray(rawJson)
          ? Object.keys(rawJson)
          : undefined,
      extractedItemCount: data?.length ?? 0,
      firstItemKeys:
        firstItem && typeof firstItem === "object"
          ? Object.keys(firstItem)
          : undefined,
      firstItemPreview: firstItem
    });
  } catch (error) {
    res.status(500).json({
      error: String(error)
    });
  }
});

/**
 * Use the port supplied by the hosting platform,
 * or default to 3000 for local development.
 *
 * Render provides the PORT environment variable automatically.
 */
const port = Number(process.env.PORT ?? 3000);

app.listen(port, () => {
  console.log(`EV charger backend running on port ${port}`);
});
