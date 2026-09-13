"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { DbRecord, RedditPost } from "@/lib/supabase";
import {
  REDDIT_BODY_LIMIT,
  pickWeekly,
  redditMarkdown,
  redditStaleMarkdown,
  redditUpdateMarkdown,
  redditWeeklyMarkdown,
} from "@/lib/admin/reddit";
import { useAdmin } from "../_shell/admin-provider";
import { buttonClass, inputClass } from "../_shell/ui";

// Reddit tools: copy the full-catalog post, build the weekly picks post
// from the sale-desk selection, keep the active post URL, and manage the
// post archive (retire / update bodies).
export function RedditPage() {
  const {
    supabase,
    records,
    market,
    redditPosts,
    setRedditPosts,
    postUrl,
    setPostUrl,
    postedInfo,
    setPostedInfo,
    selectedIds,
    setSelectedIds,
    setSelectionMode,
    pushToast,
    copyText,
  } = useAdmin();

  const byId = useMemo(
    () => new Map(records.map((r) => [r.id, r])),
    [records]
  );
  // Weekly picks are whatever is selected on the Records page, minus sold.
  const saleRecords = useMemo(
    () => records.filter((r) => selectedIds.has(r.id) && !r.sold),
    [records, selectedIds]
  );

  const [postUrlStatus, setPostUrlStatus] = useState<"idle" | "saved">("idle");
  const [tableCopied, setTableCopied] = useState(false);
  // Per-row URL drafts for the archived Reddit posts.
  const [archiveUrlEdits, setArchiveUrlEdits] = useState<
    Record<number, string>
  >({});
  // "retire-3" / "update-3" — which archive button just copied.
  const [archiveCopiedKey, setArchiveCopiedKey] = useState<string | null>(null);

  // The archive lists whole posts; update repastes hang off them as children.
  const topLevelPosts = redditPosts.filter((p) => p.parent_id === null);
  const newestPost = topLevelPosts[0] ?? null; // redditPosts is created_at desc
  // Retire banners point here — the newest archived post's URL, falling back
  // to the legacy "Active Reddit post" setting during the transition.
  const newestUrl = (newestPost?.reddit_url ?? postUrl).trim();

  function warnIfOverRedditLimit(md: string) {
    if (md.length > REDDIT_BODY_LIMIT) {
      pushToast(
        "error",
        `Post body is ${md.length.toLocaleString()} characters — over Reddit's ${REDDIT_BODY_LIMIT.toLocaleString()} limit. Trim the list before posting.`
      );
    }
  }

  // Save a copied post to the archive. Always called AFTER the clipboard
  // write — Safari drops the clipboard permission if the user gesture has to
  // wait on a network call first.
  async function archivePost(
    kind: RedditPost["kind"],
    title: string | null,
    body: string,
    recordIds: number[],
    parentId: number | null = null
  ) {
    const { data, error } = await supabase
      .from("reddit_posts")
      .insert({
        kind,
        title,
        body,
        record_ids: recordIds,
        parent_id: parentId,
      })
      .select("*")
      .single();
    if (error || !data) {
      pushToast(
        "error",
        `Copied, but archiving the post failed: ${error?.message ?? "no row returned"}`
      );
      return;
    }
    setRedditPosts((prev) => [data as RedditPost, ...prev]);
  }

  // r/vinylcollectors readers (and mods) see every live post; keep one of
  // each kind up at a time. Copying a new post is fine — just remember to
  // retire the old one once the new one is posted.
  function warnIfStillLive(kind: "full" | "weekly") {
    const live = topLevelPosts.find(
      (p) => p.kind === kind && !p.retired_at && p.reddit_url
    );
    if (!live) return;
    pushToast(
      "info",
      `Your ${kind === "full" ? "full catalog" : "weekly"} post from ${new Date(
        live.created_at
      ).toLocaleDateString()} is still live — once this one is up, copy its retire body so only one stays live.`
    );
  }

  async function copyRedditTable() {
    warnIfStillLive("full");
    const md = redditMarkdown(records);
    if (await copyText(md, "Copy the Reddit table")) {
      setTableCopied(true);
      setTimeout(() => setTableCopied(false), 1600);
    }
    warnIfOverRedditLimit(md);
    const listedIds = records
      .filter((r) => r.listed && !r.sold)
      .map((r) => r.id);
    await archivePost("full", md.split("\n")[0], md, listedIds);
  }

  // Seed the weekly post (see pickWeekly for the ranking rules).
  function randomizeWeeklyPicks() {
    const picks = pickWeekly(records, market, postedInfo.ids);
    setSelectedIds(new Set(picks.map((r) => r.id)));
    setSelectionMode("weekly");
    pushToast(
      "info",
      `${picks.length} picked — adjust them on the Catalog page if you like, then copy the weekly post here.`
    );
  }

  const [weeklyCopied, setWeeklyCopied] = useState(false);
  async function copyWeeklyPost() {
    const picks = records.filter((r) => selectedIds.has(r.id) && !r.sold);
    if (picks.length === 0) return;
    warnIfStillLive("weekly");
    const liveCount = records.filter((r) => r.listed && !r.sold).length;
    const md = redditWeeklyMarkdown(picks, liveCount, market);
    // Copy before the settings round-trip — Safari drops the clipboard
    // permission if the user gesture has to wait on a network call.
    if (await copyText(md, "Copy the weekly post")) {
      setWeeklyCopied(true);
      setTimeout(() => setWeeklyCopied(false), 1600);
    }
    warnIfOverRedditLimit(md);
    await savePostedIds(picks.map((r) => r.id));
    await archivePost(
      "weekly",
      md.split("\n")[0],
      md,
      picks.map((r) => r.id)
    );
  }

  async function savePostedIds(ids: number[]) {
    const posted_at = new Date().toISOString();
    const { data, error } = await supabase
      .from("settings")
      .update({ value: JSON.stringify({ ids, posted_at }) })
      .eq("key", "reddit_post_records")
      .select("key");
    if (error || !data?.length) {
      pushToast(
        "error",
        error?.message ??
          "Couldn't save the posted record list — the reddit_post_records settings row is missing."
      );
      return;
    }
    setPostedInfo({ ids, posted_at });
  }

  // Resolve archived record ids against the live table — records deleted
  // since the post went up just drop out of the list.
  function resolvePostedRecords(ids: number[]): DbRecord[] {
    const lookup = new Map(records.map((r) => [r.id, r]));
    return ids
      .map((id) => lookup.get(id))
      .filter((r): r is DbRecord => Boolean(r));
  }

  const [updateCopied, setUpdateCopied] = useState(false);
  async function copyUpdatePost() {
    const posted = resolvePostedRecords(postedInfo.ids);
    if (posted.length === 0) return;
    const md = redditUpdateMarkdown(posted);
    if (await copyText(md, "Copy the post update")) {
      setUpdateCopied(true);
      setTimeout(() => setUpdateCopied(false), 1600);
    }
    // Archive as a child of the archived post it refreshes, when one exists
    // (the live post may predate the archive).
    const idsKey = [...postedInfo.ids].sort((a, b) => a - b).join(",");
    const parent =
      topLevelPosts.find(
        (p) =>
          [...p.record_ids].sort((a, b) => a - b).join(",") === idsKey
      ) ?? null;
    await archivePost(
      "update",
      null,
      md,
      posted.map((r) => r.id),
      parent?.id ?? null
    );
  }

  function flashArchiveCopied(key: string) {
    setArchiveCopiedKey(key);
    setTimeout(
      () => setArchiveCopiedKey((prev) => (prev === key ? null : prev)),
      1600
    );
  }

  // Generate the "this post is outdated" body for a superseded post and
  // stamp it retired. Re-copying any time is fine — it refreshes the sold
  // strikethroughs and the newest-post link.
  async function copyRetireBody(post: RedditPost) {
    const posted = resolvePostedRecords(post.record_ids);
    if (posted.length === 0 || !newestUrl) return;
    const md = redditStaleMarkdown(post, posted, newestUrl);
    if (await copyText(md, "Copy the retire body")) {
      flashArchiveCopied(`retire-${post.id}`);
    }
    const retired_at = new Date().toISOString();
    const { error } = await supabase
      .from("reddit_posts")
      .update({ retired_at })
      .eq("id", post.id);
    if (error) {
      pushToast("error", `Marking the post retired failed: ${error.message}`);
      return;
    }
    setRedditPosts((prev) =>
      prev.map((p) => (p.id === post.id ? { ...p, retired_at } : p))
    );
  }

  // Refresh an archived post's body (sold rows struck out) without retiring
  // it — the same repaste as "Copy post update", but for any archived post.
  async function copyArchivedUpdateBody(post: RedditPost) {
    const posted = resolvePostedRecords(post.record_ids);
    if (posted.length === 0) return;
    const md = redditUpdateMarkdown(posted);
    if (await copyText(md, "Copy the update body")) {
      flashArchiveCopied(`update-${post.id}`);
    }
    await archivePost("update", null, md, posted.map((r) => r.id), post.id);
  }

  async function saveArchivedPostUrl(post: RedditPost) {
    const url = (archiveUrlEdits[post.id] ?? post.reddit_url ?? "").trim();
    const { error } = await supabase
      .from("reddit_posts")
      .update({ reddit_url: url || null })
      .eq("id", post.id);
    if (error) {
      pushToast("error", `Saving the post URL failed: ${error.message}`);
      return;
    }
    setRedditPosts((prev) =>
      prev.map((p) => (p.id === post.id ? { ...p, reddit_url: url || null } : p))
    );
    // The newest post is what buyers should land on — keep the legacy
    // settings pointer (public page + fulfillment default) in sync with it.
    if (post.id === newestPost?.id && url) {
      setPostUrl(url);
      const { error: settingsError } = await supabase
        .from("settings")
        .update({ value: url })
        .eq("key", "reddit_post_url");
      if (settingsError) {
        pushToast(
          "error",
          `Saved to the archive, but syncing the active post URL failed: ${settingsError.message}`
        );
        return;
      }
    }
    pushToast("success", "Post URL saved ✓");
  }

  async function savePostUrl() {
    const { error } = await supabase
      .from("settings")
      .update({ value: postUrl.trim() })
      .eq("key", "reddit_post_url");
    if (error) {
      pushToast("error", `Saving the post URL failed: ${error.message}`);
      return;
    }
    setPostUrlStatus("saved");
    setTimeout(() => setPostUrlStatus("idle"), 2000);
  }

  return (
    <>
      <h1 className="mt-6 text-3xl font-semibold">Reddit</h1>
        <p className="mt-1 text-sm text-neutral-400">
          The weekly post uses the records ticked in the listings table&rsquo;s
          &ldquo;Sel&rdquo; column — start with &ldquo;Pick 20: drops + scarce&rdquo;
          (biggest recent price drops first, then highest Discogs want/have
          ratio, scarcest breaking ties; a
          weekly-post bar appears above the listings instead of the sale
          desk) and adjust the checkboxes, or pick by hand. Each row shows
          price, year, and grades, with the title linked to its Discogs
          release. Copy, and the list is remembered so you can post an
          update later with sold records crossed out (no price shown).
          &ldquo;Copy Reddit table&rdquo; is still the full catalog.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={copyRedditTable} className={buttonClass}>
            {tableCopied ? "Copied!" : "Copy Reddit table"}
          </button>
          <button
            type="button"
            onClick={randomizeWeeklyPicks}
            className={buttonClass}
            title="Selects up to 10 of the biggest price drops from the last two weeks, then fills to 20 with the highest Discogs want/have ratio, scarcest first on ties (skips sold, on-hold, and last week's picks) — adjust with the Sel checkboxes"
          >
            Pick 20: drops + scarce
          </button>
          <Link
            href="/admin/catalog"
            className="text-sm text-neutral-400 underline underline-offset-2 transition hover:text-white"
            title="The picks are the Sel checkboxes in the listings table"
          >
            Adjust picks on Catalog
          </Link>
          <button
            type="button"
            onClick={copyWeeklyPost}
            className={buttonClass}
            disabled={saleRecords.length === 0}
            title="Builds the weekly post from the records selected in the listings table"
          >
            {weeklyCopied
              ? "Copied!"
              : `Copy weekly post (${saleRecords.length} selected)`}
          </button>
          <button
            type="button"
            onClick={copyUpdatePost}
            className={buttonClass}
            disabled={postedInfo.ids.length === 0}
            title="Regenerates the last copied weekly post with sold records crossed out — paste over the live post's body"
          >
            {updateCopied
              ? "Copied!"
              : `Copy post update${
                  postedInfo.ids.length
                    ? ` (${postedInfo.ids.filter((id) => byId.get(id)?.sold).length} sold / ${postedInfo.ids.length} posted)`
                    : ""
                }`}
          </button>
        </div>
        {saleRecords.length > 0 &&
        (saleRecords.length < 10 || saleRecords.length > 20) ? (
          <p className="mt-2 text-xs text-amber-400">
            Tip: 10&ndash;20 records works well for a weekly post — you have{" "}
            {saleRecords.length} selected.
          </p>
        ) : null}
        {postedInfo.posted_at ? (
          <p className="mt-2 text-xs text-neutral-500">
            Current post: {postedInfo.ids.length} records, copied{" "}
            {new Date(postedInfo.posted_at).toLocaleDateString()}.
          </p>
        ) : null}

        <h3 className="mt-8 text-lg font-medium">Active Reddit post</h3>
        <p className="mt-1 text-sm text-neutral-400">
          Paste the URL of your current sale post. Buyers then get a
          &ldquo;Comment on the post&rdquo; button that copies a &ldquo;Sent
          you a DM&rdquo; comment and opens the post. Kept in sync
          automatically when you save the URL on the newest archived post
          below.
        </p>
        <div className="mt-3 flex max-w-2xl flex-col gap-2 sm:flex-row">
          <input
            type="url"
            value={postUrl}
            onChange={(e) => setPostUrl(e.target.value)}
            placeholder="https://www.reddit.com/r/VinylCollectors/comments/…"
            className={`flex-1 ${inputClass}`}
          />
          <button type="button" onClick={savePostUrl} className={buttonClass}>
            {postUrlStatus === "saved" ? "Saved!" : "Save"}
          </button>
        </div>

        <h3 className="mt-8 text-lg font-medium">Post archive</h3>
        <p className="mt-1 text-sm text-neutral-400">
          Every copied post lands here (r/VinylCollectors doesn&rsquo;t allow
          deleting posts). After posting, paste the post&rsquo;s URL into its
          row. When a new post goes up, use &ldquo;Copy retire body&rdquo; on
          the older posts and paste it over their body on Reddit — it keeps
          the original table, strikes out anything sold, and links readers to
          the newest post.
        </p>
        {topLevelPosts.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-500">
            No archived posts yet — the next post you copy will appear here.
          </p>
        ) : (
          <div className="mt-3 flex max-w-3xl flex-col gap-3">
            {topLevelPosts.map((post) => {
              const isCurrent = post.id === newestPost?.id;
              const soldCount = post.record_ids.filter(
                (id) => byId.get(id)?.sold
              ).length;
              const updateCount = redditPosts.filter(
                (p) => p.parent_id === post.id
              ).length;
              const urlDraft =
                archiveUrlEdits[post.id] ?? post.reddit_url ?? "";
              return (
                <div
                  key={post.id}
                  className="rounded-2xl border border-white/10 bg-white/5 p-4"
                >
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="rounded-full border border-white/15 px-2 py-0.5 text-xs uppercase tracking-wide text-neutral-300">
                      {post.kind === "full" ? "Full catalog" : "Weekly"}
                    </span>
                    <span className="text-neutral-300">
                      {new Date(post.created_at).toLocaleDateString()}
                    </span>
                    <span className="text-neutral-500">
                      {post.record_ids.length} records
                      {soldCount ? ` · ${soldCount} now sold` : ""}
                      {updateCount
                        ? ` · ${updateCount} update${updateCount === 1 ? "" : "s"}`
                        : ""}
                    </span>
                    {isCurrent ? (
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300">
                        Current
                      </span>
                    ) : null}
                    {post.retired_at ? (
                      <span
                        className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300"
                        title={`Retire body copied ${new Date(post.retired_at).toLocaleDateString()}`}
                      >
                        Retired
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <input
                      type="url"
                      value={urlDraft}
                      onChange={(e) =>
                        setArchiveUrlEdits((prev) => ({
                          ...prev,
                          [post.id]: e.target.value,
                        }))
                      }
                      placeholder="https://www.reddit.com/r/VinylCollectors/comments/…"
                      className={`flex-1 ${inputClass}`}
                    />
                    <button
                      type="button"
                      onClick={() => saveArchivedPostUrl(post)}
                      className={buttonClass}
                    >
                      Save URL
                    </button>
                    {post.reddit_url ? (
                      <a
                        href={post.reddit_url}
                        target="_blank"
                        rel="noreferrer"
                        className={`${buttonClass} text-center`}
                      >
                        Open ↗
                      </a>
                    ) : null}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => copyRetireBody(post)}
                      className={buttonClass}
                      disabled={isCurrent || !newestUrl}
                      title={
                        isCurrent
                          ? "This is the current post — retire it after the next post goes up"
                          : !newestUrl
                            ? "Save the newest post's URL first so the banner has somewhere to point"
                            : "Copies the outdated-post body — paste it over this post's body on Reddit"
                      }
                    >
                      {archiveCopiedKey === `retire-${post.id}`
                        ? "Copied!"
                        : `Copy retire body${soldCount ? ` (${soldCount} sold)` : ""}`}
                    </button>
                    <button
                      type="button"
                      onClick={() => copyArchivedUpdateBody(post)}
                      className={buttonClass}
                      title="Copies this post's body with sold records crossed out — paste over the post's body on Reddit"
                    >
                      {archiveCopiedKey === `update-${post.id}`
                        ? "Copied!"
                        : "Copy update body"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
    </>
  );
}
