import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReviewInvite, ShopReview } from "../supabase.ts";
import type { ImportedReviewRow } from "./reviews.ts";

// The Reviews section's writes, under the admin's token. Each returns the
// saved row so the provider's state matches the database, and throws on
// failure for the caller's toast.

// The order's review link, made on first use. A unique order_id means two
// clicks can race; the loser reads back the winner's row.
export async function ensureReviewInvite(
  supabase: SupabaseClient,
  orderId: number
): Promise<ReviewInvite> {
  const existing = await supabase
    .from("review_invites")
    .select("*")
    .eq("order_id", orderId)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) return existing.data as ReviewInvite;
  const inserted = await supabase
    .from("review_invites")
    .insert({ order_id: orderId })
    .select("*")
    .single();
  if (!inserted.error && inserted.data) return inserted.data as ReviewInvite;
  const again = await supabase
    .from("review_invites")
    .select("*")
    .eq("order_id", orderId)
    .maybeSingle();
  if (again.data) return again.data as ReviewInvite;
  throw new Error(inserted.error?.message ?? "Couldn't make the review link");
}

export type ReviewPatch = Partial<
  Pick<ShopReview, "status" | "featured" | "reviewer_name" | "owner_reply">
>;

export async function updateReview(
  supabase: SupabaseClient,
  id: number,
  patch: ReviewPatch
): Promise<ShopReview> {
  const { data, error } = await supabase
    .from("shop_reviews")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Review not found");
  return data as ShopReview;
}

// An import is the admin's own transcription, so it goes live at once.
export async function addImportedReview(
  supabase: SupabaseClient,
  row: ImportedReviewRow
): Promise<ShopReview> {
  const { data, error } = await supabase
    .from("shop_reviews")
    .insert({ ...row, status: "published" })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Couldn't save the review");
  return data as ShopReview;
}
