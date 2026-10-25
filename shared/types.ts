export const ORIGINS = ['human_created', 'ai_assisted', 'ai_generated', 'imported'] as const;
export type OriginKind = (typeof ORIGINS)[number];

export const ASSET_KINDS = ['beat', 'song', 'sample', 'stem', 'vocal', 'full_mix', 'lyrics'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const SPLIT_ROLES = ['writer', 'publisher', 'master_owner', 'producer', 'performer'] as const;
export type SplitRole = (typeof SPLIT_ROLES)[number];

export const LICENSE_TIERS = ['basic', 'premium', 'unlimited', 'exclusive', 'sync', 'custom'] as const;
export type LicenseTier = (typeof LICENSE_TIERS)[number];

export type ComponentRole = 'instrumental' | 'vocal' | 'lyrics' | 'arrangement' | 'mix' | 'sample' | 'stem';

export interface SubscriptionState {
  planId: 'basic' | 'premium' | 'studio';
  planCode: string;
  status: 'active' | 'pending';
  email: string;
  paymentId?: string;
  currentPeriodEnd?: string;
}

export interface Profile {
  id: string;
  displayName: string;
  handle: string;
  subscription?: SubscriptionState;
}

export interface MusicalWork {
  id: string;
  title: string;
  lyrics?: string;
  createdAt: string;
}

export interface SoundRecording {
  id: string;
  title: string;
  workId?: string;
  assetId: string;
  createdAt: string;
}

export interface ProvenanceComponent {
  role: ComponentRole;
  origin: OriginKind;
  assetId?: string;
  note?: string;
}

export interface Provenance {
  assetId: string;
  origin: OriginKind;
  provider?: 'suno' | 'upload' | 'microphone';
  providerJobId?: string;
  providerAudioId?: string;
  personaId?: string;
  voiceId?: string;
  model?: string;
  prompt?: string;
  lyrics?: string;
  style?: string;
  /** Set when the creator confirms they have read the provider terms before a commercial listing. */
  providerTermsAcknowledgedAt?: string;
  components: ProvenanceComponent[];
  createdAt: string;
}

export interface Asset {
  id: string;
  ownerId: string;
  title: string;
  kind: AssetKind;
  bpm?: number;
  musicalKey?: string;
  durationSec?: number;
  audioUrl?: string;
  wavUrl?: string;
  imageUrl?: string;
  /** MIDI note data from a completed stem separation. */
  midiData?: unknown;
  /** Word-level lyric timing from Get Timestamped Lyrics. */
  alignedLyrics?: unknown;
  /** Local upload served by this app. Remote Suno URLs stay on audioUrl. */
  mediaId?: string;
  mimeType?: string;
  workId?: string;
  recordingId?: string;
  projectId?: string;
  parentAssetIds: string[];
  stemName?: string;
  createdAt: string;
}

export interface Split {
  id: string;
  subjectType: 'work' | 'recording';
  subjectId: string;
  name: string;
  role: SplitRole;
  /** 10000 = 100%. */
  shareBps: number;
}

export interface RightsDeclaration {
  assetId: string;
  createdThisWork: boolean;
  controlsRecording: boolean;
  samplesCleared: boolean;
  contributorsPermitted: boolean;
  acceptsResponsibility: boolean;
  usesSamples: boolean;
  signedAt?: string;
}

export interface SampleClearance {
  id: string;
  assetId: string;
  source: string;
  proofNote: string;
  createdAt: string;
}

export interface LicenseOffer {
  id: string;
  tier: LicenseTier;
  name: string;
  priceCents: number;
  currency: 'ZAR';
  deliverables: Array<'mp3' | 'wav' | 'stems'>;
  summary: string;
  commercial: boolean;
  exclusive: boolean;
}

export type ListingStatus = 'draft' | 'held_for_counsel' | 'published' | 'sold_exclusive' | 'removed';

export interface Listing {
  id: string;
  assetIds: string[];
  sellerId: string;
  title: string;
  blurb?: string;
  genre?: string;
  bpm?: number;
  musicalKey?: string;
  status: ListingStatus;
  offers: LicenseOffer[];
  holdReasons: string[];
  createdAt: string;
}

export interface LicenseGrant {
  id: string;
  number: string;
  listingId: string;
  offerId: string;
  assetId: string;
  buyerName: string;
  licenseTier: LicenseTier;
  priceCents: number;
  platformFeeCents: number;
  creatorShareCents: number;
  currency: 'ZAR';
  status: 'active' | 'refunded' | 'revoked';
  purchasedAt: string;
  paymentProvider: 'redface';
  paymentRef?: string;
}

export interface LedgerEntry {
  id: string;
  grantId?: string;
  kind: 'sale' | 'platform_fee' | 'creator_share' | 'refund';
  amountCents: number;
  currency: 'ZAR';
  party: 'platform' | 'creator' | 'buyer';
  note: string;
  createdAt: string;
}

export interface Project {
  id: string;
  ownerId: string;
  title: string;
  assetIds: string[];
  createdAt: string;
}

export type TaskKind =
  | 'generate'
  | 'extend'
  | 'upload_cover'
  | 'upload_extend'
  | 'add_vocals'
  | 'add_instrumental'
  | 'replace_section'
  | 'mashup'
  | 'lyrics'
  | 'vocal_removal'
  | 'wav'
  | 'midi'
  | 'sounds'
  | 'persona'
  | 'style'
  | 'cover_image'
  | 'recovery'
  | 'voice';

export interface TaskRecord {
  id: string;
  ownerId: string;
  kind: TaskKind;
  sunoTaskId?: string;
  status: string;
  assetIds: string[];
  projectId?: string;
  request: Record<string, unknown>;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AppConfig {
  sunoConfigured: boolean;
  model: string;
  marketplaceLive: boolean;
  termsVersion: string;
  platformFeeBps: number;
  marketplaceNote: string;
}

export interface TrackView extends Asset {
  provenance?: Provenance;
  declaration?: RightsDeclaration;
  work?: MusicalWork;
  recording?: SoundRecording;
  splits: Split[];
  clearances: SampleClearance[];
  children: Asset[];
}
