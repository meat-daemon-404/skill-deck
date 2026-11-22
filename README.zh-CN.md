# Skill Deck (`skill-deck` v0.4.0)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white)](https://github.com/meat-daemon-404/skill-deck)
[![Tests](https://img.shields.io/badge/Vitest-197%2F197_Passing-2ea44f)](https://github.com/meat-daemon-404/skill-deck)

[English](README.md) | [简体中文](README.zh-CN.md)

> **本地优先的超级智能体控制塔、MCP 聚合网关、自进化免疫桥接器与事务级技能保险库** —— 在单一 CLI 与可视化控制台中统一管理 Claude Code、Codex、Cursor、ZCode、DeepSeek Harness (DSH)、Gemini CLI 与 Windsurf 的 Skill 分发、MCP 路由以及 `agent-immune` v3.0.0 踩坑免疫策略。

## 核心能力

1. **事务级跨平台技能保险库（`packages/core/src/vault.ts`）**
   - 支持跨 7 大本地智能体平台的技能原子安装、软链/镜像同步、快照回滚与配置漂移检测。
2. **MCP 聚合网关与成本守卫（`packages/core/src/gateway.ts`）**
   - 将多个上游 MCP Server 聚合为单一本地入口，提供工具级延迟遥测、Schema 去重与 Token 预算护栏。
3. **原生集成 `agent-immune` v3.0.0 双层免疫护盾（`packages/core/src/agent-immune-bridge.ts`）**
   - **7 大平台免疫库自动发现与联邦**：自动定位并联邦合并 DSH、Claude Code、Cursor、Codex、ZCode、Windsurf 与 Gemini CLI 的 SQLite 抗体库（`discoverAgentImmuneStores`、`federateAgentImmuneRules`）。
   - **项目级 DNA 疫苗锁文件编译与校验**：支持生成、校验并应用 `.immune/vaccine.lock.json`（`compileVaccineLockfile`、`verifyVaccineLockfile`、`applyVaccineLockfile`），内置 SHA-256 完整性防篡改校验。
   - **执行前爆炸半径拦截器**：在工具调用落盘前通过 `preflightCheckToolCall` 计算 0–100 爆炸半径风险分（`allow` / `warn` / `rewrite` / `block`），对高危操作自动给出无损安全改写命令。

## 快速开始

```bash
git clone https://github.com/meat-daemon-404/skill-deck.git
cd skill-deck
npm install

# 运行全部 14 个测试套件共 197 项 Vitest 测试
npm test

# 构建全部工作区包
npm run build
```

## 许可证

本项目基于 [MIT License](LICENSE) 开源。
