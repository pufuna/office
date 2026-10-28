import { describe, expect, it } from 'vitest'
import { anchorParagraphLinePx } from '../src/renderer/editor/extensions'

describe('anchorParagraphLinePx', () => {
  it('a 10pt single-spaced mark keeps one font line', () => {
    const px = anchorParagraphLinePx(20, 240, 'auto', '1.15')
    expect(px).toBeCloseTo(((10 * 96) / 72) * 1.15, 6)
  })

  it('applies the auto multiple and the fixed rules', () => {
    expect(anchorParagraphLinePx(20, 480, 'auto', '1.15')).toBeCloseTo(
      ((10 * 96) / 72) * 1.15 * 2,
      6,
    )
    expect(anchorParagraphLinePx(20, 300, 'exact', '1.15')).toBe(20)
    expect(anchorParagraphLinePx(20, 150, 'atLeast', '1.15')).toBeCloseTo(
      ((10 * 96) / 72) * 1.15,
      6,
    )
  })

  it('falls back to an 11pt mark and a 1.15 font factor', () => {
    expect(anchorParagraphLinePx(null, null, null, null)).toBeCloseTo(((11 * 96) / 72) * 1.15, 6)
  })
})
