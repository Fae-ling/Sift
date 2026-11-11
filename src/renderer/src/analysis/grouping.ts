import type { Shot } from '@shared/types'

/** Number of differing bits between two 64-bit hashes written as hex. */
export function hamming(a: string, b: string): number {
  let bits = 0
  for (let i = 0; i < a.length; i += 8) {
    let x = (parseInt(a.slice(i, i + 8), 16) ^ parseInt(b.slice(i, i + 8), 16)) >>> 0
    while (x) {
      x &= x - 1
      bits++
    }
  }
  return bits
}

/** Frames this close in time and this alike are treated as the same moment. */
export const STACK_MAX_GAP_SEC = 20
export const STACK_MAX_DISTANCE = 14

/** The camera body a shot came from, for clock correction and stacking. */
export const bodyOf = (shot: Shot): string => shot.body ?? shot.camera ?? 'Unknown camera'

/**
 * Splits a shoot into scenes (a pause in shooting starts a new one) and, inside
 * each scene, into stacks of near-identical frames: bursts and repeated takes.
 * Returns the shots in capture order with sceneId and stackId filled in.
 *
 * `clockOffsets` (seconds per camera body) corrects cameras whose clocks
 * disagree, so two bodies at one wedding interleave in true order. A stack
 * never mixes bodies: two cameras see a moment from different places.
 */
export function groupShots(shots: Shot[], sceneGapSec: number, clockOffsets: Record<string, number> = {}): Shot[] {
  const at = (s: Shot): number => s.time + (clockOffsets[bodyOf(s)] ?? 0) * 1000
  const sorted = [...shots].sort((a, b) => at(a) - at(b) || a.name.localeCompare(b.name, undefined, { numeric: true }))
  let scene = 0
  let stack = 0
  let prev: Shot | undefined
  /** The stack currently open for each body, and its last frame. */
  const open = new Map<string, { stack: number; last: Shot }>()
  return sorted.map((shot) => {
    const gap = prev ? (at(shot) - at(prev)) / 1000 : 0
    if (!prev || gap > sceneGapSec) {
      scene++
      open.clear()
    }
    const body = bodyOf(shot)
    const mine = open.get(body)
    const alike =
      !!mine &&
      (at(shot) - at(mine.last)) / 1000 <= STACK_MAX_GAP_SEC &&
      !!shot.analysis &&
      !!mine.last.analysis &&
      hamming(shot.analysis.hash, mine.last.analysis.hash) <= STACK_MAX_DISTANCE
    const id = alike ? mine!.stack : ++stack
    open.set(body, { stack: id, last: shot })
    prev = shot
    return { ...shot, sceneId: scene, stackId: id }
  })
}
