import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { listAgentReviews } from '$lib/features/panel/agentReviews.server.js';

// Every agent review running or waiting to be collected, across PRs.
export const GET: RequestHandler = () => json({ reviews: listAgentReviews() });
