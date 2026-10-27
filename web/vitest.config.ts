import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Tests of Docent's own logic, run without SvelteKit. Anything that opens
// Docent's data folder gets a scratch one, never the real reviews.
export default defineConfig({
	resolve: { alias: { $lib: fileURLToPath(new URL('./src/lib', import.meta.url)) } },
	test: {
		include: ['src/**/*.test.ts'],
		env: { DOCENT_DATA_DIR: join(tmpdir(), `docent-test-${process.pid}`) }
	}
});
