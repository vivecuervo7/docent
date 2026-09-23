import { useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, Copy, Loader2, Plug, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { describeLines } from "./noteAnchors";
import { MessageText } from "./notes";
import type { FeedbackDraft, FeedbackItem, Note } from "./prDb";

// The Feedback steps: drafting review comments from your threads and from
// the agent review, ticking which to keep, and (next) posting them.

export interface DraftStatus {
  pending?: boolean;
  error?: string;
}

function FeedbackPage({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="shrink-0 px-10 pt-10 pb-6">
        <div className="flex items-start gap-6">
          <div className="min-w-0 flex-1">
            <h2 className="text-[28px] leading-[1.2] font-semibold tracking-tight">{title}</h2>
            <p className="mt-2 max-w-[68ch] text-[15px] leading-relaxed text-muted-foreground">{subtitle}</p>
          </div>
          {action}
        </div>
      </header>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-10 pb-12 [scrollbar-gutter:stable]">
        <div className="flex flex-col gap-8">{children}</div>
      </div>
    </div>
  );
}

function DraftButton({
  label,
  status,
  onClick,
  disabled,
}: {
  label: string;
  status: DraftStatus;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button variant="outline" onClick={onClick} disabled={disabled || status.pending} className="shrink-0">
      {status.pending && <Loader2 className="animate-spin" />}
      {status.pending ? "Working…" : label}
    </Button>
  );
}

function location(item: { path?: string; start?: Note["start"]; end?: Note["end"] }) {
  if (!item.path) return "The whole PR";
  const file = item.path.split("/").pop();
  return item.start && item.end ? `${file} · ${describeLines(item.start, item.end)}` : file;
}

// The code a comment is about, as GitHub shows it beside a review comment.
// Drawn by the app, which has the diffs.
export type RenderContext = (item: FeedbackItem) => ReactNode;

function FeedbackItems({
  items,
  onToggle,
  onOpen,
  renderContext,
}: {
  items: FeedbackItem[];
  onToggle: (id: string) => void;
  onOpen?: (item: FeedbackItem) => void;
  renderContext: RenderContext;
}) {
  return (
    <ul className="flex flex-col gap-4">
      {items.map((item) => (
        <li
          key={item.id}
          className={cn(
            "overflow-hidden rounded-lg border transition-opacity",
            !item.included && "opacity-55",
          )}
        >
          <div className="flex items-center gap-3 border-b bg-muted/50 px-4 py-2.5">
            <Checkbox
              checked={item.included}
              onCheckedChange={() => onToggle(item.id)}
              aria-label={item.included ? "Leave this out of the review" : "Include this in the review"}
            />
            {onOpen && item.path ? (
              <button
                type="button"
                onClick={() => onOpen(item)}
                title={`Go to ${item.path}`}
                className="min-w-0 truncate font-mono text-xs font-medium hover:text-reviewed"
              >
                {item.path}
                {item.start && item.end && (
                  <span className="text-muted-foreground"> · {describeLines(item.start, item.end)}</span>
                )}
              </button>
            ) : (
              <span className="min-w-0 truncate font-mono text-xs font-medium">
                {item.path ?? "The whole PR"}
                {item.start && item.end && (
                  <span className="text-muted-foreground"> · {describeLines(item.start, item.end)}</span>
                )}
              </span>
            )}
          </div>
          <div className="flex flex-col gap-2.5 px-4 py-3.5">
            <div className="text-[15px] leading-relaxed">
              <MessageText text={item.body} />
            </div>
            {item.rationale && (
              <div className="text-[13px] leading-relaxed text-muted-foreground">
                <MessageText text={item.rationale} />
              </div>
            )}
          </div>
          {renderContext(item)}
        </li>
      ))}
    </ul>
  );
}

function ErrorLine({ error }: { error?: string }) {
  return error ? <p className="text-sm text-[#f85149]">Couldn't draft feedback: {error}</p> : null;
}

// Threads count as changed since a draft when one was added, removed, or has
// new messages.
function isStale(draft: FeedbackDraft | undefined, notes: Note[]): boolean {
  if (!draft?.basedOn) return false;
  const basedOn = draft.basedOn;
  return (
    notes.length !== Object.keys(basedOn).length || notes.some((n) => basedOn[n.id] !== n.messages.length)
  );
}

// Before anything's drafted, drafting is the only thing to do here, so it's
// the whole page.
function DraftPrompt({
  heading,
  body,
  label,
  status,
  onClick,
}: {
  heading: string;
  body: string;
  label: string;
  status: DraftStatus;
  onClick: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-4 rounded-xl border bg-card px-8 py-8">
      <div className="flex flex-col gap-1.5">
        <h3 className="text-lg font-semibold">{heading}</h3>
        <p className="max-w-[60ch] text-[15px] leading-relaxed text-muted-foreground">{body}</p>
      </div>
      <Button
        size="lg"
        onClick={onClick}
        disabled={status.pending}
        className="bg-reviewed-strong px-5 text-white hover:bg-[#388bfd]"
      >
        {status.pending ? <Loader2 className="animate-spin" /> : <Sparkles />}
        {status.pending ? "Drafting…" : label}
      </Button>
      <ErrorLine error={status.error} />
    </div>
  );
}

export function YourFeedbackView({
  notes,
  draft,
  status,
  onDraft,
  onToggle,
  onOpenNote,
  renderContext,
}: {
  notes: Note[];
  draft: FeedbackDraft | undefined;
  status: DraftStatus;
  onDraft: () => void;
  onToggle: (id: string) => void;
  onOpenNote: (note: Note) => void;
  renderContext: RenderContext;
}) {
  const [showDiscarded, setShowDiscarded] = useState(false);
  const stale = isStale(draft, notes);
  const openItem = (item: FeedbackItem) => {
    const note = notes.find((n) => item.noteIds?.includes(n.id));
    if (note) onOpenNote(note);
  };
  // Threads the draft considered but raised nothing from.
  const used = new Set(draft?.items.flatMap((i) => i.noteIds ?? []));
  const discarded = draft ? notes.filter((n) => draft.basedOn?.[n.id] !== undefined && !used.has(n.id)) : [];
  const count = `${notes.length} ${notes.length === 1 ? "question or comment" : "questions and comments"}`;

  return (
    <FeedbackPage
      title="Your feedback"
      subtitle="Review comments worth raising with the author, drawn from the questions and comments you left on the code."
      action={draft && <DraftButton label="Redraft" status={status} onClick={onDraft} />}
    >
      {notes.length === 0 ? (
        <p className="text-[15px] leading-relaxed text-muted-foreground">
          Nothing to draft from yet. In a slice, hold{" "}
          <kbd className="rounded border px-1 font-mono text-[12px]">⌥</kbd> and drag over code to ask a
          question or leave a comment.
        </p>
      ) : !draft ? (
        <DraftPrompt
          heading="Draft your feedback"
          body={`From your ${count}, write up the review comments worth posting. Questions that were answered with nothing to raise are left out.`}
          label="Draft feedback"
          status={status}
          onClick={onDraft}
        />
      ) : (
        <>
          <ErrorLine error={status.error} />
          {stale && (
            <p className="text-sm text-muted-foreground">
              You've asked or commented more since this was drafted. Redraft to include it.
            </p>
          )}
          {draft.items.length === 0 ? (
            <p className="text-[15px] text-muted-foreground">
              Nothing you asked or commented on looked worth raising with the author.
            </p>
          ) : (
            <FeedbackItems items={draft.items} onToggle={onToggle} onOpen={openItem} renderContext={renderContext} />
          )}
          {discarded.length > 0 && (
            <section className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setShowDiscarded((v) => !v)}
                className="flex items-center gap-1.5 self-start text-sm text-muted-foreground hover:text-foreground"
              >
                {showDiscarded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                Not raised ({discarded.length})
              </button>
              {showDiscarded && (
                <ul className="flex flex-col gap-1 pl-5.5">
                  {discarded.map((note) => (
                    <li key={note.id} className="flex items-baseline gap-3 text-sm">
                      <span className="w-40 shrink-0 truncate font-mono text-[11.5px] text-muted-foreground">
                        {location(note)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-foreground/70">
                        {note.messages.find((m) => m.role === "user")?.text}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}
    </FeedbackPage>
  );
}

// The review as the backend reports it, while it's running or just ended.
export interface AgentReviewState {
  source: "builtin" | "external";
  status: "running" | "done" | "failed" | "stopped";
  progress?: { done: number; total: number; current?: string };
  findingCount: number;
  error?: string;
}

// Where the reviewer's own agent connects. The backend's address, not the
// frontend's: agents talk to it directly.
const MCP_URL = "http://localhost:3001/mcp";

function CopyBlock({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="relative">
        <pre className="scrollbar-thin overflow-x-auto rounded-md border bg-background px-3 py-2.5 pr-11 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap">
          {value}
        </pre>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          aria-label={`Copy ${label.toLowerCase()}`}
          title="Copy"
          className="absolute top-2 right-2 grid size-7 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {copied ? <Check className="size-4 text-reviewed" /> : <Copy className="size-4" />}
        </button>
      </div>
    </div>
  );
}

function agentPrompt(pr: string): string {
  return `Review the pull request ${pr} using the docent MCP tools. Start with get_review_context, then read each slice with get_diff, using read_file where you need more context. Check get_existing_comments so you don't repeat what's already been said. Submit each problem worth raising with submit_finding, on lines from get_diff, then call finish_review.`;
}

export function AgentFeedbackView({
  pr,
  draft,
  review,
  error,
  onRunBuiltin,
  onUseOwnAgent,
  onStop,
  onFinish,
  onToggle,
  onOpen,
  renderContext,
}: {
  pr: string;
  draft: FeedbackDraft | undefined;
  review: AgentReviewState | null;
  error?: string;
  onRunBuiltin: () => void;
  onUseOwnAgent: () => void;
  onStop: () => void;
  onFinish: () => void;
  onToggle: (id: string) => void;
  onOpen: (item: FeedbackItem) => void;
  renderContext: RenderContext;
}) {
  const [choosing, setChoosing] = useState(false);
  const running = review?.status === "running";
  const items = draft?.items ?? [];
  const showChoice = !running && (!draft || choosing);

  const choice = (
    <div className="flex flex-col gap-5 rounded-xl border bg-card px-8 py-8">
      <div className="flex flex-col gap-1.5">
        <h3 className="text-lg font-semibold">{draft ? "Run the agent review again" : "Run an agent review"}</h3>
        <p className="max-w-[62ch] text-[15px] leading-relaxed text-muted-foreground">
          An agent reviews the whole PR and drafts comments of its own. Use Docent's reviewer, or connect your
          own agent - any model or harness that speaks MCP.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button
          size="lg"
          onClick={() => {
            setChoosing(false);
            onRunBuiltin();
          }}
          className="bg-reviewed-strong px-5 text-white hover:bg-[#388bfd]"
        >
          <Sparkles />
          Run Docent's reviewer
        </Button>
        <Button
          size="lg"
          variant="outline"
          onClick={() => {
            setChoosing(false);
            onUseOwnAgent();
          }}
        >
          <Plug />
          Use your own agent
        </Button>
        {draft && (
          <Button size="lg" variant="ghost" onClick={() => setChoosing(false)}>
            Cancel
          </Button>
        )}
      </div>
      <ErrorLine error={error} />
    </div>
  );

  return (
    <FeedbackPage
      title="Agent feedback"
      subtitle="An optional review of the whole PR by an agent. Tick the comments to include alongside yours."
      action={
        draft && !running && !choosing && <DraftButton label="Run again" status={{}} onClick={() => setChoosing(true)} />
      }
    >
      {showChoice && choice}

      {running && review.source === "builtin" && (
        <div className="flex items-center gap-3 rounded-lg border px-4 py-3 text-[15px]">
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">
            {review.progress && review.progress.total > 0
              ? `Reviewing ${review.progress.current ?? "…"} (${Math.min(review.progress.done + 1, review.progress.total)} of ${review.progress.total})`
              : "Starting the review…"}
          </span>
          <Button variant="outline" size="sm" onClick={onStop}>
            Stop
          </Button>
        </div>
      )}

      {running && review.source === "external" && (
        <div className="flex flex-col gap-5 rounded-xl border bg-card px-8 py-7">
          <h3 className="text-base font-semibold">With Claude Code</h3>
          <CopyBlock
            label="Add Docent once, for every project"
            value={`claude mcp add --scope user --transport http docent ${MCP_URL}`}
          />
          <CopyBlock
            label="Then review the PR your usual way, and send the findings here"
            value={`/mcp__docent__review ${pr}`}
          />
          <CopyBlock
            label="Or, after a review you've already run in the session, send its findings"
            value={`/mcp__docent__submit ${pr}`}
          />
          <details className="group/other flex flex-col gap-4">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
              <ChevronRight className="size-4 group-open/other:rotate-90" />
              Other agents
            </summary>
            <div className="mt-4 flex flex-col gap-5">
              <CopyBlock label="Connect your agent to Docent's MCP server (Streamable HTTP)" value={MCP_URL} />
              <CopyBlock label="Then ask it" value={agentPrompt(pr)} />
            </div>
          </details>
          <div className="flex items-center gap-3 text-[15px]">
            <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
            <span className="min-w-0 flex-1 text-muted-foreground">
              Waiting for findings
              {review.findingCount > 0 && ` · ${review.findingCount} so far`}
            </span>
            <Button variant="outline" size="sm" onClick={onStop}>
              Cancel
            </Button>
            <Button size="sm" onClick={onFinish} className="bg-reviewed-strong text-white hover:bg-[#388bfd]">
              Finish
            </Button>
          </div>
        </div>
      )}

      {review?.status === "failed" && (
        <p className="text-sm text-[#f85149]">The review stopped with an error: {review.error}</p>
      )}
      {review?.status === "stopped" && <p className="text-sm text-muted-foreground">The review was stopped.</p>}

      {items.length > 0 ? (
        <FeedbackItems items={items} onToggle={onToggle} onOpen={onOpen} renderContext={renderContext} />
      ) : (
        draft &&
        !running &&
        !showChoice && <p className="text-[15px] text-muted-foreground">The agent didn't find anything to raise.</p>
      )}
    </FeedbackPage>
  );
}

export function PostReviewView({ yours, agent }: { yours: number; agent: number }) {
  return (
    <FeedbackPage
      title="Post review"
      subtitle="Where your feedback and the agent's come together to be posted to the PR."
    >
      <div className="flex flex-col gap-3 text-[15px] leading-relaxed text-muted-foreground">
        <p>
          Coming next. This step will combine the comments you've ticked, check them against what's already
          been said on the PR so nothing is raised twice, and let you reword them and choose an outcome
          (comment, approve, or request changes) before posting.
        </p>
        <p className="text-foreground/80">
          Ticked so far: {yours} of your comments and {agent} from the agent.
        </p>
      </div>
    </FeedbackPage>
  );
}
