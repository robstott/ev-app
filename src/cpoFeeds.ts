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
  /**
   * GeniePoint
   *
   * Public open-data locations endpoint.
   */
  ...optionalFeed({
    id: "geniepoint",
    name: "GeniePoint",
    locationsUrl:
      process.env.GENIEPOINT_LOCATIONS_URL ??
      "https://opendata.geniepoint.co.uk/locations"
  }),

  /**
   * Clenergy EV
   *
   * Public OCPI-style open-data locations endpoint.
   */
  ...optionalFeed({
    id: "clenergy",
    name: "Clenergy EV",
    locationsUrl:
      process.env.CLENERGY_LOCATIONS_URL ??
      "https://api.clenergy.online/development/pcpr/locations"
  }),

  /**
   * BMM Networks / EV Dot
   *
   * BMM's open-data page links to machine-readable OCPI locations data.
   *
   * Once you have copied the actual BMM locations URL from their open-data page,
   * add it in Render as:
   *
   * BMM_LOCATIONS_URL=https://...
   *
   * Until that environment variable is set, this feed is skipped because
   * the fallback URL contains example.com.
   */
  ...optionalFeed({
    id: "bmm",
    name: "BMM Networks / EV Dot",
    locationsUrl:
      process.env.BMM_LOCATIONS_URL ??
      "https://example.com/bmm-locations.json"
  }),

  /**
   * GRIDSERVE
   *
   * GRIDSERVE appears to require API onboarding rather than simply exposing
   * a public no-auth JSON URL in the same way as GeniePoint or Clenergy.
   *
   * Once GRIDSERVE gives you an endpoint, add it in Render as:
   *
   * GRIDSERVE_LOCATIONS_URL=https://...
   *
   * If they also give you a token, add:
   *
   * GRIDSERVE_TOKEN=...
   */
  ...optionalFeed({
    id: "gridserve",
    name: "GRIDSERVE",
    locationsUrl:
      process.env.GRIDSERVE_LOCATIONS_URL ??
      "https://example.com/gridserve-locations.json",
    token: process.env.GRIDSERVE_TOKEN
  })
];
