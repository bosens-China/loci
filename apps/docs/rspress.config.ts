import { defineConfig } from '@rspress/core'

export default defineConfig({
  root: 'docs',
  title: 'Loci',
  description: '面向 CLI 与 Agent 的本地技术文档库',
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
      { text: 'CLI 使用', link: '/cli/getting-started' },
      { text: '文档收录', link: '/guide/crawling' },
      { text: '接入 Agent', link: '/agent/overview' }
    ],
    sidebar: {
      '/guide/': [
        {
          text: '收录与抓取',
          items: [{ text: '页面发现与优先级', link: '/guide/crawling' }]
        }
      ],
      '/cli/': [
        {
          text: 'CLI 使用指南',
          items: [
            { text: '安装与快速上手', link: '/cli/getting-started' },
            {
              text: '命令参考',
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
            },
            { text: '高级配置与自动化', link: '/cli/advanced' }
          ]
        }
      ],
      '/agent/': [
        {
          text: '接入 Agent',
          items: [
            { text: '接入概览', link: '/agent/overview' },
            { text: '通过 MCP 接入', link: '/agent/mcp' },
            { text: '工具使用参考', link: '/agent/mcp-tools' },
            { text: '使用 use-loci Skill', link: '/agent/skill' },
            { text: '配置全局规则', link: '/agent/global-rules' },
            {
              text: '客户端指南',
              items: [{ text: 'Codex 规则设置', link: '/agent/codex' }]
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
