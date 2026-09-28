import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { listAgentReviews } from '$lib/server/agentReview.js';

// Every agent review running or waiting to be collected, across PRs.
export const GET: RequestHandler = () => json({ reviews: listAgentReviews() });
