# Agent Skill 版

同一套六步流程的 Agent 形态。网页版是给人点的，这里是给 Agent 执行的——本质是把「一次只问一个问题、候选先给预设、切入点必须回到选题目标」这些约束写成 Agent 能遵守的指令。

## 安装

把整个 `content-brief/` 目录放进你 Agent 的 skills 目录：

| Agent | 目标路径 |
|---|---|
| Claude Code | `~/.claude/skills/content-brief/` |
| 其他支持 Agent Skills 的工具 | 对应的 skills 目录 |

目录结构必须保持：

```
content-brief/
├── SKILL.md                     # 入口，含 name / description frontmatter
└── reference/
    ├── presets.md               # 内置候选库（离线可用）
    ├── brief-format.md          # 创作简报的标准格式与完整示例
    └── why.md                   # 每一步的判断依据
```

`SKILL.md` 保持精简，`reference/` 里的内容按需加载——这是 Agent Skills 的推荐做法，避免每次触发都塞满上下文。

## 触发方式

装好后直接说人话就行：

- 「我想做一条关于情感的内容，但不知道讲哪部分」
- 「帮我看看这个选题该怎么切入」
- 「我想写点东西，只有一个大方向」

`description` 字段里写明了触发条件，支持 Agent Skills 的工具会自动判断。

## 与网页版的差异

| | 网页版 | Skill 版 |
|---|---|---|
| 形态 | 浏览器里的六步向导 | Agent 对话里的六步提问 |
| 状态管理 | 快照 + 失效传播（改上游自动标待确认） | 靠 Agent 自己记住上下文 |
| 候选来源 | 预设库 + 可选模型 | 预设库（`reference/presets.md`）为主 |
| 产出 | 简报 + Markdown/JSON 导出 + 分享链接 | 对话里直接给简报，可让 Agent 接着写稿 |

**网页版更严格**：它用程序强制「不填完不能下一步」和「改上游必须重新确认」。Skill 版靠指令约束 Agent，灵活性更高，但守不守规矩取决于模型。

## 两版如何保持一致

流程的机器可读定义在 [`../docs/flow.json`](../docs/flow.json)，网页版直接读它；Skill 版的 `SKILL.md` 和 `reference/presets.md` 是同一份内容的人话版本。改流程时两边都要更新——这是目前唯一的同步成本。
