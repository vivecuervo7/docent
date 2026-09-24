// The shapes Docent's backend stores and returns. The React app in
// frontend/ reads and writes the same records, so these follow its
// frontend/src/prDb.ts.

export interface PrRef {
	owner: string;
	repo: string;
	number: string;
}

export interface PrFile {
	filename: string;
	status: string;
	additions: number;
	deletions: number;
	patch?: string;
	previous_filename?: string;
}

export interface PrMeta {
	title: string;
	author?: string;
	htmlUrl?: string;
	body?: string;
}

export interface LineRef {
	side: 'old' | 'new';
	line: number;
}

export interface Slice {
	id: string;
	title: string;
	summary: string;
	hunks: string[];
}

export interface PrSummary {
	what: string;
	why: string;
	how?: string;
}

export interface ConversationSummary {
	prAuthor: string;
	reviewers: {
		reviewer: string;
		verdict?: 'approved' | 'changes requested' | 'commented';
		summary: string;
		replies: { from: 'author' | 'reviewer'; outcome?: string; summary: string }[];
	}[];
	authorNotes?: string;
}

export interface FileNote {
	path: string;
	kind: 'tests' | 'context';
	note: string;
	// In notes from before the note itself gave a verdict.
	quality?: string;
	// For tests: new-file lines that name a test or group of tests.
	scenarioLines?: number[];
	// Code only worth skimming - imports, test setup - as new-file lines.
	quietRanges?: { kind: 'imports' | 'setup'; startLine: number; endLine: number }[];
}

export interface FeedbackItem {
	id: string;
	body: string;
	included: boolean;
	path?: string;
	start?: LineRef;
	end?: LineRef;
	noteIds?: string[];
	rationale?: string;
}

export interface FeedbackDraft {
	items: FeedbackItem[];
	draftedAt: number;
	basedOn?: Record<string, number>;
}

// A thread about lines the reviewer selected: a question or a remark, and
// the model's replies.
export interface NoteMessage {
	role: 'user' | 'assistant';
	text: string;
	at: number;
}

export interface Note {
	id: string;
	path: string;
	// The hunk the selection starts in, for showing its lines again.
	hunk: number;
	start: LineRef;
	end: LineRef;
	// The selected lines as they read when the thread began, with +/- markers.
	code: string;
	messages: NoteMessage[];
	createdAt: number;
	// When the reviewer last had the thread open; a reply after this is unread.
	readAt?: number;
}

export function isUnread(note: Note): boolean {
	const reply = note.messages.findLast((m) => m.role === 'assistant');
	return !!reply && reply.at > (note.readAt ?? 0);
}

export type AgentId = `agent-${number}`;
export const FIRST_AGENT: AgentId = 'agent-1';

export interface AgentReviewer {
	id: AgentId;
	// A generated handle, e.g. "copper-eagle"; agents can be told it instead
	// of the id.
	name?: string;
	ranWith?: string;
}

export interface PrRecord {
	reviewed: Record<string, boolean>;
	slices: Slice[] | null;
	summary: PrSummary | null;
	conversation: ConversationSummary | null;
	fileNotes: Record<string, FileNote[]> | null;
	notes: Note[];
	feedback: Record<string, FeedbackDraft | undefined>;
	agentReviewers: AgentReviewer[];
	agentHighest?: number;
	// Every reviewer name handed out on this PR, so none is reused.
	agentNamesUsed?: string[];
	// The prepared review; its shape is Post review's concern.
	review?: unknown;
	title?: string;
	lastOpenedAt?: number;
}

export interface SavedPr extends PrRef {
	record: PrRecord;
}

export type StepName = 'slices' | 'conversation' | 'summary' | 'notes';

export interface Generation {
	id: string;
	status: 'queued' | 'running' | 'done' | 'failed' | 'stopped';
	steps: Record<StepName, { status: 'pending' | 'active' | 'done'; startedAt?: number }>;
	results: {
		slices?: Slice[];
		conversation?: ConversationSummary;
		summary?: PrSummary;
		fileNotes?: Record<string, FileNote[]>;
	};
	error?: string;
}

export interface ModelOption {
	id: string;
	label: string;
	group: 'endpoint' | 'claude-code';
}

// Results a generation can skip because they're already saved.
export interface Reuse {
	slices?: Slice[] | null;
	conversation?: ConversationSummary | null;
	fileNotes?: Record<string, FileNote[]> | null;
}

// An agent review as the backend reports it, while running or just ended.
export interface AgentReview {
	id: string;
	source: 'builtin' | 'external';
	model?: string;
	status: 'running' | 'done' | 'failed' | 'stopped';
	progress?: { done: number; total: number; current?: string };
	findings: { id: string; path?: string; startLine?: number; endLine?: number; body: string; rationale?: string }[];
	error?: string;
}
