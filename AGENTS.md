# Agents

- 代码行数尽量不要超出400，拆除考虑拆分
- 测试用vitest，然后测试放到当前文件同层级，例如utils/fs.ts 对应 utils/test/fs.test.ts
- React 请开启 react compiler
- 请使用ts，避免any，未知类型用unknown
- 样式优先用unocss，避免书写style和css
- 注释使用中文，重要模块请确保包含注释
- 请配置alias，例如@/xxx等形式，避免../../../这样路径出现
- 实现功能的时候，需要考虑到cli和桌面，此外还有可能涉及到的后端模块关系
- 实现的时候避免重复实现，而是尽可能复用，例如爬取功能，桌面、cli、后端都是复用一个实现
