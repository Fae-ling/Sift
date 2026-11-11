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

/**
 * Splits a shoot into scenes (a pause in shooting starts a new one) and, inside
 * each scene, into stacks of near-identical frames: bursts and repeated takes.
 * Returns the shots in capture order with sceneId and stackId filled in.
 */
export function groupShots(shots: Shot[], sceneGapSec: number): Shot[] {
  const sorted = [...shots].sort((a, b) => a.time - b.time || a.name.localeCompare(b.name, undefined, { numeric: true }))
  let scene = 0
  let stack = 0
  let prev: Shot | undefined
  return sorted.map((shot) => {
    if (!prev) {
      scene = 1
      stack = 1
    } else {
      const gap = (shot.time - prev.time) / 1000
      if (gap > sceneGapSec) {
        scene++
        stack++
      } else {
        const alike =
          gap <= STACK_MAX_GAP_SEC &&
          !!shot.analysis &&
          !!prev.analysis &&
          hamming(shot.analysis.hash, prev.analysis.hash) <= STACK_MAX_DISTANCE
        if (!alike) stack++
      }
    }
    prev = shot
    return { ...shot, sceneId: scene, stackId: stack }
  })
}
