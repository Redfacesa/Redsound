import type express from 'express';
import type { Asset, TaskRecord } from '../shared/types.ts';
import {
  applyRecoveredUrls,
  callbackUrl,
  completeSideTask,
  hostedAudioUrl,
  openTask,
  patchAsset,
  rememberPersona,
  rememberVoice,
} from './catalog.ts';
import { view } from './store.ts';
import { requireAccess } from './billing.ts';
import {
  SunoError,
  addInstrumental,
  addVocals,
  boostStyle,
  coverRecord,
  defaultModel,
  generateCoverImage,
  generateMidi,
  generateSounds,
  mashup,
  midiRecord,
  recoverAudio,
  recoveryRecord,
  replaceSection,
  sunoConfigured,
  timestampedLyrics,
  uploadCover,
  uploadExtend,
  voiceCheck,
  voiceGenerate,
  voiceRecordInfo,
  voiceRegenerate,
  voiceValidate,
  voiceValidateInfo,
  wavRecord,
} from './suno/client.ts';

function requireSuno(kind: Parameters<typeof requireAccess>[0]) {
  if (!sunoConfigured()) throw new SunoError(503, 'Add SUNO_API_KEY on the server to use Suno.');
  requireAccess(kind);
}

function assetOrThrow(id: string): Asset {
  const asset = view().assets.find((item) => item.id === id);
  if (!asset) throw new SunoError(404, 'Track not found.');
  return asset;
}

function sunoIds(assetId: string): { audioId?: string; taskId?: string } {
  const provenance = view().provenance.find((item) => item.assetId === assetId);
  return { audioId: provenance?.providerAudioId, taskId: provenance?.providerJobId };
}

function publicAudio(asset: Asset): string {
  const url = hostedAudioUrl(asset);
  if (!url) {
    throw new SunoError(400, 'Suno cannot read a file that only lives on this computer. Use a generated track, or set PUBLIC_BASE_URL to a host Suno can reach.');
  }
  return url;
}

function text(value: unknown, max: number, fallback = ''): string {
  const raw = typeof value === 'string' ? value.trim() : fallback;
  return (raw || fallback).slice(0, max);
}

function sourceHold(durationSec?: number): Record<string, unknown> {
  const duration = Number(durationSec);
  return {
    audioWeight: 0.85,
    variety: 0,
    weirdnessConstraint: 0.2,
    styleWeight: 0.8,
    ...(duration >= 10 && duration <= 360 ? { duration: Math.round(duration) } : {}),
  };
}

function styleTags(style: string, bpm: number, musicalKey: string): string {
  return [style, Number.isFinite(bpm) && bpm >= 40 && bpm <= 220 ? `${Math.round(bpm)} BPM` : '', musicalKey]
    .filter(Boolean)
    .join(', ')
    .slice(0, 1000);
}

function taskIdOf(envelope: { data?: { taskId?: string; task_id?: string } | null }): string {
  const data = envelope.data;
  const id = data?.taskId || data?.task_id;
  if (!id) throw new SunoError(502, 'Suno did not return a task id.');
  return id;
}

function flagOf(data: unknown): string {
  const record = data && typeof data === 'object' ? (data as { successFlag?: unknown; status?: unknown }) : {};
  return String(record.successFlag ?? record.status ?? '');
}

export async function refreshSideTask(existing: TaskRecord): Promise<'handled' | 'music'> {
  const parent = typeof existing.request.parentAssetId === 'string' ? existing.request.parentAssetId : undefined;
  if (existing.kind === 'wav') {
    const record = await wavRecord(existing.sunoTaskId!);
    const data = record.data as { successFlag?: string; errorMessage?: string; response?: { audioWavUrl?: string } } | undefined;
    const flag = flagOf(data);
    if (flag === 'SUCCESS' && data?.response?.audioWavUrl && parent) {
      await patchAsset(parent, { wavUrl: data.response.audioWavUrl });
      await completeSideTask(existing.id, 'SUCCESS', { assetIds: [parent] });
    } else if (/FAIL|ERROR/i.test(flag)) {
      await completeSideTask(existing.id, flag || 'FAILED', { error: data?.errorMessage || record.msg });
    } else {
      await completeSideTask(existing.id, flag || 'PENDING');
    }
    return 'handled';
  }
  if (existing.kind === 'midi') {
    const record = await midiRecord(existing.sunoTaskId!);
    const data = record.data as { successFlag?: number | string; errorMessage?: string; midiData?: unknown } | undefined;
    const flag = Number(data?.successFlag);
    if (flag === 1 && parent) {
      await patchAsset(parent, { midiData: data?.midiData ?? data });
      await completeSideTask(existing.id, 'SUCCESS', { assetIds: [parent] });
    } else if (flag === 2 || flag === 3) {
      await completeSideTask(existing.id, 'FAILED', { error: data?.errorMessage || record.msg });
    } else {
      await completeSideTask(existing.id, 'PENDING');
    }
    return 'handled';
  }
  if (existing.kind === 'cover_image') {
    const record = await coverRecord(existing.sunoTaskId!);
    const data = record.data as { successFlag?: number | string; errorMessage?: string; response?: { images?: string[] } } | undefined;
    const flag = Number(data?.successFlag);
    const image = data?.response?.images?.[0];
    if (flag === 1 && image && parent) {
      await patchAsset(parent, { imageUrl: image });
      await completeSideTask(existing.id, 'SUCCESS', { assetIds: [parent], request: { images: data?.response?.images } });
    } else if (flag === 3) {
      await completeSideTask(existing.id, 'FAILED', { error: data?.errorMessage || record.msg });
    } else {
      await completeSideTask(existing.id, 'PENDING');
    }
    return 'handled';
  }
  if (existing.kind === 'recovery') {
    const record = await recoveryRecord(existing.sunoTaskId!);
    if (record.code === 201) {
      await completeSideTask(existing.id, 'PENDING');
      return 'handled';
    }
    const tracks = Array.isArray(record.data) ? (record.data as Array<{ id?: string; audio_url?: string; status?: string }>) : [];
    if (record.code === 200 && tracks.length) {
      await applyRecoveredUrls(tracks);
      await completeSideTask(existing.id, 'SUCCESS', { assetIds: parent ? [parent] : [] });
    } else if (record.code && record.code >= 400) {
      await completeSideTask(existing.id, 'FAILED', { error: record.msg });
    } else {
      await completeSideTask(existing.id, 'PENDING');
    }
    return 'handled';
  }
  if (existing.kind === 'voice') {
    const phase = existing.request.phase === 'create' ? 'create' : 'validate';
    const record = phase === 'create' ? await voiceRecordInfo(existing.sunoTaskId!) : await voiceValidateInfo(existing.sunoTaskId!);
    const data = (record.data || {}) as { status?: string; voiceId?: string; validateInfo?: unknown; failReason?: string; errorMessage?: string };
    const status = String(data.status || '');
    const ready = status === 'success' || status === 'wait_validating';
    const failed = status === 'fail' || status.endsWith('_fail');
    await completeSideTask(existing.id, ready ? 'SUCCESS' : failed ? 'FAILED' : 'PENDING', {
      error: failed ? data.failReason || data.errorMessage || record.msg : undefined,
      request: { voiceStatus: status, voiceId: data.voiceId, validateInfo: data.validateInfo },
    });
    return 'handled';
  }
  return 'music';
}

export function registerProduce(app: express.Express) {
  app.post('/api/assets/:id/cover', async (req, res, next) => {
    try {
      requireSuno('upload_cover');
      const asset = assetOrThrow(req.params.id);
      const url = publicAudio(asset);
      const bpm = Number(req.body.bpm);
      const musicalKey = text(req.body.musicalKey, 40, '');
      const style = styleTags(text(req.body.style, 200, 'Hip-Hop'), bpm, musicalKey);
      const title = text(req.body.title, 80, asset.title);
      const lyrics = text(req.body.lyrics, 5000);
      const voiceId = text(req.body.voiceId, 120);
      const created = await uploadCover({
        uploadUrl: url,
        instrumental: Boolean(req.body.instrumental),
        model: text(req.body.model, 40, defaultModel()),
        callBackUrl: callbackUrl(),
        style,
        title,
        ...(lyrics ? { lyrics } : {}),
        ...(voiceId ? { personaId: voiceId, personaModel: 'voice_persona' } : {}),
        ...sourceHold(Number(req.body.duration)),
      });
      res.status(202).json(await openTask('upload_cover', {
        parentAssetId: asset.id,
        title,
        style,
        bpm: Number.isFinite(bpm) ? bpm : undefined,
        musicalKey: musicalKey || undefined,
        single: req.body.single !== false,
        lyrics: text(req.body.lyrics, 5000),
      }, taskIdOf(created)));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/assets/:id/upload-extend', async (req, res, next) => {
    try {
      requireSuno('upload_extend');
      const asset = assetOrThrow(req.params.id);
      const created = await uploadExtend({
        uploadUrl: publicAudio(asset),
        model: text(req.body.model, 40, defaultModel()),
        callBackUrl: callbackUrl(),
        continueAt: Number(req.body.continueAt ?? 1),
        style: text(req.body.style, 1000, 'Hip-Hop'),
        title: text(req.body.title, 100, asset.title),
        ...(text(req.body.lyrics, 5000) ? { lyrics: text(req.body.lyrics, 5000) } : {}),
        audioWeight: 0.85,
        variety: 0,
        weirdnessConstraint: 0.2,
        styleWeight: 0.8,
      });
      res.status(202).json(await openTask('upload_extend', { parentAssetId: asset.id, title: asset.title }, taskIdOf(created)));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/assets/:id/vocals', async (req, res, next) => {
    try {
      requireSuno('add_vocals');
      const asset = assetOrThrow(req.params.id);
      const style = text(req.body.style, 1000);
      const negativeTags = text(req.body.negativeTags, 200, 'silence');
      const title = text(req.body.title, 80, asset.title);
      if (!style) throw new SunoError(400, 'Add vocals needs a style.');
      const lyrics = text(req.body.lyrics, 5000);
      const voiceId = text(req.body.voiceId, 120);
      const created = await addVocals({
        uploadUrl: publicAudio(asset),
        model: text(req.body.model, 40, defaultModel()),
        callBackUrl: callbackUrl(),
        title,
        negativeTags,
        style,
        ...(lyrics ? { lyrics } : {}),
        ...(voiceId ? { personaId: voiceId, personaModel: 'voice_persona' } : {}),
        vocalGender: req.body.vocalGender === 'f' || req.body.vocalGender === 'm' ? req.body.vocalGender : undefined,
        audioWeight: 0.85,
        variety: 0,
        weirdnessConstraint: 0.2,
        styleWeight: 0.8,
      });
      res.status(202).json(await openTask('add_vocals', { parentAssetId: asset.id, title, style }, taskIdOf(created)));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/assets/:id/instrumental', async (req, res, next) => {
    try {
      requireSuno('add_instrumental');
      const asset = assetOrThrow(req.params.id);
      const given = text(req.body.tags, 800);
      const title = text(req.body.title, 80, asset.title);
      if (!given) throw new SunoError(400, 'Add instrumental needs tags, for example amapiano, log drum.');
      const bpm = Number(req.body.bpm);
      const musicalKey = text(req.body.musicalKey, 40, '');
      const tags = styleTags(given, bpm, musicalKey);
      const lyrics = text(req.body.lyrics, 5000);
      const created = await addInstrumental({
        uploadUrl: publicAudio(asset),
        model: text(req.body.model, 40, defaultModel()),
        callBackUrl: callbackUrl(),
        title,
        negativeTags: text(req.body.negativeTags, 200, 'tempo change, different song'),
        tags,
        ...(lyrics ? { lyrics } : {}),
        audioWeight: 0.9,
        variety: 0,
        weirdnessConstraint: 0.15,
        styleWeight: 0.85,
      });
      res.status(202).json(await openTask('add_instrumental', {
        parentAssetId: asset.id,
        title,
        style: tags,
        bpm: Number.isFinite(bpm) ? bpm : undefined,
        musicalKey: musicalKey || undefined,
        single: req.body.single !== false,
      }, taskIdOf(created)));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/assets/:id/replace', async (req, res, next) => {
    try {
      requireSuno('replace_section');
      const asset = assetOrThrow(req.params.id);
      const ids = sunoIds(asset.id);
      const start = Number(req.body.infillStartS);
      const end = Number(req.body.infillEndS);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 10) {
        throw new SunoError(400, 'The replaced section has to be at least 10 seconds.');
      }
      const body: Record<string, unknown> = {
        prompt: text(req.body.prompt, 500, 'replace this section'),
        tags: text(req.body.tags, 1000, 'Pop'),
        title: text(req.body.title, 80, asset.title),
        infillStartS: start,
        infillEndS: end,
        fullLyrics: text(req.body.fullLyrics, 5000),
        callBackUrl: callbackUrl(),
      };
      if (ids.taskId && ids.audioId) {
        body.taskId = ids.taskId;
        body.audioId = ids.audioId;
      } else {
        body.uploadUrl = publicAudio(asset);
        body.model = defaultModel();
      }
      const created = await replaceSection(body);
      res.status(202).json(await openTask('replace_section', { parentAssetId: asset.id, title: asset.title }, taskIdOf(created)));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/mashup', async (req, res, next) => {
    try {
      requireSuno('mashup');
      const ids = Array.isArray(req.body.assetIds) ? req.body.assetIds.map(String).slice(0, 2) : [];
      if (ids.length !== 2) throw new SunoError(400, 'A mashup needs exactly two tracks.');
      const urls = ids.map((id) => publicAudio(assetOrThrow(id)));
      const created = await mashup({
        uploadUrlList: urls,
        model: text(req.body.model, 40, defaultModel()),
        callBackUrl: callbackUrl(),
      });
      res.status(202).json(await openTask('mashup', { parentAssetId: ids[0], title: 'Mashup' }, taskIdOf(created)));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/assets/:id/wav', async (req, res, next) => {
    try {
      requireSuno('wav');
      const asset = assetOrThrow(req.params.id);
      const ids = sunoIds(asset.id);
      if (!ids.taskId || !ids.audioId) throw new SunoError(400, 'WAV conversion needs a finished Suno track.');
      const { convertWav } = await import('./suno/client.ts');
      const created = await convertWav({ taskId: ids.taskId, audioId: ids.audioId, callBackUrl: callbackUrl() });
      res.status(202).json(await openTask('wav', { parentAssetId: asset.id }, taskIdOf(created)));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/assets/:id/midi', async (req, res, next) => {
    try {
      requireSuno('midi');
      const asset = assetOrThrow(req.params.id);
      const separation = [...view().tasks]
        .reverse()
        .find((task) => task.kind === 'vocal_removal' && task.request.parentAssetId === asset.id && task.sunoTaskId && task.status === 'SUCCESS');
      if (!separation?.sunoTaskId) {
        throw new SunoError(400, 'MIDI needs a finished stem separation on this track. Run split_stem first.');
      }
      const created = await generateMidi({ taskId: separation.sunoTaskId, callBackUrl: callbackUrl() });
      res.status(202).json(await openTask('midi', { parentAssetId: asset.id }, taskIdOf(created)));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/assets/:id/persona', async (req, res, next) => {
    try {
      requireSuno('persona');
      const asset = assetOrThrow(req.params.id);
      const ids = sunoIds(asset.id);
      if (!ids.taskId || !ids.audioId) throw new SunoError(400, 'A persona needs a finished Suno track.');
      const name = text(req.body.name, 80);
      const description = text(req.body.description, 500);
      if (!name || !description) throw new SunoError(400, 'A persona needs a name and a description.');
      const { generatePersona } = await import('./suno/client.ts');
      const created = await generatePersona({
        taskId: ids.taskId,
        audioId: ids.audioId,
        name,
        description,
        style: text(req.body.style, 300) || undefined,
        vocalStart: req.body.vocalStart != null ? Number(req.body.vocalStart) : undefined,
        vocalEnd: req.body.vocalEnd != null ? Number(req.body.vocalEnd) : undefined,
      });
      const personaId = created.data?.personaId;
      if (!personaId) throw new SunoError(502, 'Suno did not return a persona id.');
      const provenance = await rememberPersona(asset.id, personaId);
      res.json({ personaId, provenance });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/assets/:id/voice', async (req, res, next) => {
    try {
      const asset = assetOrThrow(req.params.id);
      const voiceId = text(req.body.voiceId, 120);
      if (!voiceId) throw new SunoError(400, 'Saving a voice needs the voice id.');
      const provenance = await rememberVoice(asset.id, voiceId);
      res.json({ voiceId, provenance });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/assets/:id/lyrics-sync', async (req, res, next) => {
    try {
      requireSuno('lyrics_sync');
      const asset = assetOrThrow(req.params.id);
      const ids = sunoIds(asset.id);
      if (!ids.taskId || !ids.audioId) throw new SunoError(400, 'Aligned lyrics need a finished Suno track.');
      const record = await timestampedLyrics(ids.taskId, ids.audioId);
      const updated = await patchAsset(asset.id, { alignedLyrics: record.data });
      res.json({ asset: updated });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/assets/:id/artwork', async (req, res, next) => {
    try {
      requireSuno('cover_image');
      const asset = assetOrThrow(req.params.id);
      const ids = sunoIds(asset.id);
      if (!ids.taskId) throw new SunoError(400, 'Cover art needs the original Suno generation task.');
      const created = await generateCoverImage(ids.taskId, callbackUrl());
      res.status(202).json(await openTask('cover_image', { parentAssetId: asset.id }, taskIdOf(created)));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/assets/:id/recover', async (req, res, next) => {
    try {
      requireSuno('recovery');
      const asset = assetOrThrow(req.params.id);
      const ids = sunoIds(asset.id);
      if (!ids.taskId) throw new SunoError(400, 'Recovery needs the original Suno task id.');
      const created = await recoverAudio(ids.taskId, callbackUrl());
      res.status(202).json(await openTask('recovery', { parentAssetId: asset.id }, taskIdOf(created)));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/sounds', async (req, res, next) => {
    try {
      requireSuno('sounds');
      const prompt = text(req.body.prompt, 500);
      if (!prompt) throw new SunoError(400, 'Describe the sound.');
      const created = await generateSounds({
        prompt,
        model: text(req.body.model, 40, defaultModel()),
        callBackUrl: callbackUrl(),
        soundLoop: Boolean(req.body.soundLoop),
        soundTempo: req.body.soundTempo != null ? Number(req.body.soundTempo) : undefined,
        soundKey: typeof req.body.soundKey === 'string' ? req.body.soundKey : undefined,
        grabLyrics: Boolean(req.body.grabLyrics),
      });
      res.status(202).json(await openTask('sounds', { prompt, title: prompt.slice(0, 80) }, taskIdOf(created)));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/style', async (req, res, next) => {
    try {
      requireSuno('style');
      const content = text(req.body.content, 2000);
      if (!content) throw new SunoError(400, 'Describe the style you want boosted.');
      const record = await boostStyle(content);
      const result = (record.data as { result?: string } | undefined)?.result || '';
      res.json({ result });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/voice/validate', async (req, res, next) => {
    try {
      requireSuno('voice');
      const voiceUrl = text(req.body.voiceUrl, 500);
      if (!voiceUrl.startsWith('http')) throw new SunoError(400, 'Voice validation needs a public audio URL.');
      const created = await voiceValidate({
        voiceUrl,
        vocalStartS: Number(req.body.vocalStartS ?? 0),
        vocalEndS: Number(req.body.vocalEndS ?? 30),
        language: text(req.body.language, 16, 'en'),
        callBackUrl: callbackUrl(),
      });
      res.status(202).json(await openTask('voice', { phase: 'validate', voiceUrl }, taskIdOf(created)));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/voice/generate', async (req, res, next) => {
    try {
      requireSuno('voice');
      const sourceTaskId = text(req.body.taskId, 80);
      const verifyUrl = text(req.body.verifyUrl, 500);
      const voiceName = text(req.body.voiceName, 80);
      if (!sourceTaskId || !verifyUrl || !voiceName) throw new SunoError(400, 'Creating a voice needs the validation task, the spoken phrase URL, and a name.');
      const created = await voiceGenerate({
        taskId: sourceTaskId,
        verifyUrl,
        voiceName,
        description: text(req.body.description, 500),
        style: text(req.body.style, 300),
        singerSkillLevel: text(req.body.singerSkillLevel, 40, 'intermediate'),
        callBackUrl: callbackUrl(),
      });
      res.status(202).json(await openTask('voice', { phase: 'create', voiceName }, taskIdOf(created)));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/voice/regenerate', async (req, res, next) => {
    try {
      requireSuno('voice');
      const sourceTaskId = text(req.body.taskId, 80);
      if (!sourceTaskId) throw new SunoError(400, 'Regenerate needs the voice task id.');
      const created = await voiceRegenerate(sourceTaskId, callbackUrl());
      res.status(202).json(await openTask('voice', { phase: 'validate', regeneratedFrom: sourceTaskId }, taskIdOf(created)));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/voice/check', async (req, res, next) => {
    try {
      requireSuno('voice');
      const taskId = text(req.body.taskId, 80);
      if (!taskId) throw new SunoError(400, 'Check voice needs a task id.');
      const record = await voiceCheck(taskId);
      res.json(record.data || { isAvailable: false });
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/listings/:id/offers', async (req, res, next) => {
    try {
      const { updateOfferPrices } = await import('./catalog.ts');
      const prices = Array.isArray(req.body.offers) ? req.body.offers : [];
      res.json(await updateOfferPrices(req.params.id, prices));
    } catch (error) {
      next(error);
    }
  });
}
