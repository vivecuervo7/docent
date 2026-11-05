export const DEFAULT_HOST = 'github.com';

// The GitHub host Docent works against: gh's own GH_HOST, which gh's calls
// already follow, or github.com. Taken just as gh takes it, so the two never
// disagree on the host: gh wants the bare name, as written when signing in.
export const githubHost = () => process.env.GH_HOST?.trim() || DEFAULT_HOST;
