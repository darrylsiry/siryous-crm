export interface Owner {
  appName: string;
  ownerName: string;
  ownerFirstName: string;
  ownerEmail: string;
  practiceName: string;
  practiceDescription: string;
  researchTriggers: string;
  coachPersona: string;
  coachContextDir: string;
  coachContextGuidance: string;
  mcpServerName: string;
  configured: boolean;
  configPath: string;
  /** Set when config/owner.json exists but couldn't be read: why. The defaults are used. */
  readError: string | null;
  /** Fields left at the example file's sample text, and so ignored. */
  ignoredSamples: string[];
  first: string;
  First: string;
  possessive: string;
  Possessive: string;
  practiceIntro: string;
}
export function loadOwner(root?: string): Owner;
export function resetOwner(): void;
export const OWNER_FORM_FIELDS: string[];
