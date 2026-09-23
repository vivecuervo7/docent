import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Loader2, MessageSquare, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Markdown } from "./markdown";
import { PIN_SIZE } from "./noteAnchors";
import type { NoteMessage } from "./prDb";

// The pin that marks a note in the diff's margin, and the floating panel it
// opens into.

const PANEL_WIDTH = 380;
// How far the panel starts above (or ends below) its pin. The arrow sits
// this far in from the panel's edge, level with the pin's middle, so the
// panel's input lands above the selection instead of on it.
const PANEL_OFFSET = 20;
const ARROW_INSET = PANEL_OFFSET + 5;

// A reply that hasn't been seen yet, centred on the icon's top-right corner.
// `ring` matches the surface behind it, so it reads as cut out of the icon.
function UnreadDot({ ring, small }: { ring: string; small?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute rounded-full bg-reviewed",
        small ? "-top-[3px] -right-[3px] size-1.5 ring-[1.5px]" : "-top-1 -right-1 size-2 ring-2",
        ring,
      )}
    />
  );
}

// The comment icon everywhere it appears: an outline at rest, two-tone when
// its button (a `group`) is hovered, and filled when active. Lucide only
// ships outlines, so the fill is layered on through fill-opacity.
export function CommentIcon({
  className,
  unread,
  ring,
  active,
  small = true,
}: {
  className: string;
  unread: boolean;
  ring: string;
  active?: boolean;
  small?: boolean;
}) {
  return (
    <span className="relative">
      <MessageSquare
        fill="currentColor"
        className={cn(
          className,
          "transition-[fill-opacity] duration-150",
          active ? "[fill-opacity:1]" : "[fill-opacity:0] group-hover:[fill-opacity:0.2]",
        )}
      />
      {unread && <UnreadDot ring={ring} small={small} />}
    </span>
  );
}

export function NotePin({
  active,
  unread,
  onClick,
  onHover,
}: {
  active: boolean;
  unread: boolean;
  onClick: () => void;
  onHover: (hovering: boolean) => void;
}) {
  // note-pin-pulse runs once each time the pin becomes active.
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      aria-label={active ? "Close note" : unread ? "Open note (unread reply)" : "Open note"}
      style={{ width: PIN_SIZE, height: PIN_SIZE - 4 }}
      className={cn("group relative grid place-items-center text-reviewed", active && "note-pin-pulse")}
    >
      <CommentIcon className="size-4" unread={unread && !active} ring="ring-background" active={active} />
    </button>
  );
}

// Points at an unread reply that's scrolled out of view, from the top or
// bottom of the margin the pins sit in. Clicking it goes there.
export function OffscreenUnread({
  direction,
  style,
  onClick,
}: {
  direction: "up" | "down";
  style: CSSProperties;
  onClick: () => void;
}) {
  const Chevron = direction === "up" ? ChevronUp : ChevronDown;
  return (
    <button
      type="button"
      onClick={onClick}
      style={style}
      title={direction === "up" ? "Unread reply above" : "Unread reply below"}
      aria-label={direction === "up" ? "Go to the unread reply above" : "Go to the unread reply below"}
      className={cn(
        "group note-offscreen-in fixed z-30 flex items-center gap-0.5 text-reviewed drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]",
        direction === "up" ? "flex-col" : "flex-col-reverse",
      )}
    >
      <Chevron className="size-4" strokeWidth={2.5} />
      <CommentIcon className="size-6" unread ring="ring-background" small={false} />
    </button>
  );
}

// How many threads a file has. On a collapsed file's header (where its pins
// are hidden with its diff) clicking it expands the file; in the sidebar it's
// just a marker.
export function NoteCount({
  count,
  unread,
  ring,
  onClick,
}: {
  count: number;
  unread: boolean;
  ring: string;
  onClick?: () => void;
}) {
  const className = "group relative flex shrink-0 items-center gap-1 px-1 py-0.5 text-[11px] text-reviewed tabular-nums";
  const content = (
    <>
      <CommentIcon className="size-3" unread={unread} ring={ring} />
      {count}
    </>
  );
  const label = `${count} on this file${unread ? ", with an unread reply" : ""}`;
  return onClick ? (
    <button
      type="button"
      onClick={(e) => {
        // It sits inside a clickable header or sidebar row.
        e.stopPropagation();
        onClick();
      }}
      title={unread ? "Open the unread reply" : "Expand to see them"}
      aria-label={`${label}; expand to see them`}
      className={className}
    >
      {content}
    </button>
  ) : (
    <span title={label} aria-label={label} className={className}>
      {content}
    </span>
  );
}

const SUGGESTIONS = ["Explain this", "Could this be simpler?", "What could break?"];

// Hangs to the left of its pin with an arrow pointing at it: downwards from
// the pin, or upwards when there isn't room below it in the scroll area
// (marked data-note-scroller).
export function NotePanel({
  title,
  draft,
  onDraftChange,
  messages,
  pending,
  error,
  onSend,
  onRetry,
  onClose,
  onDelete,
  onRead,
}: {
  title: ReactNode;
  // Held by the caller, so unsent text survives the panel closing.
  draft: string;
  onDraftChange: (text: string) => void;
  messages: NoteMessage[];
  pending: boolean;
  error?: string;
  onSend: (text: string) => void;
  onRetry: () => void;
  onClose: () => void;
  onDelete?: () => void;
  // Called while the thread is on screen, including when a reply lands.
  onRead?: () => void;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<"down" | "up">("down");

  // Decided on open and again when the panel grows (a reply arrives), not on
  // scroll, so it doesn't flip while being read.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const pin = panel?.parentElement;
    const scroller = panel?.closest("[data-note-scroller]");
    if (!panel || !pin || !scroller) return;
    function place() {
      const pinBox = pin!.getBoundingClientRect();
      const view = scroller!.getBoundingClientRect();
      const height = panel!.offsetHeight;
      const below = view.bottom - (pinBox.top - PANEL_OFFSET);
      const above = pinBox.bottom + PANEL_OFFSET - view.top;
      setPlacement(height <= below - 8 || below >= above ? "down" : "up");
    }
    place();
    const observer = new ResizeObserver(place);
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  const onReadRef = useRef(onRead);
  useEffect(() => {
    onReadRef.current = onRead;
  });
  useEffect(() => {
    onReadRef.current?.();
  }, [messages.length]);

  // Scrolls the thread itself; scrollIntoView would drag the diff along too.
  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [messages.length, pending]);

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    onSend(trimmed);
    onDraftChange("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(draft);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <div
      ref={panelRef}
      style={{
        width: PANEL_WIDTH,
        ...(placement === "down" ? { top: -PANEL_OFFSET } : { bottom: -PANEL_OFFSET }),
        transformOrigin: placement === "down" ? "top right" : "bottom right",
      }}
      className="note-panel-in absolute right-full z-30 mr-5 rounded-[10px] border border-reviewed/30 bg-[#1c2128] text-[13px] shadow-[0_16px_40px_rgba(0,0,0,0.6),0_0_0_1px_rgba(0,0,0,0.4)]"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span
        aria-hidden
        style={placement === "down" ? { top: ARROW_INSET } : { bottom: ARROW_INSET }}
        className="absolute -right-[7px] size-3 rotate-45 border-t border-r border-reviewed/30 bg-[#1c2128]"
      />
      <div className="flex items-center gap-2 border-b px-3 py-2 font-mono text-[11.5px] text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            aria-label="Delete note"
            title="Delete note"
            className="rounded p-0.5 hover:text-foreground"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          title="Close (Esc)"
          className="rounded p-0.5 hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {messages.length > 0 && (
        <div ref={threadRef} className="scrollbar-thin max-h-[360px] overflow-y-auto">
          {messages.map((message, i) => (
            <div key={i} className="flex flex-col gap-1 border-b px-3 py-2.5 leading-[1.55]">
              <span className="text-[11.5px] text-muted-foreground">
                {message.role === "user" ? "You" : "Docent"}
              </span>
              <Markdown text={message.text} small />
            </div>
          ))}
          {pending && (
            <div className="flex items-center gap-2 border-b px-3 py-2.5 text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Thinking…
            </div>
          )}
          {error && !pending && (
            <div className="flex items-center gap-2 border-b px-3 py-2.5 text-[#f85149]">
              <span className="min-w-0 flex-1">Couldn't get a reply: {error}</span>
              <button type="button" onClick={onRetry} className="shrink-0 text-foreground underline">
                Retry
              </button>
            </div>
          )}
        </div>
      )}

      <div className="p-3">
        <textarea
          ref={inputRef}
          value={draft}
          rows={draft.includes("\n") ? 3 : 1}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={messages.length === 0 ? "Ask a question or leave a comment…" : "Reply…"}
          className="block w-full resize-none rounded-md border bg-background px-2.5 py-2 text-[13px] outline-none placeholder:text-muted-foreground focus:border-reviewed focus:ring-3 focus:ring-reviewed/20"
        />
      </div>
      {messages.length === 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pb-3">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => send(suggestion)}
              className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground hover:border-reviewed/50 hover:text-foreground"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
