import type {
  LicenseOffer,
  OriginKind,
  Provenance,
  ProvenanceComponent,
  RightsDeclaration,
  SampleClearance,
  Split,
} from './types.ts';

export const FULL_SHARE_BPS = 10_000;

export function formatZar(cents: number): string {
  const amount = cents / 100;
  return `R${amount.toLocaleString('en-ZA', { minimumFractionDigits: amount % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
}

export function deriveOrigin(components: ProvenanceComponent[]): OriginKind {
  if (components.length === 0) return 'imported';
  const kinds = new Set(components.map((component) => component.origin));
  const hasHuman = kinds.has('human_created');
  const hasAi = kinds.has('ai_generated') || kinds.has('ai_assisted');
  if (hasHuman && hasAi) return 'ai_assisted';
  if (hasAi && !hasHuman && !kinds.has('imported')) {
    return kinds.has('ai_assisted') && !kinds.has('ai_generated') ? 'ai_assisted' : 'ai_generated';
  }
  if (hasHuman && kinds.size === 1) return 'human_created';
  if (kinds.size === 1 && kinds.has('imported')) return 'imported';
  if (hasHuman && kinds.has('imported') && !hasAi) return 'human_created';
  return 'ai_assisted';
}

export function splitSum(splits: Split[], subjectType: Split['subjectType'], subjectId: string): number {
  return splits
    .filter((split) => split.subjectType === subjectType && split.subjectId === subjectId)
    .reduce((total, split) => total + split.shareBps, 0);
}

export function splitIssues(splits: Split[], subjectType: Split['subjectType'], subjectId: string, label: string): string[] {
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

export function declarationIssues(declaration: RightsDeclaration | undefined, clearances: SampleClearance[]): string[] {
  if (!declaration?.signedAt) return ['Sign the rights declaration before this can be offered.'];
  const issues: string[] = [];
  if (!declaration.createdThisWork) issues.push('Confirm you created this work, or that you control the right to offer it.');
  if (!declaration.controlsRecording) issues.push('Confirm you own or control the sound recording.');
  if (!declaration.contributorsPermitted) issues.push('Confirm you have permission from every contributor.');
  if (!declaration.acceptsResponsibility) issues.push('Accept responsibility for the rights in this upload.');
  if (declaration.usesSamples) {
    if (!declaration.samplesCleared) issues.push('Samples need a clearance before this can be offered.');
    if (clearances.length === 0) issues.push('Identify each sample source and the licence or permission you hold.');
  }
  return issues;
}

export function provenanceIssues(provenance: Provenance | undefined): string[] {
  if (!provenance) return ['This asset has no provenance record.'];
  if (provenance.origin === 'ai_generated' || provenance.origin === 'ai_assisted') {
    if (!provenance.providerTermsAcknowledgedAt) {
      return ['Acknowledge the generation terms before this session can be offered. Red Sound does not assign a copyright status to generated audio.'];
    }
  }
  return [];
}

export function listingBlockers(input: {
  splits: Split[];
  workId?: string;
  recordingId?: string;
  declaration?: RightsDeclaration;
  clearances: SampleClearance[];
  provenance?: Provenance;
  marketplaceLive: boolean;
}): string[] {
  const blockers = [
    ...(input.workId ? splitIssues(input.splits, 'work', input.workId, 'Composition') : ['Link a musical work before offering a licence.']),
    ...(input.recordingId
      ? splitIssues(input.splits, 'recording', input.recordingId, 'Master')
      : ['Link a sound recording before offering a licence.']),
    ...declarationIssues(input.declaration, input.clearances),
    ...provenanceIssues(input.provenance),
  ];
  if (!input.marketplaceLive) {
    blockers.push('Live sales stay off until counsel-reviewed creator terms and licence templates are in place.');
  }
  return blockers;
}

export function platformFee(priceCents: number, feeBps: number): { platformFeeCents: number; creatorShareCents: number } {
  const platformFeeCents = Math.round((priceCents * feeBps) / FULL_SHARE_BPS);
  return { platformFeeCents, creatorShareCents: priceCents - platformFeeCents };
}

export function defaultOffers(title: string): LicenseOffer[] {
  return [
    {
      id: crypto.randomUUID(),
      tier: 'basic',
      name: 'Basic',
      priceCents: 9900,
      currency: 'ZAR',
      deliverables: ['mp3'],
      summary: `Personal, non-exclusive use of the MP3 for “${title}”. The creator sets the final terms.`,
      commercial: false,
      exclusive: false,
    },
    {
      id: crypto.randomUUID(),
      tier: 'premium',
      name: 'Premium',
      priceCents: 29900,
      currency: 'ZAR',
      deliverables: ['mp3', 'wav'],
      summary: 'WAV delivery for commercial use within the limits the creator writes into this licence.',
      commercial: true,
      exclusive: false,
    },
    {
      id: crypto.randomUUID(),
      tier: 'unlimited',
      name: 'Unlimited',
      priceCents: 79900,
      currency: 'ZAR',
      deliverables: ['mp3', 'wav', 'stems'],
      summary: 'WAV and stems, commercial use, broader distribution. Still a licence, not an assignment.',
      commercial: true,
      exclusive: false,
    },
    {
      id: crypto.randomUUID(),
      tier: 'exclusive',
      name: 'Exclusive',
      priceCents: 250000,
      currency: 'ZAR',
      deliverables: ['mp3', 'wav', 'stems'],
      summary: 'Exclusive licence. The listing leaves the market after this sale.',
      commercial: true,
      exclusive: true,
    },
  ];
}

export function originLabel(origin: OriginKind): string {
  switch (origin) {
    case 'human_created':
      return 'Recorded';
    case 'ai_assisted':
      return 'Produced';
    case 'ai_generated':
      return 'Generated';
    case 'imported':
      return 'Imported';
  }
}
