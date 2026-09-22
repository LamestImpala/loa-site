import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  ADMIN_EMAIL,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
} from "@/lib/supabase";
import { removableInstance } from "@/lib/admin/discogs-instances";

// Removes a release from the owner's Discogs collection. The Discogs token
// only exists server-side (same env vars the vinyl-collection page uses),
// so the admin page calls this route instead of Discogs directly.
//
// A record only knows its release id, not which collection copy it is.
// With one copy that's the same thing; with two or more (a keeper and a
// sale copy, say) any pick could delete the wrong one, and the delete
// can't be undone — so the route deletes nothing and answers 409 with
// the copies, for the seller to remove the right one on Discogs.
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

  const { releaseId } = await req.json();
  if (!Number.isInteger(releaseId) || releaseId <= 0) {
    return NextResponse.json({ error: "Invalid release id" }, { status: 400 });
  }

  const headers = {
    Authorization: `Discogs token=${token}`,
    "User-Agent": "LateOnsetAudiophile/1.0",
  };

  // Find the collection instance(s) of this release
  const findRes = await fetch(
    `https://api.discogs.com/users/${username}/collection/releases/${releaseId}`,
    { headers }
  );
  if (findRes.status === 404) {
    return NextResponse.json(
      { error: "Not found in your Discogs collection" },
      { status: 404 }
    );
  }
  if (!findRes.ok) {
    return NextResponse.json(
      { error: `Discogs lookup failed (${findRes.status})` },
      { status: 502 }
    );
  }
  const found = await findRes.json();
  const pick = removableInstance(found?.releases);
  if (pick.kind === "none") {
    return NextResponse.json(
      { error: "Not found in your Discogs collection" },
      { status: 404 }
    );
  }
  if (pick.kind === "several") {
    return NextResponse.json(
      {
        error: `Your Discogs collection has ${pick.instances.length} copies of this release — remove the sold one on Discogs, then mark it removed here.`,
        ambiguous: true,
        releaseUrl: `https://www.discogs.com/release/${releaseId}`,
        instances: pick.instances.map((x) => ({
          instanceId: x.instance_id,
          folderId: x.folder_id,
          dateAdded: x.date_added ?? null,
        })),
      },
      { status: 409 }
    );
  }
  const instance = pick.instance;

  const delRes = await fetch(
    `https://api.discogs.com/users/${username}/collection/folders/${instance.folder_id}/releases/${releaseId}/instances/${instance.instance_id}`,
    { method: "DELETE", headers }
  );
  if (delRes.status !== 204) {
    return NextResponse.json(
      { error: `Discogs removal failed (${delRes.status})` },
      { status: 502 }
    );
  }

  return NextResponse.json({ removed: true });
}
