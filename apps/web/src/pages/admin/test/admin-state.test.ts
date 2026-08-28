import { describe, expect, it } from 'vitest'
import type { CloudLibrary, CloudSyncJob } from '@loci/shared'
import {
  availableAdminLibraryIds,
  getAdminSyncPercent,
  isAdminSessionExpired,
  isAdminSessionValid,
  isAdminJobActive,
  latestAdminJobsByLibrary,
  mergeAdminJobs,
  resolveAdminLoginTarget
} from '../admin-state'

describe('Admin 任务状态', () => {
  it('登录后只返回原 Server 管理路由', () => {
    expect(resolveAdminLoginTarget('/admin/jobs?status=running#latest')).toBe(
      '/admin/jobs?status=running#latest'
    )
    expect(resolveAdminLoginTarget('/administer')).toBe('/admin')
    expect(resolveAdminLoginTarget('/documents')).toBe('/admin')
    expect(resolveAdminLoginTarget('https://example.com/admin')).toBe('/admin')
  })

  it('按服务端会话时间判断是否过期', () => {
    const session = {
      serverUrl: 'http://localhost:7001',
      username: 'admin',
      expiresAt: '2026-08-28T08:00:00.000Z'
    }
    expect(isAdminSessionExpired(session, Date.parse('2026-08-28T07:59:59.999Z'))).toBe(false)
    expect(isAdminSessionExpired(session, Date.parse(session.expiresAt))).toBe(true)
    expect(isAdminSessionExpired({ ...session, expiresAt: 'invalid' })).toBe(true)
    expect(isAdminSessionValid(session, Date.parse('2026-08-28T07:59:59.999Z'))).toBe(true)
    expect(isAdminSessionValid(session, Date.parse(session.expiresAt))).toBe(false)
    expect(isAdminSessionValid(null)).toBe(false)
  })

  it('按文档库选择最新任务并识别活动状态', () => {
    const older = job('old', 'library-1', 'queued', '2026-08-20T00:00:00.000Z')
    const newer = job('new', 'library-1', 'completed', '2026-08-21T00:00:00.000Z')
    expect(latestAdminJobsByLibrary([newer, older])).toEqual({ 'library-1': newer })
    expect(isAdminJobActive(older)).toBe(true)
    expect(isAdminJobActive(newer)).toBe(false)
  })

  it('合并轮询结果时以任务 ID 更新状态', () => {
    const queued = job('job-1', 'library-1', 'queued', '2026-08-21T00:00:00.000Z')
    const running = { ...queued, status: 'running' as const }
    expect(mergeAdminJobs([queued], [running])).toEqual([running])
  })

  it('使用已处理与待处理总数计算动态进度', () => {
    const running = {
      ...job('job-1', 'library-1', 'running', '2026-08-21T00:00:00.000Z'),
      progress: {
        queued: 3,
        processed: 1,
        succeeded: 1,
        failed: 0,
        limitReached: false
      }
    }
    expect(getAdminSyncPercent(running)).toBe(25)
    expect(getAdminSyncPercent({ ...running, status: 'completed' })).toBe(100)
  })

  it('批量同步排除活动任务并优先使用可用选项', () => {
    const running = job('job-1', 'library-1', 'running', '2026-08-21T00:00:00.000Z')
    const libraries = [library('library-1'), library('library-2'), library('library-3')]
    expect(
      availableAdminLibraryIds(libraries, { 'library-1': running }, ['library-1', 'library-2'])
    ).toEqual(['library-2'])
    expect(availableAdminLibraryIds(libraries, { 'library-1': running }, [])).toEqual([
      'library-2',
      'library-3'
    ])
    expect(availableAdminLibraryIds(libraries, { 'library-1': running }, ['library-1'])).toEqual([])
  })
})

function library(id: string): CloudLibrary {
  return {
    id,
    name: id,
    url: `https://example.com/${id}`,
    hostname: 'example.com',
    scopePath: '/',
    pageLimit: 1000,
    schedule: null,
    pages: 0,
    lastCrawledAt: null,
    lastError: null,
    revision: null,
    publishedAt: null
  }
}

function job(
  id: string,
  libraryId: string,
  status: CloudSyncJob['status'],
  createdAt: string
): CloudSyncJob {
  return {
    id,
    libraryId,
    hostname: 'example.com',
    status,
    priority: 0,
    paused: false,
    pauseRequested: false,
    stopRequested: false,
    partial: false,
    contentBytes: 0,
    remainingCount: 0,
    createdAt,
    updatedAt: createdAt,
    finishedAt: null,
    progress: null,
    failures: [],
    error: null
  }
}
