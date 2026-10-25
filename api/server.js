var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// server/store.ts
import fs from "node:fs";
import path from "node:path";
function emptyDb() {
  return {
    profile: { id: "local-creator", displayName: "Creator", handle: "creator" },
    works: [],
    recordings: [],
    assets: [],
    provenance: [],
    splits: [],
    declarations: [],
    clearances: [],
    listings: [],
    grants: [],
    ledger: [],
    projects: [],
    tasks: [],
    arrangements: [],
    grantSeq: 0
  };
}
function read() {
  try {
    const raw = fs.readFileSync(dbPath, "utf8");
    return { ...emptyDb(), ...JSON.parse(raw) };
  } catch {
    return emptyDb();
  }
}
function write(db) {
  fs.mkdirSync(dataDir, { recursive: true });
  const tmp = `${dbPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, dbPath);
}
function update(mutate) {
  const run = queue.then(() => {
    const db = read();
    const result = mutate(db);
    write(db);
    return result;
  });
  queue = run.then(
    () => void 0,
    () => void 0
  );
  return run;
}
function view() {
  return read();
}
function uploadsDir() {
  const dir = path.join(dataDir, "uploads");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
var dataDir, dbPath, queue;
var init_store = __esm({
  "server/store.ts"() {
    "use strict";
    dataDir = process.env.VERCEL ? path.join("/tmp", "redsound") : path.resolve(process.cwd(), "data");
    dbPath = path.join(dataDir, "db.json");
    queue = Promise.resolve();
  }
});

// shared/arrange.ts
function seedArrangement(id2, bpm, assets, newId = () => crypto.randomUUID()) {
  const tempo = bpm > 0 ? bpm : 120;
  const tracks = assets.map((asset) => {
    const duration = asset.durationSec && asset.durationSec > 0.05 ? asset.durationSec : 4;
    return {
      id: newId(),
      name: (asset.stemName || asset.title || asset.kind || "Track").toUpperCase(),
      assetId: asset.id,
      muted: false,
      solo: false,
      volume: 0.8,
      pan: 0,
      clips: [{
        id: newId(),
        assetId: asset.id,
        name: asset.stemName || asset.title,
        startSec: 0,
        offsetSec: 0,
        durationSec: duration,
        fadeInSec: 0,
        fadeOutSec: 0
      }]
    };
  });
  const span = 8;
  const names = ["Intro", "Verse", "Chorus", "Outro"];
  return ensureMixer({
    id: id2,
    bpm: tempo,
    snap: "beat",
    tracks,
    sections: names.map((name, index) => ({
      id: newId(),
      name,
      startSec: index * span,
      endSec: (index + 1) * span
    }))
  }, newId);
}
function effectChain(newId) {
  return EFFECT_TYPES.map((type) => ({ id: newId(), type, enabled: false, amount: 0.45 }));
}
function guessRole(name) {
  const label = name.toLowerCase();
  if (label.includes("adlib")) return "adlib";
  if (label.includes("back")) return "backing";
  if (label.includes("double")) return "double";
  if (label.includes("vocal") || label.includes("voice")) return "lead";
  if (label.includes("drum") || label.includes("kick") || label.includes("snare")) return "drums";
  if (label.includes("bass")) return "bass";
  if (label.includes("fx")) return "fx";
  return "beat";
}
function busFor(role, vocalBusId, drumBusId) {
  if (role === "lead" || role === "backing" || role === "adlib" || role === "double") return vocalBusId;
  if (role === "drums" || role === "beat") return drumBusId;
  return void 0;
}
function ensureMixer(arrangement, newId = () => crypto.randomUUID()) {
  const channels = [...arrangement.channels || []];
  function need(role, name, kind) {
    const found = channels.find((channel) => channel.role === role && channel.kind === kind);
    if (found) return found;
    const created = {
      id: newId(),
      name,
      kind,
      role,
      volume: kind === "master" ? 0.9 : 0.85,
      pan: 0,
      muted: false,
      effects: kind === "channel" ? effectChain(newId) : kind === "master" ? [{ id: newId(), type: "compressor", enabled: false, amount: 0.55 }] : []
    };
    channels.push(created);
    return created;
  }
  need("master", "Master", "master");
  const vocalBus = need("vocal-bus", "Vocal bus", "bus");
  const drumBus = need("drum-bus", "Drum bus", "bus");
  const tracks = arrangement.tracks.map((track) => {
    if (track.channelId && channels.some((channel2) => channel2.id === track.channelId)) return track;
    const role = guessRole(track.name);
    const channel = {
      id: newId(),
      name: track.name,
      kind: "channel",
      role,
      volume: track.volume,
      pan: track.pan,
      muted: false,
      effects: effectChain(newId),
      busId: busFor(role, vocalBus.id, drumBus.id)
    };
    channels.push(channel);
    return { ...track, channelId: channel.id };
  });
  return { ...arrangement, tracks, channels };
}
function mergeNewTracks(stored, seeded) {
  const known = new Set(stored.tracks.map((track) => track.assetId));
  const extra = seeded.tracks.filter((track) => !known.has(track.assetId));
  if (extra.length === 0) return stored;
  return { ...stored, tracks: [...stored.tracks, ...extra] };
}
var EFFECT_TYPES;
var init_arrange = __esm({
  "shared/arrange.ts"() {
    "use strict";
    EFFECT_TYPES = ["eq", "compressor", "de-esser", "saturation", "reverb", "delay"];
  }
});

// shared/rights.ts
function deriveOrigin(components) {
  if (components.length === 0) return "imported";
  const kinds = new Set(components.map((component) => component.origin));
  const hasHuman = kinds.has("human_created");
  const hasAi = kinds.has("ai_generated") || kinds.has("ai_assisted");
  if (hasHuman && hasAi) return "ai_assisted";
  if (hasAi && !hasHuman && !kinds.has("imported")) {
    return kinds.has("ai_assisted") && !kinds.has("ai_generated") ? "ai_assisted" : "ai_generated";
  }
  if (hasHuman && kinds.size === 1) return "human_created";
  if (kinds.size === 1 && kinds.has("imported")) return "imported";
  if (hasHuman && kinds.has("imported") && !hasAi) return "human_created";
  return "ai_assisted";
}
function splitIssues(splits, subjectType, subjectId, label) {
  const relevant = splits.filter((split) => split.subjectType === subjectType && split.subjectId === subjectId);
  if (relevant.length === 0) return [`Add ${label} rightsholders. Shares are a declaration, not a registration.`];
  const invalid = relevant.filter((split) => !Number.isInteger(split.shareBps) || split.shareBps <= 0 || split.shareBps > FULL_SHARE_BPS);
  if (invalid.length > 0) return [`Each ${label} share must be a whole number of basis points between 1 and 10000.`];
  const sum = relevant.reduce((total, split) => total + split.shareBps, 0);
  if (sum !== FULL_SHARE_BPS) {
    return [`${label} shares must total 100%. They currently total ${(sum / 100).toFixed(2)}%.`];
  }
  return [];
}
function declarationIssues(declaration, clearances) {
  if (!declaration?.signedAt) return ["Sign the rights declaration before this can be offered."];
  const issues = [];
  if (!declaration.createdThisWork) issues.push("Confirm you created this work, or that you control the right to offer it.");
  if (!declaration.controlsRecording) issues.push("Confirm you own or control the sound recording.");
  if (!declaration.contributorsPermitted) issues.push("Confirm you have permission from every contributor.");
  if (!declaration.acceptsResponsibility) issues.push("Accept responsibility for the rights in this upload.");
  if (declaration.usesSamples) {
    if (!declaration.samplesCleared) issues.push("Samples need a clearance before this can be offered.");
    if (clearances.length === 0) issues.push("Identify each sample source and the licence or permission you hold.");
  }
  return issues;
}
function provenanceIssues(provenance) {
  if (!provenance) return ["This asset has no provenance record."];
  if (provenance.origin === "ai_generated" || provenance.origin === "ai_assisted") {
    if (!provenance.providerTermsAcknowledgedAt) {
      return ["Acknowledge the generation terms before this session can be offered. Red Sound does not assign a copyright status to generated audio."];
    }
  }
  return [];
}
function listingBlockers(input) {
  const blockers = [
    ...input.workId ? splitIssues(input.splits, "work", input.workId, "Composition") : ["Link a musical work before offering a licence."],
    ...input.recordingId ? splitIssues(input.splits, "recording", input.recordingId, "Master") : ["Link a sound recording before offering a licence."],
    ...declarationIssues(input.declaration, input.clearances),
    ...provenanceIssues(input.provenance)
  ];
  if (!input.marketplaceLive) {
    blockers.push("Live sales stay off until counsel-reviewed creator terms and licence templates are in place.");
  }
  return blockers;
}
function platformFee(priceCents, feeBps2) {
  const platformFeeCents = Math.round(priceCents * feeBps2 / FULL_SHARE_BPS);
  return { platformFeeCents, creatorShareCents: priceCents - platformFeeCents };
}
function defaultOffers(title) {
  return [
    {
      id: crypto.randomUUID(),
      tier: "basic",
      name: "Basic",
      priceCents: 9900,
      currency: "ZAR",
      deliverables: ["mp3"],
      summary: `Personal, non-exclusive use of the MP3 for \u201C${title}\u201D. The creator sets the final terms.`,
      commercial: false,
      exclusive: false
    },
    {
      id: crypto.randomUUID(),
      tier: "premium",
      name: "Premium",
      priceCents: 29900,
      currency: "ZAR",
      deliverables: ["mp3", "wav"],
      summary: "WAV delivery for commercial use within the limits the creator writes into this licence.",
      commercial: true,
      exclusive: false
    },
    {
      id: crypto.randomUUID(),
      tier: "unlimited",
      name: "Unlimited",
      priceCents: 79900,
      currency: "ZAR",
      deliverables: ["mp3", "wav", "stems"],
      summary: "WAV and stems, commercial use, broader distribution. Still a licence, not an assignment.",
      commercial: true,
      exclusive: false
    },
    {
      id: crypto.randomUUID(),
      tier: "exclusive",
      name: "Exclusive",
      priceCents: 25e4,
      currency: "ZAR",
      deliverables: ["mp3", "wav", "stems"],
      summary: "Exclusive licence. The listing leaves the market after this sale.",
      commercial: true,
      exclusive: true
    }
  ];
}
var FULL_SHARE_BPS;
var init_rights = __esm({
  "shared/rights.ts"() {
    "use strict";
    FULL_SHARE_BPS = 1e4;
  }
});

// server/suno/client.ts
var client_exports = {};
__export(client_exports, {
  SunoError: () => SunoError,
  addInstrumental: () => addInstrumental,
  addVocals: () => addVocals,
  boostStyle: () => boostStyle,
  buildGenerateBody: () => buildGenerateBody,
  convertWav: () => convertWav,
  coverRecord: () => coverRecord,
  defaultModel: () => defaultModel,
  extendMusic: () => extendMusic,
  generateCoverImage: () => generateCoverImage,
  generateLyrics: () => generateLyrics,
  generateMidi: () => generateMidi,
  generateMusic: () => generateMusic,
  generatePersona: () => generatePersona,
  generateSounds: () => generateSounds,
  isTerminalFailure: () => isTerminalFailure,
  isTerminalSuccess: () => isTerminalSuccess,
  lyricsRecord: () => lyricsRecord,
  mashup: () => mashup,
  midiRecord: () => midiRecord,
  musicRecord: () => musicRecord,
  readTaskStatus: () => readTaskStatus,
  readTracks: () => readTracks,
  recoverAudio: () => recoverAudio,
  recoveryRecord: () => recoveryRecord,
  remainingCredits: () => remainingCredits,
  replaceSection: () => replaceSection,
  sunoBase: () => sunoBase,
  sunoConfigured: () => sunoConfigured,
  sunoRequest: () => sunoRequest,
  timestampedLyrics: () => timestampedLyrics,
  uploadCover: () => uploadCover,
  uploadExtend: () => uploadExtend,
  vocalRemoval: () => vocalRemoval,
  vocalRemovalRecord: () => vocalRemovalRecord,
  voiceCheck: () => voiceCheck,
  voiceGenerate: () => voiceGenerate,
  voiceRecordInfo: () => voiceRecordInfo,
  voiceRegenerate: () => voiceRegenerate,
  voiceValidate: () => voiceValidate,
  voiceValidateInfo: () => voiceValidateInfo,
  wavRecord: () => wavRecord
});
function sunoBase() {
  return String(process.env.SUNO_API_BASE_URL || "https://api.sunoapi.org").replace(/\/$/, "");
}
function sunoConfigured() {
  return Boolean(String(process.env.SUNO_API_KEY || "").trim());
}
function defaultModel() {
  return String(process.env.SUNO_MODEL || "V6").trim() || "V6";
}
function apiKey() {
  const key = String(process.env.SUNO_API_KEY || "").trim();
  if (!key) throw new SunoError(503, "SUNO_API_KEY is not configured on the server.");
  return key;
}
async function sunoRequest(method, path4, body) {
  const response = await fetch(`${sunoBase()}${path4}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      Accept: "application/json",
      ...body != null ? { "Content-Type": "application/json" } : {}
    },
    body: body != null ? JSON.stringify(body) : void 0
  });
  const text2 = await response.text();
  let json = { code: response.status, msg: text2 };
  try {
    json = text2 ? JSON.parse(text2) : { code: response.status };
  } catch {
    throw new SunoError(response.status, `Suno returned non-JSON (${response.status}).`);
  }
  if (json.code !== 200 && json.code !== 201) {
    throw new SunoError(json.code || response.status, json.msg || `Suno error ${json.code || response.status}`);
  }
  return json;
}
function readTracks(payload) {
  const root = asRecord(payload);
  const data = asRecord(root.data) ?? root;
  const response = asRecord(data.response);
  const list = asArray(data.data) || asArray(response?.sunoData) || asArray(response?.data) || asArray(data.sunoData) || [];
  return list.map(normalizeTrack).filter((track) => Boolean(track?.id));
}
function readTaskStatus(payload) {
  const root = asRecord(payload);
  const data = asRecord(root.data) ?? root;
  return String(data.status || data.successFlag || root.msg || "PENDING");
}
function isTerminalFailure(status) {
  return FAILED.has(status);
}
function isTerminalSuccess(status) {
  return status === "SUCCESS" || status === "FIRST_SUCCESS" || status === "TEXT_SUCCESS";
}
function normalizeTrack(value) {
  const track = asRecord(value);
  if (!track) return null;
  const id2 = String(track.id || track.audioId || "");
  if (!id2) return null;
  return {
    id: id2,
    audioUrl: stringOrUndefined(track.audio_url || track.audioUrl),
    streamAudioUrl: stringOrUndefined(track.stream_audio_url || track.streamAudioUrl),
    imageUrl: stringOrUndefined(track.image_url || track.imageUrl),
    title: stringOrUndefined(track.title),
    tags: stringOrUndefined(track.tags),
    prompt: stringOrUndefined(track.prompt),
    duration: typeof track.duration === "number" ? track.duration : void 0,
    modelName: stringOrUndefined(track.model_name || track.modelName)
  };
}
function buildGenerateBody(input) {
  const model = input.model || defaultModel();
  const customMode = Boolean(input.customMode);
  const instrumental = Boolean(input.instrumental);
  const body = {
    customMode,
    instrumental,
    model,
    callBackUrl: input.callBackUrl
  };
  if (customMode) {
    const style = (input.style || "").trim();
    const lyrics = (input.lyrics || input.prompt || "").trim();
    const negativeTags = (input.negativeTags || "").trim();
    if (!style && !lyrics && !negativeTags) {
      throw new SunoError(400, "Custom mode needs a style, lyrics, or negative tags.");
    }
    if (style) body.style = style.slice(0, 1e3);
    if (!instrumental && lyrics) body.lyrics = lyrics.slice(0, 5e3);
    if (negativeTags) body.negativeTags = negativeTags.slice(0, 1e3);
    if (input.title) body.title = input.title.trim().slice(0, 80);
    if (input.vocalGender && !instrumental) body.vocalGender = input.vocalGender;
    if (input.duration != null) body.duration = clamp(input.duration, 10, 360);
  } else {
    const prompt = (input.prompt || "").trim();
    const style = (input.style || "").trim();
    const lyrics = (input.lyrics || "").trim();
    if (!prompt && !style && !lyrics) {
      throw new SunoError(400, "Describe the track, or attach a style or lyrics.");
    }
    if (prompt) body.prompt = prompt.slice(0, 3e3);
    if (style) body.style = style.slice(0, 1e3);
    if (lyrics) body.lyrics = lyrics.slice(0, 5e3);
  }
  if (input.personaId) {
    body.personaId = input.personaId;
    body.personaModel = input.personaModel || "style_persona";
  }
  return body;
}
function generateMusic(input) {
  return sunoRequest("POST", "/api/v1/generate", buildGenerateBody(input));
}
function extendMusic(body) {
  return sunoRequest("POST", "/api/v1/generate/extend", body);
}
function uploadCover(body) {
  return sunoRequest("POST", "/api/v1/generate/upload-cover", body);
}
function uploadExtend(body) {
  return sunoRequest("POST", "/api/v1/generate/upload-extend", body);
}
function addVocals(body) {
  return sunoRequest("POST", "/api/v1/generate/add-vocals", body);
}
function addInstrumental(body) {
  return sunoRequest("POST", "/api/v1/generate/add-instrumental", body);
}
function replaceSection(body) {
  return sunoRequest("POST", "/api/v1/generate/replace-section", body);
}
function mashup(body) {
  return sunoRequest("POST", "/api/v1/generate/mashup", body);
}
function generatePersona(body) {
  return sunoRequest("POST", "/api/v1/generate/generate-persona", body);
}
function generateLyrics(prompt, callBackUrl) {
  return sunoRequest("POST", "/api/v1/lyrics", { prompt: prompt.slice(0, 200), callBackUrl });
}
function generateSounds(body) {
  return sunoRequest("POST", "/api/v1/generate/sounds", body);
}
function boostStyle(content) {
  return sunoRequest("POST", "/api/v1/style/generate", { content });
}
function vocalRemoval(body) {
  return sunoRequest("POST", "/api/v1/vocal-removal/generate", body);
}
function convertWav(body) {
  return sunoRequest("POST", "/api/v1/wav/generate", body);
}
function generateMidi(body) {
  return sunoRequest("POST", "/api/v1/midi/generate", body);
}
function musicRecord(taskId) {
  return sunoRequest("GET", `/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`);
}
function lyricsRecord(taskId) {
  return sunoRequest("GET", `/api/v1/lyrics/record-info?taskId=${encodeURIComponent(taskId)}`);
}
function vocalRemovalRecord(taskId) {
  return sunoRequest("GET", `/api/v1/vocal-removal/record-info?taskId=${encodeURIComponent(taskId)}`);
}
function wavRecord(taskId) {
  return sunoRequest("GET", `/api/v1/wav/record-info?taskId=${encodeURIComponent(taskId)}`);
}
function midiRecord(taskId) {
  return sunoRequest("GET", `/api/v1/midi/record-info?taskId=${encodeURIComponent(taskId)}`);
}
function remainingCredits() {
  return sunoRequest("GET", "/api/v1/generate/credit");
}
function timestampedLyrics(taskId, audioId) {
  return sunoRequest("POST", "/api/v1/generate/get-timestamped-lyrics", { taskId, audioId });
}
function generateCoverImage(taskId, callBackUrl) {
  return sunoRequest("POST", "/api/v1/suno/cover/generate", { taskId, callBackUrl });
}
function coverRecord(taskId) {
  return sunoRequest("GET", `/api/v1/suno/cover/record-info?taskId=${encodeURIComponent(taskId)}`);
}
function recoverAudio(sunoTaskId, callBackUrl) {
  return sunoRequest("POST", "/api/v1/suno/recovery", { sunoTaskId, callBackUrl });
}
function recoveryRecord(taskId) {
  return sunoRequest("GET", `/api/v1/suno/recovery/record-info?task_id=${encodeURIComponent(taskId)}`);
}
function voiceValidate(body) {
  return sunoRequest("POST", "/api/v1/voice/validate", body);
}
function voiceValidateInfo(taskId) {
  return sunoRequest("GET", `/api/v1/voice/validate-info?taskId=${encodeURIComponent(taskId)}`);
}
function voiceGenerate(body) {
  return sunoRequest("POST", "/api/v1/voice/generate", body);
}
function voiceRecordInfo(taskId) {
  return sunoRequest("GET", `/api/v1/voice/record-info?taskId=${encodeURIComponent(taskId)}`);
}
function voiceRegenerate(taskId, calBackUrl) {
  return sunoRequest("POST", "/api/v1/voice/regenerate", { taskId, calBackUrl });
}
function voiceCheck(taskId) {
  return sunoRequest("POST", "/api/v1/voice/check-voice", { task_id: taskId });
}
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function asArray(value) {
  return Array.isArray(value) ? value : null;
}
function stringOrUndefined(value) {
  return typeof value === "string" && value.trim() ? value : void 0;
}
var FAILED, SunoError;
var init_client = __esm({
  "server/suno/client.ts"() {
    "use strict";
    FAILED = /* @__PURE__ */ new Set([
      "CREATE_TASK_FAILED",
      "GENERATE_AUDIO_FAILED",
      "GENERATE_LYRICS_FAILED",
      "GENERATE_WAV_FAILED",
      "CALLBACK_EXCEPTION",
      "SENSITIVE_WORD_ERROR",
      "FAILED"
    ]);
    SunoError = class extends Error {
      code;
      constructor(code, message) {
        super(message);
        this.code = code;
      }
    };
  }
});

// server/catalog.ts
var catalog_exports = {};
__export(catalog_exports, {
  acknowledgeProviderTerms: () => acknowledgeProviderTerms,
  addClearance: () => addClearance,
  applyRecoveredUrls: () => applyRecoveredUrls,
  attachGeneratedTracks: () => attachGeneratedTracks,
  callbackUrl: () => callbackUrl,
  completeSideTask: () => completeSideTask,
  createProject: () => createProject,
  feeBps: () => feeBps,
  hostedAudioUrl: () => hostedAudioUrl,
  marketplaceLive: () => marketplaceLive,
  mediaPath: () => mediaPath,
  openTask: () => openTask,
  patchAsset: () => patchAsset,
  prepareListing: () => prepareListing,
  publicConfig: () => publicConfig,
  purchase: () => purchase,
  readArrangement: () => readArrangement,
  rememberPersona: () => rememberPersona,
  rememberVoice: () => rememberVoice,
  replaceSplits: () => replaceSplits,
  saveArrangement: () => saveArrangement,
  saveDeclaration: () => saveDeclaration,
  saveUpload: () => saveUpload,
  setTaskResult: () => setTaskResult,
  stemFilesFromPayload: () => stemFilesFromPayload,
  storeLyrics: () => storeLyrics,
  storeStemFiles: () => storeStemFiles,
  studioSessions: () => studioSessions,
  trackView: () => trackView,
  updateOfferPrices: () => updateOfferPrices
});
import fs2 from "node:fs";
import path2 from "node:path";
function marketplaceLive() {
  const enabled = String(process.env.MARKETPLACE_ENABLED || "").toLowerCase() === "true";
  const terms = String(process.env.CREATOR_TERMS_VERSION || "draft").trim();
  return enabled && terms.length > 0 && terms !== "draft";
}
function feeBps() {
  const parsed = Number(process.env.PLATFORM_FEE_BPS || 1e3);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 5e3) return 1e3;
  return Math.round(parsed);
}
function publicConfig() {
  const termsVersion = String(process.env.CREATOR_TERMS_VERSION || "draft");
  return {
    sunoConfigured: Boolean(String(process.env.SUNO_API_KEY || "").trim()),
    model: String(process.env.SUNO_MODEL || "V6"),
    marketplaceLive: marketplaceLive(),
    termsVersion,
    platformFeeBps: feeBps(),
    marketplaceNote: marketplaceLive() ? "Checkout is enabled for this environment." : "Listings can be prepared. Checkout stays closed until creator terms and licence templates are counsel-reviewed. Red Face records the payment when that opens."
  };
}
function callbackUrl() {
  const base = String(process.env.PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
  if (base) return `${base}/api/suno/callback`;
  return "https://example.com/redsound-callback";
}
function id() {
  return crypto.randomUUID();
}
function trackView(db, assetId) {
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
    children: db.assets.filter((item) => item.parentAssetIds.includes(asset.id))
  };
}
function createProject(db, title, assetIds) {
  const project = {
    id: id(),
    ownerId: db.profile.id,
    title,
    assetIds,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  db.projects.unshift(project);
  for (const assetId of assetIds) {
    const asset = db.assets.find((item) => item.id === assetId);
    if (asset) asset.projectId = project.id;
  }
  return project;
}
function attachGeneratedTracks(db, tracks, meta) {
  const created = [];
  for (const track of tracks) {
    if (db.provenance.some((item) => item.providerAudioId === track.id && item.providerJobId === meta.providerJobId)) {
      const existing = db.assets.find((asset2) => db.provenance.find((item) => item.assetId === asset2.id)?.providerAudioId === track.id);
      if (existing) created.push(existing);
      continue;
    }
    const workId = id();
    const recordingId = id();
    const assetId = id();
    const title = track.title || meta.titleFallback;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    db.works.unshift({ id: workId, title, lyrics: track.prompt || meta.lyrics, createdAt: now });
    db.recordings.unshift({ id: recordingId, title, workId, assetId, createdAt: now });
    const components = meta.components?.length ? meta.components : [{ role: meta.kind === "vocal" ? "vocal" : "instrumental", origin: meta.origin, note: meta.style }];
    const asset = {
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
      createdAt: now
    };
    db.assets.unshift(asset);
    db.provenance.unshift({
      assetId,
      origin: deriveOrigin(components),
      provider: "suno",
      providerJobId: meta.providerJobId,
      providerAudioId: track.id,
      model: track.modelName || meta.model,
      prompt: meta.prompt,
      lyrics: meta.lyrics || track.prompt,
      style: meta.style || track.tags,
      components,
      createdAt: now
    });
    if (meta.projectId) {
      const project = db.projects.find((item) => item.id === meta.projectId);
      if (project && !project.assetIds.includes(assetId)) project.assetIds.push(assetId);
    }
    created.push(asset);
  }
  return created;
}
async function openTask(kind, request, sunoTaskId) {
  return update((db) => {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const task = {
      id: id(),
      ownerId: db.profile.id,
      kind,
      sunoTaskId,
      status: "PENDING",
      assetIds: [],
      request,
      createdAt: now,
      updatedAt: now
    };
    db.tasks.unshift(task);
    return task;
  });
}
async function saveUpload(input) {
  const bytes = Buffer.from(input.dataBase64, "base64");
  if (bytes.length === 0 || bytes.length > 20 * 1024 * 1024) {
    throw new Error("Upload must be between 1 byte and 20 MB.");
  }
  const mediaId = id();
  const ext = path2.extname(input.filename || "").slice(0, 8) || ".bin";
  fs2.writeFileSync(path2.join(uploadsDir(), `${mediaId}${ext}`), bytes);
  return update((db) => {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const workId = id();
    const recordingId = id();
    const assetId = id();
    const parent = input.parentAssetId ? db.assets.find((item) => item.id === input.parentAssetId) : void 0;
    const components = [{ role: input.kind === "vocal" ? "vocal" : "mix", origin: input.origin }];
    if (parent) {
      const parentProvenance = db.provenance.find((item) => item.assetId === parent.id);
      components.unshift({
        role: "instrumental",
        origin: parentProvenance?.origin || "imported",
        assetId: parent.id
      });
    }
    db.works.unshift({ id: workId, title: input.title, createdAt: now });
    db.recordings.unshift({ id: recordingId, title: input.title, workId, assetId, createdAt: now });
    const asset = {
      id: assetId,
      ownerId: db.profile.id,
      title: input.title,
      kind: input.kind,
      bpm: input.bpm,
      musicalKey: input.musicalKey,
      durationSec: input.durationSec,
      mediaId,
      mimeType: input.contentType || "application/octet-stream",
      audioUrl: `/api/media/${mediaId}`,
      workId,
      recordingId,
      projectId: parent?.projectId,
      parentAssetIds: parent ? [parent.id] : [],
      createdAt: now
    };
    db.assets.unshift(asset);
    db.provenance.unshift({
      assetId,
      origin: deriveOrigin(components),
      provider: input.origin === "human_created" ? "microphone" : "upload",
      components,
      createdAt: now
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
function mediaPath(mediaId) {
  const dir = uploadsDir();
  const match = fs2.readdirSync(dir).find((name) => name.startsWith(mediaId));
  return match ? path2.join(dir, match) : null;
}
async function setTaskResult(localId, status, payload, options) {
  return update((db) => {
    const task = db.tasks.find((item) => item.id === localId || item.sunoTaskId === localId);
    if (!task) return null;
    task.status = status;
    task.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    if (status === "SUCCESS" || status === "FIRST_SUCCESS") {
      const tracks = readTracks(payload);
      const request = task.request;
      const assets = attachGeneratedTracks(db, tracks, {
        kind: options?.kind || kindForTask(task.kind),
        origin: "ai_generated",
        prompt: typeof request.prompt === "string" ? request.prompt : void 0,
        lyrics: typeof request.lyrics === "string" ? request.lyrics : void 0,
        style: typeof request.style === "string" ? request.style : void 0,
        model: typeof request.model === "string" ? request.model : void 0,
        providerJobId: task.sunoTaskId,
        parentAssetIds: typeof request.parentAssetId === "string" ? [request.parentAssetId] : [],
        titleFallback: options?.titleFallback || "Untitled",
        projectId: task.projectId,
        bpm: typeof request.bpm === "number" ? request.bpm : void 0,
        musicalKey: typeof request.musicalKey === "string" ? request.musicalKey : void 0
      });
      task.assetIds = [.../* @__PURE__ */ new Set([...task.assetIds, ...assets.map((asset) => asset.id)])];
      if (!task.projectId && assets[0]) {
        const project = createProject(db, assets[0].title, task.assetIds);
        task.projectId = project.id;
        for (const asset of assets) asset.projectId = project.id;
      }
    }
    return task;
  });
}
function kindForTask(kind) {
  if (kind === "lyrics") return "lyrics";
  if (kind === "vocal_removal") return "stem";
  if (kind === "sounds") return "sample";
  if (kind === "add_vocals" || kind === "upload_cover" || kind === "mashup" || kind === "replace_section") return "song";
  return "beat";
}
function studioSessions(db) {
  const listed = new Set(db.projects.flatMap((project) => project.assetIds));
  const sessions = db.projects.map((project) => ({
    ...project,
    assets: project.assetIds.map((assetId) => trackView(db, assetId)).filter((asset) => Boolean(asset))
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
      assets: ids.map((assetId) => trackView(db, assetId)).filter((item) => Boolean(item))
    });
  }
  return sessions;
}
function stemFilesFromPayload(payload) {
  const root = payload && typeof payload === "object" ? payload : {};
  const data = root.data && typeof root.data === "object" ? root.data : root;
  const response = data.response && typeof data.response === "object" ? data.response : data;
  const info = data.vocal_removal_info || response.vocal_removal_info || response;
  const files = [];
  const named = {
    vocal_url: "Vocals",
    vocalUrl: "Vocals",
    instrumental_url: "Instrumental",
    instrumentalUrl: "Instrumental",
    backing_vocals_url: "Backing vocals",
    backingVocalsUrl: "Backing vocals",
    drums_url: "Drums",
    drumsUrl: "Drums",
    bass_url: "Bass",
    bassUrl: "Bass",
    guitar_url: "Guitar",
    guitarUrl: "Guitar",
    keyboard_url: "Keyboard",
    keyboardUrl: "Keyboard",
    percussion_url: "Percussion",
    percussionUrl: "Percussion",
    strings_url: "Strings",
    stringsUrl: "Strings",
    synth_url: "Synth",
    synthUrl: "Synth",
    fx_url: "FX",
    fxUrl: "FX",
    brass_url: "Brass",
    brassUrl: "Brass",
    woodwinds_url: "Woodwinds",
    woodwindsUrl: "Woodwinds"
  };
  for (const [key, label] of Object.entries(named)) {
    const url = info[key];
    if (typeof url === "string" && url.startsWith("http")) files.push({ name: label, url });
  }
  const originData = info.origin_data || info.originData;
  if (Array.isArray(originData)) {
    for (const group of originData) {
      const record = group;
      for (const side of ["extract", "remove"]) {
        const entry = record[side];
        const url = entry?.audio_url;
        const stem = String(entry?.stem_type_group_name || "Stem");
        if (typeof url === "string" && url.startsWith("http")) {
          files.push({ name: `${stem} (${side})`, url });
        }
      }
    }
  }
  const seen = /* @__PURE__ */ new Set();
  return files.filter((file) => {
    const key = `${file.name}:${file.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
async function storeStemFiles(taskId, parentAssetId, files) {
  return update((db) => {
    const parent = db.assets.find((item) => item.id === parentAssetId);
    const task = db.tasks.find((item) => item.id === taskId);
    if (!parent || !task) return [];
    const created = [];
    for (const file of files) {
      const already = db.assets.find((asset2) => asset2.audioUrl === file.url && asset2.parentAssetIds.includes(parent.id));
      if (already) {
        created.push(already);
        continue;
      }
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const asset = {
        id: id(),
        ownerId: db.profile.id,
        title: `${parent.title} \u2014 ${file.name}`,
        kind: "stem",
        stemName: file.name,
        audioUrl: file.url,
        workId: parent.workId,
        recordingId: parent.recordingId,
        projectId: parent.projectId,
        parentAssetIds: [parent.id],
        createdAt: now
      };
      db.assets.unshift(asset);
      db.provenance.unshift({
        assetId: asset.id,
        origin: "ai_generated",
        provider: "suno",
        providerJobId: task.sunoTaskId,
        model: "stem-separation",
        components: [{ role: "stem", origin: "ai_generated", assetId: parent.id, note: file.name }],
        createdAt: now
      });
      if (parent.projectId) {
        const project = db.projects.find((item) => item.id === parent.projectId);
        if (project && !project.assetIds.includes(asset.id)) project.assetIds.push(asset.id);
      }
      created.push(asset);
    }
    task.assetIds = created.map((asset) => asset.id);
    task.status = "SUCCESS";
    task.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    return created;
  });
}
async function saveDeclaration(assetId, declaration) {
  return update((db) => {
    const next = { ...declaration, assetId, signedAt: (/* @__PURE__ */ new Date()).toISOString() };
    db.declarations = db.declarations.filter((item) => item.assetId !== assetId);
    db.declarations.push(next);
    return next;
  });
}
async function addClearance(assetId, source, proofNote) {
  return update((db) => {
    const clearance = { id: id(), assetId, source, proofNote, createdAt: (/* @__PURE__ */ new Date()).toISOString() };
    db.clearances.push(clearance);
    return clearance;
  });
}
async function replaceSplits(subjectType, subjectId, rows) {
  return update((db) => {
    db.splits = db.splits.filter((split) => !(split.subjectType === subjectType && split.subjectId === subjectId));
    const next = rows.map((row) => ({ ...row, id: id(), subjectType, subjectId }));
    db.splits.push(...next);
    return next;
  });
}
async function acknowledgeProviderTerms(assetId) {
  return update((db) => {
    const provenance = db.provenance.find((item) => item.assetId === assetId);
    if (!provenance) throw new Error("No provenance on this asset.");
    provenance.providerTermsAcknowledgedAt = (/* @__PURE__ */ new Date()).toISOString();
    return provenance;
  });
}
async function prepareListing(assetIds, offersInput) {
  return update((db) => {
    const assets = assetIds.map((assetId) => db.assets.find((item) => item.id === assetId)).filter((item) => Boolean(item));
    if (!assets.length) throw new Error("Choose at least one asset.");
    const primary = assets[0];
    const view2 = trackView(db, primary.id);
    const blockers = listingBlockers({
      splits: db.splits,
      workId: primary.workId,
      recordingId: primary.recordingId,
      declaration: view2?.declaration,
      clearances: view2?.clearances || [],
      provenance: view2?.provenance,
      marketplaceLive: marketplaceLive()
    });
    const onlyLegalHold = blockers.length > 0 && blockers.every((line) => /counsel-reviewed/.test(line));
    const listing = {
      id: id(),
      assetIds: assets.map((asset) => asset.id),
      sellerId: db.profile.id,
      title: primary.title,
      genre: view2?.provenance?.style,
      bpm: primary.bpm,
      musicalKey: primary.musicalKey,
      status: blockers.length === 0 ? "published" : onlyLegalHold ? "held_for_counsel" : "draft",
      offers: offersInput?.length ? offersInput : defaultOffers(primary.title),
      holdReasons: blockers,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    db.listings.unshift(listing);
    return listing;
  });
}
async function storeLyrics(localTaskId, items) {
  return update((db) => {
    const task = db.tasks.find((item) => item.id === localTaskId);
    if (!task) return [];
    const created = [];
    for (const item of items) {
      if (!item.text) continue;
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const workId = crypto.randomUUID();
      const assetId = crypto.randomUUID();
      const title = item.title || "Lyrics";
      db.works.unshift({ id: workId, title, lyrics: item.text, createdAt: now });
      const asset = {
        id: assetId,
        ownerId: db.profile.id,
        title,
        kind: "lyrics",
        workId,
        parentAssetIds: [],
        createdAt: now
      };
      db.assets.unshift(asset);
      db.provenance.unshift({
        assetId,
        origin: "ai_generated",
        provider: "suno",
        providerJobId: task.sunoTaskId,
        prompt: typeof task.request.prompt === "string" ? task.request.prompt : void 0,
        lyrics: item.text,
        components: [{ role: "lyrics", origin: "ai_generated" }],
        createdAt: now
      });
      created.push(asset);
    }
    task.assetIds = created.map((asset) => asset.id);
    task.status = created.length ? "SUCCESS" : task.status;
    task.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    return created;
  });
}
async function purchase(listingId, offerId, buyerName) {
  if (!marketplaceLive()) {
    throw new Error("Checkout is closed. Red Sound will send the buyer to Red Face after counsel-reviewed terms are in place.");
  }
  return update((db) => {
    const listing = db.listings.find((item) => item.id === listingId);
    if (!listing || listing.status !== "published" && listing.status !== "held_for_counsel") {
      throw new Error("This listing is not on sale.");
    }
    if (listing.holdReasons.length) throw new Error(listing.holdReasons[0]);
    const offer = listing.offers.find((item) => item.id === offerId);
    if (!offer) throw new Error("Unknown licence.");
    const fees = platformFee(offer.priceCents, feeBps());
    db.grantSeq += 1;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const grant = {
      id: id(),
      number: `RS-${String(db.grantSeq).padStart(6, "0")}`,
      listingId: listing.id,
      offerId: offer.id,
      assetId: listing.assetIds[0],
      buyerName: buyerName.trim() || "Buyer",
      licenseTier: offer.tier,
      priceCents: offer.priceCents,
      platformFeeCents: fees.platformFeeCents,
      creatorShareCents: fees.creatorShareCents,
      currency: "ZAR",
      status: "active",
      purchasedAt: now,
      paymentProvider: "redface"
    };
    db.grants.unshift(grant);
    db.ledger.unshift(
      {
        id: id(),
        grantId: grant.id,
        kind: "sale",
        amountCents: grant.priceCents,
        currency: "ZAR",
        party: "buyer",
        note: `${grant.number} ${offer.name}`,
        createdAt: now
      },
      {
        id: id(),
        grantId: grant.id,
        kind: "platform_fee",
        amountCents: grant.platformFeeCents,
        currency: "ZAR",
        party: "platform",
        note: "Red Sound commission",
        createdAt: now
      },
      {
        id: id(),
        grantId: grant.id,
        kind: "creator_share",
        amountCents: grant.creatorShareCents,
        currency: "ZAR",
        party: "creator",
        note: "Creator share, payout via Red Face",
        createdAt: now
      }
    );
    if (offer.exclusive) listing.status = "sold_exclusive";
    return grant;
  });
}
async function updateOfferPrices(listingId, prices) {
  return update((db) => {
    const listing = db.listings.find((item) => item.id === listingId);
    if (!listing) throw new Error("Listing not found.");
    if (listing.status === "sold_exclusive") throw new Error("This exclusive listing is already sold.");
    for (const price of prices) {
      const offer = listing.offers.find((item) => item.id === price.id);
      if (!offer) continue;
      const cents = Math.round(Number(price.priceCents));
      if (!Number.isFinite(cents) || cents < 0) throw new Error("A licence price has to be zero or more.");
      offer.priceCents = cents;
    }
    return listing;
  });
}
async function patchAsset(assetId, patch) {
  return update((db) => {
    const asset = db.assets.find((item) => item.id === assetId);
    if (!asset) throw new Error("Asset not found.");
    Object.assign(asset, patch);
    return asset;
  });
}
async function rememberPersona(assetId, personaId) {
  return update((db) => {
    const provenance = db.provenance.find((item) => item.assetId === assetId);
    if (!provenance) throw new Error("This track has no provenance record.");
    provenance.personaId = personaId;
    return provenance;
  });
}
async function rememberVoice(assetId, voiceId) {
  return update((db) => {
    const provenance = db.provenance.find((item) => item.assetId === assetId);
    if (!provenance) throw new Error("This track has no provenance record.");
    provenance.voiceId = voiceId;
    return provenance;
  });
}
async function completeSideTask(localId, status, extra) {
  return update((db) => {
    const task = db.tasks.find((item) => item.id === localId);
    if (!task) return null;
    task.status = status;
    task.error = extra?.error;
    if (extra?.assetIds) task.assetIds = extra.assetIds;
    if (extra?.request) task.request = { ...task.request, ...extra.request };
    task.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    return task;
  });
}
function hostedAudioUrl(asset) {
  if (asset.audioUrl?.startsWith("http")) return asset.audioUrl;
  const base = String(process.env.PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
  if (base && asset.mediaId) return `${base}/api/media/${asset.mediaId}`;
  return void 0;
}
function applyRecoveredUrls(tracks) {
  return update((db) => {
    let updated = 0;
    for (const track of tracks) {
      if (track.status !== "success" || !track.audio_url || !track.id) continue;
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
function sessionAssets(db, assetId) {
  const asset = db.assets.find((item) => item.id === assetId);
  if (!asset) return [];
  const ids = /* @__PURE__ */ new Set([asset.id]);
  if (asset.projectId) {
    const project = db.projects.find((item) => item.id === asset.projectId);
    for (const id2 of project?.assetIds || []) ids.add(id2);
  }
  for (const item of db.assets) {
    if (item.parentAssetIds.includes(asset.id) || item.id === asset.id) ids.add(item.id);
  }
  return [...ids].map((id2) => db.assets.find((item) => item.id === id2)).filter((item) => Boolean(item));
}
function readArrangement(db, assetId) {
  const assets = sessionAssets(db, assetId).filter((asset) => asset.audioUrl || asset.kind === "lyrics");
  if (assets.length === 0) return null;
  const bpm = assets.find((asset) => asset.bpm)?.bpm || 120;
  const seeded = seedArrangement(assetId, bpm, assets.map((asset) => ({
    id: asset.id,
    title: asset.title,
    stemName: asset.stemName,
    durationSec: asset.durationSec,
    kind: asset.kind
  })));
  const stored = (db.arrangements || []).find((item) => item.id === assetId);
  return ensureMixer(stored ? mergeNewTracks(stored, seeded) : seeded);
}
async function saveArrangement(assetId, arrangement) {
  return update((db) => {
    if (!db.assets.some((asset) => asset.id === assetId)) throw new Error("Session not found.");
    const next = { ...arrangement, id: assetId };
    const index = db.arrangements.findIndex((item) => item.id === assetId);
    if (index >= 0) db.arrangements[index] = next;
    else db.arrangements.unshift(next);
    return next;
  });
}
var init_catalog = __esm({
  "server/catalog.ts"() {
    "use strict";
    init_store();
    init_arrange();
    init_rights();
    init_client();
  }
});

// server/index.ts
init_catalog();
init_store();
init_client();
import fs3 from "node:fs";
import path3 from "node:path";
import express from "express";

// server/actions.ts
init_catalog();
init_store();

// server/billing.ts
import { AsyncLocalStorage } from "node:async_hooks";

// shared/plans.ts
var SOUND_PLANS = [
  {
    id: "basic",
    name: "Basic",
    amountZar: 299,
    planCode: "PLN_wsyk1xw3iyx60vb",
    interval: "monthly",
    generations: 40,
    summary: "Make beats and songs.",
    includes: ["Generate tracks", "Draft lyrics", "Shape a style", "Import and record"]
  },
  {
    id: "premium",
    name: "Premium",
    amountZar: 399,
    planCode: "PLN_j4al5vfexbc4c3k",
    interval: "monthly",
    generations: 200,
    summary: "Arrange, split, and finish a record.",
    includes: ["Everything in Basic", "Extend, cover, and mashup", "Add voice or instruments", "Replace a section", "Stem splits and sound design"]
  },
  {
    id: "studio",
    name: "Studio",
    amountZar: 799,
    planCode: "PLN_f7r958mlhdudbhf",
    interval: "monthly",
    generations: 600,
    summary: "Voices, masters, and delivery files.",
    includes: ["Everything in Premium", "Save and create a voice", "Artwork and aligned lyrics", "WAV, MIDI, and audio restore"]
  }
];
var RANK = { basic: 1, premium: 2, studio: 3 };
var MINIMUM = {
  generate: "basic",
  lyrics: "basic",
  style: "basic",
  extend: "premium",
  upload_cover: "premium",
  upload_extend: "premium",
  add_vocals: "premium",
  add_instrumental: "premium",
  replace_section: "premium",
  mashup: "premium",
  vocal_removal: "premium",
  sounds: "premium",
  wav: "studio",
  midi: "studio",
  persona: "studio",
  cover_image: "studio",
  recovery: "studio",
  voice: "studio",
  lyrics_sync: "studio"
};
var UNMETERED = /* @__PURE__ */ new Set(["lyrics", "style", "lyrics_sync"]);
function soundPlan(id2) {
  return SOUND_PLANS.find((plan) => plan.id === id2) ?? null;
}
function planAllows(planId, gate) {
  if (!planId) return false;
  return RANK[planId] >= RANK[MINIMUM[gate]];
}
function planMeters(gate) {
  return !UNMETERED.has(gate);
}
function requiredPlanName(gate) {
  return soundPlan(MINIMUM[gate])?.name || "Basic";
}

// server/billing.ts
init_store();
var BillingError = class extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.code = code;
  }
};
var COMMERCE_BASE = String(
  process.env.REDFACE_COMMERCE_API_BASE || "https://bpzzgilwlkghgfkvkkxx.supabase.co/functions/v1/commerce-api"
).replace(/\/$/, "");
var accounts = new AsyncLocalStorage();
var ADMIN_EMAILS = new Set(
  String(process.env.ADMIN_EMAILS || "info@redfacepay.co.za").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean)
);
function bindAccount(req, next) {
  const email = String(req.get("x-redsound-account") || "").trim().toLowerCase();
  accounts.run(email, next);
}
function actorEmail() {
  return accounts.getStore() || String(view().profile.email || "").trim().toLowerCase();
}
function isAdmin() {
  return ADMIN_EMAILS.has(actorEmail());
}
function payConfigured() {
  return Boolean(String(process.env.REDFACE_API_KEY || "").trim());
}
function publicOrigin(req) {
  const configured = String(process.env.PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
  if (configured) return configured;
  const proto = req.get("x-forwarded-proto") || req.protocol;
  const host = req.get("x-forwarded-host") || req.get("host");
  return `${proto}://${host}`;
}
function currentSubscription() {
  const subscription = view().profile.subscription;
  if (!subscription || subscription.status !== "active") return null;
  if (subscription.currentPeriodEnd && Date.parse(subscription.currentPeriodEnd) < Date.now()) return null;
  return subscription;
}
function billingSnapshot() {
  const subscription = currentSubscription();
  const stored = view().profile.subscription;
  const plan = soundPlan(subscription?.planId);
  const admin = isAdmin();
  return {
    payConfigured: payConfigured(),
    payOrigin: "https://www.redfacepay.co.za",
    admin,
    accountEmail: actorEmail(),
    plans: SOUND_PLANS.map((item) => ({
      id: item.id,
      name: item.name,
      amountZar: item.amountZar,
      planCode: item.planCode,
      interval: item.interval,
      generations: item.generations,
      summary: item.summary,
      includes: [...item.includes]
    })),
    pendingPaymentId: stored?.status === "pending" ? stored.paymentId : void 0,
    subscription: admin ? {
      planId: "studio",
      planName: "Admin",
      status: "active",
      email: actorEmail(),
      generationsUsed: generationsUsed(),
      generations: 0
    } : subscription ? {
      planId: subscription.planId,
      planName: plan?.name || subscription.planId,
      status: subscription.status,
      email: subscription.email,
      currentPeriodEnd: subscription.currentPeriodEnd,
      generationsUsed: generationsUsed(),
      generations: plan?.generations || 0
    } : null
  };
}
function requireAccess(gate) {
  if (isAdmin()) return;
  const subscription = currentSubscription();
  const plan = soundPlan(subscription?.planId);
  if (!plan || !planAllows(plan.id, gate)) {
    throw new BillingError(402, `${requiredPlanName(gate)} is required for this. Subscribe through Redface Pay.`);
  }
  if (planMeters(gate) && generationsUsed() >= plan.generations) {
    throw new BillingError(402, `${plan.name} has used its ${plan.generations} generations for this month.`);
  }
}
async function startCheckout(planId, email, origin) {
  const plan = soundPlan(planId);
  if (!plan) throw new BillingError(400, "Choose Basic, Premium, or Studio.");
  const customer = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer)) throw new BillingError(400, "Enter a valid email for the receipt.");
  const key = String(process.env.REDFACE_API_KEY || "").trim();
  if (!key) throw new BillingError(503, "Redface Pay is not configured. Set REDFACE_API_KEY on the server.");
  const month = (/* @__PURE__ */ new Date()).toISOString().slice(0, 7);
  const response = await fetch(`${COMMERCE_BASE}/payments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `redsound:${plan.id}:${customer}:${month}`
    },
    body: JSON.stringify({
      ...process.env.REDFACE_BUSINESS_ID ? { business_id: process.env.REDFACE_BUSINESS_ID } : {},
      amount: plan.amountZar,
      currency: "ZAR",
      label: `Red Sound ${plan.name}`,
      metadata: {
        origin: "redsound",
        plan_id: plan.id,
        plan_code: plan.planCode,
        plan_name: plan.name,
        interval: plan.interval,
        amount_zar: plan.amountZar,
        customer_email: customer
      }
    })
  });
  const body = await response.json().catch(() => ({}));
  const paymentId = body.data?.payment_id;
  const checkoutUrl = body.data?.checkout_url;
  if (!response.ok || !body.ok || !paymentId || !checkoutUrl) {
    throw new BillingError(502, body.error || "Redface Pay did not start checkout.");
  }
  const pending = {
    planId: plan.id,
    planCode: plan.planCode,
    status: "pending",
    email: customer,
    paymentId
  };
  await update((db) => {
    db.profile.subscription = pending;
    return pending;
  });
  return { checkoutUrl: withReturn(checkoutUrl, origin, paymentId), paymentId, planId: plan.id };
}
async function confirmCheckout(paymentId) {
  const key = String(process.env.REDFACE_API_KEY || "").trim();
  if (!key) throw new BillingError(503, "Redface Pay is not configured. Set REDFACE_API_KEY on the server.");
  const id2 = paymentId.trim();
  if (!id2) throw new BillingError(400, "Missing payment.");
  const response = await fetch(`${COMMERCE_BASE}/payments/${encodeURIComponent(id2)}`, {
    headers: { Authorization: `Bearer ${key}` }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok) throw new BillingError(502, body.error || "Redface Pay could not confirm this payment.");
  const session = body.data?.session;
  const status = String(session?.status || body.data?.transaction?.status || body.data?.status || "").toLowerCase();
  const paid = Boolean(session?.paid_at) || ["paid", "success", "completed", "settled"].includes(status);
  if (!paid) return { active: false, status: status || "pending" };
  const saved = view().profile.subscription;
  if (saved?.paymentId && saved.paymentId !== id2) {
    throw new BillingError(400, "This payment does not match the plan waiting for checkout.");
  }
  const plan = soundPlan(saved?.planId) || SOUND_PLANS.find((item) => session?.label?.includes(item.name));
  if (!plan) throw new BillingError(400, "This payment is not a Red Sound plan.");
  const periodEnd = new Date(Date.now() + 32 * 24 * 60 * 60 * 1e3).toISOString();
  const subscription = {
    planId: plan.id,
    planCode: plan.planCode,
    status: "active",
    email: saved?.email || "",
    paymentId: id2,
    currentPeriodEnd: periodEnd
  };
  await update((db) => {
    db.profile.subscription = subscription;
    return subscription;
  });
  return { active: true, status: "active", planId: plan.id, currentPeriodEnd: periodEnd };
}
function generationsUsed() {
  const start = /* @__PURE__ */ new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const from = start.getTime();
  return view().tasks.filter((task) => planMeters(task.kind) && Date.parse(task.createdAt) >= from).length;
}
function withReturn(checkoutUrl, origin, paymentId) {
  try {
    const url = new URL(checkoutUrl);
    if (!url.searchParams.get("return_url") && !url.searchParams.get("callback_url")) {
      url.searchParams.set("return_url", `${origin}/plans?payment=${encodeURIComponent(paymentId)}`);
    }
    return url.toString();
  } catch {
    return checkoutUrl;
  }
}

// server/actions.ts
init_client();
function requireSuno(kind) {
  if (!sunoConfigured()) throw new SunoError(503, "Add SUNO_API_KEY on the server to use Suno.");
  requireAccess(kind);
}
function assetOrThrow(id2) {
  const asset = view().assets.find((item) => item.id === id2);
  if (!asset) throw new SunoError(404, "Track not found.");
  return asset;
}
function sunoIds(assetId) {
  const provenance = view().provenance.find((item) => item.assetId === assetId);
  return { audioId: provenance?.providerAudioId, taskId: provenance?.providerJobId };
}
function publicAudio(asset) {
  const url = hostedAudioUrl(asset);
  if (!url) {
    throw new SunoError(400, "Suno cannot read a file that only lives on this computer. Use a generated track, or set PUBLIC_BASE_URL to a host Suno can reach.");
  }
  return url;
}
function text(value, max, fallback = "") {
  const raw = typeof value === "string" ? value.trim() : fallback;
  return (raw || fallback).slice(0, max);
}
function taskIdOf(envelope) {
  const data = envelope.data;
  const id2 = data?.taskId || data?.task_id;
  if (!id2) throw new SunoError(502, "Suno did not return a task id.");
  return id2;
}
function flagOf(data) {
  const record = data && typeof data === "object" ? data : {};
  return String(record.successFlag ?? record.status ?? "");
}
async function refreshSideTask(existing) {
  const parent = typeof existing.request.parentAssetId === "string" ? existing.request.parentAssetId : void 0;
  if (existing.kind === "wav") {
    const record = await wavRecord(existing.sunoTaskId);
    const data = record.data;
    const flag = flagOf(data);
    if (flag === "SUCCESS" && data?.response?.audioWavUrl && parent) {
      await patchAsset(parent, { wavUrl: data.response.audioWavUrl });
      await completeSideTask(existing.id, "SUCCESS", { assetIds: [parent] });
    } else if (/FAIL|ERROR/i.test(flag)) {
      await completeSideTask(existing.id, flag || "FAILED", { error: data?.errorMessage || record.msg });
    } else {
      await completeSideTask(existing.id, flag || "PENDING");
    }
    return "handled";
  }
  if (existing.kind === "midi") {
    const record = await midiRecord(existing.sunoTaskId);
    const data = record.data;
    const flag = Number(data?.successFlag);
    if (flag === 1 && parent) {
      await patchAsset(parent, { midiData: data?.midiData ?? data });
      await completeSideTask(existing.id, "SUCCESS", { assetIds: [parent] });
    } else if (flag === 2 || flag === 3) {
      await completeSideTask(existing.id, "FAILED", { error: data?.errorMessage || record.msg });
    } else {
      await completeSideTask(existing.id, "PENDING");
    }
    return "handled";
  }
  if (existing.kind === "cover_image") {
    const record = await coverRecord(existing.sunoTaskId);
    const data = record.data;
    const flag = Number(data?.successFlag);
    const image = data?.response?.images?.[0];
    if (flag === 1 && image && parent) {
      await patchAsset(parent, { imageUrl: image });
      await completeSideTask(existing.id, "SUCCESS", { assetIds: [parent], request: { images: data?.response?.images } });
    } else if (flag === 3) {
      await completeSideTask(existing.id, "FAILED", { error: data?.errorMessage || record.msg });
    } else {
      await completeSideTask(existing.id, "PENDING");
    }
    return "handled";
  }
  if (existing.kind === "recovery") {
    const record = await recoveryRecord(existing.sunoTaskId);
    if (record.code === 201) {
      await completeSideTask(existing.id, "PENDING");
      return "handled";
    }
    const tracks = Array.isArray(record.data) ? record.data : [];
    if (record.code === 200 && tracks.length) {
      await applyRecoveredUrls(tracks);
      await completeSideTask(existing.id, "SUCCESS", { assetIds: parent ? [parent] : [] });
    } else if (record.code && record.code >= 400) {
      await completeSideTask(existing.id, "FAILED", { error: record.msg });
    } else {
      await completeSideTask(existing.id, "PENDING");
    }
    return "handled";
  }
  if (existing.kind === "voice") {
    const phase = existing.request.phase === "create" ? "create" : "validate";
    const record = phase === "create" ? await voiceRecordInfo(existing.sunoTaskId) : await voiceValidateInfo(existing.sunoTaskId);
    const data = record.data || {};
    const status = String(data.status || "");
    const ready = status === "success" || status === "wait_validating";
    const failed = status === "fail" || status.endsWith("_fail");
    await completeSideTask(existing.id, ready ? "SUCCESS" : failed ? "FAILED" : "PENDING", {
      error: failed ? data.failReason || data.errorMessage || record.msg : void 0,
      request: { voiceStatus: status, voiceId: data.voiceId, validateInfo: data.validateInfo }
    });
    return "handled";
  }
  return "music";
}
function registerProduce(app2) {
  app2.post("/api/assets/:id/cover", async (req, res, next) => {
    try {
      requireSuno("upload_cover");
      const asset = assetOrThrow(req.params.id);
      const url = publicAudio(asset);
      const created = await uploadCover({
        uploadUrl: url,
        customMode: true,
        instrumental: Boolean(req.body.instrumental),
        model: text(req.body.model, 40, defaultModel()),
        callBackUrl: callbackUrl(),
        style: text(req.body.style, 1e3, "Pop"),
        title: text(req.body.title, 80, asset.title),
        prompt: text(req.body.lyrics, 5e3)
      });
      res.status(202).json(await openTask("upload_cover", { parentAssetId: asset.id, title: text(req.body.title, 80, asset.title) }, taskIdOf(created)));
    } catch (error) {
      next(error);
    }
  });
  app2.post("/api/assets/:id/upload-extend", async (req, res, next) => {
    try {
      requireSuno("upload_extend");
      const asset = assetOrThrow(req.params.id);
      const created = await uploadExtend({
        uploadUrl: publicAudio(asset),
        defaultParamFlag: true,
        model: text(req.body.model, 40, defaultModel()),
        callBackUrl: callbackUrl(),
        continueAt: Number(req.body.continueAt ?? 30),
        style: text(req.body.style, 1e3, "Pop"),
        title: text(req.body.title, 80, asset.title),
        prompt: text(req.body.lyrics, 5e3)
      });
      res.status(202).json(await openTask("upload_extend", { parentAssetId: asset.id, title: asset.title }, taskIdOf(created)));
    } catch (error) {
      next(error);
    }
  });
  app2.post("/api/assets/:id/vocals", async (req, res, next) => {
    try {
      requireSuno("add_vocals");
      const asset = assetOrThrow(req.params.id);
      const style = text(req.body.style, 1e3);
      const negativeTags = text(req.body.negativeTags, 200, "silence");
      const title = text(req.body.title, 80, asset.title);
      if (!style) throw new SunoError(400, "Add vocals needs a style.");
      const created = await addVocals({
        uploadUrl: publicAudio(asset),
        model: text(req.body.model, 40, defaultModel()),
        callBackUrl: callbackUrl(),
        title,
        negativeTags,
        style,
        prompt: text(req.body.lyrics, 5e3),
        vocalGender: req.body.vocalGender === "f" || req.body.vocalGender === "m" ? req.body.vocalGender : void 0
      });
      res.status(202).json(await openTask("add_vocals", { parentAssetId: asset.id, title, style }, taskIdOf(created)));
    } catch (error) {
      next(error);
    }
  });
  app2.post("/api/assets/:id/instrumental", async (req, res, next) => {
    try {
      requireSuno("add_instrumental");
      const asset = assetOrThrow(req.params.id);
      const tags = text(req.body.tags, 1e3);
      const title = text(req.body.title, 80, asset.title);
      if (!tags) throw new SunoError(400, "Add instrumental needs tags, for example amapiano, log drum.");
      const created = await addInstrumental({
        uploadUrl: publicAudio(asset),
        model: text(req.body.model, 40, defaultModel()),
        callBackUrl: callbackUrl(),
        title,
        negativeTags: text(req.body.negativeTags, 200, "vocals"),
        tags,
        prompt: text(req.body.lyrics, 5e3)
      });
      res.status(202).json(await openTask("add_instrumental", { parentAssetId: asset.id, title, style: tags }, taskIdOf(created)));
    } catch (error) {
      next(error);
    }
  });
  app2.post("/api/assets/:id/replace", async (req, res, next) => {
    try {
      requireSuno("replace_section");
      const asset = assetOrThrow(req.params.id);
      const ids = sunoIds(asset.id);
      const start = Number(req.body.infillStartS);
      const end = Number(req.body.infillEndS);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 10) {
        throw new SunoError(400, "The replaced section has to be at least 10 seconds.");
      }
      const body = {
        prompt: text(req.body.prompt, 500, "replace this section"),
        tags: text(req.body.tags, 1e3, "Pop"),
        title: text(req.body.title, 80, asset.title),
        infillStartS: start,
        infillEndS: end,
        fullLyrics: text(req.body.fullLyrics, 5e3),
        callBackUrl: callbackUrl()
      };
      if (ids.taskId && ids.audioId) {
        body.taskId = ids.taskId;
        body.audioId = ids.audioId;
      } else {
        body.uploadUrl = publicAudio(asset);
        body.model = defaultModel();
      }
      const created = await replaceSection(body);
      res.status(202).json(await openTask("replace_section", { parentAssetId: asset.id, title: asset.title }, taskIdOf(created)));
    } catch (error) {
      next(error);
    }
  });
  app2.post("/api/mashup", async (req, res, next) => {
    try {
      requireSuno("mashup");
      const ids = Array.isArray(req.body.assetIds) ? req.body.assetIds.map(String).slice(0, 2) : [];
      if (ids.length !== 2) throw new SunoError(400, "A mashup needs exactly two tracks.");
      const urls = ids.map((id2) => publicAudio(assetOrThrow(id2)));
      const created = await mashup({
        uploadUrlList: urls,
        model: text(req.body.model, 40, defaultModel()),
        callBackUrl: callbackUrl()
      });
      res.status(202).json(await openTask("mashup", { parentAssetId: ids[0], title: "Mashup" }, taskIdOf(created)));
    } catch (error) {
      next(error);
    }
  });
  app2.post("/api/assets/:id/wav", async (req, res, next) => {
    try {
      requireSuno("wav");
      const asset = assetOrThrow(req.params.id);
      const ids = sunoIds(asset.id);
      if (!ids.taskId || !ids.audioId) throw new SunoError(400, "WAV conversion needs a finished Suno track.");
      const { convertWav: convertWav2 } = await Promise.resolve().then(() => (init_client(), client_exports));
      const created = await convertWav2({ taskId: ids.taskId, audioId: ids.audioId, callBackUrl: callbackUrl() });
      res.status(202).json(await openTask("wav", { parentAssetId: asset.id }, taskIdOf(created)));
    } catch (error) {
      next(error);
    }
  });
  app2.post("/api/assets/:id/midi", async (req, res, next) => {
    try {
      requireSuno("midi");
      const asset = assetOrThrow(req.params.id);
      const separation = [...view().tasks].reverse().find((task) => task.kind === "vocal_removal" && task.request.parentAssetId === asset.id && task.sunoTaskId && task.status === "SUCCESS");
      if (!separation?.sunoTaskId) {
        throw new SunoError(400, "MIDI needs a finished stem separation on this track. Run split_stem first.");
      }
      const created = await generateMidi({ taskId: separation.sunoTaskId, callBackUrl: callbackUrl() });
      res.status(202).json(await openTask("midi", { parentAssetId: asset.id }, taskIdOf(created)));
    } catch (error) {
      next(error);
    }
  });
  app2.post("/api/assets/:id/persona", async (req, res, next) => {
    try {
      requireSuno("persona");
      const asset = assetOrThrow(req.params.id);
      const ids = sunoIds(asset.id);
      if (!ids.taskId || !ids.audioId) throw new SunoError(400, "A persona needs a finished Suno track.");
      const name = text(req.body.name, 80);
      const description = text(req.body.description, 500);
      if (!name || !description) throw new SunoError(400, "A persona needs a name and a description.");
      const { generatePersona: generatePersona2 } = await Promise.resolve().then(() => (init_client(), client_exports));
      const created = await generatePersona2({
        taskId: ids.taskId,
        audioId: ids.audioId,
        name,
        description,
        style: text(req.body.style, 300) || void 0,
        vocalStart: req.body.vocalStart != null ? Number(req.body.vocalStart) : void 0,
        vocalEnd: req.body.vocalEnd != null ? Number(req.body.vocalEnd) : void 0
      });
      const personaId = created.data?.personaId;
      if (!personaId) throw new SunoError(502, "Suno did not return a persona id.");
      const provenance = await rememberPersona(asset.id, personaId);
      res.json({ personaId, provenance });
    } catch (error) {
      next(error);
    }
  });
  app2.post("/api/assets/:id/lyrics-sync", async (req, res, next) => {
    try {
      requireSuno("lyrics_sync");
      const asset = assetOrThrow(req.params.id);
      const ids = sunoIds(asset.id);
      if (!ids.taskId || !ids.audioId) throw new SunoError(400, "Aligned lyrics need a finished Suno track.");
      const record = await timestampedLyrics(ids.taskId, ids.audioId);
      const updated = await patchAsset(asset.id, { alignedLyrics: record.data });
      res.json({ asset: updated });
    } catch (error) {
      next(error);
    }
  });
  app2.post("/api/assets/:id/artwork", async (req, res, next) => {
    try {
      requireSuno("cover_image");
      const asset = assetOrThrow(req.params.id);
      const ids = sunoIds(asset.id);
      if (!ids.taskId) throw new SunoError(400, "Cover art needs the original Suno generation task.");
      const created = await generateCoverImage(ids.taskId, callbackUrl());
      res.status(202).json(await openTask("cover_image", { parentAssetId: asset.id }, taskIdOf(created)));
    } catch (error) {
      next(error);
    }
  });
  app2.post("/api/assets/:id/recover", async (req, res, next) => {
    try {
      requireSuno("recovery");
      const asset = assetOrThrow(req.params.id);
      const ids = sunoIds(asset.id);
      if (!ids.taskId) throw new SunoError(400, "Recovery needs the original Suno task id.");
      const created = await recoverAudio(ids.taskId, callbackUrl());
      res.status(202).json(await openTask("recovery", { parentAssetId: asset.id }, taskIdOf(created)));
    } catch (error) {
      next(error);
    }
  });
  app2.post("/api/sounds", async (req, res, next) => {
    try {
      requireSuno("sounds");
      const prompt = text(req.body.prompt, 500);
      if (!prompt) throw new SunoError(400, "Describe the sound.");
      const created = await generateSounds({
        prompt,
        model: text(req.body.model, 40, defaultModel()),
        callBackUrl: callbackUrl(),
        soundLoop: Boolean(req.body.soundLoop),
        soundTempo: req.body.soundTempo != null ? Number(req.body.soundTempo) : void 0,
        soundKey: typeof req.body.soundKey === "string" ? req.body.soundKey : void 0,
        grabLyrics: Boolean(req.body.grabLyrics)
      });
      res.status(202).json(await openTask("sounds", { prompt, title: prompt.slice(0, 80) }, taskIdOf(created)));
    } catch (error) {
      next(error);
    }
  });
  app2.post("/api/style", async (req, res, next) => {
    try {
      requireSuno("style");
      const content = text(req.body.content, 2e3);
      if (!content) throw new SunoError(400, "Describe the style you want boosted.");
      const record = await boostStyle(content);
      const result = record.data?.result || "";
      res.json({ result });
    } catch (error) {
      next(error);
    }
  });
  app2.post("/api/voice/validate", async (req, res, next) => {
    try {
      requireSuno("voice");
      const voiceUrl = text(req.body.voiceUrl, 500);
      if (!voiceUrl.startsWith("http")) throw new SunoError(400, "Voice validation needs a public audio URL.");
      const created = await voiceValidate({
        voiceUrl,
        vocalStartS: Number(req.body.vocalStartS ?? 0),
        vocalEndS: Number(req.body.vocalEndS ?? 30),
        language: text(req.body.language, 16, "en"),
        callBackUrl: callbackUrl()
      });
      res.status(202).json(await openTask("voice", { phase: "validate", voiceUrl }, taskIdOf(created)));
    } catch (error) {
      next(error);
    }
  });
  app2.post("/api/voice/generate", async (req, res, next) => {
    try {
      requireSuno("voice");
      const sourceTaskId = text(req.body.taskId, 80);
      const verifyUrl = text(req.body.verifyUrl, 500);
      const voiceName = text(req.body.voiceName, 80);
      if (!sourceTaskId || !verifyUrl || !voiceName) throw new SunoError(400, "Creating a voice needs the validation task, the spoken phrase URL, and a name.");
      const created = await voiceGenerate({
        taskId: sourceTaskId,
        verifyUrl,
        voiceName,
        description: text(req.body.description, 500),
        style: text(req.body.style, 300),
        singerSkillLevel: text(req.body.singerSkillLevel, 40, "intermediate"),
        callBackUrl: callbackUrl()
      });
      res.status(202).json(await openTask("voice", { phase: "create", voiceName }, taskIdOf(created)));
    } catch (error) {
      next(error);
    }
  });
  app2.post("/api/voice/regenerate", async (req, res, next) => {
    try {
      requireSuno("voice");
      const sourceTaskId = text(req.body.taskId, 80);
      if (!sourceTaskId) throw new SunoError(400, "Regenerate needs the voice task id.");
      const created = await voiceRegenerate(sourceTaskId, callbackUrl());
      res.status(202).json(await openTask("voice", { phase: "validate", regeneratedFrom: sourceTaskId }, taskIdOf(created)));
    } catch (error) {
      next(error);
    }
  });
  app2.post("/api/voice/check", async (req, res, next) => {
    try {
      requireSuno("voice");
      const taskId = text(req.body.taskId, 80);
      if (!taskId) throw new SunoError(400, "Check voice needs a task id.");
      const record = await voiceCheck(taskId);
      res.json(record.data || { isAvailable: false });
    } catch (error) {
      next(error);
    }
  });
  app2.patch("/api/listings/:id/offers", async (req, res, next) => {
    try {
      const { updateOfferPrices: updateOfferPrices2 } = await Promise.resolve().then(() => (init_catalog(), catalog_exports));
      const prices = Array.isArray(req.body.offers) ? req.body.offers : [];
      res.json(await updateOfferPrices2(req.params.id, prices));
    } catch (error) {
      next(error);
    }
  });
}

// server/index.ts
loadEnv();
var app = express();
app.use(express.json({ limit: "30mb" }));
app.use((req, _res, next) => bindAccount(req, next));
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "redsound" });
});
app.get("/api/config", (_req, res) => {
  res.json(publicConfig());
});
app.get("/api/billing", (_req, res) => {
  res.json(billingSnapshot());
});
app.post("/api/billing/checkout", async (req, res, next) => {
  try {
    const result = await startCheckout(String(req.body.planId || ""), String(req.body.email || ""), publicOrigin(req));
    res.json(result);
  } catch (error) {
    next(error);
  }
});
app.post("/api/billing/confirm", async (req, res, next) => {
  try {
    res.json(await confirmCheckout(String(req.body.paymentId || "")));
  } catch (error) {
    next(error);
  }
});
app.get("/api/profile", (_req, res) => {
  res.json(view().profile);
});
app.put("/api/profile", (req, res, next) => {
  let email;
  if (typeof req.body.email === "string") {
    email = req.body.email.trim().toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      next(new BillingError(400, "Enter a valid account email."));
      return;
    }
  }
  update((db) => {
    if (typeof req.body.displayName === "string" && req.body.displayName.trim()) {
      db.profile.displayName = req.body.displayName.trim().slice(0, 80);
    }
    if (typeof req.body.handle === "string" && req.body.handle.trim()) {
      db.profile.handle = req.body.handle.trim().replace(/^@/, "").slice(0, 40);
    }
    if (email !== void 0) db.profile.email = email;
    return db.profile;
  }).then((profile) => res.json(profile)).catch(next);
});
app.get("/api/library", (_req, res) => {
  const db = view();
  res.json(db.assets.map((asset) => trackView(db, asset.id)));
});
app.get("/api/assets/:id", (req, res) => {
  const db = view();
  const track = trackView(db, req.params.id);
  if (!track) return res.status(404).json({ error: "Asset not found." });
  res.json(track);
});
app.get("/api/assets/:id/arrangement", (req, res) => {
  const arrangement = readArrangement(view(), req.params.id);
  if (!arrangement) return res.status(404).json({ error: "Session not found." });
  res.json(arrangement);
});
app.put("/api/assets/:id/arrangement", async (req, res, next) => {
  try {
    res.json(await saveArrangement(req.params.id, req.body));
  } catch (error) {
    next(error);
  }
});
app.get("/api/media/:id", (req, res) => {
  const file = mediaPath(req.params.id);
  if (!file) return res.status(404).end();
  const asset = view().assets.find((item) => item.mediaId === req.params.id);
  res.type(asset?.mimeType || "application/octet-stream");
  fs3.createReadStream(file).pipe(res);
});
app.post("/api/assets/upload", async (req, res, next) => {
  try {
    const asset = await saveUpload({
      filename: String(req.body.filename || "upload.bin"),
      contentType: String(req.body.contentType || "application/octet-stream"),
      dataBase64: String(req.body.dataBase64 || ""),
      title: String(req.body.title || "Untitled").slice(0, 120),
      kind: oneOf(req.body.kind, ["beat", "song", "sample", "stem", "vocal", "full_mix"]) || "beat",
      origin: oneOf(req.body.origin, ["human_created", "imported"]) || "imported",
      parentAssetId: typeof req.body.parentAssetId === "string" ? req.body.parentAssetId : void 0,
      bpm: numberOrUndefined(req.body.bpm),
      musicalKey: typeof req.body.musicalKey === "string" ? req.body.musicalKey.slice(0, 16) : void 0,
      durationSec: numberOrUndefined(req.body.durationSec)
    });
    res.status(201).json(trackView(view(), asset.id));
  } catch (error) {
    next(error);
  }
});
app.post("/api/generate", async (req, res, next) => {
  try {
    requireSuno2();
    requireAccess("generate");
    const input = {
      prompt: req.body.prompt,
      lyrics: req.body.lyrics,
      style: req.body.style,
      title: req.body.title,
      instrumental: Boolean(req.body.instrumental),
      customMode: Boolean(req.body.customMode),
      model: typeof req.body.model === "string" ? req.body.model : defaultModel(),
      negativeTags: req.body.negativeTags,
      vocalGender: req.body.vocalGender === "m" || req.body.vocalGender === "f" ? req.body.vocalGender : void 0,
      duration: numberOrUndefined(req.body.duration),
      personaId: typeof req.body.personaId === "string" ? req.body.personaId.trim() : void 0,
      personaModel: req.body.personaModel === "voice_persona" ? "voice_persona" : req.body.personaId ? "style_persona" : void 0,
      callBackUrl: callbackUrl()
    };
    const body = buildGenerateBody(input);
    const created = await generateMusic(input);
    const taskId = created.data?.taskId;
    const task = await openTask("generate", {
      ...body,
      title: input.title,
      prompt: input.prompt,
      lyrics: input.lyrics,
      style: input.style,
      bpm: numberOrUndefined(req.body.bpm),
      musicalKey: typeof req.body.musicalKey === "string" ? req.body.musicalKey : void 0
    }, taskId);
    res.status(202).json(task);
  } catch (error) {
    next(error);
  }
});
app.post("/api/lyrics", async (req, res, next) => {
  try {
    requireSuno2();
    requireAccess("lyrics");
    const prompt = String(req.body.prompt || "").trim();
    if (!prompt) return res.status(400).json({ error: "Describe the lyrics." });
    const created = await generateLyrics(prompt, callbackUrl());
    const taskId = created.data?.taskId;
    const task = await openTask("lyrics", { prompt }, taskId);
    res.status(202).json(task);
  } catch (error) {
    next(error);
  }
});
app.post("/api/assets/:id/stems", async (req, res, next) => {
  try {
    const db = view();
    const asset = db.assets.find((item) => item.id === req.params.id);
    const provenance = db.provenance.find((item) => item.assetId === req.params.id);
    if (!asset) return res.status(404).json({ error: "Asset not found." });
    const type = oneOf(req.body.type, ["separate_vocal", "split_stem", "split_stem_advanced"]) || "separate_vocal";
    const payload = { type, callBackUrl: callbackUrl() };
    if (provenance?.provider === "suno" && provenance.providerJobId && provenance.providerAudioId) {
      payload.taskId = provenance.providerJobId;
      payload.audioId = provenance.providerAudioId;
    } else if (asset.audioUrl?.startsWith("http")) {
      payload.audioUrl = asset.audioUrl;
    } else {
      return res.status(400).json({ error: "Stem separation needs a Suno track or a public audio URL. Local recordings have to be hosted first." });
    }
    requireSuno2();
    requireAccess("vocal_removal");
    if (type === "split_stem_advanced") payload.stemName = String(req.body.stemName || "Lead Vocal");
    const task = await openTask("vocal_removal", { ...payload, parentAssetId: asset.id });
    const created = await vocalRemoval(payload);
    const sunoTaskId = created.data?.taskId;
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
app.post("/api/assets/:id/extend", async (req, res, next) => {
  try {
    const source = sourceAudio(req.params.id);
    requireSuno2();
    requireAccess("extend");
    const body = {
      audioId: source.audioId,
      taskId: source.taskId,
      model: typeof req.body.model === "string" ? req.body.model : defaultModel(),
      callBackUrl: callbackUrl(),
      lyrics: typeof req.body.lyrics === "string" ? req.body.lyrics : void 0,
      style: typeof req.body.style === "string" ? req.body.style : void 0,
      title: typeof req.body.title === "string" ? req.body.title : void 0,
      continueAt: numberOrUndefined(req.body.continueAt),
      instrumental: Boolean(req.body.instrumental)
    };
    const created = await extendMusic(body);
    const task = await openTask("extend", { ...body, parentAssetId: req.params.id }, created.data?.taskId);
    res.status(202).json(task);
  } catch (error) {
    next(error);
  }
});
app.post("/api/suno/:action", async (req, res, next) => {
  try {
    const action = req.params.action;
    if (action === "callback") {
      res.status(200).json({ status: "received" });
      void ingestCallback(req.body).catch((error) => console.error("Suno callback failed", error));
      return;
    }
    const body = { ...req.body, model: req.body.model || defaultModel(), callBackUrl: req.body.callBackUrl || callbackUrl() };
    const runners = {
      "upload-cover": uploadCover,
      "upload-extend": uploadExtend,
      "add-vocals": addVocals,
      "add-instrumental": addInstrumental,
      "replace-section": replaceSection,
      mashup,
      wav: convertWav
    };
    const run = runners[action];
    if (!run) return res.status(404).json({ error: "Unknown Suno action." });
    const kind = action === "wav" ? "wav" : action === "mashup" ? "mashup" : action === "add-vocals" ? "add_vocals" : action === "add-instrumental" ? "add_instrumental" : action === "replace-section" ? "replace_section" : action === "upload-cover" ? "upload_cover" : "upload_extend";
    requireSuno2();
    requireAccess(kind);
    const created = await run(body);
    const task = await openTask(kind, body, created.data?.taskId);
    res.status(202).json(task);
  } catch (error) {
    next(error);
  }
});
app.get("/api/tasks/:id", async (req, res, next) => {
  try {
    const task = await refreshTask(req.params.id);
    if (!task) return res.status(404).json({ error: "Task not found." });
    const db = view();
    res.json({ ...task, assets: task.assetIds.map((assetId) => trackView(db, assetId)) });
  } catch (error) {
    next(error);
  }
});
app.get("/api/tasks", (_req, res) => {
  res.json(view().tasks);
});
app.post("/api/assets/:id/declaration", async (req, res, next) => {
  try {
    const declaration = await saveDeclaration(req.params.id, {
      createdThisWork: Boolean(req.body.createdThisWork),
      controlsRecording: Boolean(req.body.controlsRecording),
      samplesCleared: Boolean(req.body.samplesCleared),
      contributorsPermitted: Boolean(req.body.contributorsPermitted),
      acceptsResponsibility: Boolean(req.body.acceptsResponsibility),
      usesSamples: Boolean(req.body.usesSamples)
    });
    res.json(declaration);
  } catch (error) {
    next(error);
  }
});
app.post("/api/assets/:id/clearances", async (req, res, next) => {
  try {
    const source = String(req.body.source || "").trim();
    if (!source) return res.status(400).json({ error: "Name the sample source." });
    const clearance = await addClearance(req.params.id, source, String(req.body.proofNote || "").trim());
    res.status(201).json(clearance);
  } catch (error) {
    next(error);
  }
});
app.put("/api/splits", async (req, res, next) => {
  try {
    const subjectType = req.body.subjectType === "recording" ? "recording" : "work";
    const subjectId = String(req.body.subjectId || "");
    const rows = Array.isArray(req.body.splits) ? req.body.splits : [];
    const splits = await replaceSplits(
      subjectType,
      subjectId,
      rows.map((row) => ({
        name: String(row.name || "").trim() || "Unnamed",
        role: oneOf(row.role, ["writer", "publisher", "master_owner", "producer", "performer"]) || (subjectType === "work" ? "writer" : "master_owner"),
        shareBps: Math.round(Number(row.shareBps) || 0)
      }))
    );
    res.json(splits);
  } catch (error) {
    next(error);
  }
});
app.post("/api/assets/:id/provider-terms", async (req, res, next) => {
  try {
    res.json(await acknowledgeProviderTerms(req.params.id));
  } catch (error) {
    next(error);
  }
});
app.post("/api/listings", async (req, res, next) => {
  try {
    const assetIds = Array.isArray(req.body.assetIds) ? req.body.assetIds.map(String) : [];
    const listing = await prepareListing(assetIds);
    res.status(201).json(listing);
  } catch (error) {
    next(error);
  }
});
app.get("/api/listings", (_req, res) => {
  res.json(view().listings);
});
app.get("/api/listings/:id", (req, res) => {
  const listing = view().listings.find((item) => item.id === req.params.id);
  if (!listing) return res.status(404).json({ error: "Listing not found." });
  const db = view();
  res.json({ ...listing, assets: listing.assetIds.map((assetId) => trackView(db, assetId)) });
});
app.post("/api/listings/:id/purchase", async (req, res, next) => {
  try {
    const grant = await purchase(req.params.id, String(req.body.offerId || ""), String(req.body.buyerName || ""));
    res.status(201).json(grant);
  } catch (error) {
    next(error);
  }
});
app.get("/api/projects", (_req, res) => {
  res.json(studioSessions(view()));
});
app.get("/api/rights", (_req, res) => {
  const db = view();
  res.json({
    profile: db.profile,
    works: db.works.map((work) => ({
      ...work,
      splits: db.splits.filter((split) => split.subjectType === "work" && split.subjectId === work.id),
      assets: db.assets.filter((asset) => asset.workId === work.id)
    })),
    recordings: db.recordings.map((recording) => ({
      ...recording,
      splits: db.splits.filter((split) => split.subjectType === "recording" && split.subjectId === recording.id)
    })),
    feeBps: feeBps()
  });
});
app.get("/api/earnings", (_req, res) => {
  const db = view();
  const creatorCents = db.ledger.filter((entry) => entry.kind === "creator_share").reduce((sum, entry) => sum + entry.amountCents, 0);
  const platformCents = db.ledger.filter((entry) => entry.kind === "platform_fee").reduce((sum, entry) => sum + entry.amountCents, 0);
  res.json({ grants: db.grants, ledger: db.ledger, creatorCents, platformCents, feeBps: feeBps() });
});
app.get("/api/credits", async (_req, res, next) => {
  try {
    requireSuno2();
    const credits = await remainingCredits();
    res.json({ credits: credits.data });
  } catch (error) {
    next(error);
  }
});
registerProduce(app);
var dist = path3.resolve(process.cwd(), "dist");
if (!process.env.VERCEL && process.env.NODE_ENV === "production" && fs3.existsSync(dist)) {
  app.use(express.static(dist));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) return next();
    res.sendFile(path3.join(dist, "index.html"));
  });
}
app.use((error, _req, res, _next) => {
  const status = error instanceof SunoError || error instanceof BillingError ? error.code : 400;
  const message = error instanceof Error ? error.message : "Request failed";
  const http = status >= 400 && status < 600 ? status : 400;
  res.status(http === 201 ? 400 : http).json({ error: message });
});
var index_default = app;
if (!process.env.VERCEL) {
  const port = Number(process.env.PORT || 8787);
  app.listen(port, "0.0.0.0", () => {
    console.log(`Red Sound API on 0.0.0.0:${port}`);
  });
}
function requireSuno2() {
  if (!sunoConfigured()) throw new SunoError(503, "Add SUNO_API_KEY on the server to generate, extend, or separate stems.");
}
function sourceAudio(assetId) {
  const db = view();
  const provenance = db.provenance.find((item) => item.assetId === assetId);
  if (!provenance?.providerAudioId) throw new SunoError(400, "Extend needs a Suno audio id on this track.");
  return { audioId: provenance.providerAudioId, taskId: provenance.providerJobId };
}
async function refreshTask(localId) {
  const existing = view().tasks.find((item) => item.id === localId);
  if (!existing) return null;
  if (!existing.sunoTaskId || existing.status === "SUCCESS" || isTerminalFailure(existing.status)) return existing;
  if (!sunoConfigured()) return existing;
  if (existing.kind === "vocal_removal") {
    const record2 = await vocalRemovalRecord(existing.sunoTaskId);
    const status2 = readTaskStatus(record2);
    const files = stemFilesFromPayload(record2);
    if (files.length && typeof existing.request.parentAssetId === "string") {
      await storeStemFiles(existing.id, existing.request.parentAssetId, files);
    } else {
      await update((db) => {
        const task = db.tasks.find((item) => item.id === existing.id);
        if (task) {
          task.status = status2;
          if (isTerminalFailure(status2)) task.error = record2.msg;
          task.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
        }
        return task;
      });
    }
    return view().tasks.find((item) => item.id === existing.id) || null;
  }
  if (existing.kind === "lyrics") {
    const record2 = await lyricsRecord(existing.sunoTaskId);
    const status2 = readTaskStatus(record2);
    const data = record2.data?.response?.data;
    if (status2 === "SUCCESS" && Array.isArray(data)) await storeLyrics(existing.id, data);
    else {
      await update((db) => {
        const task = db.tasks.find((item) => item.id === existing.id);
        if (task) {
          task.status = status2;
          task.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
        }
        return task;
      });
    }
    return view().tasks.find((item) => item.id === existing.id) || null;
  }
  const side = await refreshSideTask(existing);
  if (side === "handled") return view().tasks.find((item) => item.id === existing.id) || null;
  const record = await musicRecord(existing.sunoTaskId);
  const status = readTaskStatus(record);
  if (isTerminalSuccess(status) || isTerminalFailure(status)) {
    await setTaskResult(existing.id, status === "TEXT_SUCCESS" ? "PENDING" : status, record, {
      titleFallback: typeof existing.request.title === "string" ? existing.request.title : "Untitled"
    });
  } else {
    await update((db) => {
      const task = db.tasks.find((item) => item.id === existing.id);
      if (task) {
        task.status = status;
        task.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      }
      return task;
    });
  }
  return view().tasks.find((item) => item.id === existing.id) || null;
}
async function ingestCallback(body) {
  const root = body && typeof body === "object" ? body : {};
  const data = root.data && typeof root.data === "object" ? root.data : {};
  const sunoTaskId = String(data.task_id || data.taskId || "");
  if (!sunoTaskId) return;
  const task = view().tasks.find((item) => item.sunoTaskId === sunoTaskId);
  if (!task) return;
  if (task.kind === "vocal_removal" && typeof task.request.parentAssetId === "string") {
    const files = stemFilesFromPayload(body);
    if (files.length) await storeStemFiles(task.id, task.request.parentAssetId, files);
    return;
  }
  if (task.kind === "wav" || task.kind === "midi" || task.kind === "cover_image" || task.kind === "recovery" || task.kind === "voice") {
    await refreshSideTask(task);
    return;
  }
  if (root.code === 200) await setTaskResult(task.id, "SUCCESS", body);
  else {
    await update((db) => {
      const current = db.tasks.find((item) => item.id === task.id);
      if (current) {
        current.status = "FAILED";
        current.error = typeof root.msg === "string" ? root.msg : "Generation failed";
        current.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      }
      return current;
    });
  }
}
function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    try {
      const text2 = fs3.readFileSync(path3.resolve(process.cwd(), file), "utf8");
      for (const line of text2.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq < 1) continue;
        const key = trimmed.slice(0, eq).trim();
        const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
        if (process.env[key] == null || process.env[key] === "") process.env[key] = value;
      }
    } catch {
    }
  }
}
function oneOf(value, allowed) {
  return typeof value === "string" && allowed.includes(value) ? value : void 0;
}
function numberOrUndefined(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : void 0;
}

// server/vercel.ts
function header(req, name) {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] || "" : value || "";
}
function restoreApiPath(req) {
  const current = req.url || "/";
  const queryIndex = current.indexOf("?");
  const pathOnly = queryIndex >= 0 ? current.slice(0, queryIndex) : current;
  const query = queryIndex >= 0 ? current.slice(queryIndex + 1) : "";
  const params = new URLSearchParams(query);
  const forwarded = params.get("__rs");
  if (forwarded) {
    params.delete("__rs");
    const extra = params.toString();
    req.url = `/api/${decodeURIComponent(forwarded).replace(/^\/+/, "")}${extra ? `?${extra}` : ""}`;
    return;
  }
  if (pathOnly === "/api" || pathOnly.startsWith("/api/") && pathOnly !== "/api/server") return;
  const invoked = header(req, "x-invoke-path") || header(req, "x-forwarded-uri") || header(req, "x-original-uri");
  const invokedPath = invoked.split("?")[0];
  if (invokedPath === "/api" || invokedPath.startsWith("/api/") && invokedPath !== "/api/server") {
    req.url = `${invokedPath}${query ? `?${query}` : ""}`;
    return;
  }
  req.url = `/api${pathOnly.startsWith("/") ? pathOnly : `/${pathOnly}`}${query ? `?${query}` : ""}`;
}
function handler(req, res) {
  restoreApiPath(req);
  return index_default(req, res);
}
export {
  handler as default
};
