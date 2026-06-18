/**
 * Small geographic helper functions.
 *
 * For an MVP, Haversine distance is fine.
 * For production, use PostGIS or another spatial index.
 */

/**
 * Calculates approximate distance between two latitude/longitude pairs.
 *
 * Returns distance in kilometres.
 */
export function distanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const earthRadiusKm = 6371;

  const dLat = degreesToRadians(lat2 - lat1);
  const dLon = degreesToRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(degreesToRadians(lat1)) *
      Math.cos(degreesToRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusKm * c;
}

/**
 * Converts degrees to radians.
 */
function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
