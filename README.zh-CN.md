# SkillDeck v0.2

**开源、100% 本地优先的 AI Agent SuperAgent 超级总控台 · MCP 聚合网关 · 双层 Agent-Immune 免疫中心（原生融合 [`meat-daemon-404/agent-immune`](https://github.com/meat-daemon-404/agent-immune)）· 事务型技能金库。默认简体中文界面，支持一键中英切换。**

[English](./README.md) | [简体中文](./README.zh-CN.md)

---

## v0.2 核心能力一览

1. **🧠 SuperAgent 超级指挥台 & 画布真执行引擎**
   - 自动探测本机已安装的 CLI Agent 与模型引擎（Antigravity `agy`、`Ollama` 实时本地模型、`Claude Code`、`Gemini CLI`、`Codex`、`gh`），支持接入本地 Ollama 或任意 OpenAI 兼容模型（离线无 Key 也能确定性运行）。
   - 横跨 **7 大平台**（Antigravity、Claude Code、Cursor、Gemini CLI、Codex、**DSH**、**ZCode**）自动路由技能与 MCP，注入 `<immune_memory>` 踩坑记忆并自动避开隔离技能，一键发送到 React Flow 画布运行并逐节点高亮执行状态。
2. **🧬 双层 Agent-Immune 免疫中心（原生对接 `meat-daemon-404/agent-immune`）**
   - **第一层 · 踩坑自进化免疫记忆（Pitfall Immunity）**：零外部依赖通过 Node 原生 `node:sqlite` 只读挂载本机 `~/.dsh/immune.sqlite`、`~/.zcode/immune.sqlite` 及 Git 团队同步文件 `.immune/rules.jsonl`，实现 `trigger → avoid → do` 实时召回、严格隔离 `<`/`>` 分隔符注入 `<immune_memory>`、手动/自动蒸馏新抗体与一键导出。
   - **第二层 · 毒技能扫描与运行时防火墙（Security Immunity）**：静态扫描所有 `SKILL.md` 及 `scripts/` 中的提示词注入（`IMM001`）、密钥外传（`IMM002`）、危险管道命令（`IMM003`）、隐蔽注释投毒（`IMM004`）与零宽字符欺骗（`IMM005`）；运行时内置**死循环熔断器** + **高危调用隔离审批队列（放行 / 拒绝 / 提取抗体）**。
3. **🔥 `@skilldeck/hub` 本地 MCP 聚合网关（真实 stdio MCP 元服务）**
   - 所有本机 Agent 只需配置唯一一个 `skilldeck-hub` MCP 入口，通过 7 个渐进式元工具按需发现并调用下游 MCP 与全机 Skills，常驻启动 Token 从 20,000+ 直降至 **~580t（立省 95%+）**，并在网页端提供 SSE 实时调用监控流与下游工具探活。
4. **🔗 Skill Vault 统一金库与时光机回滚**
   - 单一真源仓库 `~/.skilldeck/vault/`，支持沙盒预演（Dry-Run）同步、安全启停/隔离技能（`SKILL.md` ⇄ `SKILL.md.disabled`），每次写入自动备份，随时一键 `Undo` 原样回滚。
5. **🌐 默认简体中文界面（一键 `中文 / EN` + 深浅色模式自适应）**

---

## 快速上手

```powershell
pnpm install
pnpm build
pnpm demo
# 浏览器打开 http://127.0.0.1:4173，顶栏随时切换「演示环境 / 扫描本机（只读）/ 自定义目录」
```

### 一键把本机所有 Agent 接到 `skilldeck-hub`
在 Antigravity / Claude Code / Cursor / Codex / ZCode / DSH 的 MCP 配置中添加：

```json
{
  "mcpServers": {
    "skilldeck-hub": {
      "command": "node",
      "args": ["D:/explore/ai-infra/skill-deck/packages/cli/dist/cli.js", "hub", "--local"]
    }
  }
}
```

### 常用 CLI 命令

```powershell
node packages/cli/dist/cli.js scan --local       # 扫描本机 7 大 Agent 平台（含 DSH 与 ZCode）
node packages/cli/dist/cli.js immune --local     # 双层免疫体检（毒技能 + agent-immune 踩坑抗体）
node packages/cli/dist/cli.js agents             # 探测本机 agy / ollama / claude / gemini / codex
node packages/cli/dist/cli.js run --demo "部署 Cloudflare Worker 并检查 PostgreSQL RLS"
node packages/cli/dist/cli.js hub --local        # 启动真实 stdio JSON-RPC 2.0 MCP 聚合网关
node packages/cli/dist/cli.js serve --demo       # 启动中文 Web 控制塔
```

## 开源协议

MIT © 2026 SkillDeck Contributors
