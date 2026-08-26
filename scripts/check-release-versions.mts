import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { asJsonObject, readJsonObject } from './json-file.mts'

export interface ReleaseVersionMismatch {
  packagePath: string
  manifestVersion: string | null
  packageVersion: string | null
}

function readVersion(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

// release-please 的 manifest 是已发布版本事实源，必须与各包版本保持同步。
export async function findReleaseVersionMismatches(
  workspaceRoot = process.cwd()
): Promise<ReleaseVersionMismatch[]> {
  const config = await readJsonObject(resolve(workspaceRoot, 'release-please-config.json'))
  const manifest = await readJsonObject(resolve(workspaceRoot, '.release-please-manifest.json'))
  const packages = asJsonObject(config.packages, 'release-please-config.json#packages')
  const mismatches: ReleaseVersionMismatch[] = []

  for (const packagePath of Object.keys(packages)) {
    const packageJson = await readJsonObject(resolve(workspaceRoot, packagePath, 'package.json'))
    const manifestVersion = readVersion(manifest[packagePath])
    const packageVersion = readVersion(packageJson.version)
    if (manifestVersion !== packageVersion) {
      mismatches.push({ packagePath, manifestVersion, packageVersion })
    }
  }

  return mismatches
}

export async function checkReleaseVersions(workspaceRoot = process.cwd()): Promise<void> {
  const mismatches = await findReleaseVersionMismatches(workspaceRoot)
  if (mismatches.length === 0) return

  const details = mismatches.map(
    ({ packagePath, manifestVersion, packageVersion }) =>
      `- ${packagePath}: manifest=${manifestVersion ?? '缺失'}, package.json=${packageVersion ?? '缺失'}`
  )
  throw new Error(['发布版本不一致，请先同步 release-please manifest：', ...details].join('\n'))
}

const entryPath = process.argv[1]
if (entryPath && import.meta.url === pathToFileURL(resolve(entryPath)).href) {
  await checkReleaseVersions()
  console.log('release-please manifest 与包版本一致')
}
