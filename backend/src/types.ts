export interface Idea {
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
