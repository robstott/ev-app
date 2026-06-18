declare const process: {
  env: Record<string, string | undefined>;
};

import express from "express";
import { cpoFeeds } from "./cpoFeeds.js";
import { distanceKm } from "./geo.js";
import { fetchAndNormaliseCpoLocations } from "./normalise.js";
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
 * - deployment platforms such as Render
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
     * Fetch all configured CPO feeds in parallel.
     *
     * MVP note:
     * This is OK for development, but not ideal for production.
     *
     * Production note:
     * We should sync feeds periodically into a database/cache,
     * then serve app requests from our own database.
     */
    const nestedLocations = await Promise.all(
      cpoFeeds.map((feed) => fetchAndNormaliseCpoLocations(feed))
    );

    const allLocations = nestedLocations.flat();

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
 * Use the port supplied by the hosting platform,
 * or default to 3000 for local development.
 *
 * Render supplies process.env.PORT automatically.
 */
const port = Number(process.env.PORT ?? 3000);

app.listen(port, () => {
  console.log(`EV charger backend running on port ${port}`);
});
