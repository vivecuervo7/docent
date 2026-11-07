import type { RequestHandler } from './$types';
import { readStats } from '#lib/features/stats/stats.server.js';

export const GET: RequestHandler = () => Response.json(readStats());
