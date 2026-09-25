<script lang="ts">
	import { modelLabel, nameOf } from '$lib/panel.svelte';
	import { useSession } from '$lib/session.svelte';
	import type { AgentReviewer } from '$lib/types';
	import Spinner from './Spinner.svelte';
	import StateMark from './StateMark.svelte';

	// The panel at a glance, from any page: a chip while its reviewers work,
	// staying as "done" once they've finished, that opens to where each one is.
	const session = useSession();
	const panel = session.panel;
	const base = $derived(`/pr/${session.ref.owner}/${session.ref.repo}/${session.ref.number}`);

	let open = $state(false);
	let now = $state(Date.now());

	const ran = $derived(panel.reviewers.filter((r) => panel.reviews[r.id] || r.lastRun));
	const running = $derived(panel.running.length);

	// Live times while anything's running and the list is open.
	$effect(() => {
		if (!open || !running) return;
		now = Date.now();
		const tick = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(tick);
	});

	$effect(() => {
		if (!open) return;
		const close = (e: Event) => {
			if (e instanceof KeyboardEvent ? e.key === 'Escape' : !(e.target as Element).closest('.chip')) open = false;
		};
		window.addEventListener('pointerdown', close);
		window.addEventListener('keydown', close);
		return () => {
			window.removeEventListener('pointerdown', close);
			window.removeEventListener('keydown', close);
		};
	});

	function duration(ms: number): string {
		const s = Math.max(0, Math.round(ms / 1000));
		if (s < 60) return `${s}s`;
		const m = Math.floor(s / 60);
		if (m < 60) return `${m}m ${s % 60}s`;
		return `${Math.floor(m / 60)}h ${m % 60}m`;
	}

	function runsWith(r: AgentReviewer): string {
		const value = r.ranWith ?? r.planned;
		if (!value) return '';
		return value === 'external' ? 'your own agent' : modelLabel(value);
	}

	// Where a reviewer is, in a line.
	function whereIs(r: AgentReviewer): { text: string; working: boolean } {
		const live = panel.reviews[r.id];
		const run = live
			? { status: live.status, startedAt: live.startedAt, endedAt: live.endedAt, findings: live.findings.length }
			: r.lastRun;
		if (!run) return { text: 'Not started', working: false };
		const found = `${run.findings} ${run.findings === 1 ? 'finding' : 'findings'}`;
		if (run.status === 'running') {
			const elapsed = run.startedAt ? ` · ${duration(now - run.startedAt)}` : '';
			if (live?.source === 'external') return { text: `Waiting for your agent${elapsed}`, working: true };
			const p = live?.progress;
			const where = p?.total ? `Slice ${Math.min(p.done + 1, p.total)} of ${p.total}` : 'Starting';
			return { text: `${where}${elapsed}`, working: true };
		}
		const took = run.startedAt && run.endedAt ? ` in ${duration(run.endedAt - run.startedAt)}` : '';
		if (run.status === 'done') return { text: `Done${took} · ${found}`, working: false };
		if (run.status === 'stopped') return { text: `Stopped${took} · ${found}`, working: false };
		return { text: 'Stopped with an error', working: false };
	}
</script>

{#if ran.length}
	<div class="chip">
		<button class="pill" aria-haspopup="dialog" aria-expanded={open} onclick={() => (open = !open)}>
			{#if running}
				<Spinner size={15} />
				<span>Panel · {running} reviewing</span>
			{:else}
				<StateMark state="done" size={15} />
				<span>Panel · done</span>
			{/if}
			{#if panel.findingCount}<span class="faint">{panel.findingCount} {panel.findingCount === 1 ? 'finding' : 'findings'}</span>{/if}
		</button>
		{#if open}
			<div class="popover" role="dialog" aria-label="Your review panel">
				<ul>
					{#each panel.reviewers as r (r.id)}
						{@const s = whereIs(r)}
						<li>
							<div class="who">
								<span class="name">{nameOf(r)}</span>
								{#if runsWith(r)}<span class="faint model">{runsWith(r)}</span>{/if}
							</div>
							<span class="state" class:working={s.working}>
								{#if s.working}<Spinner size={12} />{/if}
								{s.text}
							</span>
						</li>
					{/each}
				</ul>
				<a class="more" href={base} onclick={() => (open = false)}>The panel on the Overview →</a>
			</div>
		{/if}
	</div>
{/if}

<style>
	.chip {
		position: relative;
	}
	.pill {
		display: flex;
		align-items: center;
		gap: 10px;
		height: 34px;
		padding: 0 14px;
		border: 0;
		border-radius: 999px;
		background: #1d1a14;
		color: #f2d9b0;
		font: inherit;
		font-size: 13.5px;
		cursor: pointer;
	}
	.pill:hover,
	.pill[aria-expanded='true'] {
		background: #262118;
	}
	.popover {
		position: absolute;
		z-index: 40;
		top: calc(100% + 8px);
		right: 0;
		width: 340px;
		padding: 6px 0 0;
		border-radius: 14px;
		background: var(--popover);
		box-shadow:
			0 0 0 1px var(--popover-line),
			0 30px 70px -20px rgba(0, 0, 0, 0.7);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	li {
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 10px 16px;
		border-bottom: 1px solid var(--popover-line);
	}
	.who {
		display: flex;
		align-items: baseline;
		gap: 8px;
	}
	.name {
		color: var(--agent-text);
		font-weight: 500;
		font-size: 14px;
	}
	.model {
		font-size: 12.5px;
	}
	.state {
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: 13px;
		color: var(--muted);
	}
	.state.working {
		color: var(--text);
	}
	.more {
		display: block;
		padding: 10px 16px 12px;
		color: var(--faint);
		font-size: 13px;
		text-decoration: none;
	}
	.more:hover {
		color: var(--text);
	}
</style>
