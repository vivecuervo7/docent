import { fetchPrConversation, withoutReviews, type PrConversation } from "./github.server.js";
import { roundRecord } from "../storage/rounds.server.js";

// What's been said on the PR, as a round's review reads it: without the
// reviews left out of that round, so a point only they made isn't taken as
// already said.
export async function roundConversation(owner: string, repo: string, number: string, round?: number): Promise<PrConversation> {
  const leftOut = (roundRecord(owner, repo, number, round).leftOutReviews as string[] | undefined) ?? [];
  return withoutReviews(await fetchPrConversation(owner, repo, number), leftOut);
}
