// Re-estimating a culled project.
//
// The app should get more precise with time, and an old cull is the way to
// check: score it again with what the app knows today, with everything it
// learned from that very project taken out, and see how many of the
// photographer's decisions it would now have predicted. The same pass turns
// up frames worth another look.

import type { Estimate, Shot, Suggestion } from '@shared/types'

interface Calls {
  right: number
  total: number
}

/**
 * How often the app's call matches the photographer's. For a moment with
 * several frames and a keeper: is the app's keeper one they kept? For a
 * single frame: does keep-or-leave match? `suggestionOf` says what the app
 * suggested for a frame, or undefined when unknown.
 */
function calls(shots: Shot[], suggestionOf: (s: Shot) => Suggestion | undefined): Calls {
  const stacks = new Map<number, Shot[]>()
  for (const s of shots) if (s.analysis) stacks.set(s.stackId ?? 0, [...(stacks.get(s.stackId ?? 0) ?? []), s])
  const out = { right: 0, total: 0 }
  for (const stack of stacks.values()) {
    // Only decisions made by hand say anything: an accepted suggestion agrees with itself.
    const judged = stack.filter((s) => s.decision !== null && s.decidedBy !== 'accepted')
    if (!judged.length || stack.some((s) => suggestionOf(s) === undefined)) continue
    const kept = stack.filter((s) => s.decision === 'pick')
    if (stack.length > 1 && kept.length) {
      out.total++
      if (kept.some((s) => suggestionOf(s) === 'pick')) out.right++
    } else {
      for (const s of judged) {
        out.total++
        const keep = suggestionOf(s) !== 'reject'
        if (keep === (s.decision === 'pick')) out.right++
      }
    }
  }
  return out
}

/**
 * Compares the decisions in `decided` with what the app suggested when they
 * were made and with what it suggests now (`rescored`: the same frames, scored
 * with today's knowledge minus this project).
 */
export function estimateOf(decided: Shot[], rescored: Shot[]): Estimate {
  const now = new Map(rescored.map((s) => [s.id, s.suggestion]))
  const then = calls(decided, (s) => (s.decision !== null ? s.suggestedThen : (s.suggestedThen ?? 'reject')))
  const today = calls(decided, (s) => now.get(s.id) ?? 'reject')
  const hadSuggestions = decided.some((s) => s.suggestedThen)
  return {
    at: Date.now(),
    frames: decided.filter((s) => s.decision !== null && s.decidedBy !== 'accepted').length,
    moments: today.total,
    then: hadSuggestions && then.total ? then.right / then.total : null,
    now: today.total ? today.right / today.total : 0
  }
}

export interface Relook {
  /** Frames from moments nothing was kept from, that the app would now put forward. */
  missed: string[]
  /** Kept frames the app would now advise against. */
  doubted: string[]
}

/** What a fresh look at a culled project turns up. */
export function relookOf(shots: Shot[]): Relook {
  const keptStacks = new Set(shots.filter((s) => s.decision === 'pick').map((s) => s.stackId))
  return {
    missed: shots.filter((s) => s.decision !== 'pick' && !keptStacks.has(s.stackId) && (s.score?.gem || (s.suggestion === 'pick' && s.decision === 'reject'))).map((s) => s.id),
    doubted: shots.filter((s) => s.decision === 'pick' && s.suggestion === 'reject' && !s.score?.gem).map((s) => s.id)
  }
}
