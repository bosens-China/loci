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
      { text: '接入 Agent', link: '/agent/overview' }
    ],
    sidebar: {
      '/cli/': [
        {
          text: 'CLI 使用指南',
          items: [
            { text: '安装与快速上手', link: '/cli/getting-started' },
            {
              text: '命令参考',
              items: [
                { text: '基础命令与运行设置', link: '/cli/commands/basics' },
                { text: '本地文档库', link: '/cli/commands/local-library' },
                { text: '页面发现与抓取', link: '/cli/crawling' },
                { text: '云端文档库', link: '/cli/commands/cloud-library' },
                { text: '数据备份与清理', link: '/cli/commands/data' },
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
          text: '能力与配置',
          items: [
            { text: '接入概览', link: '/agent/overview' },
            { text: '通过 MCP 接入', link: '/agent/mcp' },
            { text: '使用 use-loci Skill', link: '/agent/skill' },
            { text: '配置全局规则', link: '/agent/global-rules' },
            { text: '工具使用参考', link: '/agent/mcp-tools' }
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
