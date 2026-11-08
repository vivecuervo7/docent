import { isHttpError } from '@sveltejs/kit';

// What went wrong, worded for the page. A remote function's error isn't an
// Error: its message is in its body.
export const messageOf = (err: unknown): string => (isHttpError(err) ? err.body.message : err instanceof Error ? err.message : String(err));
