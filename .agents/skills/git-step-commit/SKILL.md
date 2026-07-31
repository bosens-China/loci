---
name: git-step-commit
description: Analyze Git working tree and staged changes, split them into coherent commits, infer both message language and format from the current Git author's own history before the wider repository, prefer a non-English language when history mixes English with one non-English language, use the user's conversation language when history is broadly multilingual, fall back to a default localized format, optionally add GitHub issue-closing keywords supplied by the user, and execute safely. By default propose a plan and wait for approval; when the user explicitly delegates with phrases such as “按推荐提交”, “你决定并直接提交”, or “无需确认”, skip the displayed plan and make all recommended commits directly. Use when the user asks for git commit, commit changes, git 分步提交, 分批提交, staged commit cleanup, wants current changes committed with sensible messages, or asks a commit to close GitHub issues.
---

# Git Step Commit

把当前 Git 更改整理成清晰、可审查、可回滚的提交。

## 选择模式

- **默认模式**：对“帮我提交”“git commit”“分步提交”等普通请求，先输出计划并等待确认。
- **推荐直提模式**：当用户明确说“按推荐提交”“你决定并直接提交”“无需确认”等，把批次和消息交给 agent 决定时，内部完成同样的分析，不展示计划，直接提交全部推荐批次。
- 如果用户只询问“推荐怎么提交”或“给我建议”，只输出计划。

推荐直提只省略确认。遇到疑似凭据、合并冲突、失败的必要测试或无法判断归属的文件时，停止并说明，不要擅自提交。

## 一次性分析

默认把初始检查放进**一次 shell/tool 调用**，不要拆成多个往返：

```bash
set -e
git rev-parse --show-toplevel
git status --short --untracked-files=all
git diff --stat
git diff --cached --stat
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
```

如果没有更改，直接说明并停止。规划阶段保持只读，不要执行 `git restore --staged .`。

根据状态输出同时分析暂存区、工作区和未跟踪文件：

- 已明确是本轮 agent 完成且修改意图已知时，不重复阅读正文。
- 来源不明、包含用户已有修改、同一文件同时有暂存和未暂存更改，或意图不清时，再按需查看 `git diff -- <path>`、`git diff --cached -- <path>` 和相关文件。普通 diff 不显示未跟踪文件，准备提交前要直接检查其内容。
- 按下节选择同一个历史层级来确定消息语言与格式风格，不要把不同层级的语言和格式混用。
- 复用本轮已完成的测试结果；否则只运行必要且成本合理的验证。未运行时说明原因。
- 默认不添加 `Co-authored-by:` 或任何 AI 署名；仅按用户本轮明确提供的署名添加。

## 确定消息语言与风格

用户明确指定完整消息、语言或格式时，对应要求始终优先。否则按以下顺序选择消息配置，命中后同时确定**自然语言**和**格式风格**：

1. 优先按当前配置的 `user.email` 筛选作者历史；没有匹配时再按 `user.name` 筛选。存在本人历史时，同时沿用本人的提交语言、前缀、scope、大小写、标点和语气。
2. 当前作者没有历史时，参考仓库整体历史，同时沿用仓库的主要语言和格式。忽略明显的 bot、合并和自动发布消息，除非仓库只有这类历史。
3. 没有可用历史时，使用简洁的 Conventional Commit（`feat`、`fix`、`refactor`、`test`、`docs`、`chore`），摘要语言跟随用户。

仅在第 3 级兜底时，从用户明确偏好、当前对话语言、已建立的对话语言、`LC_ALL`、`LC_MESSAGES`、`LANG` 依次判断摘要语言，仍不明确时默认英语。用户用中文交互则写中文摘要，用韩文交互则写韩文摘要。不要根据姓名、邮箱或国籍猜测语言；技术标识、文件名和 Conventional Commit 类型无需翻译。

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
消息配置：<语言 + 格式简述>（依据：用户指定 / 本人历史 / 仓库历史 / 默认格式 + 用户语言）
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
- 完成后列出每个提交的短 hash 和消息，并说明剩余未提交文件、是否只提交了部分批次，以及测试结果或未运行原因。
