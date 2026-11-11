import { MODELS } from '@shared/types'

/** Rough cost of a request, shown before the user spends anything. */
export function estimateCost(model: string, inputTokens: number, outputTokens: number): string {
  const price = MODELS.find((m) => m.id === model) ?? MODELS[0]
  const usd = (inputTokens * price.inPerM + outputTokens * price.outPerM) / 1_000_000
  return usd < 0.01 ? 'under $0.01' : `about $${usd.toFixed(2)}`
}

export const formatCost = (usd: number): string => (usd < 0.01 ? 'under $0.01' : `$${usd.toFixed(2)}`)
