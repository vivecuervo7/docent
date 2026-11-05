import { githubHost } from '$lib/github/host.server.js';

export const load = () => ({ githubHost: githubHost() });
