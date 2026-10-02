import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveOrigin, listingBlockers, platformFee, splitIssues } from '../../shared/rights.ts';
import type { Provenance, RightsDeclaration, Split } from '../../shared/types.ts';

const signed: RightsDeclaration = {
  assetId: 'asset',
  createdThisWork: true,
  controlsRecording: true,
  samplesCleared: true,
  contributorsPermitted: true,
  acceptsResponsibility: true,
  usesSamples: false,
  signedAt: '2026-10-02T00:00:00.000Z',
};

function split(subjectType: Split['subjectType'], subjectId: string, shareBps: number): Split {
  return { id: crypto.randomUUID(), subjectType, subjectId, name: 'Manace', role: subjectType === 'work' ? 'writer' : 'master_owner', shareBps };
}

test('a human vocal over an AI instrumental is AI-assisted', () => {
  const origin = deriveOrigin([
    { role: 'instrumental', origin: 'ai_generated' },
    { role: 'vocal', origin: 'human_created' },
    { role: 'arrangement', origin: 'human_created' },
    { role: 'mix', origin: 'human_created' },
  ]);
  assert.equal(origin, 'ai_assisted');
});

test('composition and master shares are tracked separately and must each total 100%', () => {
  const issues = splitIssues(
    [split('work', 'work', 5000), split('work', 'work', 2500), split('recording', 'rec', 10000)],
    'work',
    'work',
    'Composition',
  );
  assert.match(issues[0], /75\.00%/);
  assert.deepEqual(splitIssues([split('recording', 'rec', 10000)], 'recording', 'rec', 'Master'), []);
});

test('an AI beat cannot be offered until provider terms are acknowledged', () => {
  const provenance: Provenance = {
    assetId: 'asset',
    origin: 'ai_generated',
    provider: 'suno',
    providerJobId: 'task',
    components: [{ role: 'instrumental', origin: 'ai_generated' }],
    createdAt: '2026-10-02T00:00:00.000Z',
  };
  const blockers = listingBlockers({
    splits: [split('work', 'work', 10000), split('recording', 'rec', 10000)],
    workId: 'work',
    recordingId: 'rec',
    declaration: signed,
    clearances: [],
    provenance,
    marketplaceLive: true,
  });
  assert.ok(blockers.some((line) => /copyright status/i.test(line)));
});

test('samples block a listing until a clearance exists', () => {
  const blockers = listingBlockers({
    splits: [split('work', 'work', 10000), split('recording', 'rec', 10000)],
    workId: 'work',
    recordingId: 'rec',
    declaration: { ...signed, usesSamples: true, samplesCleared: false },
    clearances: [],
    provenance: {
      assetId: 'asset',
      origin: 'human_created',
      components: [{ role: 'mix', origin: 'human_created' }],
      createdAt: '2026-10-02T00:00:00.000Z',
    },
    marketplaceLive: true,
  });
  assert.ok(blockers.some((line) => /clearance/i.test(line)));
  assert.ok(blockers.some((line) => /sample source/i.test(line)));
});

test('marketplace sales stay held while creator terms are still a draft', () => {
  const blockers = listingBlockers({
    splits: [split('work', 'work', 10000), split('recording', 'rec', 10000)],
    workId: 'work',
    recordingId: 'rec',
    declaration: signed,
    clearances: [],
    provenance: {
      assetId: 'asset',
      origin: 'human_created',
      providerTermsAcknowledgedAt: '2026-10-02T00:00:00.000Z',
      components: [{ role: 'mix', origin: 'human_created' }],
      createdAt: '2026-10-02T00:00:00.000Z',
    },
    marketplaceLive: false,
  });
  assert.ok(blockers.some((line) => /counsel-reviewed/i.test(line)));
});

test('a R300 licence at 10% records R270 to the creator and R30 to the platform', () => {
  assert.deepEqual(platformFee(30000, 1000), { platformFeeCents: 3000, creatorShareCents: 27000 });
});
