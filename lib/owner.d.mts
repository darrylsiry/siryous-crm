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
  first: string;
  First: string;
  possessive: string;
  Possessive: string;
  practiceIntro: string;
}
export function loadOwner(root?: string): Owner;
