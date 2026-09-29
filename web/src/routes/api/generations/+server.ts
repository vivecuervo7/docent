import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { listGenerations } from '$lib/features/preparing/generation.server.js';

// Preparing a PR's review (slices, conversation, summary) runs as a
// background generation; see generation.ts.
export const GET: RequestHandler = () => json({ generations: listGenerations() });
