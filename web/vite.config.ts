import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true),
				// `await` in components, which remote functions are read with.
				experimental: { async: true }
			},

			// Pages read and change data through remote functions (*.remote.ts).
			// Still experimental, taken on knowingly: they're where SvelteKit is
			// heading, and Docent is a local tool its own users can update with.
			experimental: { remoteFunctions: true },

			adapter: adapter()
		})
	],
	server: {
		// Agents are given this port for MCP, so it can't drift. Five digits and
		// below the OS's range for outgoing ports, clear of other dev servers.
		port: Number(process.env.DOCENT_PORT ?? 17321),
		strictPort: true
	}
});
