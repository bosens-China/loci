import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { message } from 'antd'
import type { SkillOperationInput } from '@loci/shared'
import { queryKeys } from '../query-client'

export function useSkills(): {
  installations: Awaited<ReturnType<typeof window.api.listSkills>>
  loading: boolean
  error: Error | null
  refresh: () => void
  add: (input: SkillOperationInput) => Promise<void>
  remove: (input: SkillOperationInput) => Promise<void>
  clear: (input: SkillOperationInput) => Promise<void>
  mutating: boolean
} {
  const client = useQueryClient()
  const query = useQuery({ queryKey: queryKeys.skills, queryFn: () => window.api.listSkills() })
  const invalidate = async (): Promise<void> => {
    await client.invalidateQueries({ queryKey: queryKeys.skills })
  }
  const addMutation = useMutation({
    mutationFn: window.api.addSkills,
    onSuccess: async () => {
      message.success('安装成功')
      await invalidate()
    },
    onError: (error) => message.error(error.message)
  })
  const removeMutation = useMutation({
    mutationFn: window.api.removeSkills,
    onSuccess: async () => {
      message.success('删除成功')
      await invalidate()
    },
    onError: (error) => message.error(error.message)
  })
  const clearMutation = useMutation({
    mutationFn: window.api.clearSkills,
    onSuccess: async (result) => {
      if (result.failures.length)
        message.warning(`删除成功 ${result.removed} 个，失败 ${result.failures.length} 个`)
      else message.success(`已清空 ${result.removed} 个 Skill`)
      await invalidate()
    },
    onError: (error) => message.error(error.message)
  })
  return {
    installations: query.data ?? [],
    loading: query.isLoading,
    error: query.error,
    refresh: () => void query.refetch(),
    add: async (input) => void (await addMutation.mutateAsync(input)),
    remove: async (input) => void (await removeMutation.mutateAsync(input)),
    clear: async (input) => void (await clearMutation.mutateAsync(input)),
    mutating: addMutation.isPending || removeMutation.isPending || clearMutation.isPending
  }
}
