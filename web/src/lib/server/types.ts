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

export type ReplyOutcome = "actioned" | "acknowledged" | "refuted" | "answered" | "mixed";

export interface ThreadReply {
  from: "author" | "reviewer";
  outcome?: ReplyOutcome;
  summary: string;
}

export interface ReviewerConversation {
  reviewer: string;
  verdict?: "approved" | "changes requested" | "commented";
  summary: string;
  replies: ThreadReply[];
}

export interface ConversationSummary {
  prAuthor: string;
  reviewers: ReviewerConversation[];
  authorNotes?: string;
}

// A note on one file within a slice (see fileNotes.ts).
export interface FileNote {
  path: string;
  // What a test file tests, or what a large change amounts to.
  kind: "tests" | "context";
  note: string;
  // For tests, in notes from before the note itself gave a verdict.
  quality?: string;
  // For tests: new-file lines that name a test or group of tests, so the
  // code between them can be folded away.
  scenarioLines?: number[];
  // Code the reviewer would only skim - imports, test setup - shown folded
  // with what changed inside. New-file lines.
  quietRanges?: { kind: "imports" | "setup"; startLine: number; endLine: number }[];
}
