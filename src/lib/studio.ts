export const GENRES = ['Hip-Hop', 'Amapiano', 'House', 'R&B', 'Soul', 'Pop', 'Afrobeat', 'Drill'] as const;
export const KEYS = ['C Minor', 'C Major', 'D Minor', 'D Major', 'E Minor', 'F Minor', 'F# Minor', 'G Minor', 'G Major', 'A Minor', 'A Major', 'B Minor'] as const;
export const INSTRUMENTS = ['Drums', 'Bass', 'Keys', 'Guitar', 'Synth', 'Strings'] as const;
export const LENGTHS = [30, 60, 90, 120, 150, 180, 210, 240] as const;

export function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const remain = whole % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remain).padStart(2, '0')}`;
}

export function waveHeights(seed: string, count = 64): number[] {
  let state = 2166136261;
  for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 16777619);
  return Array.from({ length: count }, () => {
    state = Math.imul(state ^ (state >>> 15), 2246822519);
    const unit = ((state >>> 0) % 1000) / 1000;
    return 18 + Math.round(unit * 82);
  });
}

export function jobLabel(kind: string): string {
  const labels: Record<string, string> = {
    generate: 'Rendering track',
    extend: 'Extending arrangement',
    upload_cover: 'Designing a version',
    upload_extend: 'Extending arrangement',
    add_vocals: 'Generating vocal arrangement',
    add_instrumental: 'Adding instruments',
    replace_section: 'Replacing a section',
    mashup: 'Combining tracks',
    lyrics: 'Drafting lyrics',
    vocal_removal: 'Splitting stems',
    wav: 'Exporting',
    midi: 'Writing MIDI',
    sounds: 'Designing sound',
    persona: 'Saving voice',
    cover_image: 'Designing artwork',
    recovery: 'Restoring audio',
    voice: 'Creating voice',
    style: 'Shaping sound',
  };
  return labels[kind] || 'Processing';
}

export function studioError(message: string): string {
  return message
    .replace(/Add SUNO_API_KEY on the server to use Suno\./g, 'The studio engine is offline.')
    .replace(/Add SUNO_API_KEY on the server to generate, extend, or separate stems\./g, 'The studio engine is offline.')
    .replace(/Suno cannot read a file that only lives on this computer\.[^.]+\./g, 'This recording is still local. Host it before the studio can process it.')
    .replace(/Suno did not return a task id\./g, 'The studio did not start the job.')
    .replace(/Suno did not return a persona id\./g, 'The voice was not saved.')
    .replace(/finished Suno track/g, 'finished generated track')
    .replace(/original Suno generation task/g, 'original session render')
    .replace(/original Suno task id/g, 'original session')
    .replace(/Suno audio id/g, 'generated audio id')
    .replace(/persona/gi, 'voice');
}
