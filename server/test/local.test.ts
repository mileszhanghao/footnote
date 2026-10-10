import { describe, expect, it } from 'vitest'
import { HashingEmbedder, bestSentences } from '../src/llm/local.js'

describe('HashingEmbedder', () => {
  it('is deterministic and puts related text closer than unrelated text', async () => {
    const embedder = new HashingEmbedder(256)
    const [a, b, c, again] = await embedder.embed([
      'delivery fee and minimum order',
      'the delivery fee is waived over forty dollars',
      'dim sum opening hours on tuesday',
      'delivery fee and minimum order',
    ])
    const cos = (x: number[], y: number[]) => {
      const dot = x.reduce((s, v, i) => s + v * y[i]!, 0)
      return dot / (Math.hypot(...x) * Math.hypot(...y))
    }
    expect(again).toEqual(a)
    expect(cos(a!, b!)).toBeGreaterThan(cos(a!, c!))
  })
})

describe('bestSentences', () => {
  const passages = [
    '[p. 1] Golden Lantern is a dim sum house. Golden Lantern serves dim sum until midnight and is closed on Tuesdays.',
    '[p. 2] Delivery costs $3.99, and delivery is free for orders over $40. The minimum order is $15.',
  ].join('\n\n')

  it('ranks the sentence with the rare question terms first and keeps its page', () => {
    const [first] = bestSentences('When does Golden Lantern close?', passages, 3)
    expect(first).toMatchObject({ page: 1 })
    expect(first!.text).toContain('closed on Tuesdays')
  })

  it('drops weak matches and returns nothing for unrelated questions', () => {
    expect(bestSentences('How much is delivery?', passages, 3).map((s) => s.page)).toEqual([2])
    expect(bestSentences('quantum chromodynamics', passages, 3)).toEqual([])
  })
})
