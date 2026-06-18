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
import {
  NormalisedChargerLocation,
  NormalisedConnector,
  NormalisedEVSE,
  NormalisedStatus
} from "./types.js";

/**
 * A charger location after the /chargers endpoint has added
 * app-friendly summary fields.
 *
 * We keep this separate from NormalisedChargerLocation because the cached
 * raw/normalised data should stay close to the CPO/OCPI shape, while this
 * enriched type is specifically for API responses to the iPhone app.
 */
type EnrichedChargerLocation = NormalisedChargerLocation & {
  /**
   * Distance from the requested search point, in kilometres.
   */
  distanceKm: number;

  /**
   * App-friendly summary status for the whole charging location.
   */
  summaryStatus: NormalisedStatus;

  /**
   * Highest connector power available at this location, in kilowatts.
   */
  maximumPowerKw?: number;

  /**
   * Unique connector types found at this location.
   *
   * Example:
   * ["CCS", "CHADEMO", "TYPE_2"]
   */
  connectorTypes: string[];

  /**
   * Number of EVSEs that are currently available.
   */
  availableEvseCount: number;

  /**
   * Total number of EVSEs at the location.
   */
  totalEvseCount: number;
};

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
 *
 * Optional filters:
 * GET /chargers?lat=54.0&lon=-0.4&radiusKm=25&connector=CCS
 * GET /chargers?lat=54.0&lon=-0.4&radiusKm=25&minPowerKw=50
 * GET /chargers?lat=54.0&lon=-0.4&radiusKm=25&availableOnly=true
 *
 * These filters are deliberately simple so the SwiftUI app can call them easily.
 */
app.get("/chargers", async (req: any, res: any) => {
  try {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    const radiusKm = Number(req.query.radiusKm ?? 25);

    /**
     * Optional connector filter.
     *
     * Example:
     * connector=CCS
     * connector=TYPE_2
     *
     * Matching is case-insensitive.
     */
    const connectorFilter =
      typeof req.query.connector === "string"
        ? req.query.connector.trim().toUpperCase()
        : undefined;

    /**
     * Optional minimum power filter.
     *
     * Example:
     * minPowerKw=50
     *
     * This means:
     * "Only return locations where at least one connector is 50 kW or above."
     */
    const minPowerKw =
      req.query.minPowerKw !== undefined
        ? Number(req.query.minPowerKw)
        : undefined;

    /**
     * Optional availability filter.
     *
     * Example:
     * availableOnly=true
     *
     * This means:
     * "Only return locations where at least one EVSE is currently AVAILABLE."
     */
    const availableOnly =
      typeof req.query.availableOnly === "string" &&
      req.query.availableOnly.toLowerCase() === "true";

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
     * Validate optional radius.
     */
    if (!Number.isFinite(radiusKm) || radiusKm <= 0) {
      res.status(400).json({
        error: "radiusKm must be a positive number"
      });
      return;
    }

    /**
     * Validate optional minimum power filter.
     */
    if (
      minPowerKw !== undefined &&
      (!Number.isFinite(minPowerKw) || minPowerKw < 0)
    ) {
      res.status(400).json({
        error: "minPowerKw must be a positive number"
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
     * Add app-friendly summary fields before filtering/sorting.
     *
     * This lets the SwiftUI app display useful values without needing to
     * understand the full Location -> EVSE -> Connector hierarchy.
     */
    const enrichedLocations = allLocations.map((location) => {
      return enrichLocation(location, lat, lon);
    });

    /**
     * Filter to chargers within the requested radius and matching
     * any optional connector/power/availability filters.
     */
    const nearbyLocations = enrichedLocations
      .filter((location) => {
        if (location.distanceKm > radiusKm) {
          return false;
        }

        if (availableOnly && location.summaryStatus !== "AVAILABLE") {
          return false;
        }

        if (connectorFilter && !locationHasConnector(location, connectorFilter)) {
          return false;
        }

        if (
          minPowerKw !== undefined &&
          (location.maximumPowerKw === undefined ||
            location.maximumPowerKw < minPowerKw)
        ) {
          return false;
        }

        return true;
      })
      .sort((a, b) => {
        /**
         * Sort order:
         * 1. Available locations first
         * 2. Nearest locations first
         *
         * This gives the app a sensible default list without complex UI logic.
         */
        const aAvailable = a.summaryStatus === "AVAILABLE";
        const bAvailable = b.summaryStatus === "AVAILABLE";

        if (aAvailable !== bAvailable) {
          return aAvailable ? -1 : 1;
        }

        return a.distanceKm - b.distanceKm;
      });

    /**
     * We deliberately keep this response object simple rather than forcing
     * it into ChargerSearchResponse, because nearbyLocations now contains
     * enriched fields in addition to the base normalised location shape.
     */
    const response = {
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
 * Charger detail endpoint.
 *
 * Example:
 * GET /chargers/geniepoint-abc123
 *
 * This returns one charger location by ID.
 *
 * The list endpoint is useful for map/list screens:
 *
 * GET /chargers?lat=54.0&lon=-0.4&radiusKm=25
 *
 * This detail endpoint is useful when the user taps one charger and the
 * SwiftUI app wants the full Location -> EVSE -> Connector data.
 */
app.get("/chargers/:id", async (req: any, res: any) => {
  try {
    const chargerId = String(req.params.id ?? "").trim();

    /**
     * Validate that the caller supplied an ID.
     */
    if (chargerId.length === 0) {
      res.status(400).json({
        error: "charger id is required"
      });
      return;
    }

    /**
     * Load all charger locations from the same in-memory cache used by
     * the /chargers list endpoint.
     *
     * If the cache is empty or stale, this will refresh it first.
     */
    const allLocations = await getCachedChargerLocations();

    /**
     * Find the requested charger.
     *
     * IDs are generated by our normaliser, usually in the form:
     * cpoId-locationId
     *
     * Example:
     * geniepoint-12345
     */
    const matchingLocation = allLocations.find((location) => {
      return location.id === chargerId;
    });

    if (!matchingLocation) {
      res.status(404).json({
        error: "charger not found",
        id: chargerId
      });
      return;
    }

    /**
     * Return the full normalised charger location.
     *
     * Note:
     * This endpoint does not calculate distance, because it does not know
     * where the user is unless we ask for lat/lon here too.
     */
    res.json({
      location: matchingLocation
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Failed to load charger detail"
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
 * Adds app-friendly summary fields to a normalised charger location.
 *
 * The raw normalised model still keeps the useful OCPI-style hierarchy:
 *
 * Location
 *   -> EVSEs
 *      -> Connectors
 *
 * But the iPhone app should not need to calculate simple display values
 * like distance, maximum power, or available connector types.
 */
function enrichLocation(
  location: NormalisedChargerLocation,
  searchLat: number,
  searchLon: number
): EnrichedChargerLocation {
  const locationDistanceKm = distanceKm(
    searchLat,
    searchLon,
    location.latitude,
    location.longitude
  );

  const allConnectors = getAllConnectors(location);
  const maximumPowerKw = getMaximumPowerKw(allConnectors);
  const connectorTypes = getConnectorTypes(allConnectors);
  const summaryStatus = getSummaryStatus(location.evses);

  const availableEvseCount = location.evses.filter((evse) => {
    return evse.status === "AVAILABLE";
  }).length;

  return {
    ...location,
    distanceKm: roundToTwoDecimalPlaces(locationDistanceKm),
    summaryStatus,
    maximumPowerKw,
    connectorTypes,
    availableEvseCount,
    totalEvseCount: location.evses.length
  };
}

/**
 * Returns all connectors at a location as one flat array.
 */
function getAllConnectors(
  location: NormalisedChargerLocation
): NormalisedConnector[] {
  return location.evses.flatMap((evse) => {
    return evse.connectors;
  });
}

/**
 * Returns the highest known connector power at a location.
 */
function getMaximumPowerKw(
  connectors: NormalisedConnector[]
): number | undefined {
  const powers = connectors
    .map((connector) => connector.powerKw)
    .filter((power): power is number => {
      return typeof power === "number" && Number.isFinite(power);
    });

  if (powers.length === 0) {
    return undefined;
  }

  return Math.max(...powers);
}

/**
 * Returns unique connector standards at a location.
 */
function getConnectorTypes(connectors: NormalisedConnector[]): string[] {
  const connectorTypes = connectors
    .map((connector) => connector.standard)
    .filter((standard): standard is string => {
      return typeof standard === "string" && standard.trim().length > 0;
    })
    .map((standard) => {
      return standard.toUpperCase();
    });

  return Array.from(new Set(connectorTypes)).sort();
}

/**
 * Produces one summary status for a whole charging location.
 *
 * Rules:
 * - If any EVSE is AVAILABLE, the whole location is useful now.
 * - Otherwise, if any EVSE is CHARGING, RESERVED, or OCCUPIED, call it OCCUPIED.
 * - Otherwise, if any EVSE is OUT_OF_ORDER or INOPERATIVE, call it OUT_OF_ORDER.
 * - Otherwise, UNKNOWN.
 */
function getSummaryStatus(evses: NormalisedEVSE[]): NormalisedStatus {
  const statuses = evses.map((evse) => evse.status);

  if (statuses.includes("AVAILABLE")) {
    return "AVAILABLE";
  }

  if (
    statuses.includes("CHARGING") ||
    statuses.includes("RESERVED") ||
    statuses.includes("OCCUPIED")
  ) {
    return "OCCUPIED";
  }

  if (statuses.includes("OUT_OF_ORDER") || statuses.includes("INOPERATIVE")) {
    return "OUT_OF_ORDER";
  }

  return "UNKNOWN";
}

/**
 * Checks whether a location has a connector matching the requested filter.
 *
 * Matching is case-insensitive.
 */
function locationHasConnector(
  location: EnrichedChargerLocation,
  requestedConnector: string
): boolean {
  const requested = requestedConnector.trim().toUpperCase();

  return getAllConnectors(location).some((connector) => {
    return connector.standard?.trim().toUpperCase() === requested;
  });
}

/**
 * Rounds a number to two decimal places.
 *
 * Useful for distance values returned to the app.
 */
function roundToTwoDecimalPlaces(value: number): number {
  return Math.round(value * 100) / 100;
}

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

