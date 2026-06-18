import {
  CpoFeedConfig,
  NormalisedChargerLocation,
  NormalisedConnector,
  NormalisedEVSE,
  NormalisedStatus
} from "./types.js";

/**
 * Fetches one operator's locations feed and normalises it.
 *
 * This is deliberately generic and defensive. Real-world feeds can be
 * incomplete, inconsistent, temporarily broken, or subtly different from
 * the standard shape you expect.
 */
export async function fetchAndNormaliseCpoLocations(
  feed: CpoFeedConfig
): Promise<NormalisedChargerLocation[]> {
  const headers: Record<string, string> = {
    Accept: "application/json"
  };

  /**
   * Some OCPI endpoints use token-based authentication.
   *
   * Keep tokens in environment variables, not source code.
   */
  if (feed.token) {
    headers.Authorization = `Token ${feed.token}`;
  }

  const response = await fetch(feed.locationsUrl, {
    method: "GET",
    headers
  });

  if (!response.ok) {
    throw new Error(`Feed ${feed.name} returned HTTP ${response.status}`);
  }

  const rawJson: unknown = await response.json();

  /**
   * OCPI APIs often return:
   *
   * {
   *   "data": [ ... ],
   *   "status_code": 1000,
   *   "timestamp": "..."
   * }
   *
   * Some open-data JSON files may just be:
   *
   * [ ... ]
   *
   * This supports both shapes.
   */
  const rawLocations = extractRawLocationArray(rawJson);

  return rawLocations
    .map((rawLocation) => normaliseOcpiLocation(feed, rawLocation))
    .filter((location): location is NormalisedChargerLocation => {
      return location !== null;
    });
}

/**
 * Extracts the array of location objects from an unknown JSON response.
 */
function extractRawLocationArray(rawJson: unknown): unknown[] {
  if (Array.isArray(rawJson)) {
    return rawJson;
  }

  if (
    typeof rawJson === "object" &&
    rawJson !== null &&
    "data" in rawJson &&
    Array.isArray((rawJson as { data: unknown }).data)
  ) {
    return (rawJson as { data: unknown[] }).data;
  }

  return [];
}

/**
 * Converts one raw OCPI-ish location into our clean app model.
 *
 * We use unknown and cautious runtime checks because data from external
 * APIs should never be trusted blindly.
 */
function normaliseOcpiLocation(
  feed: CpoFeedConfig,
  raw: unknown
): NormalisedChargerLocation | null {
  if (!isObject(raw)) {
    return null;
  }

  const coordinates = getObject(raw.coordinates);

  const latitude = toNumber(coordinates?.latitude);
  const longitude = toNumber(coordinates?.longitude);

  /**
   * If a location has no valid coordinates, the app cannot map it.
   */
  if (latitude === undefined || longitude === undefined) {
    return null;
  }

  const rawLocationId =
    toStringOrUndefined(raw.id) ??
    toStringOrUndefined(raw.uid) ??
    crypto.randomUUID();

  const evsesRaw = Array.isArray(raw.evses) ? raw.evses : [];

  const evses: NormalisedEVSE[] = evsesRaw.map((rawEvse, index) => {
    return normaliseEvse(feed, rawLocationId, rawEvse, index);
  });

  return {
    id: `${feed.id}-${rawLocationId}`,
    name:
      toStringOrUndefined(raw.name) ??
      toStringOrUndefined(raw.address) ??
      "Unnamed charging location",
    operatorName: extractOperatorName(raw) ?? feed.name,
    latitude,
    longitude,
    address: buildAddress(raw),
    lastUpdated: toStringOrUndefined(raw.last_updated),
    evses
  };
}

/**
 * Converts one raw EVSE into our clean EVSE model.
 */
function normaliseEvse(
  feed: CpoFeedConfig,
  locationId: string,
  raw: unknown,
  index: number
): NormalisedEVSE {
  const rawObject = getObject(raw);

  const rawEvseId =
    toStringOrUndefined(rawObject?.uid) ??
    toStringOrUndefined(rawObject?.evse_id) ??
    `${locationId}-evse-${index}`;

  const rawConnectors = Array.isArray(rawObject?.connectors)
    ? rawObject.connectors
    : [];

  const connectors = rawConnectors.map((rawConnector, connectorIndex) => {
    return normaliseConnector(
      feed,
      locationId,
      rawEvseId,
      rawConnector,
      connectorIndex
    );
  });

  return {
    id: `${feed.id}-${rawEvseId}`,
    status: normaliseOcpiStatus(rawObject?.status),
    connectors
  };
}

/**
 * Converts one raw connector into our clean connector model.
 */
function normaliseConnector(
  feed: CpoFeedConfig,
  locationId: string,
  evseId: string,
  raw: unknown,
  index: number
): NormalisedConnector {
  const rawObject = getObject(raw);

  const rawConnectorId =
    toStringOrUndefined(rawObject?.id) ?? `connector-${index}`;

  return {
    id: `${feed.id}-${locationId}-${evseId}-${rawConnectorId}`,
    standard: toStringOrUndefined(rawObject?.standard),
    powerKw: parsePowerKw(rawObject)
  };
}

/**
 * Converts raw OCPI status text into our simplified status enum.
 */
function normaliseOcpiStatus(rawStatus: unknown): NormalisedStatus {
  const status = String(rawStatus ?? "").toUpperCase();

  switch (status) {
    case "AVAILABLE":
      return "AVAILABLE";

    case "CHARGING":
      return "CHARGING";

    case "RESERVED":
      return "RESERVED";

    case "BLOCKED":
    case "OCCUPIED":
      return "OCCUPIED";

    case "OUTOFORDER":
    case "OUT_OF_ORDER":
      return "OUT_OF_ORDER";

    case "INOPERATIVE":
      return "INOPERATIVE";

    default:
      return "UNKNOWN";
  }
}

/**
 * Attempts to calculate connector power in kilowatts.
 *
 * OCPI connector data may include:
 * - max_electric_power in watts
 * - voltage and amperage
 */
function parsePowerKw(
  rawConnector: Record<string, unknown> | undefined
): number | undefined {
  if (!rawConnector) {
    return undefined;
  }

  const maxElectricPowerWatts = toNumber(rawConnector.max_electric_power);

  if (maxElectricPowerWatts !== undefined) {
    return maxElectricPowerWatts / 1000;
  }

  const voltage = toNumber(rawConnector.voltage);
  const amperage = toNumber(rawConnector.amperage);

  if (voltage !== undefined && amperage !== undefined) {
    return (voltage * amperage) / 1000;
  }

  return undefined;
}

/**
 * Builds a simple readable address.
 */
function buildAddress(raw: Record<string, unknown>): string | undefined {
  const parts = [raw.address, raw.city, raw.postal_code, raw.country]
    .map(toStringOrUndefined)
    .filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(", ") : undefined;
}

/**
 * Attempts to extract operator name from an OCPI-ish location object.
 */
function extractOperatorName(
  raw: Record<string, unknown>
): string | undefined {
  const operator = getObject(raw.operator);
  const owner = getObject(raw.owner);

  return toStringOrUndefined(operator?.name) ?? toStringOrUndefined(owner?.name);
}

/**
 * Runtime helper: is this value a plain object?
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Runtime helper: return object or undefined.
 */
function getObject(value: unknown): Record<string, unknown> | undefined {
  return isObject(value) ? value : undefined;
}

/**
 * Runtime helper: convert a value to number if possible.
 */
function toNumber(value: unknown): number | undefined {
  const numberValue = Number(value);

  return Number.isFinite(numberValue) ? numberValue : undefined;
}

/**
 * Runtime helper: convert a value to string if useful.
 */
function toStringOrUndefined(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  if (typeof value === "number") {
    return String(value);
  }

  return undefined;
}
