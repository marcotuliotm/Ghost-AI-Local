import { memo, useCallback, useRef, useState, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'

// Model output rendered as Markdown (GFM: tables, task lists, strikethrough)
// with syntax-highlighted code. Nothing in a reply may reach the network or
// navigate the overlay: raw HTML stays off (react-markdown's default), links
// render as plain text with the URL in a tooltip, and images are replaced by
// their alt text instead of being fetched.

async function copyText(text: string) {
  if (window.ghostAPI?.copyText) await window.ghostAPI.copyText(text)
  else await navigator.clipboard.writeText(text)
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const preRef = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    const text = preRef.current?.textContent ?? ''
    if (!text) return
    try {
      await copyText(text.replace(/\n$/, ''))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard may be unavailable; ignore silently
    }
  }, [])

  return (
    <div className="relative group/code">
      <pre ref={preRef}>{children}</pre>
      <button
        type="button"
        onClick={handleCopy}
        className="absolute top-1 right-1 px-1.5 py-0.5 rounded text-[8px] bg-ghost-fill text-ghost-text-muted opacity-0 group-hover/code:opacity-100 hover:text-ghost-text transition-opacity"
        title="Copy code"
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  )
}

const components: Components = {
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  a: ({ children, href }) => (
    <span className="underline decoration-dotted" title={href}>{children}</span>
  ),
  img: ({ alt }) => <span className="text-ghost-text-muted">[image{alt ? `: ${alt}` : ''}]</span>,
  table: ({ children }) => (
    <div className="overflow-x-auto my-1.5"><table>{children}</table></div>
  ),
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={components}>
      {text}
    </ReactMarkdown>
  )
})
