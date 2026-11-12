import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9335;
const frames = ['scene', 'record', 'beats', 'samples'];
const stores = [
  { name: 'apple', width: 430, height: 932, scale: 3 },
  { name: 'play', width: 360, height: 640, scale: 3 },
];

const browser = spawn(chrome, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  `--remote-debugging-port=${port}`,
  '--user-data-dir=/tmp/redsound-store-shots',
  'about:blank',
], { stdio: 'ignore' });

let seq = 0;
const pending = new Map();
let ws;

function send(method, params = {}, sessionId) {
  const id = ++seq;
  const message = { id, method, params };
  if (sessionId) message.sessionId = sessionId;
  ws.send(JSON.stringify(message));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out: ${method}`)), 20000);
    pending.set(id, (payload) => {
      clearTimeout(timer);
      if (payload.error) reject(new Error(JSON.stringify(payload.error)));
      else resolve(payload.result);
    });
  });
}

async function openSocket() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((response) => response.json());
      ws = new WebSocket(version.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve, { once: true });
        ws.addEventListener('error', reject, { once: true });
      });
      ws.addEventListener('message', (event) => {
        const payload = JSON.parse(event.data);
        const done = pending.get(payload.id);
        if (done) {
          pending.delete(payload.id);
          done(payload);
        }
      });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error('Chrome did not open a debugger port.');
}

try {
  await openSocket();
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const attached = await send('Target.attachToTarget', { targetId, flatten: true });
  const session = attached.sessionId;
  await send('Page.enable', {}, session);
  for (const store of stores) {
    await mkdir(`public/store/${store.name}`, { recursive: true });
    await send('Emulation.setDeviceMetricsOverride', {
      width: store.width,
      height: store.height,
      deviceScaleFactor: store.scale,
      mobile: true,
    }, session);
    for (const frame of frames) {
      await send('Page.navigate', { url: `http://localhost:5173/shots/${frame}` }, session);
      const started = Date.now();
      let ready = false;
      while (!ready && Date.now() - started < 12000) {
        const result = await send('Runtime.evaluate', {
          expression: 'document.documentElement.dataset.ready || ""',
          returnByValue: true,
        }, session);
        ready = result.result?.value === '1';
        if (!ready) await new Promise((resolve) => setTimeout(resolve, 300));
      }
      const shot = await send('Page.captureScreenshot', { format: 'png' }, session);
      const file = `public/store/${store.name}/${frame}.png`;
      await writeFile(file, Buffer.from(shot.data, 'base64'));
      console.log(file);
    }
  }
  ws.close();
} finally {
  browser.kill();
}
