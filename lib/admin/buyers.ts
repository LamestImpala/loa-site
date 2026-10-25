// How a buyer is named across the admin. Reddit buyers show as u/handle;
// buyers who ordered by email are stored by name (with the email on their
// order), so the prefix would be wrong for them. Without an email in
// hand, a handle that can't be a Reddit name (spaces, @, too long) is
// shown plain too.
const REDDIT_HANDLE = /^[A-Za-z0-9_-]{3,20}$/;

export function isRedditHandle(handle: string): boolean {
  return REDDIT_HANDLE.test(handle);
}

export function buyerLabel(
  handle: string | null | undefined,
  email?: string | null,
  empty = "(no buyer)"
): string {
  const name = (handle ?? "").trim().replace(/^u\//, "");
  const addr = (email ?? "").trim();
  if (!name) return addr || empty;
  if (addr || !isRedditHandle(name)) return name;
  return `u/${name}`;
}
