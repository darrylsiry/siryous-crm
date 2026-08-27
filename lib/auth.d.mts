export const AUTH_COOKIE: string;
export const COOKIE_MAX_AGE: number;
export function authEnabled(): boolean;
export function tokenPath(): string;
export function getAuthToken(): string;
/** True when getAuthToken() had to generate the token in this process (first run). */
export function wasJustCreated(): boolean;
export function tokenMatches(candidate: unknown): boolean;
export function signInUrl(origin?: string): string;
