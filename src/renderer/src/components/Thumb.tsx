import { memo } from 'react'
import type { Shot } from '@shared/types'
import { thumbUrl } from '../analysis/pipeline'

const WARNING_MARK: Record<string, string> = { blink: 'eyes', soft: 'soft', 'soft-face': 'soft', clipped: 'hot', dark: 'dark' }

/** A thumbnail with its decision, suggestion and warning markers. */
export const Thumb = memo(function Thumb(props: {
  projectId: string
  shot: Shot
  selected?: boolean
  onSelect?: (id: string) => void
}): React.JSX.Element {
  const { shot, selected, onSelect, projectId } = props
  const flag = shot.decision ?? (shot.suggestion && shot.suggestion !== 'reject' ? `s-${shot.suggestion}` : null)
  const warning = shot.score?.warnings[0]
  return (
    <div
      data-shot={shot.id}
      className={`thumb ${selected ? 'sel' : ''} ${shot.decision === 'reject' ? 'reject' : ''}`}
      onClick={() => onSelect?.(shot.id)}
      title={shot.name}
    >
      {shot.analysis ? <img src={thumbUrl(projectId, shot.id)} loading="lazy" draggable={false} alt={shot.name} /> : null}
      {flag && <span className={`flag ${flag}`} />}
      {shot.score?.gem ? <span className="w gem">gem</span> : warning && <span className="w">{WARNING_MARK[warning]}</span>}
      {shot.rating > 0 && <span className="stars">{'★'.repeat(shot.rating)}</span>}
    </div>
  )
})
