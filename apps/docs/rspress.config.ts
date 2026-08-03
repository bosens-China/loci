import { defineConfig } from '@rspress/core'

export default defineConfig({
  root: 'docs',
  title: 'Loci',
  description: '面向 AI Agent 的本地文档知识库',
  base: '/loci/',
  themeConfig: {
    nav: [
      { text: '桌面应用', link: '/desktop/getting-started' },
      { text: 'CLI', link: '/cli/getting-started' }
    ],
    sidebar: {
      '/desktop/': [
        {
          text: '桌面应用',
          items: [{ text: '快速上手', link: '/desktop/getting-started' }]
        }
      ],
      '/cli/': [
        {
          text: 'CLI',
          items: [
            { text: '安装与使用', link: '/cli/getting-started' },
            { text: '命令参考', link: '/cli/commands' }
          ]
        }
      ]
    },
    socialLinks: [
      {
        icon: 'github',
        mode: 'link',
        content: 'https://github.com/bosens-China/loci'
      }
    ]
  }
})
