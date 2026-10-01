import { describe, expect, test } from 'bun:test'
import { isReviewablePackagePath } from './fs-utils'

describe('isReviewablePackagePath', () => {
  test('reviews archives and loose Ren\'Py patch scripts', () => {
    expect(isReviewablePackagePath('SurvivalGuide-Day14.5-pc.zip')).toBe(true)
    expect(isReviewablePackagePath('patch.7z')).toBe(true)
    expect(isReviewablePackagePath('patch.rar')).toBe(true)
    expect(isReviewablePackagePath('C:\\downloads\\untrusted\\patch (1).rpyc')).toBe(true)
    expect(isReviewablePackagePath('C:\\downloads\\untrusted\\patch (1).rpy')).toBe(true)
    expect(isReviewablePackagePath('uncensor.rpy')).toBe(true)
    expect(isReviewablePackagePath('UNCENSOR.RPYC')).toBe(true)
  })

  test('leaves other finished files out of approval', () => {
    expect(isReviewablePackagePath('notes.txt')).toBe(false)
    expect(isReviewablePackagePath('cover.jpg')).toBe(false)
    expect(isReviewablePackagePath('setup.exe')).toBe(false)
    expect(isReviewablePackagePath('patch.rpyc.txt')).toBe(false)
  })
})
