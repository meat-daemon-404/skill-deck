# SkillDeck

**开源、本地优先的 AI Agent 技能（`SKILL.md`）与 MCP（`mcpServers`）统一控制塔 —— 集上下文 Token 预算热力图、中英双语触发冲突雷达、Prompt 路由沙盒、安全审计与可视化工作流编排于一体。**

[English](./README.md) | [简体中文](./README.zh-CN.md)

---

## 为什么做 SkillDeck？

现在越来越多的开发者同时使用 **Antigravity**、**Claude Code**、**Cursor**、**Gemini CLI**、**OpenAI Codex**，并安装了数十甚至上百个开放标准的 `SKILL.md` 技能和 MCP Server。但配置一多，四个隐形痛点就会立刻爆发：

1. **上下文额度悄悄被吃光**：写得太啰嗦的 `description` 和大量常驻 MCP Schema，每轮对话都在白烧几千 Token。
2. **技能触发词互相打架**：两个技能在相似关键词或中文触发词上重叠，导致 Agent 路由飘忽不定。
3. **密钥明文泄露与配置失效**：`.mcp.json` 里不小心硬编码了 API Key、Markdown 相对引用断链、目录名与 `name` 不一致、本机缺少对应 CLI 命令。
4. **多平台配置难迁移**：想把一套沉淀好的 Skills + MCP 打包迁到另一个 Agent 工具，只能手动逐个复制改格式。

**SkillDeck** 提供零云端依赖、100% 本地运行的 CLI + 交互式 Web 控制塔，一键掌控你的全部 AI Agent 资产。

---

## 核心特性

- **多平台只读自动发现**：支持扫描 `.gemini/`、`.claude/`、`.cursor/`、`.codex/` 及任意自定义目录，内置开箱即用的中英双语 **Demo Workspace**，同时支持在顶部一键切到 **My Machine (Read-Only)** 实时扫描你本机真实配置。
- **常驻 vs 按需 Context Token 热力图**：针对中英文混合场景校准的 Token 估算器，直观区分每轮必加载的 Startup 成本与按需加载的 Body/References 成本。
- **中英双语触发冲突雷达**：结合双语 TF-IDF 余弦相似度与显式触发词（如 `触发词：...` / `Trigger on: ...`）重叠检测，精准揪出互相抢触发的技能对。
- **Prompt 路由仿真沙盒**：输入任意中文或英文提示词，实时模拟哪些技能会被激活、高亮命中的关键词、展示**反向排除规则（`Do NOT use for...` / `不负责...`）抑制效果**以及潜在路由歧义警告。
- **14 条规范与安全审计规则（`SD001`–`SD104`）**：校验 Agent Skills 官方规范、检查断链与本机 `PATH` 可执行文件，并在数据离开核心扫描层前自动脱敏明文密钥。
- **可视化 DAG 工作流编排器**：基于 [`@xyflow/react`](https://reactflow.dev/)，把真实发现的 Skill、MCP Server 和人工审批闸门连线编排，一键拓扑编译成可直接安装的 **Orchestrator `SKILL.md`**。
- **跨平台安全导出器**：一键导出并自动替换所有敏感密钥为 `${ENV_VAR}` 占位符，支持 **Claude Code**、**Cursor (`.mdc`)**、**Gemini CLI**、**Antigravity Plugin** 与 **Portable JSON**。

---

## 快速开始

```bash
# 1. 安装依赖
pnpm install

# 2. 构建核心引擎、本地服务端、CLI 与 Web 控制塔
pnpm build

# 3. 启动交互式 Web 控制塔（默认加载内置演示环境）
pnpm demo
# -> 浏览器打开 http://127.0.0.1:4173，可在右上角一键切换到「My Machine (Read-Only)」扫描本机真实技能！
```

### 常用 CLI 命令

```bash
# 扫描内置演示环境 / 扫描本机真实配置
node packages/cli/dist/cli.js scan --demo
node packages/cli/dist/cli.js scan --local

# CI 友好的规范与安全审计（发现错误返回非零退出码，--strict 同时拦截警告）
node packages/cli/dist/cli.js lint --demo
node packages/cli/dist/cli.js lint --local --json

# 查看上下文 Token 预算拆解 & 触发冲突雷达
node packages/cli/dist/cli.js budget --demo
node packages/cli/dist/cli.js conflicts --demo

# 在终端里直接测试任意中/英文 Prompt 会命中哪些技能
node packages/cli/dist/cli.js route --demo "Deploy a Cloudflare Worker with wrangler.toml"
node packages/cli/dist/cli.js route --demo "帮我拆分镜，生成分镜表和首帧提示词"

# 跨平台安全导出（自动脱敏所有检测到的密钥）
node packages/cli/dist/cli.js export --demo --target claude-code --out .skilldeck-export/claude
```

---

## 项目结构

```text
skill-deck/
├── packages/
│   ├── core/          # @skilldeck/core — 零 UI 核心引擎（扫描、解析、Token 估算、冲突雷达、路由、审计、脱敏、导出）
│   ├── server/        # @skilldeck/server — 仅监听 127.0.0.1 的本地 HTTP API 与前端静态托管
│   └── cli/           # @skilldeck/cli — 终端命令行工具
├── apps/
│   └── web/           # @skilldeck/web — React 19 + TypeScript + Vite + React Flow 控制塔界面
├── examples/
│   └── demo-workspace/ # 内置中英双语多平台演示目录
└── docs/
    ├── architecture.md # 架构说明
    └── spec-checks.md  # 14 条审计规则文档
```

## 隐私与安全承诺

- **100% 本地运行**：服务端默认仅绑定 `127.0.0.1`，无任何云端上报或遥测。
- **默认严格只读**：扫描本机 Agent 配置绝不会修改你的任何已有文件。
- **源头密钥脱敏**：所有检测到的 API Key、Token 和数据库连接密码在 `@skilldeck/core` 阶段即完成遮罩，绝不透传给前端或导出包。

## 开源协议

MIT © 2026 SkillDeck Contributors
