/**
 * Suno API client for https://api.sunoapi.org
 * Shapes follow the current docs: V6-series models, record-info polling,
 * and vocal/instrument stem separation.
 */

const FAILED = new Set([
  'CREATE_TASK_FAILED',
  'GENERATE_AUDIO_FAILED',
  'GENERATE_LYRICS_FAILED',
  'GENERATE_WAV_FAILED',
  'CALLBACK_EXCEPTION',
  'SENSITIVE_WORD_ERROR',
  'FAILED',
]);

export function sunoBase(): string {
  return String(process.env.SUNO_API_BASE_URL || 'https://api.sunoapi.org').replace(/\/$/, '');
}

export function sunoConfigured(): boolean {
  return Boolean(String(process.env.SUNO_API_KEY || '').trim());
}

export function defaultModel(): string {
  return String(process.env.SUNO_MODEL || 'V6').trim() || 'V6';
}

export interface SunoEnvelope<T = unknown> {
  code: number;
  msg?: string;
  data?: T;
  task_id?: string;
}

export class SunoError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

function apiKey(): string {
  const key = String(process.env.SUNO_API_KEY || '').trim();
  if (!key) throw new SunoError(503, 'SUNO_API_KEY is not configured on the server.');
  return key;
}

export async function sunoRequest<T = unknown>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<SunoEnvelope<T>> {
  const response = await fetch(`${sunoBase()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      Accept: 'application/json',
      ...(body != null ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json: SunoEnvelope<T> = { code: response.status, msg: text };
  try {
    json = text ? (JSON.parse(text) as SunoEnvelope<T>) : { code: response.status };
  } catch {
    throw new SunoError(response.status, `Suno returned non-JSON (${response.status}).`);
  }
  // Recovery polling uses 201 while the job is still running.
  if (json.code !== 200 && json.code !== 201) {
    throw new SunoError(json.code || response.status, json.msg || `Suno error ${json.code || response.status}`);
  }
  return json;
}

export interface SunoTrack {
  id: string;
  audioUrl?: string;
  streamAudioUrl?: string;
  imageUrl?: string;
  title?: string;
  tags?: string;
  prompt?: string;
  duration?: number;
  modelName?: string;
}

export function readTracks(payload: unknown): SunoTrack[] {
  const root = asRecord(payload);
  const data = asRecord(root.data) ?? root;
  const response = asRecord(data.response);
  const list =
    asArray(data.data) ||
    asArray(response?.sunoData) ||
    asArray(response?.data) ||
    asArray(data.sunoData) ||
    [];
  return list.map(normalizeTrack).filter((track): track is SunoTrack => Boolean(track?.id));
}

export function readTaskStatus(payload: unknown): string {
  const root = asRecord(payload);
  const data = asRecord(root.data) ?? root;
  return String(data.status || data.successFlag || root.msg || 'PENDING');
}

export function isTerminalFailure(status: string): boolean {
  return FAILED.has(status);
}

export function isTerminalSuccess(status: string): boolean {
  return status === 'SUCCESS' || status === 'FIRST_SUCCESS' || status === 'TEXT_SUCCESS';
}

function normalizeTrack(value: unknown): SunoTrack | null {
  const track = asRecord(value);
  if (!track) return null;
  const id = String(track.id || track.audioId || '');
  if (!id) return null;
  return {
    id,
    audioUrl: stringOrUndefined(track.audio_url || track.audioUrl),
    streamAudioUrl: stringOrUndefined(track.stream_audio_url || track.streamAudioUrl),
    imageUrl: stringOrUndefined(track.image_url || track.imageUrl),
    title: stringOrUndefined(track.title),
    tags: stringOrUndefined(track.tags),
    prompt: stringOrUndefined(track.prompt),
    duration: typeof track.duration === 'number' ? track.duration : undefined,
    modelName: stringOrUndefined(track.model_name || track.modelName),
  };
}

export interface GenerateInput {
  prompt?: string;
  lyrics?: string;
  style?: string;
  title?: string;
  instrumental?: boolean;
  customMode?: boolean;
  model?: string;
  negativeTags?: string;
  vocalGender?: 'm' | 'f';
  duration?: number;
  personaId?: string;
  personaModel?: 'style_persona' | 'voice_persona';
  callBackUrl: string;
}

export function buildGenerateBody(input: GenerateInput): Record<string, unknown> {
  const model = input.model || defaultModel();
  const customMode = Boolean(input.customMode);
  const instrumental = Boolean(input.instrumental);
  const body: Record<string, unknown> = {
    customMode,
    instrumental,
    model,
    callBackUrl: input.callBackUrl,
  };
  if (customMode) {
    const style = (input.style || '').trim();
    const lyrics = (input.lyrics || input.prompt || '').trim();
    const negativeTags = (input.negativeTags || '').trim();
    if (!style && !lyrics && !negativeTags) {
      throw new SunoError(400, 'Custom mode needs a style, lyrics, or negative tags.');
    }
    if (style) body.style = style.slice(0, 1000);
    if (!instrumental && lyrics) body.lyrics = lyrics.slice(0, 5000);
    if (negativeTags) body.negativeTags = negativeTags.slice(0, 1000);
    if (input.title) body.title = input.title.trim().slice(0, 80);
    if (input.vocalGender && !instrumental) body.vocalGender = input.vocalGender;
    if (input.duration != null) body.duration = clamp(input.duration, 10, 360);
  } else {
    const prompt = (input.prompt || '').trim();
    const style = (input.style || '').trim();
    const lyrics = (input.lyrics || '').trim();
    if (!prompt && !style && !lyrics) {
      throw new SunoError(400, 'Describe the track, or attach a style or lyrics.');
    }
    if (prompt) body.prompt = prompt.slice(0, 3000);
    if (style) body.style = style.slice(0, 1000);
    if (lyrics) body.lyrics = lyrics.slice(0, 5000);
  }
  if (input.personaId) {
    body.personaId = input.personaId;
    body.personaModel = input.personaModel || 'style_persona';
  }
  return body;
}

export function generateMusic(input: GenerateInput) {
  return sunoRequest<{ taskId: string }>('POST', '/api/v1/generate', buildGenerateBody(input));
}

export function extendMusic(body: Record<string, unknown>) {
  return sunoRequest<{ taskId: string }>('POST', '/api/v1/generate/extend', body);
}

export function uploadCover(body: Record<string, unknown>) {
  return sunoRequest<{ taskId: string }>('POST', '/api/v1/generate/upload-cover', body);
}

export function uploadExtend(body: Record<string, unknown>) {
  return sunoRequest<{ taskId: string }>('POST', '/api/v1/generate/upload-extend', body);
}

export function addVocals(body: Record<string, unknown>) {
  return sunoRequest<{ taskId: string }>('POST', '/api/v1/generate/add-vocals', body);
}

export function addInstrumental(body: Record<string, unknown>) {
  return sunoRequest<{ taskId: string }>('POST', '/api/v1/generate/add-instrumental', body);
}

export function replaceSection(body: Record<string, unknown>) {
  return sunoRequest<{ taskId: string }>('POST', '/api/v1/generate/replace-section', body);
}

export function mashup(body: Record<string, unknown>) {
  return sunoRequest<{ taskId: string }>('POST', '/api/v1/generate/mashup', body);
}

export function generatePersona(body: Record<string, unknown>) {
  return sunoRequest<{ personaId: string }>('POST', '/api/v1/generate/generate-persona', body);
}

export function generateLyrics(prompt: string, callBackUrl: string) {
  return sunoRequest<{ taskId: string }>('POST', '/api/v1/lyrics', { prompt: prompt.slice(0, 200), callBackUrl });
}

export function generateSounds(body: Record<string, unknown>) {
  return sunoRequest<{ taskId: string }>('POST', '/api/v1/generate/sounds', body);
}

export function boostStyle(content: string) {
  return sunoRequest('POST', '/api/v1/style/generate', { content });
}

export function vocalRemoval(body: Record<string, unknown>) {
  return sunoRequest<{ taskId: string }>('POST', '/api/v1/vocal-removal/generate', body);
}

export function convertWav(body: Record<string, unknown>) {
  return sunoRequest<{ taskId: string }>('POST', '/api/v1/wav/generate', body);
}

export function generateMidi(body: Record<string, unknown>) {
  return sunoRequest<{ taskId: string }>('POST', '/api/v1/midi/generate', body);
}

export function musicRecord(taskId: string) {
  return sunoRequest('GET', `/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`);
}

export function lyricsRecord(taskId: string) {
  return sunoRequest('GET', `/api/v1/lyrics/record-info?taskId=${encodeURIComponent(taskId)}`);
}

export function vocalRemovalRecord(taskId: string) {
  return sunoRequest('GET', `/api/v1/vocal-removal/record-info?taskId=${encodeURIComponent(taskId)}`);
}

export function wavRecord(taskId: string) {
  return sunoRequest('GET', `/api/v1/wav/record-info?taskId=${encodeURIComponent(taskId)}`);
}

export function midiRecord(taskId: string) {
  return sunoRequest('GET', `/api/v1/midi/record-info?taskId=${encodeURIComponent(taskId)}`);
}

export function remainingCredits() {
  return sunoRequest<number>('GET', '/api/v1/generate/credit');
}

export function timestampedLyrics(taskId: string, audioId: string) {
  return sunoRequest('POST', '/api/v1/generate/get-timestamped-lyrics', { taskId, audioId });
}

export function generateCoverImage(taskId: string, callBackUrl: string) {
  return sunoRequest<{ taskId: string }>('POST', '/api/v1/suno/cover/generate', { taskId, callBackUrl });
}

export function coverRecord(taskId: string) {
  return sunoRequest('GET', `/api/v1/suno/cover/record-info?taskId=${encodeURIComponent(taskId)}`);
}

export function recoverAudio(sunoTaskId: string, callBackUrl: string) {
  return sunoRequest<{ task_id: string }>('POST', '/api/v1/suno/recovery', { sunoTaskId, callBackUrl });
}

export function recoveryRecord(taskId: string) {
  return sunoRequest('GET', `/api/v1/suno/recovery/record-info?task_id=${encodeURIComponent(taskId)}`);
}

export function voiceValidate(body: Record<string, unknown>) {
  return sunoRequest<{ taskId: string }>('POST', '/api/v1/voice/validate', body);
}

export function voiceValidateInfo(taskId: string) {
  return sunoRequest('GET', `/api/v1/voice/validate-info?taskId=${encodeURIComponent(taskId)}`);
}

export function voiceGenerate(body: Record<string, unknown>) {
  return sunoRequest<{ taskId: string }>('POST', '/api/v1/voice/generate', body);
}

export function voiceRecordInfo(taskId: string) {
  return sunoRequest('GET', `/api/v1/voice/record-info?taskId=${encodeURIComponent(taskId)}`);
}

export function voiceRegenerate(taskId: string, calBackUrl: string) {
  return sunoRequest<{ taskId: string }>('POST', '/api/v1/voice/regenerate', { taskId, calBackUrl });
}

export function voiceCheck(taskId: string) {
  return sunoRequest<{ isAvailable: boolean }>('POST', '/api/v1/voice/check-voice', { task_id: taskId });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}
