import { defineConfig } from '@rspress/core'

export default defineConfig({
  root: 'docs',
  title: 'Loci',
  description: '本地 CLI 与 Web UI 共用的技术文档库',
  icon: '/icon.svg',
  logo: '/icon.svg',
  logoText: 'Loci',
  lang: 'zh',
  base: '/loci/',
  siteOrigin: 'https://bosens-china.github.io',
  llms: true,
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
                { text: '数据备份与恢复', link: '/cli/commands/data' }
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
            { text: '使用 use-loci Skill', link: '/agent/skill' },
            { text: '配置全局规则', link: '/agent/global-rules' }
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
