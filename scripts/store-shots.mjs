import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const frames = ['scene', 'record', 'beats', 'samples'];
const stores = [
  { name: 'apple', width: 430, height: 932, scale: 3 },
  { name: 'play', width: 360, height: 640, scale: 3 },
];

function shot(store, frame) {
  const file = `public/store/${store.name}/${frame}.png`;
  return new Promise((resolve, reject) => {
    const child = spawn(chrome, [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      `--force-device-scale-factor=${store.scale}`,
      `--window-size=${store.width},${store.height}`,
      '--virtual-time-budget=5000',
      `--screenshot=${process.cwd()}/${file}`,
      `http://localhost:5173/shots/${frame}`,
    ], { stdio: 'ignore' });
    child.on('exit', (code) => (code === 0 ? resolve(file) : reject(new Error(`${file} exited ${code}`))));
  });
}

for (const store of stores) {
  await mkdir(`public/store/${store.name}`, { recursive: true });
  for (const frame of frames) {
    const file = await shot(store, frame);
    console.log(file);
  }
}
