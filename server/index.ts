import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import {
  acknowledgeProviderTerms,
  addClearance,
  callbackUrl,
  feeBps,
  mediaPath,
  openTask,
  prepareListing,
  studioSessions,
  openSession,
  publicConfig,
  purchase,
  readArrangement,
  replaceSplits,
  saveArrangement,
  saveDeclaration,
  saveUpload,
  setTaskResult,
  stemFilesFromPayload,
  storeLyrics,
  storeStemFiles,
  trackView,
} from './catalog.ts';
import { update, view } from './store.ts';
import {
  SunoError,
  addInstrumental,
  addVocals,
  buildGenerateBody,
  convertWav,
  defaultModel,
  extendMusic,
  generateLyrics,
  generateMusic,
  isTerminalFailure,
  isTerminalSuccess,
  lyricsRecord,
  mashup,
  musicRecord,
  readTaskStatus,
  remainingCredits,
  replaceSection,
  sunoConfigured,
  uploadCover,
  uploadExtend,
  vocalRemoval,
  vocalRemovalRecord,
} from './suno/client.ts';
import { refreshSideTask, registerProduce } from './actions.ts';
import { BillingError, billingSnapshot, bindAccount, confirmCheckout, publicOrigin, requireAccess, startCheckout } from './billing.ts';

loadEnv();

const app = express();
app.use(express.json({ limit: '30mb' }));
app.use((req, _res, next) => bindAccount(req, next));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'redsound' });
});

app.get('/api/config', (_req, res) => {
  res.json(publicConfig());
});

app.get('/api/billing', (_req, res) => {
  res.json(billingSnapshot());
});

app.post('/api/billing/checkout', async (req, res, next) => {
  try {
    const result = await startCheckout(String(req.body.planId || ''), String(req.body.email || ''), publicOrigin(req));
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/billing/confirm', async (req, res, next) => {
  try {
    res.json(await confirmCheckout(String(req.body.paymentId || '')));
  } catch (error) {
    next(error);
  }
});

app.get('/api/profile', (_req, res) => {
  res.json(view().profile);
});

app.put('/api/profile', (req, res, next) => {
  let email: string | undefined;
  if (typeof req.body.email === 'string') {
    email = req.body.email.trim().toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      next(new BillingError(400, 'Enter a valid account email.'));
      return;
    }
  }
  update((db) => {
    if (typeof req.body.displayName === 'string' && req.body.displayName.trim()) {
      db.profile.displayName = req.body.displayName.trim().slice(0, 80);
    }
    if (typeof req.body.handle === 'string' && req.body.handle.trim()) {
      db.profile.handle = req.body.handle.trim().replace(/^@/, '').slice(0, 40);
    }
    if (email !== undefined) db.profile.email = email;
    return db.profile;
  }).then((profile) => res.json(profile)).catch(next);
});

app.get('/api/library', (_req, res) => {
  const db = view();
  res.json(db.assets.map((asset) => trackView(db, asset.id)));
});

app.get('/api/assets/:id', (req, res) => {
  const db = view();
  const track = trackView(db, req.params.id);
  if (!track) return res.status(404).json({ error: 'Asset not found.' });
  res.json(track);
});

app.get('/api/assets/:id/arrangement', (req, res) => {
  const arrangement = readArrangement(view(), req.params.id);
  if (!arrangement) return res.status(404).json({ error: 'Session not found.' });
  res.json(arrangement);
});

app.put('/api/assets/:id/arrangement', async (req, res, next) => {
  try {
    res.json(await saveArrangement(req.params.id, req.body));
  } catch (error) {
    next(error);
  }
});

app.get('/api/media/:id', (req, res) => {
  const file = mediaPath(req.params.id);
  if (!file) return res.status(404).end();
  const asset = view().assets.find((item) => item.mediaId === req.params.id);
  res.type(asset?.mimeType || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});

app.post('/api/assets/upload', async (req, res, next) => {
  try {
    const asset = await saveUpload({
      filename: String(req.body.filename || 'upload.bin'),
      contentType: String(req.body.contentType || 'application/octet-stream'),
      dataBase64: String(req.body.dataBase64 || ''),
      title: String(req.body.title || 'Untitled').slice(0, 120),
      kind: oneOf(req.body.kind, ['beat', 'song', 'sample', 'stem', 'vocal', 'full_mix']) || 'beat',
      origin: oneOf(req.body.origin, ['human_created', 'imported']) || 'imported',
      parentAssetId: typeof req.body.parentAssetId === 'string' ? req.body.parentAssetId : undefined,
      bpm: numberOrUndefined(req.body.bpm),
      musicalKey: typeof req.body.musicalKey === 'string' ? req.body.musicalKey.slice(0, 16) : undefined,
      durationSec: numberOrUndefined(req.body.durationSec),
    });
    res.status(201).json(trackView(view(), asset.id));
  } catch (error) {
    next(error);
  }
});

app.post('/api/generate', async (req, res, next) => {
  try {
    requireSuno();
    requireAccess('generate');
    const input = {
      prompt: req.body.prompt as string | undefined,
      lyrics: req.body.lyrics as string | undefined,
      style: req.body.style as string | undefined,
      title: req.body.title as string | undefined,
      instrumental: Boolean(req.body.instrumental),
      customMode: Boolean(req.body.customMode),
      model: typeof req.body.model === 'string' ? req.body.model : defaultModel(),
      negativeTags: req.body.negativeTags as string | undefined,
      vocalGender: req.body.vocalGender === 'm' || req.body.vocalGender === 'f' ? req.body.vocalGender : undefined,
      duration: numberOrUndefined(req.body.duration),
      personaId: typeof req.body.personaId === 'string' ? req.body.personaId.trim() : undefined,
      personaModel: req.body.personaModel === 'voice_persona' ? 'voice_persona' as const : req.body.personaId ? 'style_persona' as const : undefined,
      callBackUrl: callbackUrl(),
    };
    const body = buildGenerateBody(input);
    const created = await generateMusic(input);
    const taskId = created.data?.taskId;
    const task = await openTask('generate', {
      ...body,
      title: input.title,
      prompt: input.prompt,
      lyrics: input.lyrics,
      style: input.style,
      bpm: numberOrUndefined(req.body.bpm),
      musicalKey: typeof req.body.musicalKey === 'string' ? req.body.musicalKey : undefined,
    }, taskId);
    res.status(202).json(task);
  } catch (error) {
    next(error);
  }
});

app.post('/api/lyrics', async (req, res, next) => {
  try {
    requireSuno();
    requireAccess('lyrics');
    const prompt = String(req.body.prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: 'Describe the lyrics.' });
    const created = await generateLyrics(prompt, callbackUrl());
    const taskId = (created.data as { taskId?: string } | undefined)?.taskId;
    const task = await openTask('lyrics', { prompt }, taskId);
    res.status(202).json(task);
  } catch (error) {
    next(error);
  }
});

app.post('/api/assets/:id/stems', async (req, res, next) => {
  try {
    const db = view();
    const asset = db.assets.find((item) => item.id === req.params.id);
    const provenance = db.provenance.find((item) => item.assetId === req.params.id);
    if (!asset) return res.status(404).json({ error: 'Asset not found.' });
    const type = oneOf(req.body.type, ['separate_vocal', 'split_stem', 'split_stem_advanced']) || 'separate_vocal';
    const payload: Record<string, unknown> = { type, callBackUrl: callbackUrl() };
    if (provenance?.provider === 'suno' && provenance.providerJobId && provenance.providerAudioId) {
      payload.taskId = provenance.providerJobId;
      payload.audioId = provenance.providerAudioId;
    } else if (asset.audioUrl?.startsWith('http')) {
      payload.audioUrl = asset.audioUrl;
    } else {
      return res.status(400).json({ error: 'Stem separation needs a Suno track or a public audio URL. Local recordings have to be hosted first.' });
    }
    requireSuno();
    requireAccess('vocal_removal');
    if (type === 'split_stem_advanced') payload.stemName = String(req.body.stemName || 'Lead Vocal');
    const task = await openTask('vocal_removal', { ...payload, parentAssetId: asset.id });
    const created = await vocalRemoval(payload);
    const sunoTaskId = (created.data as { taskId?: string } | undefined)?.taskId;
    const saved = await update((state) => {
      const current = state.tasks.find((item) => item.id === task.id);
      if (current) current.sunoTaskId = sunoTaskId;
      return current;
    });
    res.status(202).json(saved);
  } catch (error) {
    next(error);
  }
});

app.post('/api/assets/:id/extend', async (req, res, next) => {
  try {
    const source = sourceAudio(req.params.id);
    requireSuno();
    requireAccess('extend');
    const body = {
      audioId: source.audioId,
      taskId: source.taskId,
      model: typeof req.body.model === 'string' ? req.body.model : defaultModel(),
      callBackUrl: callbackUrl(),
      lyrics: typeof req.body.lyrics === 'string' ? req.body.lyrics : undefined,
      style: typeof req.body.style === 'string' ? req.body.style : undefined,
      title: typeof req.body.title === 'string' ? req.body.title : undefined,
      continueAt: numberOrUndefined(req.body.continueAt),
      instrumental: Boolean(req.body.instrumental),
    };
    const created = await extendMusic(body);
    const task = await openTask('extend', { ...body, parentAssetId: req.params.id }, created.data?.taskId);
    res.status(202).json(task);
  } catch (error) {
    next(error);
  }
});

app.post('/api/suno/:action', async (req, res, next) => {
  try {
    const action = req.params.action;
    if (action === 'callback') {
      res.status(200).json({ status: 'received' });
      void ingestCallback(req.body).catch((error) => console.error('Suno callback failed', error));
      return;
    }
    const body = { ...req.body, model: req.body.model || defaultModel(), callBackUrl: req.body.callBackUrl || callbackUrl() };
    const runners: Record<string, (payload: Record<string, unknown>) => Promise<{ data?: { taskId?: string } }>> = {
      'upload-cover': uploadCover,
      'upload-extend': uploadExtend,
      'add-vocals': addVocals,
      'add-instrumental': addInstrumental,
      'replace-section': replaceSection,
      mashup,
      wav: convertWav,
    };
    const run = runners[action];
    if (!run) return res.status(404).json({ error: 'Unknown Suno action.' });
    const kind = action === 'wav' ? 'wav' : action === 'mashup' ? 'mashup' : action === 'add-vocals' ? 'add_vocals' : action === 'add-instrumental' ? 'add_instrumental' : action === 'replace-section' ? 'replace_section' : action === 'upload-cover' ? 'upload_cover' : 'upload_extend';
    requireSuno();
    requireAccess(kind);
    const created = await run(body);
    const task = await openTask(kind, body, created.data?.taskId);
    res.status(202).json(task);
  } catch (error) {
    next(error);
  }
});

app.get('/api/tasks/:id', async (req, res, next) => {
  try {
    const task = await refreshTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found.' });
    const db = view();
    res.json({ ...task, assets: task.assetIds.map((assetId) => trackView(db, assetId)) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/tasks', (_req, res) => {
  res.json(view().tasks);
});

app.post('/api/assets/:id/declaration', async (req, res, next) => {
  try {
    const declaration = await saveDeclaration(req.params.id, {
      createdThisWork: Boolean(req.body.createdThisWork),
      controlsRecording: Boolean(req.body.controlsRecording),
      samplesCleared: Boolean(req.body.samplesCleared),
      contributorsPermitted: Boolean(req.body.contributorsPermitted),
      acceptsResponsibility: Boolean(req.body.acceptsResponsibility),
      usesSamples: Boolean(req.body.usesSamples),
    });
    res.json(declaration);
  } catch (error) {
    next(error);
  }
});

app.post('/api/assets/:id/clearances', async (req, res, next) => {
  try {
    const source = String(req.body.source || '').trim();
    if (!source) return res.status(400).json({ error: 'Name the sample source.' });
    const clearance = await addClearance(req.params.id, source, String(req.body.proofNote || '').trim());
    res.status(201).json(clearance);
  } catch (error) {
    next(error);
  }
});

app.put('/api/splits', async (req, res, next) => {
  try {
    const subjectType = req.body.subjectType === 'recording' ? 'recording' : 'work';
    const subjectId = String(req.body.subjectId || '');
    const rows = Array.isArray(req.body.splits) ? req.body.splits : [];
    const splits = await replaceSplits(
      subjectType,
      subjectId,
      rows.map((row: { name?: string; role?: string; shareBps?: number }) => ({
        name: String(row.name || '').trim() || 'Unnamed',
        role: oneOf(row.role, ['writer', 'publisher', 'master_owner', 'producer', 'performer']) || (subjectType === 'work' ? 'writer' : 'master_owner'),
        shareBps: Math.round(Number(row.shareBps) || 0),
      })),
    );
    res.json(splits);
  } catch (error) {
    next(error);
  }
});

app.post('/api/assets/:id/provider-terms', async (req, res, next) => {
  try {
    res.json(await acknowledgeProviderTerms(req.params.id));
  } catch (error) {
    next(error);
  }
});

app.post('/api/listings', async (req, res, next) => {
  try {
    const assetIds = Array.isArray(req.body.assetIds) ? req.body.assetIds.map(String) : [];
    const listing = await prepareListing(assetIds);
    res.status(201).json(listing);
  } catch (error) {
    next(error);
  }
});

app.get('/api/listings', (_req, res) => {
  res.json(view().listings);
});

app.get('/api/listings/:id', (req, res) => {
  const listing = view().listings.find((item) => item.id === req.params.id);
  if (!listing) return res.status(404).json({ error: 'Listing not found.' });
  const db = view();
  res.json({ ...listing, assets: listing.assetIds.map((assetId) => trackView(db, assetId)) });
});

app.post('/api/listings/:id/purchase', async (req, res, next) => {
  try {
    const grant = await purchase(req.params.id, String(req.body.offerId || ''), String(req.body.buyerName || ''));
    res.status(201).json(grant);
  } catch (error) {
    next(error);
  }
});

app.get('/api/projects', (_req, res) => {
  res.json(studioSessions(view()));
});

app.post('/api/projects', (req, res, next) => {
  const bpm = Number(req.body.bpm);
  openSession({
    title: String(req.body.title || ''),
    bpm: Number.isFinite(bpm) ? bpm : 120,
    musicalKey: String(req.body.musicalKey || 'C Minor'),
  }).then((session) => res.status(201).json(session)).catch(next);
});

app.get('/api/rights', (_req, res) => {
  const db = view();
  res.json({
    profile: db.profile,
    works: db.works.map((work) => ({
      ...work,
      splits: db.splits.filter((split) => split.subjectType === 'work' && split.subjectId === work.id),
      assets: db.assets.filter((asset) => asset.workId === work.id),
    })),
    recordings: db.recordings.map((recording) => ({
      ...recording,
      splits: db.splits.filter((split) => split.subjectType === 'recording' && split.subjectId === recording.id),
    })),
    feeBps: feeBps(),
  });
});

app.get('/api/earnings', (_req, res) => {
  const db = view();
  const creatorCents = db.ledger.filter((entry) => entry.kind === 'creator_share').reduce((sum, entry) => sum + entry.amountCents, 0);
  const platformCents = db.ledger.filter((entry) => entry.kind === 'platform_fee').reduce((sum, entry) => sum + entry.amountCents, 0);
  res.json({ grants: db.grants, ledger: db.ledger, creatorCents, platformCents, feeBps: feeBps() });
});

app.get('/api/credits', async (_req, res, next) => {
  try {
    requireSuno();
    const credits = await remainingCredits();
    res.json({ credits: credits.data });
  } catch (error) {
    next(error);
  }
});

registerProduce(app);

const dist = path.resolve(process.cwd(), 'dist');
if (!process.env.VERCEL && process.env.NODE_ENV === 'production' && fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    res.sendFile(path.join(dist, 'index.html'));
  });
}

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = error instanceof SunoError || error instanceof BillingError ? error.code : 400;
  const message = error instanceof Error ? error.message : 'Request failed';
  const http = status >= 400 && status < 600 ? status : 400;
  res.status(http === 201 ? 400 : http).json({ error: message });
});

export default app;

if (!process.env.VERCEL) {
  const port = Number(process.env.PORT || 8787);
  app.listen(port, '0.0.0.0', () => {
    console.log(`Red Sound API on 0.0.0.0:${port}`);
  });
}

function requireSuno() {
  if (!sunoConfigured()) throw new SunoError(503, 'Add SUNO_API_KEY on the server to generate, extend, or separate stems.');
}

function sourceAudio(assetId: string): { audioId: string; taskId?: string } {
  const db = view();
  const provenance = db.provenance.find((item) => item.assetId === assetId);
  if (!provenance?.providerAudioId) throw new SunoError(400, 'Extend needs a Suno audio id on this track.');
  return { audioId: provenance.providerAudioId, taskId: provenance.providerJobId };
}

async function refreshTask(localId: string) {
  const existing = view().tasks.find((item) => item.id === localId);
  if (!existing) return null;
  if (!existing.sunoTaskId || existing.status === 'SUCCESS' || isTerminalFailure(existing.status)) return existing;
  if (!sunoConfigured()) return existing;
  if (existing.kind === 'vocal_removal') {
    const record = await vocalRemovalRecord(existing.sunoTaskId);
    const status = readTaskStatus(record);
    const files = stemFilesFromPayload(record);
    if (files.length && typeof existing.request.parentAssetId === 'string') {
      await storeStemFiles(existing.id, existing.request.parentAssetId, files);
    } else {
      await update((db) => {
        const task = db.tasks.find((item) => item.id === existing.id);
        if (task) {
          task.status = status;
          if (isTerminalFailure(status)) task.error = record.msg;
          task.updatedAt = new Date().toISOString();
        }
        return task;
      });
    }
    return view().tasks.find((item) => item.id === existing.id) || null;
  }
  if (existing.kind === 'lyrics') {
    const record = await lyricsRecord(existing.sunoTaskId);
    const status = readTaskStatus(record);
    const data = (record.data as { response?: { data?: Array<{ title?: string; text?: string; status?: string }> } } | undefined)?.response?.data;
    if (status === 'SUCCESS' && Array.isArray(data)) await storeLyrics(existing.id, data);
    else {
      await update((db) => {
        const task = db.tasks.find((item) => item.id === existing.id);
        if (task) {
          task.status = status;
          task.updatedAt = new Date().toISOString();
        }
        return task;
      });
    }
    return view().tasks.find((item) => item.id === existing.id) || null;
  }
  const side = await refreshSideTask(existing);
  if (side === 'handled') return view().tasks.find((item) => item.id === existing.id) || null;
  const record = await musicRecord(existing.sunoTaskId);
  const status = readTaskStatus(record);
  if (isTerminalSuccess(status) || isTerminalFailure(status)) {
    await setTaskResult(existing.id, status === 'TEXT_SUCCESS' ? 'PENDING' : status, record, {
      titleFallback: typeof existing.request.title === 'string' ? existing.request.title : 'Untitled',
    });
  } else {
    await update((db) => {
      const task = db.tasks.find((item) => item.id === existing.id);
      if (task) {
        task.status = status;
        task.updatedAt = new Date().toISOString();
      }
      return task;
    });
  }
  return view().tasks.find((item) => item.id === existing.id) || null;
}

async function ingestCallback(body: unknown) {
  const root = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const data = root.data && typeof root.data === 'object' ? (root.data as Record<string, unknown>) : {};
  const sunoTaskId = String(data.task_id || data.taskId || '');
  if (!sunoTaskId) return;
  const task = view().tasks.find((item) => item.sunoTaskId === sunoTaskId);
  if (!task) return;
  if (task.kind === 'vocal_removal' && typeof task.request.parentAssetId === 'string') {
    const files = stemFilesFromPayload(body);
    if (files.length) await storeStemFiles(task.id, task.request.parentAssetId, files);
    return;
  }
  if (task.kind === 'wav' || task.kind === 'midi' || task.kind === 'cover_image' || task.kind === 'recovery' || task.kind === 'voice') {
    await refreshSideTask(task);
    return;
  }
  if (root.code === 200) await setTaskResult(task.id, 'SUCCESS', body);
  else {
    await update((db) => {
      const current = db.tasks.find((item) => item.id === task.id);
      if (current) {
        current.status = 'FAILED';
        current.error = typeof root.msg === 'string' ? root.msg : 'Generation failed';
        current.updatedAt = new Date().toISOString();
      }
      return current;
    });
  }
}

function loadEnv() {
  for (const file of ['.env.local', '.env']) {
    try {
      const text = fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq < 1) continue;
        const key = trimmed.slice(0, eq).trim();
        const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
        if (process.env[key] == null || process.env[key] === '') process.env[key] = value;
      }
    } catch {
      // Missing env files are fine.
    }
  }
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
