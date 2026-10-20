import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { readStats } from '$lib/features/stats/stats.server.js';

export const GET: RequestHandler = () => json(readStats());
