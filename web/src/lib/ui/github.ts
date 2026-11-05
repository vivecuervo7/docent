// The GitHub host, set once by the root layout before anything renders.
let host = 'github.com';

export const setGithubHost = (h: string) => (host = h);
export const githubHost = () => host;
export const githubUrl = (path: string) => `https://${host}/${path}`;
