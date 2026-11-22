// Which Discogs collection copies the import should turn into drafts.
// A record only knows its release id, so copies are told apart by count:
// for each release, the records already in Stock (and still in the
// collection) that no earlier run has paired with a copy are paired with
// the oldest new copies, and only the copies left over are imported. Pure.

export type CollectionCopy = {
  instance_id: number;
  release_id: number;
  date_added?: string;
};

export type ImportPlan = {
  // New copies that belong to a record already in Stock: remembered, not imported.
  matched: CollectionCopy[];
  // New copies with no record: one draft each, oldest first.
  toImport: CollectionCopy[];
};

const addedAt = (c: CollectionCopy) => (c.date_added ? new Date(c.date_added).getTime() || 0 : 0);

export function planImport(
  collection: CollectionCopy[],
  // Instance ids an earlier run has already imported or matched.
  seenInstanceIds: Iterable<number>,
  // Release ids of the records in Stock whose copy is still in the Discogs
  // collection (not discogs_removed), one entry per record.
  stockReleaseIds: Iterable<number>
): ImportPlan {
  const seen = new Set(seenInstanceIds);
  // Records per release not yet paired with a copy.
  const unpaired = new Map<number, number>();
  for (const id of stockReleaseIds) unpaired.set(id, (unpaired.get(id) ?? 0) + 1);

  const fresh: CollectionCopy[] = [];
  const taken = new Set<number>();
  for (const copy of collection) {
    if (taken.has(copy.instance_id)) continue; // a copy listed twice
    taken.add(copy.instance_id);
    if (seen.has(copy.instance_id)) {
      const left = unpaired.get(copy.release_id) ?? 0;
      if (left > 0) unpaired.set(copy.release_id, left - 1);
    } else {
      fresh.push(copy);
    }
  }
  fresh.sort((a, b) => addedAt(a) - addedAt(b) || a.instance_id - b.instance_id);

  const plan: ImportPlan = { matched: [], toImport: [] };
  for (const copy of fresh) {
    const left = unpaired.get(copy.release_id) ?? 0;
    if (left > 0) {
      unpaired.set(copy.release_id, left - 1);
      plan.matched.push(copy);
    } else {
      plan.toImport.push(copy);
    }
  }
  return plan;
}
