import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// GitHub-flavoured markdown, styled to sit in the app's cards: what a review
// comment will look like once it's posted.

const components: Components = {
  p: ({ children }) => <p className="leading-relaxed">{children}</p>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-reviewed hover:underline">
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 pl-3 text-muted-foreground">{children}</blockquote>
  ),
  h1: ({ children }) => <h3 className="text-base font-semibold">{children}</h3>,
  h2: ({ children }) => <h3 className="text-base font-semibold">{children}</h3>,
  h3: ({ children }) => <h4 className="text-[15px] font-semibold">{children}</h4>,
  pre: ({ children }) => (
    <pre className="scrollbar-thin overflow-x-auto rounded-md border bg-card px-3 py-2.5 font-mono text-[12.5px] leading-relaxed [&_code]:bg-transparent [&_code]:p-0">
      {children}
    </pre>
  ),
  code: ({ children }) => <code className="rounded bg-secondary px-1 py-px font-mono text-[12.5px]">{children}</code>,
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table className="text-sm [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:px-2 [&_th]:py-1">
        {children}
      </table>
    </div>
  ),
};

export function Markdown({ text, small = false }: { text: string; small?: boolean }) {
  return (
    <div className={small ? "flex flex-col gap-2 text-sm" : "flex flex-col gap-3 text-[15px]"}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
