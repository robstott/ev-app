declare const process: {
  env: Record<string, string | undefined>;
};

import { CpoFeedConfig } from "./types.js";

/**
 * Helper that only includes a feed when a URL has actually been configured.
 *
 * This lets us add optional CPOs without breaking the app while we are waiting
 * for API access or credentials.
 */
function optionalFeed(feed: CpoFeedConfig): CpoFeedConfig[] {
  if (!feed.locationsUrl || feed.locationsUrl.includes("example.com")) {
    return [];
  }

  return [feed];
}

/**
 * List of CPO feeds our backend knows about.
 *
 * Each feed should provide location/reference/status data in either:
 * - OCPI-ish JSON format, usually { data: [...] }
 * - or a direct array of location objects
 *
 * The normaliser then converts each operator into our clean app model.
 */
export const cpoFeeds: CpoFeedConfig[] = [
  ...optionalFeed({
    id: "geniepoint",
    name: "GeniePoint",
    locationsUrl:
      process.env.GENIEPOINT_LOCATIONS_URL ??
      "https://opendata.geniepoint.co.uk/locations"
  }),

  ...optionalFeed({
    id: "gridserve",
    name: "GRIDSERVE",

    /**
     * Put the GRIDSERVE locations/reference-data endpoint here once they
     * provide API access.
     *
     * Render environment variable:
     * GRIDSERVE_LOCATIONS_URL=https://...
     */
    locationsUrl:
      process.env.GRIDSERVE_LOCATIONS_URL ??
      "https://example.com/gridserve-locations.json",

    /**
     * If GRIDSERVE gives you a token, put it in Render as:
     * GRIDSERVE_TOKEN=...
     *
     * The normaliser already sends:
     * Authorization: Token <token>
     *
     * If their docs require "Bearer" instead, we can update this per feed.
     */
    token: process.env.GRIDSERVE_TOKEN
  })
];
