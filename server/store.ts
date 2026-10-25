import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Arrangement } from '../shared/arrange.ts';
import type {
  Asset,
  LedgerEntry,
  LicenseGrant,
  Listing,
  MusicalWork,
  Profile,
  Project,
  Provenance,
  RightsDeclaration,
  SampleClearance,
  SoundRecording,
  Split,
  TaskRecord,
} from '../shared/types.ts';

export interface Database {
  profile: Profile;
  works: MusicalWork[];
  recordings: SoundRecording[];
  assets: Asset[];
  provenance: Provenance[];
  splits: Split[];
  declarations: RightsDeclaration[];
  clearances: SampleClearance[];
  listings: Listing[];
  grants: LicenseGrant[];
  ledger: LedgerEntry[];
  projects: Project[];
  tasks: TaskRecord[];
  arrangements: Arrangement[];
  grantSeq: number;
}

// Vercel functions can write to /tmp only, and that disk is not shared across instances.
const dataDir = process.env.VERCEL
  ? path.join('/tmp', 'redsound')
  : path.resolve(process.cwd(), 'data');
const dbPath = path.join(dataDir, 'db.json');

function emptyDb(): Database {
  return {
    profile: { id: 'local-creator', displayName: 'Creator', handle: 'creator' },
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
    grantSeq: 0,
  };
}

let queue: Promise<unknown> = Promise.resolve();

type StudioScope = {
  ownerId: string;
  token: string;
  db: Database;
  queue: Promise<unknown>;
};

const scopes = new AsyncLocalStorage<StudioScope>();

export function studioAuth(): { ownerId: string; token: string } | null {
  const scope = scopes.getStore();
  if (!scope?.ownerId || !scope.token) return null;
  return { ownerId: scope.ownerId, token: scope.token };
}

function supabaseConfig(): { url: string; key: string } | null {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = String(process.env.SUPABASE_PUBLISHABLE_KEY || '').trim();
  if (!url || !key) return null;
  return { url, key };
}

function read(): Database {
  try {
    const raw = fs.readFileSync(dbPath, 'utf8');
    return { ...emptyDb(), ...JSON.parse(raw) };
  } catch {
    return emptyDb();
  }
}

function write(db: Database) {
  fs.mkdirSync(dataDir, { recursive: true });
  const tmp = `${dbPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, dbPath);
}

async function loadRemote(token: string, ownerId: string): Promise<Database> {
  const config = supabaseConfig();
  if (!config) return emptyDb();
  const response = await fetch(
    `${config.url}/rest/v1/redsound_state?owner_id=eq.${encodeURIComponent(ownerId)}&select=document`,
    { headers: { apikey: config.key, Authorization: `Bearer ${token}`, Accept: 'application/json' } },
  );
  if (!response.ok) throw new Error('Could not open the studio library.');
  const rows = await response.json() as Array<{ document?: Partial<Database> }>;
  const document = rows[0]?.document;
  if (!document || typeof document !== 'object') return emptyDb();
  return { ...emptyDb(), ...document };
}

async function saveRemote(scope: StudioScope) {
  const config = supabaseConfig();
  if (!config) return;
  const response = await fetch(`${config.url}/rest/v1/redsound_state`, {
    method: 'POST',
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${scope.token}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({
      owner_id: scope.ownerId,
      document: scope.db,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!response.ok) throw new Error('Could not save the studio library.');
}

export async function enterStudio(ownerId: string, token: string, done: () => void) {
  if (!ownerId || !token || !supabaseConfig()) {
    done();
    return;
  }
  const db = await loadRemote(token, ownerId);
  scopes.run({ ownerId, token, db, queue: Promise.resolve() }, done);
}

export function update<T>(mutate: (db: Database) => T): Promise<T> {
  const scope = scopes.getStore();
  if (!scope) {
    const run = queue.then(() => {
      const db = read();
      const result = mutate(db);
      write(db);
      return result;
    });
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
  const run = scope.queue.then(async () => {
    const result = mutate(scope.db);
    await saveRemote(scope);
    return result;
  });
  scope.queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function view(): Database {
  return scopes.getStore()?.db ?? read();
}

export function uploadsDir(): string {
  const dir = path.join(dataDir, 'uploads');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
