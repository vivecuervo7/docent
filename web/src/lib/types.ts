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
	quality?: string;
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

export interface Note {
	id: string;
	path: string;
	hunk: number;
	start: LineRef;
	end: LineRef;
	code?: string;
	messages: { role: 'user' | 'assistant'; text: string; at?: number }[];
	readAt?: number;
}

export type AgentId = `agent-${number}`;
export const FIRST_AGENT: AgentId = 'agent-1';

export interface AgentReviewer {
	id: AgentId;
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
