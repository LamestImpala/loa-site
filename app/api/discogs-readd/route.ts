import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  ADMIN_EMAIL,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
} from "@/lib/supabase";

// Adds a release back to the owner's Discogs collection — the undo of
// /api/discogs-remove, for a record that's for sale again after its copy
// came out (a refund, a cancelled order). Discogs makes a new instance:
// today's date added, no notes or condition fields from the old copy.
//
// It lands in the folder the removal reported, or Uncategorized (1) when
// that's unknown or the folder is gone. If the collection already has the
// release — re-added by hand, or a keeper copy — the route adds nothing
// and answers 409 with the count, unless the admin confirms (`force`).
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.email !== ADMIN_EMAIL) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const username = process.env.DISCOGS_USERNAME;
  const token = process.env.DISCOGS_TOKEN;
  if (!username || !token) {
    return NextResponse.json(
      { error: "Discogs credentials are not configured on the server" },
      { status: 500 }
    );
  }

  const { releaseId, folderId, force } = await req.json();
  if (!Number.isInteger(releaseId) || releaseId <= 0) {
    return NextResponse.json({ error: "Invalid release id" }, { status: 400 });
  }
  // Folder 0 is "All" and can't be added to.
  const folder = Number.isInteger(folderId) && folderId >= 1 ? folderId : 1;

  const headers = {
    Authorization: `Discogs token=${token}`,
    "User-Agent": "LateOnsetAudiophile/1.0",
  };

  if (!force) {
    const findRes = await fetch(
      `https://api.discogs.com/users/${username}/collection/releases/${releaseId}`,
      { headers }
    );
    if (findRes.ok) {
      const found = await findRes.json();
      const copies = (found?.releases ?? []).filter(
        (x: { instance_id?: number }) => !!x?.instance_id
      ).length;
      if (copies > 0) {
        return NextResponse.json(
          {
            error: `Your Discogs collection already has ${copies === 1 ? "a copy" : `${copies} copies`} of this release.`,
            already: copies,
          },
          { status: 409 }
        );
      }
    } else if (findRes.status !== 404) {
      return NextResponse.json(
        { error: `Discogs lookup failed (${findRes.status})` },
        { status: 502 }
      );
    }
  }

  const add = (f: number) =>
    fetch(
      `https://api.discogs.com/users/${username}/collection/folders/${f}/releases/${releaseId}`,
      { method: "POST", headers }
    );
  let usedFolder = folder;
  let addRes = await add(folder);
  // The folder was deleted or renumbered since the removal.
  if (!addRes.ok && folder !== 1 && addRes.status >= 400 && addRes.status < 500) {
    usedFolder = 1;
    addRes = await add(1);
  }
  if (!addRes.ok) {
    return NextResponse.json(
      { error: `Discogs add failed (${addRes.status})` },
      { status: 502 }
    );
  }

  return NextResponse.json({ added: true, folderId: usedFolder });
}
