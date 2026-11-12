import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface MenuOption {
  id: string
  label: string
  hint?: string
  count?: number
}

/**
 * A drop-down list drawn by Sift itself. Its panel is placed over everything
 * (it never hides behind the photo or gets cut off by the filmstrip), opens
 * upward when there is no room below, and works from the keyboard:
 * arrows to move, Enter to choose, Esc to close.
 */
export function Menu(props: {
  value: string
  options: MenuOption[]
  onChange: (id: string) => void
  /** What the button says when the value is not one of the options. */
  placeholder: string
  label: string
  title?: string
  /** Highlights the button, e.g. when a filter is on. */
  active?: boolean
  size?: 'sm' | 'md'
  width?: number
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState(0)
  const [place, setPlace] = useState<{ left: number; top?: number; bottom?: number; width: number; maxHeight: number } | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const chosen = props.options.find((o) => o.id === props.value)

  useLayoutEffect(() => {
    if (!open || !button.current) return
    const r = button.current.getBoundingClientRect()
    const width = Math.max(r.width, props.width ?? 220)
    const left = Math.min(r.left, window.innerWidth - width - 8)
    const below = window.innerHeight - r.bottom - 12
    const above = r.top - 12
    setPlace(below >= 220 || below >= above ? { left, top: r.bottom + 6, width, maxHeight: below } : { left, bottom: window.innerHeight - r.top + 6, width, maxHeight: above })
  }, [open, props.width])

  useEffect(() => {
    if (!open) return
    setAt(Math.max(0, props.options.findIndex((o) => o.id === props.value)))
    const close = (e: MouseEvent): void => {
      if (!panel.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false)
    }
    const away = (): void => setOpen(false)
    window.addEventListener('mousedown', close)
    window.addEventListener('resize', away)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('resize', away)
    }
  }, [open, props.options, props.value])

  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLElement>(`[data-i="${at}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [at, open])

  const choose = (id: string): void => {
    props.onChange(id)
    setOpen(false)
    button.current?.focus()
  }

  const onKey = (e: React.KeyboardEvent): void => {
    // Keys used here must not also reach the cull's shortcuts.
    e.stopPropagation()
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        setOpen(true)
      }
      return
    }
    if (e.key === 'Escape') setOpen(false)
    else if (e.key === 'ArrowDown') setAt((i) => Math.min(props.options.length - 1, i + 1))
    else if (e.key === 'ArrowUp') setAt((i) => Math.max(0, i - 1))
    else if (e.key === 'Enter' || e.key === ' ') props.options[at] && choose(props.options[at].id)
    else return
    e.preventDefault()
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        className={`menu-button ${props.size ?? 'md'} ${props.active ? 'active' : ''} ${open ? 'open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKey}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${props.label}: ${chosen?.label ?? props.placeholder}`}
        title={props.title}
      >
        <span className="menu-value">{chosen?.label ?? props.placeholder}</span>
        <svg className="menu-caret" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open &&
        place &&
        createPortal(
          <div
            ref={panel}
            className="menu-panel"
            role="listbox"
            aria-label={props.label}
            tabIndex={-1}
            onKeyDown={onKey}
            style={{ left: place.left, top: place.top, bottom: place.bottom, width: place.width, maxHeight: Math.min(420, place.maxHeight) }}
          >
            {props.options.map((o, i) => (
              <div
                key={o.id}
                data-i={i}
                role="option"
                aria-selected={o.id === props.value}
                className={`menu-item ${i === at ? 'at' : ''} ${o.id === props.value ? 'chosen' : ''}`}
                onMouseEnter={() => setAt(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(o.id)}
              >
                <span className="menu-check" aria-hidden="true">
                  {o.id === props.value ? '✓' : ''}
                </span>
                <span className="menu-text">
                  <span className="menu-label">{o.label}</span>
                  {o.hint && <span className="menu-hint">{o.hint}</span>}
                </span>
                {o.count !== undefined && <span className="menu-count">{o.count}</span>}
              </div>
            ))}
          </div>,
          document.body
        )}
    </>
  )
}
