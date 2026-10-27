import fs from 'node:fs';
import path from 'node:path';
import type { Database } from './store.ts';
import { studioAuth, update, uploadsDir } from './store.ts';
import { blankArrangement, ensureMixer, mergeNewTracks, seedArrangement, type Arrangement } from '../shared/arrange.ts';
import { defaultOffers, deriveOrigin, listingBlockers, platformFee } from '../shared/rights.ts';
import type {
  Asset,
  AssetKind,
  LicenseGrant,
  Listing,
  OriginKind,
  ProvenanceComponent,
  RightsDeclaration,
  Split,
  TaskKind,
  TrackView,
} from '../shared/types.ts';
import { readTracks, type SunoTrack } from './suno/client.ts';

export function marketplaceLive(): boolean {
  const enabled = String(process.env.MARKETPLACE_ENABLED || '').toLowerCase() === 'true';
  const terms = String(process.env.CREATOR_TERMS_VERSION || 'draft').trim();
  return enabled && terms.length > 0 && terms !== 'draft';
}

export function feeBps(): number {
  const parsed = Number(process.env.PLATFORM_FEE_BPS || 1000);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 5000) return 1000;
  return Math.round(parsed);
}

export function publicConfig() {
  const termsVersion = String(process.env.CREATOR_TERMS_VERSION || 'draft');
  return {
    sunoConfigured: Boolean(String(process.env.SUNO_API_KEY || '').trim()),
    model: String(process.env.SUNO_MODEL || 'V6'),
    marketplaceLive: marketplaceLive(),
    termsVersion,
    platformFeeBps: feeBps(),
    marketplaceNote: marketplaceLive()
      ? 'Checkout is enabled for this environment.'
      : 'Listings can be prepared. Checkout stays closed until creator terms and licence templates are counsel-reviewed. Red Face records the payment when that opens.',
  };
}

export function callbackUrl(): string {
  const base = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
  if (base) return `${base}/api/suno/callback`;
  return 'https://example.com/redsound-callback';
}

function id(): string {
  return crypto.randomUUID();
}

export function trackView(db: Database, assetId: string): TrackView | null {
  const asset = db.assets.find((item) => item.id === assetId);
  if (!asset) return null;
  return {
    ...asset,
    provenance: db.provenance.find((item) => item.assetId === asset.id),
    declaration: db.declarations.find((item) => item.assetId === asset.id),
    work: db.works.find((item) => item.id === asset.workId),
    recording: db.recordings.find((item) => item.id === asset.recordingId),
    splits: db.splits.filter((split) => split.subjectId === asset.workId || split.subjectId === asset.recordingId),
    clearances: db.clearances.filter((item) => item.assetId === asset.id),
    children: db.assets.filter((item) => item.parentAssetIds.includes(asset.id)),
  };
}

export function createProject(db: Database, title: string, assetIds: string[]) {
  const project = {
    id: id(),
    ownerId: db.profile.id,
    title,
    assetIds,
    createdAt: new Date().toISOString(),
  };
  db.projects.unshift(project);
  for (const assetId of assetIds) {
    const asset = db.assets.find((item) => item.id === assetId);
    if (asset) asset.projectId = project.id;
  }
  return project;
}

export function attachGeneratedTracks(
  db: Database,
  tracks: SunoTrack[],
  meta: {
    kind: AssetKind;
    origin: OriginKind;
    prompt?: string;
    lyrics?: string;
    style?: string;
    model?: string;
    providerJobId?: string;
    parentAssetIds?: string[];
    components?: ProvenanceComponent[];
    projectId?: string;
    titleFallback: string;
    bpm?: number;
    musicalKey?: string;
  },
): Asset[] {
  const created: Asset[] = [];
  for (const track of tracks) {
    if (db.provenance.some((item) => item.providerAudioId === track.id && item.providerJobId === meta.providerJobId)) {
      const existing = db.assets.find((asset) => db.provenance.find((item) => item.assetId === asset.id)?.providerAudioId === track.id);
      if (existing) created.push(existing);
      continue;
    }
    const workId = id();
    const recordingId = id();
    const assetId = id();
    const title = track.title || meta.titleFallback;
    const now = new Date().toISOString();
    db.works.unshift({ id: workId, title, lyrics: track.prompt || meta.lyrics, createdAt: now });
    db.recordings.unshift({ id: recordingId, title, workId, assetId, createdAt: now });
    const components = meta.components?.length
      ? meta.components
      : [{ role: meta.kind === 'vocal' ? 'vocal' : 'instrumental', origin: meta.origin, note: meta.style } satisfies ProvenanceComponent];
    const asset: Asset = {
      id: assetId,
      ownerId: db.profile.id,
      title,
      kind: meta.kind,
      bpm: meta.bpm,
      musicalKey: meta.musicalKey,
      durationSec: track.duration,
      audioUrl: track.audioUrl || track.streamAudioUrl,
      imageUrl: track.imageUrl,
      workId,
      recordingId,
      projectId: meta.projectId,
      parentAssetIds: meta.parentAssetIds || [],
      createdAt: now,
    };
    db.assets.unshift(asset);
    db.provenance.unshift({
      assetId,
      origin: deriveOrigin(components),
      provider: 'suno',
      providerJobId: meta.providerJobId,
      providerAudioId: track.id,
      model: track.modelName || meta.model,
      prompt: meta.prompt,
      lyrics: meta.lyrics || track.prompt,
      style: meta.style || track.tags,
      components,
      createdAt: now,
    });
    if (meta.projectId) {
      const project = db.projects.find((item) => item.id === meta.projectId);
      if (project && !project.assetIds.includes(assetId)) project.assetIds.push(assetId);
    }
    created.push(asset);
  }
  return created;
}

export async function openTask(kind: TaskKind, request: Record<string, unknown>, sunoTaskId?: string) {
  return update((db) => {
    const now = new Date().toISOString();
    const task = {
      id: id(),
      ownerId: db.profile.id,
      kind,
      sunoTaskId,
      status: 'PENDING',
      assetIds: [],
      request,
      createdAt: now,
      updatedAt: now,
    };
    db.tasks.unshift(task);
    return task;
  });
}

export async function saveUpload(input: {
  filename: string;
  contentType: string;
  dataBase64: string;
  title: string;
  kind: AssetKind;
  origin: OriginKind;
  parentAssetId?: string;
  bpm?: number;
  musicalKey?: string;
  durationSec?: number;
}): Promise<Asset> {
  const bytes = Buffer.from(input.dataBase64, 'base64');
  if (bytes.length === 0 || bytes.length > 20 * 1024 * 1024) {
    throw new Error('Upload must be between 1 byte and 20 MB.');
  }
  const mediaId = id();
  const ext = path.extname(input.filename || '').slice(0, 8) || '.bin';
  fs.writeFileSync(path.join(uploadsDir(), `${mediaId}${ext}`), bytes);
  const auth = studioAuth();
  let hosted: string | undefined;
  if (auth) {
    try {
      hosted = await publishRecording(auth.token, `${auth.ownerId}/${mediaId}${ext}`, bytes, input.contentType);
    } catch {
      hosted = undefined;
    }
  }
  return update((db) => {
    const now = new Date().toISOString();
    const workId = id();
    const recordingId = id();
    const assetId = id();
    const parent = input.parentAssetId ? db.assets.find((item) => item.id === input.parentAssetId) : undefined;
    const components: ProvenanceComponent[] = [{
      role: input.kind === 'vocal' ? 'vocal' : input.kind === 'beat' ? 'instrumental' : 'mix',
      origin: input.origin,
    }];
    if (parent) {
      const parentProvenance = db.provenance.find((item) => item.assetId === parent.id);
      components.unshift({
        role: 'instrumental',
        origin: parentProvenance?.origin || 'imported',
        assetId: parent.id,
      });
    }
    db.works.unshift({ id: workId, title: input.title, createdAt: now });
    db.recordings.unshift({ id: recordingId, title: input.title, workId, assetId, createdAt: now });
    const asset: Asset = {
      id: assetId,
      ownerId: db.profile.id,
      title: input.title,
      kind: input.kind,
      bpm: input.bpm,
      musicalKey: input.musicalKey,
      durationSec: input.durationSec,
      mediaId,
      mimeType: input.contentType || 'application/octet-stream',
      audioUrl: hosted || `/api/media/${mediaId}`,
      workId,
      recordingId,
      projectId: parent?.projectId,
      parentAssetIds: parent ? [parent.id] : [],
      createdAt: now,
    };
    db.assets.unshift(asset);
    db.provenance.unshift({
      assetId,
      origin: deriveOrigin(components),
      provider: input.origin === 'human_created' ? 'microphone' : 'upload',
      components,
      createdAt: now,
    });
    if (parent?.projectId) {
      const project = db.projects.find((item) => item.id === parent.projectId);
      if (project && !project.assetIds.includes(assetId)) project.assetIds.push(assetId);
    } else if (parent) {
      createProject(db, parent.title, [parent.id, assetId]);
    } else {
      createProject(db, input.title, [assetId]);
    }
    return asset;
  });
}

export function mediaPath(mediaId: string): string | null {
  const dir = uploadsDir();
  const match = fs.readdirSync(dir).find((name) => name.startsWith(mediaId));
  return match ? path.join(dir, match) : null;
}

export async function setTaskResult(localId: string, status: string, payload: unknown, options?: { kind?: AssetKind; titleFallback?: string }) {
  return update((db) => {
    const task = db.tasks.find((item) => item.id === localId || item.sunoTaskId === localId);
    if (!task) return null;
    task.status = status;
    task.updatedAt = new Date().toISOString();
    if (status === 'SUCCESS' || status === 'FIRST_SUCCESS') {
      const request = task.request;
      let tracks = readTracks(payload);
      if (request.single === true) {
        const playable = tracks.filter((track) => track.audioUrl || track.streamAudioUrl);
        tracks = (playable.length ? playable : tracks).slice(0, 1);
      }
      const assets = attachGeneratedTracks(db, tracks, {
        kind: options?.kind || kindForTask(task.kind),
        origin: 'ai_generated',
        prompt: typeof request.prompt === 'string' ? request.prompt : undefined,
        lyrics: typeof request.lyrics === 'string' ? request.lyrics : undefined,
        style: typeof request.style === 'string' ? request.style : undefined,
        model: typeof request.model === 'string' ? request.model : undefined,
        providerJobId: task.sunoTaskId,
        parentAssetIds: typeof request.parentAssetId === 'string' ? [request.parentAssetId] : [],
        titleFallback: options?.titleFallback || 'Untitled',
        projectId: task.projectId,
        bpm: typeof request.bpm === 'number' ? request.bpm : undefined,
        musicalKey: typeof request.musicalKey === 'string' ? request.musicalKey : undefined,
      });
      task.assetIds = [...new Set([...task.assetIds, ...assets.map((asset) => asset.id)])];
      if (!task.projectId && assets[0]) {
        const project = createProject(db, assets[0].title, task.assetIds);
        task.projectId = project.id;
        for (const asset of assets) asset.projectId = project.id;
      }
    }
    return task;
  });
}

function kindForTask(kind: TaskKind): AssetKind {
  if (kind === 'lyrics') return 'lyrics';
  if (kind === 'vocal_removal') return 'stem';
  if (kind === 'sounds') return 'sample';
  if (kind === 'add_vocals' || kind === 'upload_cover' || kind === 'mashup' || kind === 'replace_section') return 'song';
  return 'beat';
}

export function studioSessions(db: Database) {
  const listed = new Set(db.projects.flatMap((project) => project.assetIds));
  const sessions = db.projects.map((project) => ({
    ...project,
    assets: project.assetIds.map((assetId) => trackView(db, assetId)).filter((asset): asset is TrackView => Boolean(asset)),
  }));
  for (const asset of db.assets) {
    if (asset.parentAssetIds.length > 0 || asset.projectId || listed.has(asset.id)) continue;
    const ids = [asset.id, ...db.assets.filter((child) => child.parentAssetIds.includes(asset.id)).map((child) => child.id)];
    sessions.push({
      id: asset.id,
      ownerId: asset.ownerId,
      title: asset.title,
      assetIds: ids,
      createdAt: asset.createdAt,
      assets: ids.map((assetId) => trackView(db, assetId)).filter((item): item is TrackView => Boolean(item)),
    });
  }
  return sessions;
}

export async function deleteSession(sessionId: string) {
  const removed = await update((db) => {
    const project = db.projects.find((item) => item.id === sessionId);
    const anchor = project
      ? project.assetIds
      : db.assets.some((asset) => asset.id === sessionId)
        ? [sessionId]
        : null;
    if (!anchor) return null;
    const ids = new Set(anchor);
    let grew = true;
    while (grew) {
      grew = false;
      for (const asset of db.assets) {
        if (ids.has(asset.id)) continue;
        if (asset.projectId === sessionId || asset.parentAssetIds.some((parent) => ids.has(parent))) {
          ids.add(asset.id);
          grew = true;
        }
      }
    }
    const keptElsewhere = new Set(
      db.projects.filter((item) => item.id !== project?.id).flatMap((item) => item.assetIds),
    );
    for (const assetId of [...ids]) {
      if (keptElsewhere.has(assetId)) ids.delete(assetId);
    }
    const files = db.assets
      .filter((asset) => ids.has(asset.id))
      .map((asset) => ({ audioUrl: asset.audioUrl, mediaId: asset.mediaId }));
    db.assets = db.assets.filter((asset) => !ids.has(asset.id));
    if (project) db.projects = db.projects.filter((item) => item.id !== project.id);
    db.arrangements = db.arrangements.filter((item) => !ids.has(item.id));
    db.provenance = db.provenance.filter((item) => !ids.has(item.assetId));
    db.recordings = db.recordings.filter((item) => !ids.has(item.assetId));
    db.tasks = db.tasks.map((task) => ({
      ...task,
      assetIds: task.assetIds.filter((assetId) => !ids.has(assetId)),
      projectId: task.projectId === sessionId ? undefined : task.projectId,
    }));
    return files;
  });
  if (!removed) return false;
  for (const file of removed) {
    if (file.mediaId) {
      try {
        const local = mediaPath(file.mediaId);
        if (local) fs.unlinkSync(local);
      } catch {
        // The local copy is already gone.
      }
    }
    if (file.audioUrl) await dropStored(file.audioUrl);
  }
  return true;
}

async function dropStored(audioUrl: string) {
  const auth = studioAuth();
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!auth?.token || !base || !key) return;
  const marker = '/redsound-audio/';
  const index = audioUrl.indexOf(marker);
  if (index < 0) return;
  const objectPath = decodeURIComponent(audioUrl.slice(index + marker.length).split('?')[0]);
  if (!objectPath.startsWith(`${auth.ownerId}/`)) return;
  await fetch(`${base}/storage/v1/object/redsound-audio/${objectPath}`, {
    method: 'DELETE',
    headers: { apikey: key, Authorization: `Bearer ${auth.token}` },
  }).catch(() => undefined);
}

export async function openSession(input: { title: string; bpm: number; musicalKey: string }) {
  return update((db) => {
    const now = new Date().toISOString();
    const assetId = id();
    const title = input.title.trim().slice(0, 80) || 'Untitled session';
    const bpm = input.bpm > 0 ? input.bpm : 120;
    const musicalKey = input.musicalKey.trim().slice(0, 16) || 'C Minor';
    db.assets.unshift({
      id: assetId,
      ownerId: db.profile.id,
      title,
      kind: 'vocal',
      bpm,
      musicalKey,
      parentAssetIds: [],
      createdAt: now,
    });
    const project = createProject(db, title, [assetId]);
    db.arrangements.unshift(blankArrangement(assetId, bpm));
    return {
      ...project,
      assets: [trackView(db, assetId)].filter((asset): asset is TrackView => Boolean(asset)),
    };
  });
}

export interface StemFile {
  name: string;
  url: string;
}

export function stemFilesFromPayload(payload: unknown): StemFile[] {
  const root = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const data = (root.data && typeof root.data === 'object' ? root.data : root) as Record<string, unknown>;
  const response = (data.response && typeof data.response === 'object' ? data.response : data) as Record<string, unknown>;
  const info = (data.vocal_removal_info || response.vocal_removal_info || response) as Record<string, unknown>;
  const files: StemFile[] = [];
  const named: Record<string, string> = {
    vocal_url: 'Vocals',
    vocalUrl: 'Vocals',
    instrumental_url: 'Instrumental',
    instrumentalUrl: 'Instrumental',
    backing_vocals_url: 'Backing vocals',
    backingVocalsUrl: 'Backing vocals',
    drums_url: 'Drums',
    drumsUrl: 'Drums',
    bass_url: 'Bass',
    bassUrl: 'Bass',
    guitar_url: 'Guitar',
    guitarUrl: 'Guitar',
    keyboard_url: 'Keyboard',
    keyboardUrl: 'Keyboard',
    percussion_url: 'Percussion',
    percussionUrl: 'Percussion',
    strings_url: 'Strings',
    stringsUrl: 'Strings',
    synth_url: 'Synth',
    synthUrl: 'Synth',
    fx_url: 'FX',
    fxUrl: 'FX',
    brass_url: 'Brass',
    brassUrl: 'Brass',
    woodwinds_url: 'Woodwinds',
    woodwindsUrl: 'Woodwinds',
  };
  for (const [key, label] of Object.entries(named)) {
    const url = info[key];
    if (typeof url === 'string' && url.startsWith('http')) files.push({ name: label, url });
  }
  const originData = (info.origin_data || info.originData) as unknown;
  if (Array.isArray(originData)) {
    for (const group of originData) {
      const record = group as Record<string, unknown>;
      for (const side of ['extract', 'remove'] as const) {
        const entry = record[side] as Record<string, unknown> | undefined;
        const url = entry?.audio_url;
        const stem = String(entry?.stem_type_group_name || 'Stem');
        if (typeof url === 'string' && url.startsWith('http')) {
          files.push({ name: `${stem} (${side})`, url });
        }
      }
    }
  }
  const seen = new Set<string>();
  return files.filter((file) => {
    const key = `${file.name}:${file.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function storeStemFiles(taskId: string, parentAssetId: string, files: StemFile[]) {
  return update((db) => {
    const parent = db.assets.find((item) => item.id === parentAssetId);
    const task = db.tasks.find((item) => item.id === taskId);
    if (!parent || !task) return [];
    const created: Asset[] = [];
    for (const file of files) {
      const already = db.assets.find((asset) => asset.audioUrl === file.url && asset.parentAssetIds.includes(parent.id));
      if (already) {
        created.push(already);
        continue;
      }
      const now = new Date().toISOString();
      const asset: Asset = {
        id: id(),
        ownerId: db.profile.id,
        title: `${parent.title} — ${file.name}`,
        kind: 'stem',
        stemName: file.name,
        audioUrl: file.url,
        workId: parent.workId,
        recordingId: parent.recordingId,
        projectId: parent.projectId,
        parentAssetIds: [parent.id],
        createdAt: now,
      };
      db.assets.unshift(asset);
      db.provenance.unshift({
        assetId: asset.id,
        origin: 'ai_generated',
        provider: 'suno',
        providerJobId: task.sunoTaskId,
        model: 'stem-separation',
        components: [{ role: 'stem', origin: 'ai_generated', assetId: parent.id, note: file.name }],
        createdAt: now,
      });
      if (parent.projectId) {
        const project = db.projects.find((item) => item.id === parent.projectId);
        if (project && !project.assetIds.includes(asset.id)) project.assetIds.push(asset.id);
      }
      created.push(asset);
    }
    task.assetIds = created.map((asset) => asset.id);
    task.status = 'SUCCESS';
    task.updatedAt = new Date().toISOString();
    return created;
  });
}

export async function saveDeclaration(assetId: string, declaration: Omit<RightsDeclaration, 'assetId' | 'signedAt'>) {
  return update((db) => {
    const next: RightsDeclaration = { ...declaration, assetId, signedAt: new Date().toISOString() };
    db.declarations = db.declarations.filter((item) => item.assetId !== assetId);
    db.declarations.push(next);
    return next;
  });
}

export async function addClearance(assetId: string, source: string, proofNote: string) {
  return update((db) => {
    const clearance = { id: id(), assetId, source, proofNote, createdAt: new Date().toISOString() };
    db.clearances.push(clearance);
    return clearance;
  });
}

export async function replaceSplits(subjectType: Split['subjectType'], subjectId: string, rows: Array<Pick<Split, 'name' | 'role' | 'shareBps'>>) {
  return update((db) => {
    db.splits = db.splits.filter((split) => !(split.subjectType === subjectType && split.subjectId === subjectId));
    const next = rows.map((row) => ({ ...row, id: id(), subjectType, subjectId }));
    db.splits.push(...next);
    return next;
  });
}

export async function acknowledgeProviderTerms(assetId: string) {
  return update((db) => {
    const provenance = db.provenance.find((item) => item.assetId === assetId);
    if (!provenance) throw new Error('No provenance on this asset.');
    provenance.providerTermsAcknowledgedAt = new Date().toISOString();
    return provenance;
  });
}

export async function prepareListing(assetIds: string[], offersInput?: Listing['offers']): Promise<Listing> {
  return update((db) => {
    const assets = assetIds.map((assetId) => db.assets.find((item) => item.id === assetId)).filter((item): item is Asset => Boolean(item));
    if (!assets.length) throw new Error('Choose at least one asset.');
    const primary = assets[0];
    const view = trackView(db, primary.id);
    const blockers = listingBlockers({
      splits: db.splits,
      workId: primary.workId,
      recordingId: primary.recordingId,
      declaration: view?.declaration,
      clearances: view?.clearances || [],
      provenance: view?.provenance,
      marketplaceLive: marketplaceLive(),
    });
    const onlyLegalHold = blockers.length > 0 && blockers.every((line) => /counsel-reviewed/.test(line));
    const listing: Listing = {
      id: id(),
      assetIds: assets.map((asset) => asset.id),
      sellerId: db.profile.id,
      title: primary.title,
      genre: view?.provenance?.style,
      bpm: primary.bpm,
      musicalKey: primary.musicalKey,
      status: blockers.length === 0 ? 'published' : onlyLegalHold ? 'held_for_counsel' : 'draft',
      offers: offersInput?.length ? offersInput : defaultOffers(primary.title),
      holdReasons: blockers,
      createdAt: new Date().toISOString(),
    };
    db.listings.unshift(listing);
    return listing;
  });
}

export async function storeLyrics(localTaskId: string, items: Array<{ title?: string; text?: string; status?: string }>) {
  return update((db) => {
    const task = db.tasks.find((item) => item.id === localTaskId);
    if (!task) return [];
    const created: Asset[] = [];
    for (const item of items) {
      if (!item.text) continue;
      const now = new Date().toISOString();
      const workId = crypto.randomUUID();
      const assetId = crypto.randomUUID();
      const title = item.title || 'Lyrics';
      db.works.unshift({ id: workId, title, lyrics: item.text, createdAt: now });
      const asset: Asset = {
        id: assetId,
        ownerId: db.profile.id,
        title,
        kind: 'lyrics',
        workId,
        parentAssetIds: [],
        createdAt: now,
      };
      db.assets.unshift(asset);
      db.provenance.unshift({
        assetId,
        origin: 'ai_generated',
        provider: 'suno',
        providerJobId: task.sunoTaskId,
        prompt: typeof task.request.prompt === 'string' ? task.request.prompt : undefined,
        lyrics: item.text,
        components: [{ role: 'lyrics', origin: 'ai_generated' }],
        createdAt: now,
      });
      created.push(asset);
    }
    task.assetIds = created.map((asset) => asset.id);
    task.status = created.length ? 'SUCCESS' : task.status;
    task.updatedAt = new Date().toISOString();
    return created;
  });
}

export async function purchase(listingId: string, offerId: string, buyerName: string): Promise<LicenseGrant> {
  if (!marketplaceLive()) {
    throw new Error('Checkout is closed. Red Sound will send the buyer to Red Face after counsel-reviewed terms are in place.');
  }
  return update((db) => {
    const listing = db.listings.find((item) => item.id === listingId);
    if (!listing || (listing.status !== 'published' && listing.status !== 'held_for_counsel')) {
      throw new Error('This listing is not on sale.');
    }
    if (listing.holdReasons.length) throw new Error(listing.holdReasons[0]);
    const offer = listing.offers.find((item) => item.id === offerId);
    if (!offer) throw new Error('Unknown licence.');
    const fees = platformFee(offer.priceCents, feeBps());
    db.grantSeq += 1;
    const now = new Date().toISOString();
    const grant: LicenseGrant = {
      id: id(),
      number: `RS-${String(db.grantSeq).padStart(6, '0')}`,
      listingId: listing.id,
      offerId: offer.id,
      assetId: listing.assetIds[0],
      buyerName: buyerName.trim() || 'Buyer',
      licenseTier: offer.tier,
      priceCents: offer.priceCents,
      platformFeeCents: fees.platformFeeCents,
      creatorShareCents: fees.creatorShareCents,
      currency: 'ZAR',
      status: 'active',
      purchasedAt: now,
      paymentProvider: 'redface',
    };
    db.grants.unshift(grant);
    db.ledger.unshift(
      {
        id: id(),
        grantId: grant.id,
        kind: 'sale',
        amountCents: grant.priceCents,
        currency: 'ZAR',
        party: 'buyer',
        note: `${grant.number} ${offer.name}`,
        createdAt: now,
      },
      {
        id: id(),
        grantId: grant.id,
        kind: 'platform_fee',
        amountCents: grant.platformFeeCents,
        currency: 'ZAR',
        party: 'platform',
        note: 'Red Sound commission',
        createdAt: now,
      },
      {
        id: id(),
        grantId: grant.id,
        kind: 'creator_share',
        amountCents: grant.creatorShareCents,
        currency: 'ZAR',
        party: 'creator',
        note: 'Creator share, payout via Red Face',
        createdAt: now,
      },
    );
    if (offer.exclusive) listing.status = 'sold_exclusive';
    return grant;
  });
}

export async function updateOfferPrices(listingId: string, prices: Array<{ id: string; priceCents: number }>) {
  return update((db) => {
    const listing = db.listings.find((item) => item.id === listingId);
    if (!listing) throw new Error('Listing not found.');
    if (listing.status === 'sold_exclusive') throw new Error('This exclusive listing is already sold.');
    for (const price of prices) {
      const offer = listing.offers.find((item) => item.id === price.id);
      if (!offer) continue;
      const cents = Math.round(Number(price.priceCents));
      if (!Number.isFinite(cents) || cents < 0) throw new Error('A licence price has to be zero or more.');
      offer.priceCents = cents;
    }
    return listing;
  });
}

export async function patchAsset(assetId: string, patch: Partial<Pick<Asset, 'wavUrl' | 'imageUrl' | 'audioUrl' | 'midiData' | 'alignedLyrics'>>) {
  return update((db) => {
    const asset = db.assets.find((item) => item.id === assetId);
    if (!asset) throw new Error('Asset not found.');
    Object.assign(asset, patch);
    return asset;
  });
}

export async function rememberPersona(assetId: string, personaId: string) {
  return update((db) => {
    const provenance = db.provenance.find((item) => item.assetId === assetId);
    if (!provenance) throw new Error('This track has no provenance record.');
    provenance.personaId = personaId;
    return provenance;
  });
}

export async function rememberVoice(assetId: string, voiceId: string) {
  return update((db) => {
    const provenance = db.provenance.find((item) => item.assetId === assetId);
    if (!provenance) throw new Error('This track has no provenance record.');
    provenance.voiceId = voiceId;
    return provenance;
  });
}

export async function completeSideTask(localId: string, status: string, extra?: { error?: string; assetIds?: string[]; request?: Record<string, unknown> }) {
  return update((db) => {
    const task = db.tasks.find((item) => item.id === localId);
    if (!task) return null;
    task.status = status;
    task.error = extra?.error;
    if (extra?.assetIds) task.assetIds = extra.assetIds;
    if (extra?.request) task.request = { ...task.request, ...extra.request };
    task.updatedAt = new Date().toISOString();
    return task;
  });
}

async function publishRecording(token: string, objectPath: string, bytes: Buffer, contentType: string): Promise<string | undefined> {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = String(process.env.SUPABASE_PUBLISHABLE_KEY || '').trim();
  if (!url || !key) return undefined;
  const response = await fetch(`${url}/storage/v1/object/redsound-audio/${objectPath}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      'Content-Type': contentType || 'application/octet-stream',
      'x-upsert': 'true',
    },
    body: new Uint8Array(bytes),
  });
  if (!response.ok) return undefined;
  return `${url}/storage/v1/object/public/redsound-audio/${objectPath}`;
}

export function hostedAudioUrl(asset: Asset): string | undefined {
  if (asset.audioUrl?.startsWith('http')) return asset.audioUrl;
  const base = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
  if (base && asset.mediaId) return `${base}/api/media/${asset.mediaId}`;
  return undefined;
}

export function applyRecoveredUrls(tracks: Array<{ id?: string; audio_url?: string; status?: string }>) {
  return update((db) => {
    let updated = 0;
    for (const track of tracks) {
      if (track.status !== 'success' || !track.audio_url || !track.id) continue;
      const provenance = db.provenance.find((item) => item.providerAudioId === track.id);
      if (!provenance) continue;
      const asset = db.assets.find((item) => item.id === provenance.assetId);
      if (!asset) continue;
      asset.audioUrl = track.audio_url;
      updated += 1;
    }
    return updated;
  });
}

function sessionAssets(db: Database, assetId: string) {
  const asset = db.assets.find((item) => item.id === assetId);
  if (!asset) return [];
  const ids = new Set<string>([asset.id]);
  if (asset.projectId) {
    const project = db.projects.find((item) => item.id === asset.projectId);
    for (const id of project?.assetIds || []) ids.add(id);
  }
  for (const item of db.assets) {
    if (item.parentAssetIds.includes(asset.id) || item.id === asset.id) ids.add(item.id);
  }
  return [...ids].map((id) => db.assets.find((item) => item.id === id)).filter((item): item is NonNullable<typeof item> => Boolean(item));
}

export function readArrangement(db: Database, assetId: string): Arrangement | null {
  if (!db.assets.some((asset) => asset.id === assetId)) return null;
  const assets = sessionAssets(db, assetId).filter((asset) => asset.audioUrl || asset.kind === 'lyrics');
  const stored = (db.arrangements || []).find((item) => item.id === assetId);
  if (assets.length === 0) return stored ? ensureMixer(stored) : null;
  const bpm = assets.find((asset) => asset.bpm)?.bpm || 120;
  const seeded = seedArrangement(assetId, bpm, assets.map((asset) => ({
    id: asset.id,
    title: asset.title,
    stemName: asset.stemName,
    durationSec: asset.durationSec,
    kind: asset.kind,
  })));
  return ensureMixer(stored ? mergeNewTracks(stored, seeded) : seeded);
}

export async function saveArrangement(assetId: string, arrangement: Arrangement) {
  return update((db) => {
    if (!db.assets.some((asset) => asset.id === assetId)) throw new Error('Session not found.');
    const next = { ...arrangement, id: assetId };
    const index = db.arrangements.findIndex((item) => item.id === assetId);
    if (index >= 0) db.arrangements[index] = next;
    else db.arrangements.unshift(next);
    return next;
  });
}
