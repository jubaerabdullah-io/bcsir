// Text for the walking route summary, from a result of routing/route-service.js.
//
// The route itself is always the original BCSIR network path. Endpoints are a
// building's recorded entrance, or its footprint centre when no entrance is
// recorded, snapped to the nearest network node by the route service. That
// short access leg is NOT part of the road network, so it is never counted as
// route length. For buildings without a recorded entrance, the summary says
// plainly that the route ends at the nearest point of the network. Pure module,
// tested with node --test.

export const WALKING_SPEED_KMH = 5;

export function formatDistance(metres) {
  if (!Number.isFinite(metres)) return "";
  return metres >= 1000 ? `${(metres / 1000).toFixed(2)} km` : `${Math.round(metres)} m`;
}

export function walkingMinutes(metres) {
  if (!Number.isFinite(metres) || metres <= 0) return 0;
  return Math.max(1, Math.round(metres / (WALKING_SPEED_KMH * 1000 / 60)));
}

const buildingName = (endpoint) => endpoint?.feature?.properties?.name_en?.trim() || endpoint?.feature?.properties?.render_label || "this building";

// One sentence for a building without a recorded entrance, or null when the
// route uses the building's recorded entrance.
export function describeEndpoint(endpoint, role) {
  if (!endpoint) return null;
  const verb = role === "source" ? "starts" : "ends";
  if (endpoint.kind === "centroid") {
    return `No entrance is recorded for ${buildingName(endpoint)}. The route ${verb} at the nearest point of the campus road network, ${formatDistance(endpoint.snapDistanceM)} from the building centre.`;
  }
  return null;
}

// { status, headline, detail, notes[] } for the directions panel.
export function describeRoute(result) {
  if (!result) return null;
  const notes = [describeEndpoint(result.source, "source"), describeEndpoint(result.destination, "destination")].filter(Boolean);
  if (result.ok) {
    if (result.networkDistanceM === 0) {
      return { status: "ok", headline: "Same location", detail: "Start and destination use the same point of the road network.", notes };
    }
    return {
      status: "ok",
      headline: `${walkingMinutes(result.networkDistanceM)} min walk`,
      detail: `${formatDistance(result.networkDistanceM)} along campus roads and paths (at ${WALKING_SPEED_KMH} km/h)`,
      notes
    };
  }
  if (result.reason === "no-path") {
    return {
      status: "error",
      headline: "No walking route",
      detail: "These places are not connected in the campus road network (ConnectedRoads/v0/r2.json). No route is drawn, because the network has no path between them.",
      notes
    };
  }
  return { status: "error", headline: "Route unavailable", detail: "A route could not be calculated for this selection.", notes };
}
