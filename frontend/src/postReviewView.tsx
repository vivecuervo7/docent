import { useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, ExternalLink, Loader2, Pencil, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DraftButton, DraftPrompt, ErrorLine, type DraftStatus, type RenderContext } from "./feedbackViews";
import { describeLines } from "./noteAnchors";
import { MessageText } from "./notes";
import type { FeedbackItem, FeedbackKind, ReviewComment, ReviewDraft, ReviewEvent } from "./prDb";

// The last look before posting: the review laid out the way its recipient
// will see it on GitHub - the review with its summary, then the comments on
// lines beneath it - with every piece editable. Choosing what to post was the
// job of the Feedback steps; here it's the wording.

export interface ReviewCandidate {
  item: FeedbackItem;
  source: FeedbackKind;
}

// What would be sent to GitHub, as the backend builds it.
export interface ReviewPayload {
  event: ReviewEvent;
  body: string;
  comments: { path: string; line: number; start_line?: number; body: string }[];
}

const EVENTS: { event: ReviewEvent; label: string; verb: string }[] = [
  { event: "COMMENT", label: "Comment", verb: "commented" },
  { event: "APPROVE", label: "Approve", verb: "approved these changes" },
  { event: "REQUEST_CHANGES", label: "Request changes", verb: "requested changes" },
];

// Shown as it will render, with an Edit button that turns it into a text
// box. Edits are saved as they're typed.
function EditableText({
  value,
  placeholder,
  readOnly,
  onChange,
}: {
  value: string;
  placeholder: string;
  readOnly: boolean;
  onChange: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing && !readOnly) {
    return (
      <div className="flex flex-col gap-2">
        <textarea
          autoFocus
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setEditing(false);
          }}
          className="min-h-20 w-full resize-none rounded-md border bg-background px-3 py-2.5 text-[15px] leading-relaxed outline-none [field-sizing:content] placeholder:text-muted-foreground focus:border-reviewed"
        />
        <Button size="sm" variant="outline" className="self-end" onClick={() => setEditing(false)}>
          Done
        </Button>
      </div>
    );
  }
  return (
    <div className="group/edit relative text-[15px] leading-relaxed">
      {value.trim() ? (
        <MessageText text={value} />
      ) : (
        <p className="text-muted-foreground italic">{placeholder}</p>
      )}
      {!readOnly && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label="Edit"
          title="Edit"
          className="absolute -top-1 -right-1 grid size-7 place-items-center rounded-md text-muted-foreground opacity-0 group-hover/edit:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100"
        >
          <Pencil className="size-3.5" />
        </button>
      )}
    </div>
  );
}

function LeaveOutButton({ comment, readOnly, onToggle }: { comment: ReviewComment; readOnly: boolean; onToggle: () => void }) {
  if (readOnly) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
    >
      {comment.included ? "Leave out" : "Include"}
    </button>
  );
}

function location(comment: ReviewComment): string {
  if (!comment.path) return "";
  return comment.start && comment.end ? `${comment.path} · ${describeLines(comment.start, comment.end)}` : comment.path;
}

export function PostReviewView({
  pr,
  candidates,
  draft,
  status,
  viewer,
  avatar,
  isOwnPr,
  isInline,
  onPrepare,
  onUpdate,
  onRestore,
  onPreview,
  onPost,
  onStartOver,
  renderContext,
}: {
  pr: string;
  candidates: ReviewCandidate[];
  draft: ReviewDraft | undefined;
  status: DraftStatus;
  viewer?: string;
  avatar: ReactNode;
  // GitHub only lets a PR's author comment on their own PR.
  isOwnPr: boolean;
  // Whether GitHub will take a comment on its lines, or it goes in the
  // review's text.
  isInline: (comment: ReviewComment) => boolean;
  onPrepare: () => void;
  onUpdate: (update: (draft: ReviewDraft) => ReviewDraft) => void;
  // Puts a comment that was left out as already said back in the review.
  onRestore: (index: number) => void;
  onPreview: () => Promise<ReviewPayload>;
  onPost: () => Promise<void>;
  onStartOver: () => void;
  renderContext: RenderContext;
}) {
  const [showDropped, setShowDropped] = useState(false);
  const [confirming, setConfirming] = useState<ReviewPayload | null>(null);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | undefined>(undefined);

  const yours = candidates.filter((c) => c.source === "yours").length;
  const agent = candidates.length - yours;
  const byId = new Map(candidates.map((c) => [c.item.id, c]));
  const tally = `${yours} of your ${yours === 1 ? "comment" : "comments"} and ${agent} from the agent`;

  // The heading spans the page like the other Feedback steps; the review
  // itself reads at the Overview's prose width.
  const page = (children: ReactNode, action?: ReactNode) => (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="shrink-0 px-10 pt-10 pb-6">
        <div className="flex items-start gap-6">
          <div className="min-w-0 flex-1">
            <h2 className="text-[28px] leading-[1.2] font-semibold tracking-tight">Post review</h2>
            <p className="mt-2 max-w-[68ch] text-[15px] leading-relaxed text-muted-foreground">
              A last look at the review as it will appear on the PR. Reword anything before it goes out.
            </p>
          </div>
          {action}
        </div>
      </header>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-10 pt-8 pb-16 [scrollbar-gutter:stable]">
        <div className="mx-auto flex max-w-[860px] flex-col gap-8">{children}</div>
      </div>
    </div>
  );

  if (!draft) {
    return page(
      <DraftPrompt
        heading="Prepare the review"
        body={
          candidates.length > 0
            ? `Put the ${tally} you've kept into one review: comments making the same point are merged, and anything already said on the PR is set aside.`
            : "Nothing's ticked in Your feedback or Agent feedback. You can still prepare a review to approve, or to post a summary on its own."
        }
        label="Prepare review"
        status={status}
        onClick={onPrepare}
      />,
    );
  }

  const readOnly = !!draft.posted;
  const stale =
    !readOnly &&
    (draft.basedOn.length !== candidates.length || candidates.some((c) => !draft.basedOn.includes(c.item.id)));
  const inline = draft.comments.filter((c) => isInline(c));
  const inBody = draft.comments.filter((c) => !isInline(c));
  const kept = draft.comments.filter((c) => c.included);
  const event = EVENTS.find((e) => e.event === draft.event) ?? EVENTS[0];

  const setComment = (id: string, change: Partial<ReviewComment>) =>
    onUpdate((d) => ({ ...d, comments: d.comments.map((c) => (c.id === id ? { ...c, ...change } : c)) }));

  async function preview() {
    setPostError(undefined);
    try {
      setConfirming(await onPreview());
    } catch (err) {
      setPostError((err as Error).message);
    }
  }

  async function post() {
    setPosting(true);
    setPostError(undefined);
    try {
      await onPost();
      setConfirming(null);
    } catch (err) {
      setPostError((err as Error).message);
    } finally {
      setPosting(false);
    }
  }

  return page(
    <>
      {draft.posted && (
        <div className="flex items-center gap-3 rounded-lg border border-reviewed/40 bg-reviewed/10 px-4 py-3 text-[15px]">
          <Check className="size-4 shrink-0 text-reviewed" />
          <span className="min-w-0 flex-1">Posted {new Date(draft.posted.at).toLocaleString()}.</span>
          <a
            href={draft.posted.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-sm text-reviewed hover:underline"
          >
            View on GitHub
            <ExternalLink className="size-3.5" />
          </a>
        </div>
      )}
      <ErrorLine error={status.error} what="Couldn't prepare the review" />
      {stale && (
        <p className="text-sm text-muted-foreground">
          What's ticked in Feedback has changed since this was prepared. Prepare again to include it.
        </p>
      )}

      <div className="flex flex-col">
        {/* The review itself: who, the outcome, the summary, and any comments
            GitHub can't place on lines. */}
        <section className="overflow-hidden rounded-lg border bg-card">
          <div className="flex items-center gap-2.5 border-b bg-muted/50 px-4 py-2.5 text-sm">
            {avatar}
            <span className="font-semibold">{viewer ?? "You"}</span>
            <span className="text-muted-foreground">{event.verb}</span>
          </div>
          <div className="flex flex-col gap-5 bg-background px-5 py-4">
            <EditableText
              value={draft.summary}
              placeholder="No summary. Add one to say something about the PR overall."
              readOnly={readOnly}
              onChange={(summary) => onUpdate((d) => ({ ...d, summary }))}
            />
            {inBody.map((comment) => (
              <div
                key={comment.id}
                className={cn("flex flex-col gap-1.5 border-t pt-4 transition-opacity", !comment.included && "opacity-40")}
              >
                <div className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                    {location(comment) || "About the PR as a whole"}
                  </span>
                  <LeaveOutButton
                    comment={comment}
                    readOnly={readOnly}
                    onToggle={() => setComment(comment.id, { included: !comment.included })}
                  />
                </div>
                <EditableText
                  value={comment.body}
                  placeholder="Empty comments aren't posted."
                  readOnly={readOnly}
                  onChange={(body) => setComment(comment.id, { body })}
                />
              </div>
            ))}
          </div>
        </section>

        {/* The comments on lines, hanging off the review like a thread. */}
        {inline.length > 0 && (
          <div className="ml-6 flex flex-col gap-5 border-l-2 pt-5 pl-6">
            {inline.map((comment) => (
              <article
                key={comment.id}
                className={cn("overflow-hidden rounded-lg border bg-card transition-opacity", !comment.included && "opacity-40")}
              >
                <div className="flex items-center gap-3 border-b bg-muted/50 px-4 py-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{location(comment)}</span>
                  <LeaveOutButton
                    comment={comment}
                    readOnly={readOnly}
                    onToggle={() => setComment(comment.id, { included: !comment.included })}
                  />
                </div>
                {renderContext(comment)}
                <div className="flex gap-3 border-t bg-background px-4 py-4">
                  <span className="mt-0.5 shrink-0">{avatar}</span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <span className="text-sm font-semibold">{viewer ?? "You"}</span>
                    <EditableText
                      value={comment.body}
                      placeholder="Empty comments aren't posted."
                      readOnly={readOnly}
                      onChange={(body) => setComment(comment.id, { body })}
                    />
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {draft.dropped.length > 0 && (
        <section className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setShowDropped((v) => !v)}
            className="flex items-center gap-1.5 self-start text-sm text-muted-foreground hover:text-foreground"
          >
            {showDropped ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            Already said on the PR ({draft.dropped.length})
          </button>
          {showDropped && (
            <ul className="flex flex-col gap-4 pl-5.5">
              {draft.dropped.map((dropped, i) => (
                <li key={i} className="flex flex-col gap-1 text-sm">
                  {dropped.from.map((id) => {
                    const source = byId.get(id);
                    return source ? (
                      <span key={id} className="text-foreground/75">
                        {source.item.body}
                      </span>
                    ) : null;
                  })}
                  <span className="text-muted-foreground">{dropped.reason}</span>
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => onRestore(i)}
                      className="self-start text-xs text-reviewed hover:underline"
                    >
                      Include anyway
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {!readOnly && (
        <section className="flex flex-col gap-4 rounded-xl border bg-card px-6 py-5">
          {confirming ? (
            <>
              <h3 className="text-base font-semibold">Post this review?</h3>
              <p className="text-[15px] leading-relaxed text-muted-foreground">
                To <span className="text-foreground">{pr}</span>
                {viewer && (
                  <>
                    {" "}
                    as <span className="text-foreground">{viewer}</span>
                  </>
                )}
                : {EVENTS.find((e) => e.event === confirming.event)?.label}, with {confirming.comments.length} inline{" "}
                {confirming.comments.length === 1 ? "comment" : "comments"}. It's visible to everyone on the PR.
              </p>
              <ErrorLine error={postError} what="Couldn't post the review" />
              <div className="flex gap-2">
                <Button onClick={post} disabled={posting} className="bg-reviewed-strong px-4 text-white hover:bg-[#388bfd]">
                  {posting ? <Loader2 className="animate-spin" /> : <Send />}
                  Post to GitHub
                </Button>
                <Button variant="outline" onClick={() => setConfirming(null)} disabled={posting}>
                  Back
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {EVENTS.map(({ event: option, label }) => {
                  const unavailable = isOwnPr && option !== "COMMENT";
                  return (
                    <button
                      key={option}
                      type="button"
                      disabled={unavailable}
                      title={unavailable ? "GitHub doesn't let you approve or request changes on your own PR." : undefined}
                      onClick={() => onUpdate((d) => ({ ...d, event: option }))}
                      className={cn(
                        "rounded-md border px-3 py-1.5 text-sm",
                        draft.event === option
                          ? "border-reviewed bg-reviewed/15 text-foreground"
                          : "text-muted-foreground enabled:hover:text-foreground",
                        unavailable && "opacity-40",
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <ErrorLine error={postError} what="Couldn't post the review" />
              <div className="flex items-center gap-3">
                <Button onClick={preview} className="bg-reviewed-strong px-4 text-white hover:bg-[#388bfd]">
                  <Send />
                  Post review
                </Button>
                <span className="text-sm text-muted-foreground">
                  {kept.length} {kept.length === 1 ? "comment" : "comments"}
                  {draft.summary.trim() ? " and a summary" : ""}
                </span>
              </div>
            </>
          )}
        </section>
      )}
    </>,
    !confirming && (
      <DraftButton
        label={readOnly ? "Start a new review" : "Prepare again"}
        status={status}
        onClick={readOnly ? onStartOver : onPrepare}
      />
    ),
  );
}
