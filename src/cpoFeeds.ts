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
    id: "clenergy",
    name: "Clenergy EV",

    /**
     * Clenergy's open-data page links to this public locations endpoint.
     *
     * Render environment variable:
     * CLENERGY_LOCATIONS_URL=https://api.clenergy.online/development/pcpr/locations
     */
    locationsUrl:
      process.env.CLENERGY_LOCATIONS_URL ??
      "https://api.clenergy.online/development/pcpr/locations"
  })
];
