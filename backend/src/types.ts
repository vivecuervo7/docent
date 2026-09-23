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

export interface ConversationCard {
  author: string;
  kind: string;
  summary: string;
}
