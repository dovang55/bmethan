require('dotenv').config();
const express  = require('express');
const multer   = require('multer');
const cors     = require('cors');
const path     = require('path');
const fs       = require('fs');
const ws       = require('ws');
const { createClient } = require('@supabase/supabase-js');

// ── Supabase ──────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { realtime: { transport: ws } }
);

const BUCKET     = 'ethan-videos';
const ADMIN_KEY  = process.env.ADMIN_KEY || 'admin2026';
const PORT       = process.env.PORT      || 3000;
const TMP_DIR    = path.join(__dirname, 'tmp');

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// ── Express ───────────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

// Fichiers statiques : tout ce qui est dans le dossier parent (upload.html, admin.html, etc.)
app.use(express.static(path.join(__dirname, '..')));

// ── Multer (stockage temporaire sur disque) ───────────────────────────────────
const storage = multer.diskStorage({
  destination: TMP_DIR,
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '_'))
});
const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 Mo max
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype.startsWith('video/') || file.mimetype.startsWith('image/');
    cb(ok ? null : new Error('Seules les vidéos sont acceptées'), ok);
  }
});

// ── Middleware admin ──────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.adminKey;
  if (key !== ADMIN_KEY) return res.status(401).json({ error: 'Non autorisé' });
  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/upload  — envoi d'une vidéo
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/upload', upload.single('video'), async (req, res) => {
  const tmpPath = req.file?.path;
  try {
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });

    const { name = 'Anonyme', message = '' } = req.body;
    const ext      = path.extname(req.file.originalname).toLowerCase() || '.mp4';
    const safeName = name.replace(/[^a-z0-9]/gi, '_').slice(0, 40);
    const fileName = `${Date.now()}_${safeName}${ext}`;

    // Lecture + upload vers Supabase Storage
    const buffer = fs.readFileSync(tmpPath);
    console.log('[upload] bucket:', BUCKET);
    console.log('[upload] fileName:', fileName);
    console.log('[upload] mimetype:', req.file.mimetype);
    console.log('[upload] size:', buffer.length);
    const { data: uploadData, error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(fileName, buffer, { contentType: req.file.mimetype, upsert: false });

    console.log('[upload] result:', uploadData, uploadErr);
    if (uploadErr) throw uploadErr;

    // URL publique
    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(fileName);

    // Métadonnées en base
    const { error: dbErr } = await supabase.from('video_submissions').insert({
      name,
      message,
      video_url:  urlData.publicUrl,
      file_name:  fileName,
      created_at: new Date().toISOString()
    });
    if (dbErr) throw dbErr;

    res.json({ success: true, url: urlData.publicUrl });
  } catch (err) {
    console.error('[upload]', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    if (tmpPath && fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/videos  — liste toutes les vidéos (admin)
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/videos', requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('video_submissions')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/videos/:id  — supprime une vidéo (admin)
// ─────────────────────────────────────────────────────────────────────────────
app.delete('/api/videos/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;

  // Récupère le nom de fichier
  const { data: row } = await supabase
    .from('video_submissions').select('file_name').eq('id', id).single();

  if (row?.file_name) {
    await supabase.storage.from(BUCKET).remove([row.file_name]);
  }

  const { error } = await supabase.from('video_submissions').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/rsvp  — enregistre une réponse
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/rsvp', async (req, res) => {
  try {
    const {
      nom, prenom,
      pres_mishte, adults_mishte, children_mishte,
      pres_shabbat, adults_shabbat, children_shabbat,
      message
    } = req.body;

    if (!nom || !prenom) return res.status(400).json({ error: 'Nom et prénom requis' });

    const { error } = await supabase.from('rsvp_submissions').insert({
      nom, prenom,
      pres_mishte:      pres_mishte      || 'non',
      adults_mishte:    parseInt(adults_mishte)    || 0,
      children_mishte:  parseInt(children_mishte)  || 0,
      pres_shabbat:     pres_shabbat     || 'non',
      adults_shabbat:   parseInt(adults_shabbat)   || 0,
      children_shabbat: parseInt(children_shabbat) || 0,
      message:          message || '',
      created_at:       new Date().toISOString()
    });

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('[rsvp]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/rsvp  — liste toutes les réponses (admin)
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/rsvp', requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('rsvp_submissions')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/rsvp/:id  — supprime une réponse (admin)
// ─────────────────────────────────────────────────────────────────────────────
app.delete('/api/rsvp/:id', requireAdmin, async (req, res) => {
  const { error } = await supabase.from('rsvp_submissions').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ─────────────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅  Serveur démarré sur http://localhost:${PORT}`);
  console.log(`   Upload  → http://localhost:${PORT}/upload.html`);
  console.log(`   Admin   → http://localhost:${PORT}/admin.html`);
});
