// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractLabel,
  findTracking,
  linesFromItems,
  matchParcel,
  postalCodes,
  recipientCandidates,
} from "./label-intake.ts";
import { order, shipment } from "./fixtures.ts";

// What a 4×6 USPS label from PayPal's Shipping Center reads like.
const THERMAL_LABEL = [
  "USPS MEDIA MAIL",
  "ShroomHog",
  "Curiouser Records",
  "1234 W Camelback Rd",
  "Phoenix AZ 85015",
  "SHIP TO:",
  "JANE Q BUYER",
  "123 MAIN ST APT 4",
  "TEMPE AZ 85281-1234",
  "USPS TRACKING #",
  "9400 1112 0621 3456 7890 12",
];

// The letter-size variant: name on the SHIP TO line, no "TRACKING" header,
// barcode text with the 420+ZIP prefix.
const LETTER_LABEL = [
  "PRIORITY MAIL",
  "SHIP TO: Bob Recipient",
  "9 Elm Ave",
  "Mesa, AZ 85201",
  "420852019205590123456789012345",
];

test("lines: fragments group by y (top first) and sort by x", () => {
  const lines = linesFromItems([
    { str: "TO:", transform: [1, 0, 0, 1, 40, 300] },
    { str: "SHIP", transform: [1, 0, 0, 1, 10, 300.6] },
    { str: "9400 1112", transform: [1, 0, 0, 1, 10, 100] },
    { str: "0621 3456 7890 12", transform: [1, 0, 0, 1, 80, 100] },
    { str: "  ", transform: [1, 0, 0, 1, 0, 200] },
  ]);
  assert.deepEqual(lines, ["SHIP TO:", "9400 1112 0621 3456 7890 12"]);
});

test("tracking: spaced groups under the TRACKING line", () => {
  assert.equal(findTracking(THERMAL_LABEL), "9400111206213456789012");
});

test("tracking: barcode text with a 420+ZIP prefix is trimmed", () => {
  assert.equal(findTracking(LETTER_LABEL), "9205590123456789012345");
});

test("tracking: the number under TRACKING beats a longer one elsewhere", () => {
  const lines = ["420852819400111206213456789012", "USPS TRACKING #", "9400 1112 0621 3456 7890 12"];
  assert.equal(findTracking(lines), "9400111206213456789012");
  assert.equal(findTracking(["no numbers here", "12345 67890"]), null);
});

test("recipients: the block after SHIP TO, seller and keywords dropped", () => {
  assert.deepEqual(recipientCandidates(THERMAL_LABEL)[0], "JANE Q BUYER");
  assert.ok(!recipientCandidates(THERMAL_LABEL).includes("ShroomHog"));
  assert.ok(!recipientCandidates(THERMAL_LABEL).includes("Curiouser Records"));
  assert.equal(recipientCandidates(LETTER_LABEL)[0], "Bob Recipient");
});

test("postal codes in label order", () => {
  assert.deepEqual(postalCodes(THERMAL_LABEL), ["85015", "85281"]);
});

const jane = order({
  id: 1,
  buyer_username: "janeq",
  status: "paid",
  ship_to: {
    name: "Jane Q Buyer",
    line1: "123 Main St",
    line2: null,
    city: "Tempe",
    state: "AZ",
    postal_code: "85281",
    country_code: "US",
  },
});
const bob = order({
  id: 2,
  buyer_username: "bobr",
  status: "paid",
  ship_to: { ...jane.ship_to!, name: "Bob Recipient", postal_code: "85201" },
});
const candidates = [
  { shipment: shipment({ id: 10, order_id: 1, packed_at: "2026-09-15T00:00:00Z" }), order: jane, buyer: "janeq" },
  { shipment: shipment({ id: 11, order_id: 2, packed_at: "2026-09-15T00:00:00Z" }), order: bob, buyer: "bobr" },
];

test("match: full name plus ZIP is a confident hit", () => {
  const m = matchParcel(extractLabel(THERMAL_LABEL), candidates);
  assert.equal(m.best?.shipment.id, 10);
  assert.equal(m.confident, true);
  assert.deepEqual(m.ranked.map((r) => [r.candidate.shipment.id, r.score]), [[10, 7], [11, 0]]);
});

test("match: surname alone is a lead, not confident against a ZIP tie", () => {
  const twins = [
    candidates[0],
    { ...candidates[1], order: order({ ...bob, ship_to: { ...bob.ship_to!, name: "Ann Buyer", postal_code: "85281" } }) },
  ];
  const m = matchParcel({ recipients: ["J BUYER"], postalCodes: ["85281"] }, twins);
  assert.equal(m.best?.shipment.id, 10);
  assert.equal(m.confident, false);
});

test("match: the parcel's own ship-to snapshot wins over the order's; a handle on the label counts a little", () => {
  const snap = {
    ...candidates[1],
    shipment: shipment({ id: 12, order_id: 2, to_address: { name: "Robert Recipient", postal_code: "85201" } }),
  };
  const m = matchParcel({ recipients: ["ROBERT RECIPIENT", "bobr"], postalCodes: ["85201"] }, [candidates[0], snap]);
  assert.equal(m.best?.shipment.id, 12);
  assert.equal(m.ranked[0].score, 8);
});

test("match: nothing recognisable yields no best", () => {
  const m = matchParcel({ recipients: ["SOMEONE ELSE"], postalCodes: ["10001"] }, candidates);
  assert.equal(m.best, null);
  assert.equal(m.confident, false);
});
