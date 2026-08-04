import { defineConfig } from '@rspress/core'

export default defineConfig({
  root: 'docs',
  title: 'Loci',
  description: '面向 AI Agent 的本地文档知识库',
  icon: '/icon.svg',
  logo: '/icon.svg',
  logoText: 'Loci',
  lang: 'zh',
  base: '/loci/',
  themeConfig: {
    lastUpdated: true,
    editLink: {
      docRepoBaseUrl: 'https://github.com/bosens-China/loci/tree/master/apps/docs/docs',
      text: '在 GitHub 上编辑此页'
    },
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
            {
              text: '命令与参数',
              items: [
                { text: '基础、浏览器与设置', link: '/cli/commands/basics' },
                { text: '本地文档库', link: '/cli/commands/local-library' },
                { text: '云端文档库', link: '/cli/commands/cloud-library' },
                { text: 'MCP 与数据管理', link: '/cli/commands/integrations' },
                {
                  text: 'Admin：Server 管理',
                  link: '/cli/commands/admin'
                }
              ]
            }
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
