import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// The publishable key is safe to expose — Row Level Security controls access.
export const SUPABASE_URL = "https://spmbjuurarlpyqcqxyyz.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_DJ3UU1iAO7CQDJDWENtcnQ_3-_N6DXM";

export const ADMIN_EMAIL = "brandoncgillihan@gmail.com";

export type DbRecord = {
  id: number;
  artist: string;
  title: string;
  pressing: string;
  media: string;
  sleeve: string;
  price: number;
  notes: string;
  photos: string;
  discogs_release_id: number | null;
  sold: boolean;
  listed: boolean;
  updated_at: string;
};

export type PendingPriceChange = {
  id: number;
  record_id: number;
  old_price: number;
  suggested_price: number;
  pct_change: number;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  records?: Pick<DbRecord, "artist" | "title" | "pressing" | "price"> | null;
};

export type PriceRun = {
  id: number;
  ran_at: string;
  checked: number;
  auto_applied: number;
  flagged: number;
  errors: number;
  summary: {
    record_id: number;
    artist: string;
    title: string;
    old_price: number;
    new_price: number;
    pct: number;
    action: "applied" | "flagged";
  }[];
};

// Server-side client for the public /records page (anon role: RLS only
// exposes listed records).
export function createServerSupabase(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false },
  });
}

let browserClient: SupabaseClient | null = null;

// Browser client for the admin page; keeps the auth session in localStorage.
export function getBrowserSupabase(): SupabaseClient {
  if (!browserClient) {
    browserClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  }
  return browserClient;
}
