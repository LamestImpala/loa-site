// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import { removableInstance } from "./discogs-instances.ts";

test("one collection copy is removable; several are left for the seller", () => {
  assert.deepEqual(removableInstance(undefined), { kind: "none" });
  assert.deepEqual(removableInstance([{ folder_id: 1 }]), { kind: "none" });
  assert.deepEqual(removableInstance([{ instance_id: 7, folder_id: 3 }]), {
    kind: "one",
    instance: { instance_id: 7, folder_id: 3 },
  });
  const two = [
    { instance_id: 7, folder_id: 1 },
    { instance_id: 8, folder_id: 5 },
  ];
  assert.deepEqual(removableInstance(two), { kind: "several", instances: two });
});
