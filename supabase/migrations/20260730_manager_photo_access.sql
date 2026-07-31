-- Let shop managers view their team's proof photos.
--
-- The teams migration let managers READ work_logs rows (which carry photo_path),
-- but the photos live in the private `proofs` storage bucket, which has its own
-- policies. Without this, a manager sees a job's details and a broken image.
--
-- Photo paths are written as: {owner_uid}/{emp_id}/{log_id}.jpg
-- so the first path segment identifies the tech who owns the file. We reuse
-- is_manager_of() from the teams migration, which is true only when the caller
-- manages a shop that tech belongs to.
--
-- Read-only on purpose: a manager can look at proof, never upload, overwrite,
-- or delete a tech's evidence.

DROP POLICY IF EXISTS "managers_read_team_proofs" ON storage.objects;

CREATE POLICY "managers_read_team_proofs" ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'proofs'
    -- Guard the cast: a malformed path must not raise, just fail to match.
    AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    AND public.is_manager_of(((storage.foldername(name))[1])::uuid)
  );
