import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  ADMIN_EMAIL,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
} from "@/lib/supabase";

// Fetches a Discogs release for the admin's "Add a record" form. Runs
// server-side so the request carries the Discogs token when configured —
// anonymous browser calls to api.discogs.com hit rate limits quickly.
export async function GET(req: NextRequest) {
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

  const releaseId = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(releaseId) || releaseId <= 0) {
    return NextResponse.json({ error: "Invalid release id" }, { status: 400 });
  }

  const token = process.env.DISCOGS_TOKEN;
  const headers: Record<string, string> = {
    "User-Agent": "LateOnsetAudiophile/1.0",
    ...(token ? { Authorization: `Discogs token=${token}` } : {}),
  };

  const res = await fetch(`https://api.discogs.com/releases/${releaseId}`, {
    headers,
  });
  if (!res.ok) {
    return NextResponse.json(
      { error: `Discogs returned ${res.status}` },
      { status: res.status === 404 ? 404 : 502 }
    );
  }
  return NextResponse.json(await res.json());
}
