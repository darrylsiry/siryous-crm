export function todayLocal(d?: Date): string;
export function isIsoDate(s: unknown): s is string;
export function parseDueDate(label: string | null | undefined, base?: string): string | null;
export function splitLastTouch(value: string | null | undefined): { date: string | null; note: string | null };
export function shortDate(iso: string | null | undefined, today?: string): string;
export function localStamp(stored: string | null | undefined, today?: string): string;
export function localDateOf(stored: string | null | undefined): string;
export function ago(stored: string | null | undefined, now?: Date): string;
