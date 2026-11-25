import { NormalizationError } from "../contracts/normalize.ts";
import { withoutUsCountrySuffix } from "./us-locality.ts";

export function normalizeLocationText(text: string): string {
  // NFKC expands ½ to 1⁄2. Preserve the boundary between it and the integer.
  return text.replace(/(\d)([¼-¾⅐-⅞])/gu, "$1 $2").normalize("NFKC").replaceAll("⁄", "/")
    .replace(/[‐‑]/g, "-").trim().toLowerCase().replace(/\s+/g, " ");
}

function clarify(): never {
  throw new NormalizationError(
    "Enter one building number and street name. Put any apartment after the street, for example “12 Example Street, Apt 4B”. For a venue name, put the exact name in double quotes.",
  );
}

// Match the entire primary number, including an attached suffix, range or
// fraction. An unsupported numeric token must never become a place-name search.
// USPS Publication 28 D3/E12.5 includes N6W23001 and 6W220. Consume the
// complete token so that neither coordinate in a grid number can match alone.
const numberedLine = /^((?:[a-z]{1,2})?\d+(?:[a-z]+\d+)*[a-z]{0,2}(?:-(?:[a-z]{1,2}|\d+[a-z]?)|\/\d+)?(?: \d+\/\d+)?)(?: (.+))?$/;
const numberStart = /^(?:[a-z]{1,2})?\d/;
const zip = /^\d{5}(?:-\d{4})?$/;
// Bare "FL" followed by a postal code denotes Florida. Explicit floor
// designators ("Floor", "Fl.", or "Fl #") still accept numeric identifiers.
// A bare unit identifier needs a digit or a single letter. Use "#" for
// longer alphabetic identifiers so "Ste. Genevieve" stays a locality.
const unitIdentifier = /(?:(?:(?:apt\.?|apartment|unit|suite|ste\.?|floor|fl\.?)\s*)?#\s*[a-z\d][a-z\d-]*|(?:apt\.?|apartment|unit|suite|ste\.?|floor|fl(?! \d{5}(?:-\d{4})?$)\.?)(?:\s+|(?=\d))(?:[a-z]|(?=[a-z\d-]*\d)[a-z\d][a-z\d-]*))/;
const unit = new RegExp("^" + unitIdentifier.source + "$");
const trailingUnit = new RegExp(" " + unitIdentifier.source + "$");
export function withoutTrailingUnit(street: string): string {
  if (withoutUsCountrySuffix(street) !== street) return street;
  return street.replace(trailingUnit, "");
}
const venueEnding = /\b(?:hall|center|centre|museum|theat(?:er|re)|stadium|arena|hotel|school|library)$/;
const anotherNumber = /(?:\b(?:and|or|to|through)\b|[&/+;–—]|\s-|-\s)\s*(?:[a-z]{1,2})?\d/;
const ordinalStreet = /^\d+(?:st|nd|rd|th)\b/;

const directions = new Map(Object.entries({
  n: "north", e: "east", s: "south", w: "west",
  ne: "northeast", nw: "northwest", se: "southeast", sw: "southwest",
}));
const directionNames = new Set(directions.values());
const compass = [...directions.keys(), ...directionNames].join("|");
const directionalRoute = new RegExp(`^((?:${compass})\\.? [a-z]{1,2})[ -](?=\\d)`);

// A route code can follow a compass direction within the street.
function normalizeHighway(street: string, separator: " " | ""): string {
  const routePrefix = "$1" + separator;
  return street.replace(/\bu\.s\.(?=[ -]\d)/g, "us")
    .replace(directionalRoute, routePrefix)
    .replace(/^([a-z]{1,2})-(?=\d)/, routePrefix)
    .replace(/\b(i|ih|us|sr|sh|cr|fm|rm|hwy|highway|route|interstate)-(?=\d)/g, routePrefix);
}

const addressSeparator = /(?:[-/;&+–—]|\b(?:and|or|to|through)\b)\s*(?=(?:[a-z]{1,2})?\d)/g;

function hasStreetAlternative(part: string, earlierAddress: boolean): boolean {
  const line = numberedLine.exec(part);
  // A route number belongs to its street. Preserve separators in locality
  // components, including "TX-99 Other Road" and "TX 78701/99 Other Road".
  const text = line?.[2] ? line[1] + " " + normalizeHighway(line[2], "") : part;
  for (const separator of text.matchAll(addressSeparator)) {
    if (line && separator.index < line[1].length) continue; // Range or fraction in the primary number.
    const right = text.slice(separator.index + separator[0].length);
    if (separator[0].trim() === "or" && zip.test(withoutUsCountrySuffix(right))) continue;
    if (!numberedLine.exec(right)?.[2]) continue; // "OR 97201" has no second street.
    if (earlierAddress || numberedLine.exec(text.slice(0, separator.index).trimEnd())?.[2]) return true;
  }
  return false;
}

const streetSuffixes = new Map(Object.entries({
  st: "street", rd: "road", ave: "avenue", blvd: "boulevard", dr: "drive", ln: "lane",
  ct: "court", cir: "circle", pl: "place", pkwy: "parkway", hwy: "highway",
  ter: "terrace", trl: "trail", sq: "square",
}));

/** Compare the complete street while keeping internal name words literal (e.g. St John). */
export function streetKey(street: string): string {
  const words = normalizeHighway(normalizeLocationText(street), " ").split(" ");
  const last = words.length - 1;
  if (last === 0) return words[0];
  words[0] = directions.get(words[0].replace(/\.$/, "")) ?? words[0];
  const end = words[last].replace(/\.$/, "");
  words[last] = directions.get(end) ?? words[last];
  const suffix = directionNames.has(words[last]) ? last - 1 : last;
  if (suffix > 0) words[suffix] = streetSuffixes.get(words[suffix].replace(/\.$/, "")) ?? words[suffix];
  return words.join(" ");
}

export type LocationQuery =
  | { kind: "address"; houseNumber: string; street?: string; locality?: string }
  | { kind: "named"; name: string; quotedText?: string; locality?: string }
  | { kind: "text"; locality?: string };

export function classifyLocationQuery(query: string): LocationQuery {
  // An organizer can explicitly resolve a name that itself reads like an
  // address. Only an exact structured place name can match that choice.
  const quoted = /^(?:"([^"]+)"|“([^”]+)”)(\s*,.*)?$/u.exec(query.trim());
  if (quoted) {
    const name = (quoted[1] ?? quoted[2]).trim();
    const locality = quoted[3] ?? "";
    const parts = normalizeLocationText(locality).split(",").map(s => s.trim()).filter(Boolean);
    if (!name || parts.some(part => !zip.test(withoutUsCountrySuffix(part))
      && (numberedLine.exec(part)?.[2] || hasStreetAlternative(part, true)))) clarify();
    return { kind: "named", name: normalizeLocationText(name), quotedText: name + locality, locality: parts.join(", ") };
  }
  const text = normalizeLocationText(query);
  const parts = text.split(",").map(s => s.trim()).filter(Boolean);
  let primary: Extract<LocationQuery, { kind: "address" }> | undefined;
  const locality: string[] = [];
  let numberedVenuePrefix = false;
  for (const [i, part] of parts.entries()) {
    if (hasStreetAlternative(part, !!primary)) clarify();
    const beforeCountry = withoutUsCountrySuffix(part);
    if (i > 0 && zip.test(beforeCountry)) {
      if (primary) locality.push(part);
      continue;
    }
    if (unit.test(part) && beforeCountry === part) {
      if (!primary) clarify();
      continue;
    }
    const match = numberedLine.exec(part);
    if (!match) {
      // A word containing digits may be a venue name. Keep malformed number
      // syntax (e.g. 12--B) on the clarification path.
      const token = part.split(" ", 1)[0];
      if (numberStart.test(token) && !/^\d[\da-z]*(?:-[\da-z]+)*[a-z]{3,}$/.test(token)) clarify();
      if (primary) locality.push(part);
      continue;
    }
    const [, number, streetLine] = match;
    const street = streetLine && withoutTrailingUnit(streetLine);
    if (!street && parts.length > 1) {
      if (primary) continue; // An unlabeled unit after a numbered street.
      clarify();
    }
    if (street) {
      // "12 4th Avenue" has a numbered street name. "12 4B Example Street"
      // leaves two possible primary numbers.
      if (numberStart.test(street) && !ordinalStreet.test(street)) clarify();
      // A final Oregon state/ZIP can share the street component. The provider
      // still has to substantiate it on this building.
      const alternatives = normalizeHighway(withoutUsCountrySuffix(street), "").replace(/ or \d{5}(?:-\d{4})?$/, "");
      if (/^(?:[-/&+]|(?:or|and)\s)/.test(alternatives) || anotherNumber.test(alternatives)) clarify();
    }
    if (primary && !(numberedVenuePrefix && i === 1)) clarify();
    primary = { kind: "address", houseNumber: number, street };
    // Preserve "5 Example Hall, 12 Example Street" but ask about two streets.
    numberedVenuePrefix = i === 0 && /^\d+$/.test(number) && !!street && venueEnding.test(street);
  }
  if (primary) return locality.length ? { ...primary, locality: locality.join(", ") } : primary;
  const name = parts[0];
  const qualifiers = parts.slice(1).join(", ");
  if (name && /\d/.test(name)) return { kind: "named", name, locality: qualifiers };
  return { kind: "text", locality: qualifiers };
}
