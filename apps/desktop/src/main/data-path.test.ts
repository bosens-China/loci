import { afterEach, describe, expect, it } from 'vitest'
import { resolveLociDataDir } from './data-path'

const originalDataDir = process.env.LOCI_DATA_DIR

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.LOCI_DATA_DIR
  else process.env.LOCI_DATA_DIR = originalDataDir
})

describe('resolveLociDataDir', () => {
  it('uses the desktop userData path when Electron provides it', () => {
    delete process.env.LOCI_DATA_DIR
    expect(resolveLociDataDir('/tmp/electron-loci')).toBe('/tmp/electron-loci')
  })

  it('allows an explicit isolated data directory', () => {
    process.env.LOCI_DATA_DIR = '/tmp/loci-isolated'
    expect(resolveLociDataDir('/tmp/electron-loci')).toBe('/tmp/loci-isolated')
  })
})
