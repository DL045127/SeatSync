import { expect, test } from "vitest";
import { NormalizationError } from "../../src/contracts/normalize.ts";
import { classifyLocationQuery, streetKey } from "../../src/locations/house-number.ts";
import { hasConsistentUsState, matchesPrimaryLine, matchesUsLocality } from "../../src/locations/us-locality.ts";

// The same complete address must be searchable alone and require clarification
// as either half of a pair. Each case leaves different punctuation inside it.
const addresses = [
  { text: "2500 I-35 Frontage Road, Austin, TX", number: "2500", street: "i-35 frontage road" },
  { text: "12 US-183 Highway, Portland, OR 97201-1234", number: "12", street: "us-183 highway" },
  { text: "24 TX-35 Frontage Road, Austin, TX", number: "24", street: "tx-35 frontage road" },
  { text: "24 N TX-35 Frontage Road, Austin, TX", number: "24", street: "n tx-35 frontage road" },
  { text: "24 North TX-35 Frontage Road, Austin, TX", number: "24", street: "north tx-35 frontage road" },
  { text: "24 N OR-99 Frontage Road, Eugene, OR", number: "24", street: "n or-99 frontage road" },
  { text: "N6W23001 Example Road, Madison, WI", number: "n6w23001", street: "example road" },
  { text: "5 Example Hall, 12-14 Example Street, Austin, TX", number: "12-14", street: "example street" },
  { text: "12 1/2 Example Street, 4B, Dallas, TX", number: "12 1/2", street: "example street" },
  { text: "12-B Example Street Apt 4B, Winston-Salem, NC 27101", number: "12-b", street: "example street" },
];

test.each(addresses)("ISSUE-084: preserve $text alone and clarify competing streets", ({ text, number, street }) => {
  expect(classifyLocationQuery(text)).toMatchObject({ kind: "address", houseNumber: number, street });
  for (const other of addresses) {
    if (other.text === text) continue;
    for (const separator of [", or ", " or ", " - ", " — ", "; ", " / ", ", "]) {
      const pair = text + separator + other.text;
      expect(() => classifyLocationQuery(pair), pair).toThrow(NormalizationError);
    }
  }
});

test("state abbreviations keep their route numbers and ZIPs in single addresses", () => {
  const states = "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");
  for (const state of states) {
    const highway = `24 North ${state}-99 Frontage Road, Example City, ${state}`;
    expect(classifyLocationQuery(highway), highway).toMatchObject({ houseNumber: "24", street: `north ${state.toLowerCase()}-99 frontage road` });
    expect(() => classifyLocationQuery(highway + ", or 99 Other Road"), highway).toThrow(NormalizationError);
    const locality = "example city " + state.toLowerCase() + " 12345";
    expect(classifyLocationQuery("12 Example Road " + locality)).toMatchObject({ street: "example road " + locality });
    expect(classifyLocationQuery(`12 Example Road, Example City, ${state} 12345`)).toMatchObject({ street: "example road", locality: `example city, ${state.toLowerCase()} 12345` });
  }
});

test("ISSUE-088: street comparison preserves distinct names, directions, suffixes and route numbers", () => {
  for (const direction of ["N.", "North", "NW", "Northwest", "SE", "Southeast"]) {
    expect(streetKey(direction + " TX-35 Frontage Rd")).toBe(streetKey(direction + " TX 35 Frontage Road"));
  }
  expect(streetKey("Example Rd. NW")).toBe(streetKey("Example Road Northwest"));
  expect(streetKey("N. Example St")).not.toBe(streetKey("South Example Street"));
  expect(streetKey("Example St")).not.toBe(streetKey("Example Road"));
  expect(streetKey("St John Road")).not.toBe(streetKey("Street John Road"));
  expect(streetKey("I-35 Frontage Rd")).not.toBe(streetKey("I-30 Frontage Road"));
});

test("ISSUE-090: USPS states, district and territories match in both directions", () => {
  // Independent expected pairs, including names that are suffixes of other names.
  const pairs = [
    "Alabama AL", "Alaska AK", "Arizona AZ", "Arkansas AR", "California CA", "Colorado CO",
    "Connecticut CT", "Delaware DE", "Florida FL", "Georgia GA", "Hawaii HI", "Idaho ID",
    "Illinois IL", "Indiana IN", "Iowa IA", "Kansas KS", "Kentucky KY", "Louisiana LA",
    "Maine ME", "Maryland MD", "Massachusetts MA", "Michigan MI", "Minnesota MN",
    "Mississippi MS", "Missouri MO", "Montana MT", "Nebraska NE", "Nevada NV",
    "New Hampshire NH", "New Jersey NJ", "New Mexico NM", "New York NY", "North Carolina NC",
    "North Dakota ND", "Ohio OH", "Oklahoma OK", "Oregon OR", "Pennsylvania PA",
    "Rhode Island RI", "South Carolina SC", "South Dakota SD", "Tennessee TN", "Texas TX",
    "Utah UT", "Vermont VT", "Virginia VA", "Washington WA", "West Virginia WV",
    "Wisconsin WI", "Wyoming WY", "District of Columbia DC", "Puerto Rico PR",
    "Virgin Islands VI", "Northern Mariana Islands MP", "American Samoa AS", "Guam GU",
  ];
  for (const pair of pairs) {
    const code = pair.slice(-2);
    const name = pair.slice(0, -3);
    const city = "Sample City";
    const postcode = "12345-6789";
    const otherName = code === "WA" ? "Virginia" : "Washington";
    const otherCode = code === "WA" ? "VA" : "WA";
    const cityNamedForState = { city: otherName, state_code: code, state: name, postcode };
    expect(hasConsistentUsState(cityNamedForState), pair).toBe(true);
    expect(hasConsistentUsState({ ...cityNamedForState, state: otherName }), pair).toBe(false);
    expect(matchesUsLocality(otherName + ", 12345, USA", cityNamedForState), pair).toBe(true);
    expect(matchesUsLocality(otherName + ", 12346, USA", cityNamedForState), pair).toBe(false);
    expect(matchesUsLocality(otherName + ", " + otherCode + " 12345", cityNamedForState), pair).toBe(false);
    expect(classifyLocationQuery("12 Sample Rd, Ste. Genevieve, " + code), pair)
      .toMatchObject({ locality: "ste. genevieve, " + code.toLowerCase() });
    expect(classifyLocationQuery("12 Sample Rd, Ste. #Alpha, Ste. Genevieve, " + code), pair)
      .toMatchObject({ locality: "ste. genevieve, " + code.toLowerCase() });
    for (const [queryState, fields] of [[code, { state: name }], [name, { state_code: code }]] as const) {
      const place = { city, postcode, ...fields };
      for (const postal of ["", " 12345", " 12345-6789"]) {
        for (const country of ["", ", US", " U.S.A.", ", United States of America"]) {
          const text = city + ", " + queryState + postal + country;
          expect(matchesUsLocality(text, place), text).toBe(true);
          const wrong = code === "VA" ? "WV" : "VA";
          expect(matchesUsLocality(text, { ...place, state_code: wrong }), text).toBe(false);
          expect(matchesUsLocality(text, { city, postcode }), text).toBe(false);
        }
      }
    }
  }
});

test("ISSUE-089: every supplied locality field needs evidence on this row", () => {
  const city = "Central Point";
  const place = { city, state: "Oregon", state_code: "OR", postcode: "97502-1234" };
  for (const query of ["", "USA", city, "OR", "Oregon, United States", "97502", "Central Point, US",
    "Central Point OR 97502 USA", "Central Point, Oregon, 97502-1234, U.S."]) {
    expect(matchesUsLocality(query, place), query).toBe(true);
  }
  for (const query of ["Other City", "CO", "Central Point, Ohio", "97501", "97502-0000",
    "Central Point, OR, Canada", "97502 97501", "Central Point, CO, OR", "Unverified Central Point OR"]) {
    expect(matchesUsLocality(query, place), query).toBe(false);
  }
  expect(matchesUsLocality("Central Point, OR", { state: "Oregon" })).toBe(false);
  expect(matchesUsLocality("97502", { city })).toBe(false);
  expect(matchesUsLocality("97502-1234", { postcode: "97502" })).toBe(false);
  expect(matchesUsLocality("Central Point OR", { ...place, state: "Ohio" })).toBe(false);
  const nj = { city: "West New York", state_code: "NJ" };
  expect(matchesUsLocality("West New York, USA", nj)).toBe(true);
  expect(matchesUsLocality("West New York, New Jersey", nj)).toBe(true);
  expect(matchesUsLocality("West New York, NY", nj)).toBe(false);
  expect(matchesUsLocality("WV", { state: " West  Virginia " })).toBe(true);
});

test("comma placement preserves which building qualifies for a pasted postal address", () => {
  for (const [city, code, name, postcode] of [
    ["Central Point", "OR", "Oregon", "97502"], ["Miami", "FL", "Florida", "33101"],
    ["New York", "NY", "New York", "10001"], ["Washington", "DC", "District of Columbia", "20001"],
    ["Morgantown", "WV", "West Virginia", "26501"],
  ]) {
    for (const spelling of [code, name]) for (const country of ["USA", "United States"]) {
      for (const postal of ["", postcode]) {
        const fields = [city, spelling, postal, country].filter(Boolean);
        const queries = fields.reduce((prefixes, field) => prefixes.flatMap(prefix =>
          [prefix + " " + field, prefix + ", " + field]), ["12 Sample Rd"]);
        for (const text of queries) {
          const query = classifyLocationQuery(text);
          if (query.kind !== "address" || !query.street) throw new Error(text);
          expect(query.houseNumber, text).toBe("12");
          for (const [row, expected] of [
            [{ city, state_code: code, postcode }, true], [{ city, state: name, postcode }, true],
            [{ city, state_code: "OK", postcode }, false],
            [{ city: "Other City", state_code: code, postcode }, false],
            [{ city, state_code: code, postcode: "00000" }, !postal],
          ] as const) {
            expect(matchesPrimaryLine(query.street, query.locality, row,
              primary => streetKey(primary) === "sample road"), text).toBe(expected);
          }
        }
      }
    }
  }
});
