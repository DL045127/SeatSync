// USPS Publication 28, Appendix B (US states, DC and US territories).
// https://pe.usps.com/text/pub28/28apb.htm
const postalNames = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  AS: "American Samoa", GU: "Guam", MP: "Northern Mariana Islands", PR: "Puerto Rico",
  VI: "Virgin Islands",
};

const stateCodes = new Map<string, string>();
for (const [code, name] of Object.entries(postalNames)) {
  stateCodes.set(code.toLowerCase(), code);
  stateCodes.set(name.toLowerCase(), code);
}

interface UsPlace {
  city?: string;
  state?: string;
  state_code?: string;
  postcode?: string;
}

export function withoutUsCountrySuffix(text: string): string {
  return text.replace(/(?:^|[ ,]+)(?:united states(?: of america)?|u\.?s\.?(?:a\.?)?)$/i, "");
}

function localityKey(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

export function hasConsistentUsState(place: UsPlace): boolean {
  const name = localityKey(place.state ?? "");
  const code = localityKey(place.state_code ?? "");
  if (!name || !code) return true;
  const state = stateCodes.get(name);
  return state !== undefined && state === stateCodes.get(code);
}

/** Callers admit only US rows. Consume country, ZIP, state and city in postal order. */
export function matchesUsLocality(locality: string, place: UsPlace): boolean {
  let rest = withoutUsCountrySuffix(localityKey(locality));
  const zip = /(?:^|[ ,]+)(\d{5}(?:-\d{4})?)$/.exec(rest);
  if (zip) {
    const stored = place.postcode?.trim();
    const base = stored?.match(/^(\d{5})-\d{4}$/)?.[1];
    if (zip[1] !== stored && zip[1] !== base) return false;
    rest = rest.slice(0, zip.index);
  }
  if (!rest) return true;
  const city = localityKey(place.city ?? "");
  // Try the longest suffix first, so West Virginia cannot resolve to Virginia.
  const lastPart = rest.slice(rest.lastIndexOf(",") + 1).trim();
  const words = lastPart.split(" ");
  for (let i = 0; i < words.length; i++) {
    const suffix = words.slice(i).join(" ");
    const wanted = stateCodes.get(suffix);
    if (!wanted) continue;
    // An exact city plus ZIP can disambiguate a full state name. Postal codes
    // and a separate state component still require a matching state field.
    if (rest === city && suffix.length > 2 && (zip || i > 0)) return true;
    const fields = [place.state_code, place.state].map(value => localityKey(value ?? "")).filter(Boolean);
    if (!fields.length || !fields.every(value => stateCodes.get(value) === wanted)) return false;
    rest = rest.slice(0, -suffix.length).replace(/[ ,]+$/, "");
    break;
  }
  return !rest || rest === city;
}

/** A street or name may share its comma component with an inline locality. */
export function matchesPrimaryLine(line: string, locality: string | undefined, place: UsPlace,
  matches: (primary: string) => boolean): boolean {
  for (let end = line.length; end > 0; end = line.lastIndexOf(" ", end - 1)) {
    if (!matches(line.slice(0, end))) continue;
    const remaining = [line.slice(end).trim(), locality].filter(Boolean).join(", ");
    if (matchesUsLocality(remaining, place)) return true;
  }
  return false;
}
