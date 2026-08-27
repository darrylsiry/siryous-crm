export function todayLocal(d?: Date): string;
export function isIsoDate(s: unknown): s is string;
export function parseDueDate(label: string | null | undefined, base?: string): string | null;
export function splitLastTouch(value: string | null | undefined): { date: string | null; note: string | null };
