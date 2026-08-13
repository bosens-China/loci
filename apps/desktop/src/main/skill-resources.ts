import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 打包后资源位于 process.resourcesPath；开发态直接读取仓库唯一源目录。 */
export function resolveDesktopSkillResourceDir(
  packaged: boolean,
  resourcesPath: string,
  moduleUrl = import.meta.url
): string {
  return packaged
    ? join(resourcesPath, 'skills', 'use-loci')
    : fileURLToPath(new URL('../../../../.agents/skills/use-loci/', moduleUrl))
}
