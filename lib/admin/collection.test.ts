// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectCollection } from "./collection.ts";

test("series detection reads labels, series, companies, and format text", () => {
  assert.equal(detectCollection({ labels: [{ name: "Vinyl Me, Please" }] }), "VMP");
  assert.equal(detectCollection({ series: [{ name: "Vinyl Me Please Classics" }] }), "VMP");
  assert.equal(detectCollection({ companies: [{ name: "Mobile Fidelity Sound Lab" }] }), "MoFi");
  assert.equal(detectCollection({ formats: [{ descriptions: ["Tone Poet Series"] }] }), "Tone Poet");
  assert.equal(detectCollection({ formats: [{ text: "Rhino Hi-Fi" }] }), "RHF");
  assert.equal(detectCollection({ labels: [{ name: "Interscope Vinyl Collective" }] }), "IVC");
  assert.equal(detectCollection({ labels: [{ name: "Atlantic 75" }] }), "Atlantic 75");
});

test("the more specific series wins over its parent label", () => {
  assert.equal(
    detectCollection({
      labels: [{ name: "Analogue Productions" }],
      formats: [{ descriptions: ["UHQR", "200g"] }],
    }),
    "UHQR"
  );
  assert.equal(
    detectCollection({ labels: [{ name: "Acoustic Sounds" }, { name: "Analogue Productions" }] }),
    "Acoustic Sounds"
  );
});

test("unknown or empty release data yields no series", () => {
  assert.equal(detectCollection({}), "");
  assert.equal(detectCollection({ labels: [{}], formats: [{}] }), "");
  assert.equal(detectCollection({ labels: [{ name: "Columbia" }] }), "");
});
