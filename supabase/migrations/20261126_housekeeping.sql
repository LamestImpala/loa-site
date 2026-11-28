-- Housekeeping from the Nov 24 security audit (security slice 8).
--
-- Four small, independent tightenings. None of them changes what a
-- shopper, a pick'em player or the admin can do in the app:
--   1. a trigger function nobody needs to call directly loses its public
--      EXECUTE grant;
--   2. the record-photos bucket gets a size cap and an image-only rule;
--   3. the public may still VIEW every photo by its address, but may no
--      longer LIST the bucket's files;
--   4. two backup tables from the Oct 3 pick'em repair are dropped.
--
-- Order of going live: this file and the code in the same PR do not
-- depend on each other; either can go first.
--
-- Safe to run twice: every statement is idempotent.

-- ---------------------------------------------------------------------
-- 1. pickem_pick_changed() is a SECURITY DEFINER trigger function
--    (it removes a stale stake when a pick changes). Postgres checks
--    EXECUTE on a trigger function when the trigger is created, not each
--    time it fires, so the trigger on pickem_picks keeps working for
--    players. Postgres also refuses to run a trigger function outside a
--    trigger, so this closes nothing that was reachable; it clears the
--    grant so the function stops showing up as publicly callable.
-- ---------------------------------------------------------------------
revoke all on function public.pickem_pick_changed() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. record-photos: at most 10 MB a file, and only the image types a
--    browser can show. The admin's uploads are phone photos (3-6 MB
--    straight from the camera, far less once the reply box resizes
--    them); the largest file there today is 2.5 MB. Storage refuses
--    anything else with a message the admin already shows as a toast.
-- ---------------------------------------------------------------------
update storage.buckets
set file_size_limit = 10485760,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'record-photos';

-- ---------------------------------------------------------------------
-- 3. Listing. The bucket is public, so a photo's address
--    (/storage/v1/object/public/record-photos/...) is served to anyone
--    without consulting these policies: the shop, the image optimizer and
--    the email attachments all keep working. The old SELECT policy went
--    further and let anyone ask Storage for the full list of files,
--    including photos sent to one buyer and kept off the listing
--    (replies/...). Only the admin needs that: Storage reads the row
--    back when it deletes a file. So the read policy becomes the
--    owner's, with the two-step sign-in rule the upload and delete
--    policies already carry.
-- ---------------------------------------------------------------------
drop policy if exists "public reads record photos" on storage.objects;
drop policy if exists "admin reads record photos" on storage.objects;
create policy "admin reads record photos" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'record-photos'
    and (select auth.jwt() ->> 'email') = 'brandoncgillihan@gmail.com'
    and (select auth.jwt() ->> 'aal') = 'aal2'
  );

-- ---------------------------------------------------------------------
-- 4. Backups taken on Oct 3 before the closing-line repair
--    (20261003_pickem_repair_closing_lines.sql). Nothing reads them; with
--    them goes the undo that file describes.
-- ---------------------------------------------------------------------
drop table if exists public.pickem_games_backup_20261003;
drop table if exists public.pickem_house_backup_20261003;
