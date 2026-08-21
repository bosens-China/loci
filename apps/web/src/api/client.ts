import axios from 'axios'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const request = axios.create({
  baseURL: '/',
  timeout: 20_000,
  headers: { 'content-type': 'application/json' }
})

request.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (!axios.isAxiosError(error)) return Promise.reject(new ApiError('本地服务请求失败'))
    let data: unknown = error.response?.data
    if (data instanceof Blob && data.type.includes('application/json')) {
      try {
        data = JSON.parse(await data.text()) as unknown
      } catch {
        data = null
      }
    }
    const message =
      data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error
        : error.code === 'ECONNABORTED'
          ? '本地服务响应超时'
          : '无法连接 Loci 本地服务'
    return Promise.reject(new ApiError(message, error.response?.status))
  }
)
