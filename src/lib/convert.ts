import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';
import { rejectReason, inputExtension, type ConvertTarget } from './convertName.ts';

let engine: Promise<FFmpeg> | null = null;
let queue: Promise<unknown> = Promise.resolve();

function load(): Promise<FFmpeg> {
  if (!engine) {
    const pending = (async () => {
      const ffmpeg = new FFmpeg();
      await ffmpeg.load({
        coreURL: await toBlobURL(coreURL, 'text/javascript'),
        wasmURL: await toBlobURL(wasmURL, 'application/wasm'),
      });
      return ffmpeg;
    })();
    engine = pending;
    pending.catch(() => {
      if (engine === pending) engine = null;
    });
  }
  return engine;
}

async function convertOne(file: File, target: ConvertTarget, onStage?: (stage: 'prepare' | 'convert') => void): Promise<Blob> {
  const refused = rejectReason(file);
  if (refused) throw new Error(refused);
  onStage?.('prepare');
  const ffmpeg = await load();
  onStage?.('convert');
  const input = `in.${inputExtension(file.name)}`;
  const output = `out.${target}`;
  await ffmpeg.writeFile(input, await fetchFile(file));
  const args = target === 'wav'
    ? ['-i', input, '-vn', '-acodec', 'pcm_s16le', '-ar', '44100', output]
    : ['-i', input, '-vn', '-acodec', 'libmp3lame', '-b:a', '192k', output];
  let code = 1;
  try {
    code = await ffmpeg.exec(args);
  } finally {
    await ffmpeg.deleteFile(input).catch(() => undefined);
  }
  if (code !== 0) {
    await ffmpeg.deleteFile(output).catch(() => undefined);
    throw new Error('This file has no sound the converter can read. Use the voice note itself, not a photo or a document.');
  }
  const data = await ffmpeg.readFile(output);
  await ffmpeg.deleteFile(output).catch(() => undefined);
  const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type: target === 'wav' ? 'audio/wav' : 'audio/mpeg' });
}

export function convertAudio(file: File, target: ConvertTarget, onStage?: (stage: 'prepare' | 'convert') => void): Promise<Blob> {
  const run = queue.then(() => convertOne(file, target, onStage));
  queue = run.then(() => undefined, () => undefined);
  return run;
}
