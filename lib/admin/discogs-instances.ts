// Which Discogs collection copy a removal may delete. A record only knows
// its release id, so a release with one copy in the collection is safe to
// delete and one with several is not — any pick could take a keeper or
// another sale copy, and the delete can't be undone. Pure.

export type CollectionInstance = {
  instance_id?: number;
  folder_id?: number;
  date_added?: string;
};

export function removableInstance(
  releases: CollectionInstance[] | undefined
):
  | { kind: "none" }
  | { kind: "one"; instance: Required<Pick<CollectionInstance, "instance_id" | "folder_id">> }
  | { kind: "several"; instances: CollectionInstance[] } {
  const found = (releases ?? []).filter((x) => !!x?.instance_id);
  if (found.length === 0) return { kind: "none" };
  if (found.length > 1) return { kind: "several", instances: found };
  return {
    kind: "one",
    instance: { instance_id: found[0].instance_id!, folder_id: found[0].folder_id ?? 1 },
  };
}
