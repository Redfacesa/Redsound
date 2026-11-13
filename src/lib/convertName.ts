export const CONVERT_LIMIT = 40 * 1024 * 1024;

export type ConvertTarget = 'wav' | 'mp3';

const INPUTS = new Set([
  'mp3', 'wav', 'wave', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'webm', 'flac',
  'aiff', 'aif', 'aifc', 'caf', '3gp', '3gpp', 'amr', 'wma', 'mp4', 'mpeg',
  'mpga', 'mov', 'm4b', 'mkv',
]);

export function inputExtension(name: string): string {
  const ext = name.toLowerCase().split('.').pop() || '';
  return INPUTS.has(ext) ? ext : 'audio';
}

export function outputName(name: string, target: ConvertTarget): string {
  const base = name.replace(/\.[^.]+$/, '') || 'sound';
  const clean = base.replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
  return `${clean || 'sound'}.${target}`;
}

export function rejectReason(file: { size: number }): string {
  if (file.size <= 0) return 'That file is empty.';
  if (file.size > CONVERT_LIMIT) return 'That file is larger than 40 MB. Split the voice note and try again.';
  return '';
}

export function sizeLabel(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
