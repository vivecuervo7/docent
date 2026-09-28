import { resolve } from "node:path";

// Where Docent keeps its settings, reviews and repo cache: the app's own data
// folder, beside whatever runs it, unless DOCENT_DATA_DIR says otherwise.
export function dataDir(...parts: string[]): string {
  return resolve(process.env.DOCENT_DATA_DIR ?? resolve(process.cwd(), "data"), ...parts);
}
