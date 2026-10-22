import { Fragment, memo, useState } from 'react'
import type { JSX, ReactNode } from 'react'

function inline(text: string): ReactNode[] {
  return text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g).map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`'))
      return (
        <code className="message-inline-code" key={index}>
          {part.slice(1, -1)}
        </code>
      )
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={index}>{part.slice(2, -2)}</strong>
    return part
  })
}

function CodeBlock({ language, content }: { language: string; content: string }): JSX.Element {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setFailed(false)
    } catch {
      setCopied(false)
      setFailed(true)
    }
  }
  return (
    <div className="message-code">
      <div className="message-code-header">
        <span>{language || 'Code'}</span>
        <button className="message-copy" type="button" onClick={() => void copy()}>
          {copied ? 'Copied' : failed ? 'Copy unavailable' : 'Copy code'}
        </button>
      </div>
      <pre>
        <code>{content}</code>
      </pre>
    </div>
  )
}

/** Render readable text and code without interpreting model output as HTML. */
export const MessageContent = memo(function MessageContent({
  content,
}: {
  content: string
}): JSX.Element {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    const fence = /^\s*```([^`]*)$/.exec(line)
    if (fence) {
      const start = index++
      const code: string[] = []
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index] ?? ''))
        code.push(lines[index++] ?? '')
      if (index < lines.length) index++
      blocks.push(
        <CodeBlock key={start} language={fence[1]?.trim() ?? ''} content={code.join('\n')} />,
      )
      continue
    }
    if (!line.trim()) {
      index++
      continue
    }
    const heading = /^#{1,6}\s+(.+)$/.exec(line)
    if (heading) {
      blocks.push(
        <p className="message-heading" key={index++}>
          {inline(heading[1] ?? '')}
        </p>,
      )
      continue
    }
    if (/^\s*(?:[-*+]\s+|\d+[.)]\s+).+/.test(line)) {
      const start = index
      const ordered = /^\s*\d+[.)]\s+/.test(line)
      const items: ReactNode[] = []
      const pattern = ordered ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/
      while (index < lines.length) {
        const item = pattern.exec(lines[index] ?? '')
        if (!item) break
        items.push(<li key={index++}>{inline(item[1] ?? '')}</li>)
      }
      blocks.push(
        ordered ? (
          <ol className="message-list" key={start}>
            {items}
          </ol>
        ) : (
          <ul className="message-list" key={start}>
            {items}
          </ul>
        ),
      )
      continue
    }
    const start = index
    const paragraph: string[] = [line]
    index++
    while (index < lines.length) {
      const next = lines[index] ?? ''
      if (!next.trim() || /^\s*```[^`]*$|^#{1,6}\s+.+$|^\s*(?:[-*+]\s+|\d+[.)]\s+).+/.test(next))
        break
      paragraph.push(next)
      index++
    }
    blocks.push(
      <p className="message-paragraph" key={start}>
        {paragraph.map((text, lineIndex) => (
          <Fragment key={lineIndex}>
            {lineIndex > 0 && <br />}
            {inline(text)}
          </Fragment>
        ))}
      </p>,
    )
  }
  return <div className="message-content">{blocks}</div>
})
