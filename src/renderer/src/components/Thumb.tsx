import { memo } from 'react'
import type { Shot } from '@shared/types'
import { thumbUrl } from '../analysis/pipeline'

const WARNING_MARK: Record<string, string> = { blink: 'eyes', soft: 'soft', 'soft-face': 'soft', clipped: 'hot', dark: 'dark' }

/** How a thumbnail was clicked: plain, with Ctrl/Cmd (add or remove), or with Shift (a range). */
export interface ClickMods {
  toggle: boolean
  range: boolean
}

/** A thumbnail with its decision, suggestion and warning markers. */
export const Thumb = memo(function Thumb(props: {
  projectId: string
  shot: Shot
  selected?: boolean
  /** Chosen together with others, to decide in one go. */
  marked?: boolean
  onSelect?: (id: string, mods: ClickMods) => void
  /** Hide what the app thinks of this frame (its burst is being judged unprompted). */
  hide?: boolean
}): React.JSX.Element {
  const { shot, selected, marked, onSelect, projectId, hide } = props
  const flag = shot.decision ?? (!hide && shot.suggestion && shot.suggestion !== 'reject' ? `s-${shot.suggestion}` : null)
  const warning = hide ? undefined : shot.score?.warnings[0]
  return (
    <div
      data-shot={shot.id}
      className={`thumb ${selected ? 'sel' : ''} ${marked ? 'marked' : ''} ${shot.decision === 'reject' ? 'reject' : ''}`}
      onClick={(e) => onSelect?.(shot.id, { toggle: e.ctrlKey || e.metaKey, range: e.shiftKey })}
      title={`${shot.name}${shot.why?.length ? ` · rejected: ${shot.why.join(', ')}` : ''}`}
      role="option"
      aria-selected={selected || marked}
    >
      {shot.analysis ? <img src={thumbUrl(projectId, shot.id)} loading="lazy" draggable={false} alt={shot.name} /> : null}
      {flag && <span className={`flag ${flag}`} />}
      {marked && <span className="tick">✓</span>}
      {shot.score?.gem && !hide ? <span className="w gem">gem</span> : warning && <span className="w">{WARNING_MARK[warning]}</span>}
      {shot.rating > 0 && <span className="stars">{'★'.repeat(shot.rating)}</span>}
    </div>
  )
})
