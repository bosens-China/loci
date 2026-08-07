import { defineConfig } from '@rspress/core'

export default defineConfig({
  root: 'docs',
  title: 'Loci',
  description: '桌面应用与 CLI 共享的本地技术文档库',
  icon: '/icon.svg',
  logo: '/icon.svg',
  logoText: 'Loci',
  lang: 'zh',
  base: '/loci/',
  i18nSource: {
    editLinkText: {
      zh: '在 GitHub 上编辑此页',
      en: 'Edit this page on GitHub'
    }
  },
  themeConfig: {
    lastUpdated: true,
    editLink: {
      docRepoBaseUrl: 'https://github.com/bosens-China/loci/tree/master/apps/docs/docs'
    },
    nav: [
      { text: '桌面应用', link: '/desktop/getting-started' },
      { text: 'CLI', link: '/cli/getting-started' },
      { text: '收录规则', link: '/guide/crawling' },
      { text: 'AI 接入', link: '/agent/overview' }
    ],
    sidebar: {
      '/guide/': [
        {
          text: '收录与抓取',
          items: [{ text: '页面发现与优先级', link: '/guide/crawling' }]
        }
      ],
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
                { text: '数据备份与运行环境', link: '/cli/commands/integrations' },
                {
                  text: 'Admin：Server 管理',
                  link: '/cli/commands/admin'
                }
              ]
            }
          ]
        }
      ],
      '/agent/': [
        {
          text: 'AI 接入',
          items: [
            { text: '接入方式概览', link: '/agent/overview' },
            { text: '配置 MCP', link: '/agent/mcp' },
            { text: '使用 Loci Skill', link: '/agent/skill' },
            { text: '配置 Codex AGENTS.md', link: '/agent/codex' }
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
