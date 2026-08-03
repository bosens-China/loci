import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { browserStatus } from './browser.js'

describe('browserStatus', () => {
  it('returns an actionable missing state without downloading a browser', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'loci-browser-'))
    try {
      const status = await browserStatus(directory)
      expect(status).toMatchObject({ installed: false, launchable: false, error: null })
      expect(status.executable).toContain(directory)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
