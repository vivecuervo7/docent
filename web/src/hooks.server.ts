// Keeps the stats from the start, so no review saved before they're first
// opened goes unrecorded.
import '#lib/features/stats/stats.server.js';
import { persistent } from '#lib/storage/persistent.server.js';
// Marks work left under way by the last run as interrupted.
import '#lib/storage/interrupted.server.js';
// Marks rounds posted before posting marked them done.
import '#lib/storage/postedDone.server.js';
import { modelOptions } from '#lib/models/modelProvider.server.js';
import { setupCheck } from '#lib/features/settings/setupChecks.server.js';
import { guard } from '#lib/api/requestGuard.server.js';

// What's installed and which models there are, looked at once the server
// starts, so the first page to ask has an answer waiting.
persistent('checks-warmed', () => {
	modelOptions.fresh().catch(() => {});
	setupCheck.fresh().catch(() => {});
	return true;
});

// Background work nothing waits on - saving a finished job, say - that fails
// anyway is logged, rather than stopping the server.
persistent('unhandled-rejections', () => process.on('unhandledRejection', (err) => console.error('[unhandled]', err)));

// Answers only this machine, and changes only from Docent's own pages.
export const handle = guard;
