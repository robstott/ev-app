/**
 * This file contains the clean data shapes used by our backend.
 *
 * These are not raw OCPI types.
 * They are the simplified objects that our iPhone app will receive.
 */

/**
 * The full response returned by:
 *
 * GET /chargers?lat=...&lon=...&radiusKm=...
 */
export type ChargerSearchResponse = {
  locations: NormalisedChargerLocation[];
};

/**
 * A physical charging site.
 *
 * In OCPI terms, this roughly maps to a "Location".
 */
export type NormalisedChargerLocation = {
  /**
   * Unique ID created by our backend.
   *
   * We prefix the CPO ID so two operators cannot accidentally clash.
   * Example:
   * "geniepoint-12345"
   */
  id: string;

  /**
   * Human-friendly charger/site name.
   */
  name: string;

  /**
   * Name of the charge point operator.
   */
  operatorName?: string;

  /**
   * Latitude in decimal degrees.
   */
  latitude: number;

  /**
   * Longitude in decimal degrees.
   */
  longitude: number;

  /**
   * Optional readable address.
   */
  address?: string;

  /**
   * Timestamp from the operator feed, if available.
   *
   * This is important because live charger status becomes less useful
   * as it gets older.
   */
  lastUpdated?: string;

  /**
   * One or more EVSEs at this location.
   */
  evses: NormalisedEVSE[];
};

/**
 * One usable charging unit at a location.
 *
 * A physical charger cabinet may contain more than one EVSE.
 */
export type NormalisedEVSE = {
  id: string;
  status: NormalisedStatus;
  connectors: NormalisedConnector[];
};

/**
 * One connector attached to an EVSE.
 */
export type NormalisedConnector = {
  id: string;

  /**
   * Example values:
   * "CCS", "CHADEMO", "TYPE_2"
   */
  standard?: string;

  /**
   * Charging power in kilowatts.
   */
  powerKw?: number;
};

/**
 * Simplified charger statuses for our app.
 *
 * Raw OCPI has more nuance, but this is good enough for the first app.
 */
export type NormalisedStatus =
  | "AVAILABLE"
  | "OCCUPIED"
  | "CHARGING"
  | "RESERVED"
  | "OUT_OF_ORDER"
  | "INOPERATIVE"
  | "UNKNOWN";

/**
 * Configuration for one charge point operator feed.
 */
export type CpoFeedConfig = {
  /**
   * Short internal ID.
   *
   * Example:
   * "geniepoint"
   */
  id: string;

  /**
   * Human-friendly name.
   */
  name: string;

  /**
   * URL for the operator's locations feed.
   *
   * This may be a public JSON file or an OCPI endpoint.
   */
  locationsUrl: string;

  /**
   * Optional access token.
   *
   * Some operators may require credentials.
   * Never commit real tokens into source control.
   */
  token?: string;
};
