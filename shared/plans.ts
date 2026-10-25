import type { TaskKind } from './types.ts';

/** Display names are Red Sound's. Paystack plan codes and ZAR amounts stay as billed. */
export const SOUND_PLANS = [
  {
    id: 'basic',
    name: 'Basic',
    amountZar: 299,
    planCode: 'PLN_wsyk1xw3iyx60vb',
    interval: 'monthly' as const,
    generations: 40,
    summary: 'Make beats and songs.',
    includes: ['Generate tracks', 'Draft lyrics', 'Shape a style', 'Import and record'],
  },
  {
    id: 'premium',
    name: 'Premium',
    amountZar: 399,
    planCode: 'PLN_j4al5vfexbc4c3k',
    interval: 'monthly' as const,
    generations: 200,
    summary: 'Arrange, split, and finish a record.',
    includes: ['Everything in Basic', 'Extend, cover, and mashup', 'Add voice or instruments', 'Replace a section', 'Stem splits and sound design'],
  },
  {
    id: 'studio',
    name: 'Studio',
    amountZar: 799,
    planCode: 'PLN_f7r958mlhdudbhf',
    interval: 'monthly' as const,
    generations: 600,
    summary: 'Voices, masters, and delivery files.',
    includes: ['Everything in Premium', 'Save and create a voice', 'Artwork and aligned lyrics', 'WAV, MIDI, and audio restore'],
  },
] as const;

export type SoundPlanId = (typeof SOUND_PLANS)[number]['id'];
export type Gate = TaskKind | 'lyrics_sync';

const RANK: Record<SoundPlanId, number> = { basic: 1, premium: 2, studio: 3 };

const MINIMUM: Record<Gate, SoundPlanId> = {
  generate: 'basic',
  lyrics: 'basic',
  style: 'basic',
  extend: 'premium',
  upload_cover: 'premium',
  upload_extend: 'premium',
  add_vocals: 'premium',
  add_instrumental: 'premium',
  replace_section: 'premium',
  mashup: 'premium',
  vocal_removal: 'premium',
  sounds: 'premium',
  wav: 'studio',
  midi: 'studio',
  persona: 'studio',
  cover_image: 'studio',
  recovery: 'studio',
  voice: 'studio',
  lyrics_sync: 'studio',
};

const UNMETERED = new Set<Gate>(['lyrics', 'style', 'lyrics_sync']);

export function soundPlan(id: string | undefined) {
  return SOUND_PLANS.find((plan) => plan.id === id) ?? null;
}

export function planAllows(planId: SoundPlanId | undefined, gate: Gate): boolean {
  if (!planId) return false;
  return RANK[planId] >= RANK[MINIMUM[gate]];
}

export function planMeters(gate: Gate): boolean {
  return !UNMETERED.has(gate);
}

export function requiredPlanName(gate: Gate): string {
  return soundPlan(MINIMUM[gate])?.name || 'Basic';
}
