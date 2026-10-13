export interface PaletteClasses {
  /** Pill badge classes (statuses, opportunity kinds). */
  badge: string;
  /** Top-border classes for a pipeline column. */
  stage: string;
  /** Border + background tint for a card of a "separate" opportunity kind. */
  card: string;
}
export const PALETTES: Record<string, PaletteClasses>;
export function palette(name: unknown): PaletteClasses;

export interface StatusEntry {
  emoji: string;
  label: string;
  /** Resolved Tailwind classes. */
  color: string;
}
export interface BucketEntry {
  label: string;
  icon: string;
  order: number;
}
export interface StageEntry {
  label: string;
  icon: string;
  /** Resolved Tailwind classes. */
  color: string;
  order: number;
  open: boolean;
}
export interface KindEntry {
  label: string;
  /** Resolved Tailwind classes. */
  badge: string;
  /** Listed after the other kinds on the pipeline board (e.g. job opportunities vs. business development). */
  separate: boolean;
  /** Card tint classes when separate, else null. */
  card: string | null;
}

export interface Vocab {
  status: Record<string, StatusEntry>;
  buckets: Record<string, BucketEntry>;
  stages: Record<string, StageEntry>;
  kinds: Record<string, KindEntry>;
  strengths: readonly string[];
  /** One entry per status: default keep-warm cadence in days, or null. */
  cadence: Record<string, number | null>;
}
export interface LoadedVocab extends Vocab {
  configPath: string;
  configured: boolean;
}

/** Raw shape of config/vocab.json (palette names, not class strings). */
export interface VocabConfig {
  status?: Record<string, Partial<{ emoji: string; label: string; color: string; order: number }>> & { remove?: string[] };
  buckets?: Record<string, Partial<BucketEntry>> & { remove?: string[] };
  stages?: Record<string, Partial<{ label: string; icon: string; color: string; order: number; open: boolean }>> & {
    remove?: string[];
  };
  kinds?: Record<string, Partial<{ label: string; color: string; order: number }>> & { remove?: string[] };
  strengths?: string[];
  cadence?: Record<string, number | null> & { remove?: string[] };
}

export const DEFAULT_VOCAB: {
  status: Record<string, { emoji: string; label: string; color: string }>;
  buckets: Record<string, BucketEntry>;
  stages: Record<string, { label: string; icon: string; color: string; order: number; open: boolean }>;
  kinds: Record<string, { label: string; color: string }>;
  strengths: string[];
  cadence: Record<string, number | null>;
};

export function mergeVocab(fromFile: unknown): Vocab;
export function loadVocab(root?: string): LoadedVocab;

export function statusList(v: Vocab): string;
export function bucketList(v: Vocab): string;
export function stageList(v: Vocab): string;
export function kindList(v: Vocab): string;
export function cadenceSentence(v: Vocab): string;
