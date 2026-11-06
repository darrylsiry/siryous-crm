export const AUTH_COOKIE: string;
export const COOKIE_MAX_AGE: number;
export function authEnabled(): boolean;
export function tokenPath(): string;
export function getAuthToken(): string;
/** True when getAuthToken() had to generate the token in this process (first run). */
export function wasJustCreated(): boolean;
export function tokenMatches(candidate: unknown): boolean;
export function normalizeToken(raw: string | null | undefined): string;
export const SESSION_DAYS: number;
export function createSession(now?: number): string;
export function sessionFor(candidate: unknown, now?: number): string | null;
export function touchSession(id: string, now?: number): void;
export function endOtherSessions(keepId: string | null): void;
export function legacyCookie(candidate: unknown): boolean;
export function cookieOptions(): { httpOnly: boolean; sameSite: "strict"; path: string; maxAge: number };
export function healthProof(nonce: unknown): string | null;
export function createSignInCode(): string;
export function consumeSignInCode(candidate: unknown): boolean;
