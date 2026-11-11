import { Fragment, useState } from 'react'
import { ARTICLES, CATEGORIES, type Article } from '../knowledge'

/** Renders **bold** inside a line of text. */
function Inline({ text }: { text: string }): React.JSX.Element {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/).map((part, i) =>
        part.startsWith('**') ? <b key={i}>{part.slice(2, -2)}</b> : <Fragment key={i}>{part}</Fragment>
      )}
    </>
  )
}

/** Turns the small Markdown subset used by the articles into elements. */
function Body({ text }: { text: string }): React.JSX.Element {
  const out: React.JSX.Element[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  const flush = (): void => {
    if (!list) return
    const items = list.items.map((item, i) => (
      <li key={i}>
        <Inline text={item} />
      </li>
    ))
    out.push(list.ordered ? <ol key={out.length}>{items}</ol> : <ul key={out.length}>{items}</ul>)
    list = null
  }
  for (const raw of text.trim().split('\n')) {
    const line = raw.trim()
    const bullet = /^- (.*)/.exec(line)
    const numbered = /^\d+\. (.*)/.exec(line)
    if (bullet || numbered) {
      const ordered = !!numbered
      if (!list || list.ordered !== ordered) {
        flush()
        list = { ordered, items: [] }
      }
      list.items.push((bullet ?? numbered)![1])
      continue
    }
    flush()
    if (!line) continue
    if (line.startsWith('## ')) out.push(<h2 key={out.length}>{line.slice(3)}</h2>)
    else
      out.push(
        <p key={out.length}>
          <Inline text={line} />
        </p>
      )
  }
  flush()
  return <>{out}</>
}

export function Learn(): React.JSX.Element {
  const [current, setCurrent] = useState<Article>(ARTICLES[0])
  return (
    <div className="learn">
      <div className="learn-nav">
        {CATEGORIES.map((category) => (
          <div key={category}>
            <h3 style={{ paddingLeft: 10 }}>{category}</h3>
            {ARTICLES.filter((a) => a.category === category).map((a) => (
              <button key={a.id} className={a.id === current.id ? 'on' : ''} onClick={() => setCurrent(a)}>
                {a.title}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="article" key={current.id}>
        <div className="page">
          <div className="muted small">{current.category}</div>
          <h1>{current.title}</h1>
          <p className="lead">{current.summary}</p>
          <Body text={current.body} />
          <h3>Go deeper</h3>
          <ul className="small">
            {current.sources.map((s) => (
              <li key={s.label}>
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noreferrer">
                    {s.label}
                  </a>
                ) : (
                  s.label
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
