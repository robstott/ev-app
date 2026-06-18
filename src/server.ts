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
  distanceKm: number;
  summaryStatus: NormalisedStatus;
  maximumPowerKw?: number;
  connectorTypes: string[];
  availableEvseCount: number;
  totalEvseCount: number;
};

/**
 * Create the Express application.
 */
const app = express();

/**
 * Tell Express to understand JSON request bodies.
 */
app.use(express.json());

/**
 * Simple health check.
 */
app.get("/health", (_req: any, res: any) => {
  res.json({
    ok: true
  });
});

/**
 * Main charger search endpoint.
 *
 * Examples:
 * GET /chargers?lat=54.0&lon=-0.4&radiusKm=25
 * GET /chargers?lat=54.0&lon=-0.4&radiusKm=25&connector=CCS
 * GET /chargers?lat=54.0&lon=-0.4&radiusKm=25&minPowerKw=50
 * GET /chargers?lat=54.0&lon=-0.4&radiusKm=25&availableOnly=true
 */
app.get("/chargers", async (req: any, res: any) => {
  try {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    const radiusKm = Number(req.query.radiusKm ?? 25);

    const connectorFilter =
      typeof req.query.connector === "string"
        ? req.query.connector.trim().toUpperCase()
        : undefined;

    const minPowerKw =
      req.query.minPowerKw !== undefined
        ? Number(req.query.minPowerKw)
        : undefined;

    const availableOnly =
      typeof req.query.availableOnly === "string" &&
      req.query.availableOnly.toLowerCase() === "true";

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      res.status(400).json({
        error: "lat and lon query parameters are required"
      });
      return;
    }

    if (!Number.isFinite(radiusKm) || radiusKm <= 0) {
      res.status(400).json({
        error: "radiusKm must be a positive number"
      });
      return;
    }

    if (
      minPowerKw !== undefined &&
      (!Number.isFinite(minPowerKw) || minPowerKw < 0)
    ) {
      res.status(400).json({
        error: "minPowerKw must be a positive number"
      });
      return;
    }

    const allLocations = await getCachedChargerLocations();

    const enrichedLocations = allLocations.map((location) => {
      return enrichLocation(location, lat, lon);
    });

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
        const aAvailable = a.summaryStatus === "AVAILABLE";
        const bAvailable = b.summaryStatus === "AVAILABLE";

        if (aAvailable !== bAvailable) {
          return aAvailable ? -1 : 1;
        }

        return a.distanceKm - b.distanceKm;
      });

    res.json({
      locations: nearbyLocations
    });
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
 */
app.get("/chargers/:id", async (req: any, res: any) => {
  try {
    const chargerId = String(req.params.id ?? "").trim();

    if (chargerId.length === 0) {
      res.status(400).json({
        error: "charger id is required"
      });
      return;
    }

    const allLocations = await getCachedChargerLocations();

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
 */
app.get("/debug/cache-status", (_req: any, res: any) => {
  res.json(getCacheStatus());
});

/**
 * Debug endpoint to force a cache refresh.
 *
 * In a real public production app, this should be protected by an admin key.
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
 * Examples:
 * GET /debug/raw-feed-shape
 * GET /debug/raw-feed-shape?feedId=bmm
 * GET /debug/raw-feed-shape?feedId=clenergy
 */
app.get("/debug/raw-feed-shape", async (req: any, res: any) => {
  try {
    const { cpoFeeds } = await import("./cpoFeeds.js");

    const requestedFeedId =
      typeof req.query.feedId === "string"
        ? req.query.feedId.trim()
        : undefined;

    const feed =
      requestedFeedId !== undefined
        ? cpoFeeds.find((candidateFeed) => {
            return candidateFeed.id === requestedFeedId;
          })
        : cpoFeeds[0];

    if (!feed) {
      res.status(404).json({
        error: "Feed not found",
        requestedFeedId,
        availableFeedIds: cpoFeeds.map((candidateFeed) => {
          return candidateFeed.id;
        })
      });
      return;
    }

    const headers: Record<string, string> = {
      Accept: "application/json"
    };

    if (feed.token) {
      headers.Authorization = `Token ${feed.token}`;
    }

    const response = await fetch(feed.locationsUrl, {
      method: "GET",
      headers
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
      feedId: feed.id,
      feedName: feed.name,
      feedUrl: feed.locationsUrl,
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
 * Debug endpoint showing which CPO feeds are currently configured.
 */
app.get("/debug/feeds", async (_req: any, res: any) => {
  try {
    const { cpoFeeds } = await import("./cpoFeeds.js");

    res.json({
      feedCount: cpoFeeds.length,
      feeds: cpoFeeds.map((feed) => {
        return {
          id: feed.id,
          name: feed.name,
          locationsUrl: feed.locationsUrl,
          hasToken: Boolean(feed.token)
        };
      })
    });
  } catch (error) {
    res.status(500).json({
      error: String(error)
    });
  }
});

/**
 * Debug endpoint estimating current backend coverage.
 *
 * This counts:
 * - locations
 * - EVSEs / chargers
 * - connectors
 *
 * grouped by our feed ID prefix, e.g.
 * geniepoint-, clenergy-, bmm-, chargy-
 *
 * It then compares our EVSE count with a recent UK public EV charger
 * estimate. This is only an approximation, but useful during development.
 */
app.get("/debug/coverage", async (_req: any, res: any) => {
  try {
    const allLocations = await getCachedChargerLocations();

    /**
     * UK public EVSE / charger estimate.
     *
     * This value should be reviewed periodically because the UK charging
     * network is growing quickly.
     */
    const UK_PUBLIC_EVSE_ESTIMATE = 120_388;

    const byFeed: Record<
      string,
      {
        locationCount: number;
        evseCount: number;
        connectorCount: number;
      }
    > = {};

    for (const location of allLocations) {
      const feedId = location.id.split("-")[0] ?? "unknown";

      if (!byFeed[feedId]) {
        byFeed[feedId] = {
          locationCount: 0,
          evseCount: 0,
          connectorCount: 0
        };
      }

      byFeed[feedId].locationCount += 1;
      byFeed[feedId].evseCount += location.evses.length;
      byFeed[feedId].connectorCount += location.evses.reduce(
        (total, evse) => {
          return total + evse.connectors.length;
        },
        0
      );
    }

    const totalLocationCount = allLocations.length;

    const totalEvseCount = allLocations.reduce((total, location) => {
      return total + location.evses.length;
    }, 0);

    const totalConnectorCount = allLocations.reduce((total, location) => {
      return (
        total +
        location.evses.reduce((evseTotal, evse) => {
          return evseTotal + evse.connectors.length;
        }, 0)
      );
    }, 0);

    const estimatedUkCoveragePercent =
      Math.round((totalEvseCount / UK_PUBLIC_EVSE_ESTIMATE) * 10_000) / 100;

    res.json({
      basis: {
        ukPublicEvseEstimate: UK_PUBLIC_EVSE_ESTIMATE,
        estimateSource: "Zapmap end-April 2026 public EV charger count",
        note:
          "Coverage is approximate because feeds may use slightly different EVSE/device/connector interpretations."
      },
      totals: {
        locationCount: totalLocationCount,
        evseCount: totalEvseCount,
        connectorCount: totalConnectorCount,
        estimatedUkCoveragePercent
      },
      byFeed
    });
  } catch (error) {
    res.status(500).json({
      error: String(error)
    });
  }
});

/**
 * Adds app-friendly summary fields to a normalised charger location.
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
 */
function roundToTwoDecimalPlaces(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Use the port supplied by the hosting platform,
 * or default to 3000 for local development.
 */
const port = Number(process.env.PORT ?? 3000);

app.listen(port, () => {
  console.log(`EV charger backend running on port ${port}`);
});
