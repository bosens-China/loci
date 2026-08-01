import { describe, expect, it } from 'vitest'
import { findBestPassage } from './content'

describe('findBestPassage', () => {
  it('returns the best matching paragraph with its nearest heading', () => {
    expect(
      findBestPassage(
        '# 开始\n\n先安装依赖。\n\n## 响应式原理\n\n读取属性时进行依赖追踪。',
        '依赖追踪',
        '文档'
      )
    ).toEqual({
      sectionTitle: '响应式原理',
      paragraph: '读取属性时进行依赖追踪。',
      truncated: false
    })
  })
})
