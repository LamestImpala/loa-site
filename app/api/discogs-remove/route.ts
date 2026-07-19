import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  ADMIN_EMAIL,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
} from "@/lib/supabase";

// Removes a release from the owner's Discogs collection. The Discogs token
// only exists server-side (same env vars the vinyl-collection page uses),
// so the admin page calls this route instead of Discogs directly.
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
  const instance = found?.releases?.[0];
  if (!instance?.instance_id) {
    return NextResponse.json(
      { error: "Not found in your Discogs collection" },
      { status: 404 }
    );
  }

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
