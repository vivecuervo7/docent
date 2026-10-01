import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

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
