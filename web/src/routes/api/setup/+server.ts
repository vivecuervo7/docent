import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { checkSetup } from '$lib/server/setup.js';

// What's set up on this machine, for the Getting started page.
export const GET: RequestHandler = async () => json(await checkSetup());
