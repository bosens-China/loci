---
name: apply-yliu-frontend-practices
description: "Apply Yliu's client-side frontend engineering practices when writing, refactoring, or reviewing React or Vue code. Use for browser API modules, Axios wrappers, request hooks and composables, async feedback and loading states, route-driven detail pages, destructive-action confirmation, reusable hooks, UnoCSS and UI-framework styling, empty and error states, layout stability, and focused frontend tests."
---

# Apply Yliu Frontend Practices

对浏览器端 React、Vue 前端代码应用 Yliu 的个人工程实践。覆盖编写、重构和代码审查，不处理服务端模块。

## 确定优先级

按以下优先级决策：

1. 用户本次明确要求。
2. 项目已经稳定使用的规范、封装和依赖。
3. 本技能的默认实践。

先检查依赖清单和任务涉及的现有实现。复用项目已有的成熟方案，不并行引入功能重复的库，也不为应用本技能而迁移无关代码。

## 按需读取规范

只完整读取当前任务涉及的引用文件；任务跨多个类别时读取所有相关文件：

- 涉及 Axios、API 模块、请求 Hook、业务错误或操作反馈时，读取 [requests-and-feedback.md](references/requests-and-feedback.md)。
- 涉及 Hook/Composable 抽取、请求执行时机、路由性能、详情页面或 Pinia 数据来源时，读取 [hooks-and-routing.md](references/hooks-and-routing.md)。网络 Hook 同时读取请求规范。
- 涉及 Loading、Error、Empty、布局稳定、危险操作、组件库、UnoCSS 或样式时，读取 [ui-states-and-styling.md](references/ui-states-and-styling.md)。
- 涉及新增、调整或审查测试时，读取 [testing.md](references/testing.md)。

不要为了“了解全貌”默认加载全部引用；根据任务实际范围选择。

## 执行工作

### 编写或重构

1. 读取相关引用文件。
2. 查看项目中同类代码和依赖，确认已有约定。
3. 只实现任务所需的最小改动。
4. 让新增代码与项目风格一致，并应用引用文件中的默认实践。
5. 运行与改动风险相称的检查。

### 代码审查

1. 读取审查范围涉及的引用文件。
2. 只报告真实、可定位的问题，说明影响和最小修复方向。
3. 按严重程度排序，避免把个人偏好包装成缺陷。
4. 用户没有要求修复时不要直接修改代码。

## 核心约束

- 不猜测业务成功状态；优先从项目中查找，仍不清晰时询问用户。
- 不让公共抽象隐式启动当前页面不需要的请求。
- 不让详情页依赖上一页内存状态，使用 URL 核心参数请求当前详情。
- 不重复展示请求反馈，也不把失败伪装成成功返回值。
- 不为了复用制造万能组件、薄包装 Hook 或新的重复依赖。
- 不测试普通文案和易变展示细节，除非用户明确要求。
