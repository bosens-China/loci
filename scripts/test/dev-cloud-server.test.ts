import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createDevCloudServerEnvironment,
  DEV_CLOUD_SERVER_PASSWORD,
  DEV_CLOUD_SERVER_PORT,
  usesManagedDevCloudServer
} from '../dev-cloud-server.mts'

describe('开发云端 Server 配置', () => {
  it('只接管默认回环 Server 地址', () => {
    expect(usesManagedDevCloudServer('http://localhost:7001')).toBe(true)
    expect(usesManagedDevCloudServer('http://127.0.0.1:7001/')).toBe(true)
    expect(usesManagedDevCloudServer('https://localhost:7001')).toBe(false)
    expect(usesManagedDevCloudServer('https://cloud.example.com')).toBe(false)
  })

  it('隔离 Server 数据，并保留明确配置的本地管理员密码', () => {
    const root = '/workspace/loci'
    expect(createDevCloudServerEnvironment(root, { PATH: '/bin' })).toMatchObject({
      PATH: '/bin',
      PORT: String(DEV_CLOUD_SERVER_PORT),
      LOCI_DATA_DIR: join(root, '.loci-dev', 'server-data'),
      LOCI_ADMIN_USERNAME: 'admin',
      LOCI_ADMIN_PASSWORD: DEV_CLOUD_SERVER_PASSWORD
    })
    expect(
      createDevCloudServerEnvironment(root, { LOCI_LOCAL_ADMIN_PASSWORD: 'custom-password' })
        .LOCI_ADMIN_PASSWORD
    ).toBe('custom-password')
  })
})
