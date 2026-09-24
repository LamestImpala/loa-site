import { createClient } from "@supabase/supabase-js";
import { ADMIN_EMAIL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./supabase";

// Auth for the job routes: Vercel cron sends `Authorization: Bearer
// $CRON_SECRET`; an admin page sends the owner's Supabase access token.
export async function authorizeJob(req: Request): Promise<boolean> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  const secret = process.env.CRON_SECRET;
  if (secret && token === secret) return true;
  const anon = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false },
  });
  const { data } = await anon.auth.getUser(token);
  return data.user?.email === ADMIN_EMAIL;
}
