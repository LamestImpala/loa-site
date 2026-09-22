import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./supabase";

// A Supabase client with the service role: it bypasses RLS, so only
// server code that has already authenticated its caller another way (a
// cron secret, a verified PayPal webhook signature) may use it.
export function serviceSupabase() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
}
