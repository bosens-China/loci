import { GithubOutlined, GlobalOutlined } from '@ant-design/icons'
import { Form, Input, Select } from 'antd'
import {
  DOCUMENT_SOURCE_DEFAULTS,
  DOCUMENT_SOURCE_LIMITS,
  getSourceScopeOptions,
  type SourceKind
} from '@loci/shared'
import { getLibraryUrlDefaults, validateLibrarySourceKind } from './library-form'

export interface LibraryCoreFormValue {
  name: string
  url: string
  scopePath: string
  pageLimit: number
  schedule?: string | null
}

export interface LibraryBasicFieldsProps {
  autoFocusUrl?: boolean
  suggestName?: boolean
  kind?: SourceKind
}

/** 本地来源与 Server 文档库共用的核心基础字段（URL、名称、收录范围）。 */
export function LibraryBasicFields(props: LibraryBasicFieldsProps): React.JSX.Element {
  const form = Form.useFormInstance<LibraryCoreFormValue>()
  const url = Form.useWatch('url', form) ?? ''
  const scopeOptions = getSourceScopeOptions(url)
  const isGithub = props.kind === 'github'

  const applyUrlDefaults = (inputUrl: string): void => {
    form.setFieldsValue(
      getLibraryUrlDefaults({
        url: inputUrl,
        name: form.getFieldValue('name') ?? '',
        scopePath: form.getFieldValue('scopePath') ?? DOCUMENT_SOURCE_DEFAULTS.scopePath,
        nameTouched: form.isFieldTouched('name'),
        suggestName: props.suggestName === true
      })
    )
  }

  return (
    <>
      <Form.Item
        name="url"
        label={isGithub ? 'GitHub 仓库 URL' : '起始页面 URL'}
        extra={
          isGithub
            ? '支持任意公开 GitHub 仓库，自动读取默认分支 Markdown 文档。'
            : '输入文档首页或任意子页面，自动探测 llms.txt、OpenAPI 或站点网页。'
        }
        rules={[
          { required: true, whitespace: true, message: '请输入完整的 URL' },
          {
            validator: (_rule, value: string | undefined) => {
              if (!value || !value.trim()) return Promise.resolve()
              const trimmed = value.trim()
              try {
                const parsed = new URL(trimmed)
                if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                  return Promise.reject(new Error('只支持 http:// 或 https:// 协议'))
                }
              } catch {
                return Promise.reject(new Error('请输入合法的 URL（包含 http:// 或 https://）'))
              }
              if (props.kind) {
                const message = validateLibrarySourceKind(props.kind, trimmed)
                if (message) return Promise.reject(new Error(message))
              }
              return Promise.resolve()
            }
          }
        ]}
      >
        <Input
          autoFocus={props.autoFocusUrl}
          prefix={
            isGithub ? (
              <GithubOutlined className="text-[var(--ant-color-text-secondary)]" />
            ) : (
              <GlobalOutlined className="text-[var(--ant-color-text-secondary)]" />
            )
          }
          placeholder={
            isGithub ? 'https://github.com/owner/repository' : 'https://example.com/docs'
          }
          onChange={(event) => applyUrlDefaults(event.currentTarget.value)}
          onBlur={(event) => applyUrlDefaults(event.currentTarget.value)}
        />
      </Form.Item>

      <Form.Item
        name="name"
        label="文档库名称"
        rules={[
          { required: true, whitespace: true, message: '请输入文档库名称' },
          {
            max: DOCUMENT_SOURCE_LIMITS.nameLength.max,
            message: `名称长度不能超过 ${DOCUMENT_SOURCE_LIMITS.nameLength.max} 个字符`
          }
        ]}
      >
        <Input
          maxLength={DOCUMENT_SOURCE_LIMITS.nameLength.max}
          placeholder={isGithub ? '例如：hono' : '例如：Hono 官方文档'}
        />
      </Form.Item>

      {!isGithub && (
        <Form.Item
          name="scopePath"
          label="收录范围"
          extra="只收录所选路径及其子路径；编辑时收窄范围会立即删除范围外正文。"
          rules={[{ required: true, message: '请选择收录范围' }]}
        >
          <Select
            options={scopeOptions}
            placeholder={url ? '选择路径范围' : '先填写起始页面 URL'}
            disabled={!scopeOptions.length}
          />
        </Form.Item>
      )}
    </>
  )
}
