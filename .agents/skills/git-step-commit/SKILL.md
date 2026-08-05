---
name: git-step-commit
description: Analyze Git changes, split them into coherent commits, infer message language and format, optionally close supplied GitHub issues, and execute safely. Manage persistent global or repository preferences for review versus direct submission and automatic or specified commit-message language through native Git config. Use when the user asks to commit, review or batch Git changes, configure/show/delete commit preferences, 设置提交偏好、按推荐提交、指定提交语言, or close issues through commits.
---

# Git Step Commit

把当前 Git 更改整理成清晰、可审查、可回滚的提交。

## 管理持久偏好

当用户要求设置、查看或删除提交偏好时，只处理配置并返回结果，不检查工作树、不规划提交，也不提交文件。使用 Git 原生配置，不依赖 Skill 携带的脚本或额外运行时。

使用两个配置项：

- `git-step-commit.mode`：只允许 `default`、`review` 或 `direct`。
- `git-step-commit.language`：允许 `auto` 或规范化的语言标识。把常见自然语言名称转换为稳定标识，例如中文为 `zh-CN`、英文为 `en`、日文为 `ja`、韩文为 `ko`；其他值使用合法的 BCP 47 形式，不确定时先询问，不写入猜测值。

使用两个作用域：

- **全局**：使用 `git config --global`，对该用户的所有项目生效。
- **当前项目**：使用 `git config --local`，只写入当前仓库的 Git 配置，不写入或提交项目文件。执行前确认位于 Git 仓库中。

写入或删除时必须知道作用域。用户未说明且无法从上下文确定时先询问，不要擅自选择全局或当前项目。读取未指定作用域时默认显示当前有效值及来源。

### 读取

使用当前终端直接执行以下 Git 命令；不要要求 Bash、Python 或 Go。分别读取各层，按字段解析：

```text
git config --local --get git-step-commit.mode
git config --local --get git-step-commit.language
git config --global --get git-step-commit.mode
git config --global --get git-step-commit.language
```

不在 Git 仓库中时跳过 `--local`。读取不存在的 key 所产生的非零退出码表示“未设置”，不是工作流失败。显示每个字段的有效值和来源：本次指令、当前项目、全局或内置。

### 写入

先校验并规范化所有值，再使用对应作用域执行一个或两个精确命令：

```text
git config --global --replace-all git-step-commit.mode review
git config --global --replace-all git-step-commit.language zh-CN
git config --local --replace-all git-step-commit.mode direct
git config --local --replace-all git-step-commit.language auto
```

只修改用户明确给出的字段。写入后从同一作用域读回并核对；命令失败或读回不一致时说明真实结果，不要声称配置成功。

### 删除

删除单个字段时执行对应的 `--unset-all`：

```text
git config --global --unset-all git-step-commit.mode
git config --local --unset-all git-step-commit.language
```

删除指定作用域的全部提交偏好时执行：

```text
git config --global --remove-section git-step-commit
git config --local --remove-section git-step-commit
```

只删除用户指定的字段和作用域。目标不存在所产生的非零退出码表示原本已无配置，按幂等成功处理。删除后读取有效值并说明回退到了哪一层。

## 选择模式

- 每次实际提交请求开始时静默读取项目和全局的两个配置项，即使用户本轮没有提到偏好；把读取放进下方的一次性分析调用，避免增加往返。
- 对 `mode` 按“本次明确指令 → 当前项目配置 → 全局配置 → 内置默认”逐层取值。只要当前项目存在该 key，就停止向全局回退；因此项目级 `default` 可以明确恢复内置行为。
- `default`：使用内置行为。对“帮我提交”“git commit”“分步提交”等普通请求先输出计划并等待确认；本次明确说“按推荐提交”“你决定并直接提交”“无需确认”等授权时直接提交。
- `review`：默认输出计划并等待确认。
- `direct`：默认内部完成分析并直接提交全部推荐批次。
- 本次明确说“本次直接提交”或“本次先审查”时，临时覆盖持久模式但不修改配置。
- 如果用户只询问“推荐怎么提交”“给我建议”或只要求审查，无论持久模式为何都只输出计划。

`direct` 和本次直提授权都只省略确认。遇到疑似凭据、合并冲突、失败的必要测试或无法判断归属的文件时，始终停止并说明，不要擅自提交。

## 一次性分析

默认把初始检查放进**一次 shell/tool 调用**，不要拆成多个往返：

```bash
set -e
git rev-parse --show-toplevel
git status --short --untracked-files=all
git diff --stat
git diff --cached --stat
local_mode="$(git config --local --get git-step-commit.mode || true)"
local_language="$(git config --local --get git-step-commit.language || true)"
global_mode="$(git config --global --get git-step-commit.mode || true)"
global_language="$(git config --global --get git-step-commit.language || true)"
author_email="$(git config --get user.email || true)"
author_name="$(git config --get user.name || true)"
author_history=""
if [ -n "$author_email" ]; then
  author_history="$(git log --all -12 --author="$author_email" --pretty=format:%s 2>/dev/null || true)"
fi
if [ -z "$author_history" ] && [ -n "$author_name" ]; then
  author_history="$(git log --all -12 --author="$author_name" --pretty=format:%s 2>/dev/null || true)"
fi
printf 'commit author: %s <%s>\nuser locale: %s\nauthor history:\n%s\nrepository history:\n' \
  "$author_name" "$author_email" "${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}" "$author_history"
git log --all -12 --pretty=format:%s 2>/dev/null || true
printf '\npersistent preferences:\nlocal mode=%s language=%s\nglobal mode=%s language=%s\n' \
  "$local_mode" "$local_language" "$global_mode" "$global_language"
```

如果没有更改，直接说明并停止。规划阶段保持只读，不要执行 `git restore --staged .`。

根据状态输出同时分析暂存区、工作区、未跟踪文件和持久偏好：

- 已明确是本轮 agent 完成且修改意图已知时，不重复阅读正文。
- 来源不明、包含用户已有修改、同一文件同时有暂存和未暂存更改，或意图不清时，再按需查看 `git diff -- <path>`、`git diff --cached -- <path>` 和相关文件。普通 diff 不显示未跟踪文件，准备提交前要直接检查其内容。
- 按下节选择同一个历史层级来确定消息语言与格式风格，不要把不同层级的语言和格式混用。
- 复用本轮已完成的测试结果；否则只运行必要且成本合理的验证。未运行时说明原因。
- 默认不添加 `Co-authored-by:` 或任何 AI 署名；仅按用户本轮明确提供的署名添加。

## 确定消息语言与风格

对 `language` 按“本次明确指令 → 当前项目配置 → 全局配置 → `auto`”逐层取值。只要当前项目存在该 key，就停止向全局回退；因此项目级 `auto` 可以明确恢复自动推断。

- 用户明确指定完整消息、语言或格式时，对应要求始终优先，只影响本次请求，不修改持久配置。
- 有效语言不是 `auto` 时，使用指定语言撰写摘要；仍按下方历史层级推断前缀、scope、大小写、标点和语气。
- 有效语言为 `auto` 时，按以下顺序选择消息配置，命中后同时确定**自然语言**和**格式风格**：

1. 优先按当前配置的 `user.email` 筛选作者历史；没有匹配时再按 `user.name` 筛选。存在本人历史时，同时沿用本人的提交语言、前缀、scope、大小写、标点和语气。
2. 当前作者没有历史时，参考仓库整体历史，同时沿用仓库的主要语言和格式。忽略明显的 bot、合并和自动发布消息，除非仓库只有这类历史。
3. 没有可用历史时，使用简洁的 Conventional Commit（`feat`、`fix`、`refactor`、`test`、`docs`、`chore`），摘要语言跟随用户。

仅在第 3 级兜底时，从当前对话语言、已建立的对话语言、`LC_ALL`、`LC_MESSAGES`、`LANG` 依次判断摘要语言，仍不明确时默认英语。用户用中文交互则写中文摘要，用韩文交互则写韩文摘要。不要根据姓名、邮箱或国籍猜测语言；技术标识、文件名和 Conventional Commit 类型无需翻译。

不要把不同层级混用。例如本人历史为中文 Conventional Commit 时，即使全仓近期多为英文，也继续使用本人的中文 Conventional Commit；只有本人完全没有历史时才整体切换到全仓配置。

### 判断历史中的混合语言

在已经选中的本人历史或全仓历史内，忽略 Conventional Commit 类型、scope、文件名、代码标识和 Issue 编号，再按每条摘要的自然语言判断：

1. 只出现一种语言时，使用该语言。
2. 英语与一种非英语语言混合时，优先使用该非英语语言，不要因少量英文提交切换成英语。例如 10 条中 7 条中文、3 条英文时使用中文。
3. 出现多种非英语语言时，若一种语言明显占主导则使用该语言；否则视为广泛混合，改用用户当前与 AI 的对话语言。
4. 无法可靠识别语言时，也使用用户当前与 AI 的对话语言。

混合语言只改变摘要语言，不改变历史层级。前缀、scope、大小写、标点和语气仍从已经选中的本人历史或全仓历史推断。

## 默认模式：提交计划

输出计划后等待确认，不要提前运行 `git add` 或 `git commit`：

```text
建议提交计划：
变更来源：本轮 agent 修改 / 用户已有修改 / 混合 / 不确定
验证状态：已运行 <command> / 建议先运行 <command> / 未运行，原因：...
消息配置：<语言 + 格式简述>（依据：本次指定 / 项目偏好 / 全局偏好 / 本人历史 / 仓库历史 / 内置回退）
协作者：默认不添加
Issue：默认不关闭；如需在提交进入默认分支后自动关闭，请回复编号（如 #12、#34；多批提交可注明对应批次）。
执行方式：确认后用一次命令链完成全部批次

1. <commit message>
   - 文件：path/a, path/b
   - 目的：...
2. <commit message>
   - 文件：path/c
   - 目的：...

请确认：全部提交、只提交某几批，或调整批次/消息。
```

用户确认全部或说“按推荐提交”后直接执行；只确认部分时只提交指定批次，其他更改保持不动。

## 关闭 GitHub Issues

- 默认不关闭 Issue。只使用用户明确给出的编号，不根据 diff、分支名或提交内容猜测。
- 同仓库编号使用 `#123`，跨仓库编号保留 `owner/repository#123`；忽略重复编号，拒绝无效编号。
- 单批提交时把全部编号放入该提交。多批提交时优先使用用户指定的归属；未指定且关联明确时放入最相关批次，无法判断时先询问。
- 使用独立的 commit body，不改变仓库原有的标题风格：`git commit -m "<message>" -m "Closes #12"`。多个 Issue 写成 `Closes #12, closes #34`，每个编号都带关闭关键字。
- 关闭动作在包含该 commit 的更改进入 GitHub 默认分支后发生，不要声称本地提交已经关闭 Issue。
- 推荐直提模式只处理用户事先提供的编号，不为询问 Issue 而打断执行。默认模式下，用户只回复编号视为补充计划；除非同时确认提交，否则继续等待确认。

## 划分批次

按意图分组，使每批能独立审查和回滚：

- 同一目的、必须一起成立的更改通常只做一个提交。
- 独立功能或问题、可单独审查的测试/文档/工具配置、遮挡源码的大型生成产物应拆分。
- 通常按“基础设施 → 实现 → 测试 → 文档 → 生成产物”排序，但优先遵循仓库历史；必要的测试或生成产物可与实现同批。
- 不要顺手提交无关脏文件。

## 快速执行

当每个文件整体只属于一个批次、路径明确且无需选择 hunk 时，把所有批次放进**一次 shell 调用、一条 `&&` 命令链**：

```bash
git add -A -- <batch-1-paths> \
  && git commit --only -m "<message-1>" -m "Closes #<issue>" -- <batch-1-paths> \
  && git add -A -- <batch-2-paths> \
  && git commit --only -m "<message-2>" -- <batch-2-paths> \
  && git status --short \
  && git log -2 --pretty=format:'%h %s'
```

没有关联 Issue 的批次省略第二个 `-m`。按批次数量调整 `git log -N`。正确引用所有路径和消息，在 pathspec 前使用 `--`；不要使用无 pathspec 的 `git add .` 或 `git add -A`。

`git commit --only -- <paths>` 只提交指定路径，并保留其他已暂存文件。前置的精确 `git add -A -- <paths>` 会提交这些路径的完整当前状态，因此仅在整文件属于本批时使用。

`&&` 会在失败时停止后续提交。失败后先用只读的 `git status --short` 和 `git log` 判断完成到哪一批；不要盲目续跑。PowerShell 使用等价的单次调用并检查 `$LASTEXITCODE`。

## 逐批执行

只有在以下情况使用慢速路径：需要 `git add -p`、同一路径的暂存/未暂存内容不应一起提交、用户与 agent 修改混在同一文件、路径很多难以确认、用户要求预览，或 hook/状态异常。

整文件仍属于同一批时，逐步暂存、检查并提交精确路径：

```bash
git add -A -- <paths>...
git diff --cached --stat -- <paths>...
git diff --cached --name-status -- <paths>...
git commit --only -m "<message>" -m "Closes #<issue>" -- <paths>...
git status --short
```

没有关联 Issue 时省略第二个 `-m`。需要选择 hunk 时，先确保当前提交能独占暂存区：

```bash
git add -p -- <paths>...
git diff --cached
git commit -m "<message>" -m "Closes #<issue>"
git status --short
```

没有关联 Issue 时省略第二个 `-m`。不要给 hunk 提交添加 pathspec 或 `--only`，否则会忽略 hunk 选择并提交指定路径的完整工作区内容。若暂存区还有需要保留的其他更改，不要静默清空；先征求用户同意再重组，或使用临时 index。

## 安全与结果

- 不要使用会丢弃内容的 `git reset --hard`、`git checkout -- <path>`、`git clean`，也不要 amend、rebase、改写历史或 force push，除非用户明确要求。
- 不要提交密钥、凭据、本地缓存、编辑器文件或非预期构建产物。
- 如果 hook 修改文件，检查新增 diff；属于当前批次时重新暂存并重试，否则保持未提交。
- 配置操作完成后报告被修改或删除的作用域、字段、有效值及来源；不要回显无关的 Git 配置。
- 完成后列出每个提交的短 hash 和消息，并说明剩余未提交文件、是否只提交了部分批次，以及测试结果或未运行原因。
