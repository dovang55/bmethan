-- ============================================================
-- À exécuter UNE SEULE FOIS dans l'éditeur SQL de Supabase
-- Dashboard → SQL Editor → New query → colle tout → Run
-- ============================================================


-- ── 0. TABLE RSVP ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rsvp_submissions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nom              TEXT NOT NULL DEFAULT '',
  prenom           TEXT NOT NULL DEFAULT '',
  pres_mishte      TEXT DEFAULT 'non',
  adults_mishte    INTEGER DEFAULT 0,
  children_mishte  INTEGER DEFAULT 0,
  pres_shabbat     TEXT DEFAULT 'non',
  adults_shabbat   INTEGER DEFAULT 0,
  children_shabbat INTEGER DEFAULT 0,
  message          TEXT DEFAULT '',
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE rsvp_submissions ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_rsvp_created ON rsvp_submissions(created_at DESC);


-- ── 1. TABLE VIDÉOS ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS video_submissions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL DEFAULT 'Anonyme',
  message     TEXT DEFAULT '',
  video_url   TEXT NOT NULL,
  file_name   TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Index pour trier par date
CREATE INDEX IF NOT EXISTS idx_video_submissions_created
  ON video_submissions(created_at DESC);

-- Active RLS sur la table (obligatoire pour Supabase)
ALTER TABLE video_submissions ENABLE ROW LEVEL SECURITY;

-- Le serveur utilise la SERVICE_KEY → elle bypasse toutes les RLS.
-- Aucune policy supplémentaire nécessaire pour la table.


-- ── 2. BUCKET STORAGE ────────────────────────────────────────
-- ⚠️  Crée le bucket MANUELLEMENT dans l'interface Supabase :
--     Dashboard → Storage → New bucket
--     Name: ethan-videos   |   Public bucket: ✅ ON


-- ── 3. POLICIES STORAGE ──────────────────────────────────────

-- 3a. Lecture publique : n'importe qui peut voir/lire les vidéos
--     (nécessaire pour que les URLs publiques fonctionnent)
CREATE POLICY "Lecture publique ethan-videos"
  ON storage.objects FOR SELECT
  USING ( bucket_id = 'ethan-videos' );

-- 3b. Upload via service role uniquement (le serveur Express)
--     La service key bypasse les RLS, donc cette policy n'est
--     là que pour bloquer les uploads directs depuis le navigateur.
CREATE POLICY "Upload service role uniquement"
  ON storage.objects FOR INSERT
  WITH CHECK ( bucket_id = 'ethan-videos' AND auth.role() = 'service_role' );

-- 3c. Suppression via service role uniquement
CREATE POLICY "Suppression service role uniquement"
  ON storage.objects FOR DELETE
  USING ( bucket_id = 'ethan-videos' AND auth.role() = 'service_role' );
