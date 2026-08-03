import { afterEach, describe, expect, it } from 'vitest'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { resolveLociDataDir } from '../data-path'

const originalDataDir = process.env.LOCI_DATA_DIR

function defaultDataDir(): string {
  if (process.platform === 'darwin')
    return join(homedir(), 'Library', 'Application Support', 'Loci')
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Loci')
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'Loci')
}

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.LOCI_DATA_DIR
  else process.env.LOCI_DATA_DIR = originalDataDir
})

describe('resolveLociDataDir', () => {
  it('uses the shared platform data directory by default', () => {
    delete process.env.LOCI_DATA_DIR
    expect(resolveLociDataDir()).toBe(defaultDataDir())
  })

  it('allows an explicit isolated data directory', () => {
    process.env.LOCI_DATA_DIR = '/tmp/loci-isolated'
    expect(resolveLociDataDir()).toBe(resolve('/tmp/loci-isolated'))
  })
})
