import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

// Tests of Docent's own logic, run without SvelteKit. Anything that opens
// Docent's data folder gets a scratch one, never the real reviews.
export default defineConfig({
	test: {
		include: ['src/**/*.test.ts'],
		env: { DOCENT_DATA_DIR: join(tmpdir(), `docent-test-${process.pid}`) }
	}
});
