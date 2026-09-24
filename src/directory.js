// Campus directory: buildings, laboratories / research divisions and testing
// services, with the lookups the search and the directions panel need.
//
// Data:
//   buildings     render copy of public/data/BuildingBoundary.geojson
//   laboratories  public/data/directory/laboratories.json
//   services      public/data/directory/testing-services.json
// A service names its laboratory (laboratory_id); a laboratory names its
// building (building_id) or inherits the building of its parent unit. Records
// that set their own building_id use it. Nothing is guessed: when no building
// is recorded along that chain, the entry has buildingId = null and the map
// says so instead of pointing somewhere else.
//
// Pure module (no DOM, no MapLibre) so it can be tested with node --test.

export const LAB_TYPE_LABELS = { institute: "Institute", laboratory: "Laboratory", division: "Research division", section: "Research section" };
const KIND_ORDER = { building: 0, lab: 1, test: 2 };

// Lower-case, Latin accents removed, punctuation to spaces. Bengali letters and
// vowel signs are kept so Bengali building names stay searchable.
export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
    .trim();
}

// Sample types are shown as published, minus the institute tag the INARS list
// appends to some of them ("Feed-(INARS)" becomes "Feed") and list numbering ("-1").
export function displaySampleType(value) {
  return String(value ?? "")
    .replace(/\s*-?\s*\(INARS\)\s*$/i, "")
    .replace(/\s*-\s*1\s*$/, "")
    .trim();
}

const capitalizeFirst = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);

export function formatFee(service) {
  if (Number.isFinite(service?.fee_bdt)) return `${service.fee_bdt.toLocaleString("en-US")} BDT`;
  return service?.fee_text || null;
}

export function formatDuration(service) {
  if (Number.isFinite(service?.duration_days)) return `${service.duration_days} day${service.duration_days === 1 ? "" : "s"}`;
  return service?.duration_text || null;
}

// context: a field that can add to a match but cannot make one on its own.
const field = (text, weight, context = false) => ({ text: normalizeText(text), weight, context });

export function createDirectory({ buildings, laboratories = [], services = [], sources = [] }) {
  const buildingFeatures = buildings?.features || [];
  const buildingsById = new Map();
  buildingFeatures.forEach((feature) => {
    const id = feature.properties?.id;
    if (id !== undefined && id !== null && !buildingsById.has(String(id))) buildingsById.set(String(id), feature);
  });
  const labsById = new Map(laboratories.map((lab) => [lab.id, lab]));
  const sourcesById = new Map(sources.map((source) => [source.id, source]));

  // Walks up parent_id until a building_id is found. Returns the building id
  // (string) and the unit that recorded it, or null.
  function labLocation(labId, seen = new Set()) {
    const lab = labsById.get(labId);
    if (!lab || seen.has(labId)) return null;
    seen.add(labId);
    if (lab.building_id !== undefined && lab.building_id !== null) return { buildingId: String(lab.building_id), via: lab };
    return lab.parent_id ? labLocation(lab.parent_id, seen) : null;
  }
  function parentsOf(lab) {
    const chain = [];
    const seen = new Set([lab.id]);
    for (let current = labsById.get(lab.parent_id); current && !seen.has(current.id); current = labsById.get(current.parent_id)) {
      seen.add(current.id);
      chain.push(current);
    }
    return chain;
  }
  const buildingName = (id) => {
    const p = buildingsById.get(String(id))?.properties;
    return p ? String(p.name_en || p.render_label || `Building ${id}`).trim() : null;
  };
  const labShortName = (lab) => (lab ? lab.short_name || lab.name : "");

  const entries = [];

  buildingFeatures.forEach((feature) => {
    const p = feature.properties || {};
    const title = String(p.name_en || p.render_label || `Building ${p.id}`).trim();
    entries.push({
      kind: "building",
      key: `building:${p.render_id ?? p.id}`,
      id: String(p.id),
      title,
      subtitle: [p.name_en_short, p.render_category_label].filter(Boolean).join(" · "),
      meta: `Building ${p.id}`,
      buildingId: String(p.id),
      renderId: p.render_id ?? String(p.id),
      // The fields the original building search used, plus weights.
      fields: [field(title, 1), field(p.name_en_short, 0.95), field(p.name_en_alias, 0.9), field(p.name_bn, 0.9), field(p.id, 0.9), field(p.render_category_label, 0.4)]
    });
  });

  laboratories.forEach((lab) => {
    const location = labLocation(lab.id);
    // An institute whose building already carries its name is found through
    // that building; listing it twice would only duplicate the result.
    if (lab.type === "institute" && location && normalizeText(buildingName(location.buildingId)) === normalizeText(lab.name)) return;
    const parents = parentsOf(lab);
    const typeLabel = LAB_TYPE_LABELS[lab.type] || "Laboratory";
    entries.push({
      kind: "lab",
      key: `lab:${lab.id}`,
      id: lab.id,
      title: lab.name,
      subtitle: [typeLabel, ...parents.map(labShortName)].filter(Boolean).join(" · "),
      meta: location ? `Building ${location.buildingId}` : "Location not recorded",
      buildingId: location?.buildingId ?? null,
      locatedVia: location && location.via.id !== lab.id ? location.via : null,
      record: lab,
      typeLabel,
      parents,
      fields: [field(lab.name, 1), field(lab.short_name, 0.95), field(typeLabel, 0.4), ...parents.map((parent) => field(`${parent.name} ${parent.short_name || ""}`, 0.5))]
    });
  });

  const seenServices = new Set();
  services.forEach((service) => {
    const lab = labsById.get(service.laboratory_id) || null;
    const location = service.building_id !== undefined && service.building_id !== null
      ? { buildingId: String(service.building_id), via: null }
      : labLocation(service.laboratory_id);
    // The published list repeats a few identical rows; show each test once.
    const identity = [normalizeText(service.name), normalizeText(service.sample_type), normalizeText(service.method), service.laboratory_id, location?.buildingId].join("|");
    if (seenServices.has(identity)) return;
    seenServices.add(identity);
    entries.push({
      kind: "test",
      key: `test:${service.id}`,
      id: service.id,
      title: capitalizeFirst(String(service.name || "").trim()),
      subtitle: displaySampleType(service.sample_type),
      meta: [labShortName(lab), location ? `Building ${location.buildingId}` : "Location not recorded"].filter(Boolean).join(" · "),
      buildingId: location?.buildingId ?? null,
      record: service,
      lab,
      source: sourcesById.get(service.source) || null,
      // A test is found by its own name, sample type or method; the laboratory
      // name only refines ("calcium inars"), so "INARS" alone lists the institute
      // rather than all of its tests.
      fields: [field(service.name, 1), field(service.sample_type, 0.55), field(service.method, 0.35), field(lab ? `${lab.name} ${lab.short_name || ""}` : "", 0.3, true)]
    });
  });

  function scoreEntry(entry, tokens, phrase) {
    let total = 0;
    let own = false;
    for (const token of tokens) {
      let best = 0;
      for (const { text, weight, context } of entry.fields) {
        if (!text) continue;
        const words = text.split(" ");
        let match = 0;
        if (words.includes(token)) match = 3;
        else if (words.some((word) => word.startsWith(token))) match = 2;
        else if (token.length >= 3 && text.includes(token)) match = 1;
        if (match && !context) own = true;
        best = Math.max(best, match * weight);
      }
      if (!best) return 0; // every word of the query must match
      total += best;
    }
    if (!own) return 0;
    const title = entry.fields[0].text;
    if (title === phrase) total += 6;
    else if (title.startsWith(phrase)) total += 3;
    else if (title.includes(phrase)) total += 1.5;
    return total;
  }

  // kinds: entry kinds to return (default all). Returns { results, total }.
  function search(query, { kinds = ["building", "lab", "test"], limit = 30 } = {}) {
    const phrase = normalizeText(query);
    if (!phrase) return { results: [], total: 0 };
    const tokens = phrase.split(" ");
    const scored = [];
    for (const entry of entries) {
      if (!kinds.includes(entry.kind)) continue;
      const score = scoreEntry(entry, tokens, phrase);
      if (score > 0) scored.push({ entry, score });
    }
    scored.sort((a, b) => b.score - a.score
      || KIND_ORDER[a.entry.kind] - KIND_ORDER[b.entry.kind]
      || a.entry.title.localeCompare(b.entry.title)
      || a.entry.subtitle.localeCompare(b.entry.subtitle));
    return { results: scored.slice(0, limit).map(({ entry }) => entry), total: scored.length };
  }

  return {
    entries,
    search,
    building: (id) => (id === null || id === undefined ? null : buildingsById.get(String(id)) || null),
    entryForBuilding: (feature) => entries.find((entry) => entry.kind === "building" && entry.renderId === feature?.properties?.render_id) || null,
    entry: (key) => entries.find((entry) => entry.key === key) || null,
    labLocation,
    lab: (id) => labsById.get(id) || null,
    labShortName,
    buildingName
  };
}
