import * as z from 'zod/v4'
import { remoteReadAnnotations, result, writeAnnotations } from './server-support.js'
import type { LociMcpServices } from './server.js'
import type { LociToolRegistrar } from './tool-registry.js'

const nullableConcurrency = z.number().int().min(1).max(32).nullable()
const nullableInterval = z.number().int().min(0).max(3_600).nullable()
const policyTarget = z.enum(['local', 'server']).default('local')

export function registerHostnamePolicyTools(
  register: LociToolRegistrar,
  services: LociMcpServices
): void {
  register(
    'loci_list_hostname_policies',
    {
      title: '列出域名抓取限制',
      description: '读取全部 hostname 自定义并发与批次间隔。',
      inputSchema: z.object({ target: policyTarget }).strict(),
      outputSchema: z.object({ policies: z.array(z.record(z.string(), z.unknown())) }),
      annotations: remoteReadAnnotations()
    },
    async ({ target }) =>
      result(
        {
          policies:
            target === 'server'
              ? await services.listServerHostnamePolicies()
              : services.listHostnameCrawlPolicies()
        },
        '域名规则读取完成'
      )
  )

  register(
    'loci_save_hostname_policy',
    {
      title: '保存域名抓取限制',
      description: '新增或实时修改 hostname 规则；null 表示继承全局设置。',
      inputSchema: z
        .object({
          hostname: z.string().trim().min(1),
          target: policyTarget,
          http_concurrency: nullableConcurrency,
          browser_concurrency: nullableConcurrency,
          batch_interval_min_seconds: nullableInterval,
          batch_interval_max_seconds: nullableInterval
        })
        .strict(),
      outputSchema: z.object({ policy: z.record(z.string(), z.unknown()) }),
      annotations: writeAnnotations(false)
    },
    async (input) => {
      const policy = {
        hostname: input.hostname,
        httpConcurrency: input.http_concurrency,
        browserConcurrency: input.browser_concurrency,
        batchIntervalMinSeconds: input.batch_interval_min_seconds,
        batchIntervalMaxSeconds: input.batch_interval_max_seconds
      }
      return result(
        {
          policy:
            input.target === 'server'
              ? await services.saveServerHostnamePolicy(policy)
              : services.saveHostnameCrawlPolicy(policy)
        },
        '域名规则已实时生效'
      )
    }
  )

  register(
    'loci_delete_hostname_policy',
    {
      title: '删除域名抓取限制',
      description: '删除 hostname 自定义规则并恢复全局限制。调用前必须取得用户确认。',
      inputSchema: z.object({ hostname: z.string().trim().min(1), target: policyTarget }).strict(),
      outputSchema: z.object({ deleted: z.boolean() }),
      annotations: writeAnnotations(true)
    },
    async ({ hostname, target }) => {
      if (target === 'server') {
        await services.deleteServerHostnamePolicy(hostname)
        return result({ deleted: true }, 'Server 域名规则删除完成')
      }
      return result({ deleted: services.deleteHostnameCrawlPolicy(hostname) }, '域名规则删除完成')
    }
  )
}
