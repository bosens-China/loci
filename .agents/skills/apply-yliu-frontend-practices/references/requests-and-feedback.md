# 请求与反馈

在任务涉及浏览器业务请求、API 模块、请求状态或消息反馈时使用本规范。

## 使用 Axios

- 浏览器端业务接口默认使用 Axios，不直接使用原生 `fetch`。
- 先复用项目已有请求实例；没有时再创建统一实例。
- 在请求侧处理认证 Header 等公共配置，在响应侧处理业务错误、HTTP 错误、网络错误和超时。
- 从现有类型、拦截器、调用代码和实际响应中查找业务成功规则。找不到或存在冲突时询问用户，禁止自行假设成功码。
- 把失败统一转换为 `Error` 或其子类，并通过 `Promise.reject(error)` 抛出。
- Axios 拦截器只做协议处理和错误标准化，不展示 Toast、`message.error` 或其他 UI。
- 不把失败包装成正常返回的 `{ error }`，否则请求 Hook 无法进入 `onError`。
- 保证错误 `message` 可安全展示，不暴露堆栈、SQL、内部路径或敏感信息。

```ts
request.interceptors.response.use(
  (response) => {
    if (!isBusinessSuccess(response.data)) {
      return Promise.reject(toRequestError(response.data))
    }

    return response
  },
  (error) => Promise.reject(toRequestError(error)),
)
```

## 独立导出 API 函数

- 每个接口使用独立的 `export const` 异步函数。
- 等待 Axios 响应，解构并返回 `data`，不泄漏整个 `AxiosResponse`。
- TypeScript 项目要声明参数和返回数据类型。
- 不把多个接口聚合进 `userApi`、`services` 等对象。

```ts
export const createUser = async (
  params: CreateUserParams,
): Promise<CreateUserResult> => {
  const { data } = await request.post<CreateUserResult>('/users', params)
  return data
}
```

## 使用请求 Hook

- 先复用项目已有请求状态方案。
- React 项目没有既定方案时优先使用 `ahooks` 的 `useRequest`。
- Vue 项目没有既定方案时优先使用 `vue-request` 或同类成熟方案。
- 使用库提供的 `data`、`loading`、`error`、生命周期、取消和刷新能力，不重复手写同类状态。
- 新建、编辑、删除等变更请求默认使用手动模式，由明确操作触发。
- 查询请求成功时不弹提示；新建、编辑、删除成功时使用“新建成功”“编辑成功”“删除成功”等固定文案。
- 在页面请求 Hook 的 `onError` 中显示标准化后的 `error.message`。
- 一个请求只展示一次反馈，避免 Hook、组件和其他封装重复提示。

```ts
const { run: create, loading } = useRequest(createUser, {
  manual: true,
  onSuccess: () => {
    message.success('新建成功')
  },
  onError: (error) => {
    message.error(error.message)
  },
})
```
