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
	// Set once the reviewer keeps or skips an agent's finding; until then it's
	// kept by default but still waiting on them.
	decided?: boolean;
	// The reviewer's questions about a finding, and the answers.
	messages?: NoteMessage[];
	// When the reviewer last had the finding open; an answer after this is unread.
	readAt?: number;
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

// A thread, or a finding asked about, with a reply since it was last open.
export function isUnread(talk: { messages?: NoteMessage[]; readAt?: number }): boolean {
	const reply = talk.messages?.findLast((m) => m.role === 'assistant');
	return !!reply && reply.at > (talk.readAt ?? 0);
}

export type AgentId = `agent-${number}`;
export const FIRST_AGENT: AgentId = 'agent-1';

export interface AgentReviewer {
	id: AgentId;
	// A generated handle, e.g. "copper-eagle"; agents can be told it instead
	// of the id.
	name?: string;
	ranWith?: string;
	// What it's set to run with next: a model, or "external". Chosen on the
	// panel card, or given by the default panel.
	planned?: string;
	// Its latest review, kept after the backend has let it go.
	lastRun?: { startedAt: number; endedAt?: number; status: AgentReview['status']; findings: number; error?: string };
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
	// Set once the reviewer changes the panel, or the default panel has been
	// applied: after that the default isn't applied again.
	panelSettled?: boolean;
	// Every reviewer name handed out on this PR, so none is reused.
	agentNamesUsed?: string[];
	review?: ReviewDraft;
	title?: string;
	// The model this review uses, taken from the start page's when it's first
	// prepared, and changeable from inside the review.
	model?: string;
	// The PR's author, saved when it's opened, for the start page.
	author?: string;
	// The PR's head commit when its slices were made, to tell when it's had
	// new commits since.
	preparedHead?: string;
	// Set once the reviewer marks the review complete, after posting.
	completedAt?: number;
	lastOpenedAt?: number;
}

export interface SavedPr extends PrRef {
	record: PrRecord;
}

export type StepName = 'slices' | 'conversation' | 'summary' | 'notes';

export interface Generation {
	id: string;
	status: 'queued' | 'running' | 'done' | 'failed' | 'stopped';
	// The model it ran with, when the review has its own.
	model?: string;
	steps: Record<StepName, { status: 'pending' | 'active' | 'done'; startedAt?: number }>;
	results: {
		slices?: Slice[];
		conversation?: ConversationSummary;
		summary?: PrSummary;
		fileNotes?: Record<string, FileNote[]>;
		// The head commit the slices were made from.
		head?: string;
	};
	error?: string;
}

export interface ModelOption {
	id: string;
	label: string;
	// Where it runs, as the menu groups it: "Claude Code" or a provider's name.
	source: string;
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
	source: 'builtin' | 'external' | 'persona';
	model?: string;
	status: 'running' | 'done' | 'failed' | 'stopped';
	progress?: { done: number; total: number; current?: string };
	findings: { id: string; path?: string; startLine?: number; endLine?: number; body: string; rationale?: string }[];
	error?: string;
	startedAt: number;
	endedAt?: number;
}

export type ReviewEvent = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';

// One comment in the prepared review. Shared with the React app's records.
export interface ReviewComment {
	id: string;
	body: string;
	included: boolean;
	// The feedback items it covers.
	from: string[];
	path?: string;
	start?: LineRef;
	end?: LineRef;
}

// The review as prepared from what was kept in Wrap up, then worded.
export interface ReviewDraft {
	preparedAt: number;
	// The feedback items that were kept when it was prepared.
	basedOn: string[];
	comments: ReviewComment[];
	// Kept feedback left out, with why: usually that someone already said it.
	dropped: { from: string[]; reason: string }[];
	summary: string;
	// The reviewer chose to post without the review's own text.
	summaryLeftOut?: boolean;
	event: ReviewEvent;
	posted?: { at: number; url: string };
}

// What would be sent to GitHub, as the backend builds it.
export interface ReviewPayload {
	event: ReviewEvent;
	body: string;
	comments: { path: string; line: number; start_line?: number; body: string }[];
}
