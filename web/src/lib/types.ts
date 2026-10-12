// The shapes Docent's backend stores and returns.

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
	// Reviewing a range of commits: the hunks it touched, and its lines in
	// them. Without these, the whole PR is under review.
	inRange?: number[];
	rangeLines?: { old: number[]; new: number[] };
}

export interface PrMeta {
	title: string;
	// The PR's latest commit.
	head?: string;
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
	// The reviewer's own comments from a thread, word for word: posted as
	// written and on the thread's lines.
	asWritten?: boolean;
	rationale?: string;
	// Set once the reviewer keeps or skips an agent's finding; until then it's
	// kept by default but still waiting on them.
	decided?: boolean;
	// The reviewer's questions about a finding, and the answers.
	messages?: NoteMessage[];
	// When the reviewer last had the finding open; an answer after this is unread.
	readAt?: number;
	// Been through the panel's editor, which groups and filters findings;
	// until then it isn't shown. `editFailed` shows it anyway, as it is,
	// until the editor's next try.
	edited?: boolean;
	editFailed?: boolean;
	// Why the editor filtered it out, as trivial or unfounded.
	filtered?: string;
	// The finding it makes the same point as, which leads their group.
	joins?: { reviewer: string; id: string };
	// The group's lead it was separated from, to merge back into.
	separatedFrom?: { reviewer: string; id: string };
	// The slice Docent's reviewer found it in.
	slice?: string;
	// What the editor found checking a kept finding against the code.
	checked?: string;
	// What a kept finding assumes, when nothing in the PR or the code
	// settles it.
	speculative?: string;
	// How much it matters, as its reviewer judged it or the editor lowered it.
	severity?: Severity;
	// What a finding that joined a group disagrees with its lead about.
	disputed?: string;
	// For an external reviewer's finding, the PR thread already raising it.
	onPr?: string;
	// Why the reviewer's own process set it aside before handing it back;
	// the editor judged it in full.
	setAside?: string;
	// How likely it is, and what happens when it does, as the editor judged.
	impact?: string;
	impactLevel?: 'low' | 'moderate' | 'high';
	// What checking it against the code found, in a word.
	checkedVerdict?: 'confirmed' | 'partly' | 'unsettled';
	// Why the editor suggests skipping it: it holds, but likely isn't worth
	// posting. It starts out skipped until the reviewer decides.
	skipSuggested?: string;
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
	// What was asked, when a quick question's label stands for more.
	prompt?: string;
	// A comment the reviewer means to post as written, asking for no reply.
	comment?: boolean;
	// The reviewer's conclusion to a conversation, asking for no reply: not
	// posted, but what drafting and Prepare follow.
	conclusion?: boolean;
}

// A thread on selected lines, or without lines on a whole file, or with no
// path either on the PR as a whole.
export interface Note {
	id: string;
	// Empty for a thread on the PR as a whole.
	path: string;
	// The hunk the selection starts in, for showing its lines again.
	hunk?: number;
	start?: LineRef;
	end?: LineRef;
	// The selected lines as they read when the thread began, with +/- markers.
	code?: string;
	messages: NoteMessage[];
	createdAt: number;
	// When the reviewer last had the thread open; a reply after this is unread.
	readAt?: number;
}

// Where a thread sits, in words: its lines, its file, or the PR.
export function noteWhere(note: Pick<Note, 'path' | 'start' | 'end'>): string {
	if (!note.path) return 'the PR as a whole';
	if (!note.start || !note.end) return 'the whole file';
	return note.start.line === note.end.line ? `line ${note.start.line}` : `lines ${note.start.line}–${note.end.line}`;
}

// A thread, or a finding asked about, with a reply since it was last open.
export function isUnread(talk: { messages?: NoteMessage[]; readAt?: number }): boolean {
	const reply = talk.messages?.findLast((m) => m.role === 'assistant');
	return !!reply && reply.at > (talk.readAt ?? 0);
}

// A panel finding not yet read: never opened, seen in full or decided on.
export function isNewFinding(item: { readAt?: number; decided?: boolean }): boolean {
	return !item.readAt && !item.decided;
}

export type AgentId = `agent-${number}`;
export const FIRST_AGENT: AgentId = 'agent-1';

export interface AgentReviewer {
	id: AgentId;
	// A generated handle, e.g. "copper-eagle"; agents can be told it instead
	// of the id.
	name?: string;
	ranWith?: string;
	// What it's set to run with next: a model, "external", or a session
	// ("session:<id>"). Chosen on the panel card, or given by the default panel.
	planned?: string;
	// For Docent's reviewer, the persona it takes; none is the default.
	persona?: string;
	// Switched off on the panel, so it isn't started with the others until
	// it's switched back on. Kept, so reopening the PR remembers it.
	off?: boolean;
	// A reviewer "auto" added, with why the PR warranted its persona; "auto"
	// replaces its picks each time it runs.
	pickedBy?: AgentId;
	pickReason?: string;
	// For "auto" ("auto:<model>"), the personas it last picked.
	// `general` when the general reviewer went in with its picks, which it
	// does unless one is on the panel by choice.
	picks?: { at: number; personas: string[]; general?: boolean; error?: string };
	// Its latest review, kept after the backend has let it go.
	lastRun?: {
		startedAt: number;
		endedAt?: number;
		status: AgentReview['status'];
		findings: number;
		error?: string;
		// An external reviewer's own overall recommendation.
		verdict?: { event: ReviewEvent; reason?: string };
	};
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
	// The commits under review, when it isn't the whole PR.
	range?: ReviewRange;
	// Set once the reviewer marks the review complete, after posting.
	completedAt?: number;
	lastOpenedAt?: number;
	// Earlier reviews of the PR, oldest first; the fields above are the latest.
	rounds?: Round[];
}

export type Round = Partial<
	Pick<
		PrRecord,
		| 'range'
		| 'reviewed'
		| 'slices'
		| 'summary'
		| 'conversation'
		| 'fileNotes'
		| 'notes'
		| 'feedback'
		| 'agentReviewers'
		| 'agentHighest'
		| 'panelSettled'
		| 'review'
		| 'preparedHead'
		| 'completedAt'
	>
>;

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
export type Severity = 'blocker' | 'major' | 'minor' | 'nit';
export const SEVERITY_ORDER: Severity[] = ['blocker', 'major', 'minor', 'nit'];

export interface AgentReview {
	id: string;
	source: 'builtin' | 'external' | 'session';
	model?: string;
	status: 'running' | 'done' | 'failed' | 'stopped';
	// `waiting` while its next call is queued behind others.
	progress?: { done: number; total: number; current?: string; waiting?: boolean; finished?: string[] };
	findings: { id: string; path?: string; startLine?: number; endLine?: number; body: string; rationale?: string; slice?: string; severity?: Severity; setAside?: string }[];
	error?: string;
	verdict?: { event: ReviewEvent; reason?: string };
	startedAt: number;
	endedAt?: number;
}

export type ReviewEvent = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';

// One comment in the prepared review.
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
	// How preparing suggested submitting it, and why.
	suggested?: { event: ReviewEvent; reason?: string };
	// Pending: left on GitHub for the reviewer to add to and submit there.
	posted?: { at: number; url: string; pending?: boolean };
}

// What would be sent to GitHub, as the backend builds it.
export interface ReviewPayload {
	// None for a review left pending.
	event?: ReviewEvent;
	body: string;
	comments: { path: string; line: number; start_line?: number; body: string }[];
}

// Some of a PR's commits: those after `after`, up to and including `to`.
export interface ReviewRange {
	after: string;
	to: string;
}

export interface PrCommit {
	sha: string;
	// The commit before it: where a range starting at it begins.
	parent: string;
	date: string;
	// Its first line.
	message: string;
	merge: boolean;
}

// Said on the PR on GitHub, by its reviewers or its author: inline threads
// where they sit, and what was said on the PR as a whole.
export interface GitHubEntry {
	author: string;
	body: string;
	createdAt: string;
}

export interface GitHubThread {
	id: string;
	path: string;
	// Where it sits at the PR's head; none when it's outdated or on a whole file.
	start?: LineRef;
	end?: LineRef;
	outdated: boolean;
	originalLine?: number;
	entries: GitHubEntry[];
}

export interface GitHubComments {
	threads: GitHubThread[];
	general: (GitHubEntry & { id: string; state?: string })[];
}
