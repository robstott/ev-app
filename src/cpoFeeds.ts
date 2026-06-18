import { CpoFeedConfig } from "./types.js";

/**
 * List of charge point operator feeds our backend knows about.
 *
 * For the MVP, we start with one operator slot.
 * Later, add more operators as you obtain open-data URLs or credentials.
 *
 * Important:
 * Use environment variables for real feed URLs and tokens. That keeps
 * deployment-specific details and secrets out of the codebase.
 */
export const cpoFeeds: CpoFeedConfig[] = [
  {
    id: "geniepoint",
    name: "GeniePoint",

    /**
     * Placeholder fallback:
     *
     * Replace GENIEPOINT_LOCATIONS_URL with a real JSON/open-data/OCPI URL
     * in your local shell or Render environment variables.
     */
    locationsUrl:
      process.env.GENIEPOINT_LOCATIONS_URL ??
      "https://example.com/geniepoint-locations.json"
  }

  /**
   * Add more CPOs here as you get access:
   *
   * {
   *   id: "instavolt",
   *   name: "InstaVolt",
   *   locationsUrl: process.env.INSTAVOLT_LOCATIONS_URL ?? "",
   *   token: process.env.INSTAVOLT_TOKEN
   * }
   */
];
