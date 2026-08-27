export const AUTH_COOKIE: string;
export const COOKIE_MAX_AGE: number;
export function authEnabled(): boolean;
export function tokenPath(): string;
export function getAuthToken(): string;
export function tokenMatches(candidate: unknown): boolean;
export function signInUrl(origin?: string): string;
