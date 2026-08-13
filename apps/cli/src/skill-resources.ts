import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 发布包读取 dist 静态资源，源码运行和测试读取仓库中的唯一源目录。 */
export function resolveCliSkillResourceDir(moduleUrl = import.meta.url): string {
  const packaged = fileURLToPath(new URL('./resources/skills/use-loci/', moduleUrl))
  if (existsSync(packaged)) return resolve(packaged)
  return resolve(fileURLToPath(new URL('../../../.agents/skills/use-loci/', moduleUrl)))
}
