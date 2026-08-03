# Agents

- 代码行数尽量不要超出400，拆除考虑拆分
- 测试用vitest，然后测试放到当前文件同层级，例如utils/fs.ts 对应 utils/test/fs.test.ts
- React 请开启 react compiler
- 请使用ts，避免any，未知类型用unknown
- 样式优先用unocss，避免书写style和css
- 注释使用中文，重要模块请确保包含注释
- 请配置alias，例如@/xxx等形式，避免../../../这样路径出现
