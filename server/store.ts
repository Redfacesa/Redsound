import fs from 'node:fs';
import path from 'node:path';
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

export function update<T>(mutate: (db: Database) => T): Promise<T> {
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

export function view(): Database {
  return read();
}

export function uploadsDir(): string {
  const dir = path.join(dataDir, 'uploads');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
