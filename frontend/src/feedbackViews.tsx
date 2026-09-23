import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Loader2, Sparkles } from "lucide-react";
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
        <div className="flex max-w-[860px] flex-col gap-8">{children}</div>
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

function FeedbackItems({
  items,
  onToggle,
  onOpen,
}: {
  items: FeedbackItem[];
  onToggle: (id: string) => void;
  onOpen?: (item: FeedbackItem) => void;
}) {
  return (
    <ul className="flex flex-col divide-y rounded-lg border">
      {items.map((item) => (
        <li key={item.id} className={cn("flex items-start gap-4 px-4 py-3.5", !item.included && "opacity-55")}>
          <Checkbox
            checked={item.included}
            onCheckedChange={() => onToggle(item.id)}
            aria-label={item.included ? "Leave this out of the review" : "Include this in the review"}
            className="mt-0.5"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            {onOpen && item.path ? (
              <button
                type="button"
                onClick={() => onOpen(item)}
                title={`Go to ${item.path}`}
                className="self-start font-mono text-[11.5px] text-muted-foreground hover:text-foreground"
              >
                {location(item)}
              </button>
            ) : (
              <span className="font-mono text-[11.5px] text-muted-foreground">{location(item)}</span>
            )}
            <div className="text-[15px] leading-relaxed">
              <MessageText text={item.body} />
            </div>
          </div>
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
}: {
  notes: Note[];
  draft: FeedbackDraft | undefined;
  status: DraftStatus;
  onDraft: () => void;
  onToggle: (id: string) => void;
  onOpenNote: (note: Note) => void;
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
            <FeedbackItems items={draft.items} onToggle={onToggle} onOpen={openItem} />
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

export function AgentFeedbackView({
  draft,
  status,
  onRun,
  onToggle,
}: {
  draft: FeedbackDraft | undefined;
  status: DraftStatus;
  onRun: () => void;
  onToggle: (id: string) => void;
}) {
  return (
    <FeedbackPage
      title="Agent feedback"
      subtitle="An optional review of the whole PR by an agent. Tick the comments to include alongside yours."
      action={draft && <DraftButton label="Run again" status={status} onClick={onRun} />}
    >
      {draft && <ErrorLine error={status.error} />}
      {draft ? (
        draft.items.length === 0 ? (
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            The agent review returned nothing. It isn't built yet, so for now it always returns an empty
            review.
          </p>
        ) : (
          <FeedbackItems items={draft.items} onToggle={onToggle} />
        )
      ) : (
        <DraftPrompt
          heading="Run an agent review"
          body="An agent reviews the whole PR and drafts comments of its own. It's optional, and you choose which of its comments to keep."
          label="Run agent review"
          status={status}
          onClick={onRun}
        />
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
