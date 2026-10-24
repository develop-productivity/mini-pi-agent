# mini-pi-agent 协作规则

写给在本项目工作的 AI agent。上一级的 `../AGENTS.md` 也生效（审查流程、`docs/` 记录、服务器约束）；本文件只补充这个项目特有的规则，两边冲突时以本文件为准，并在回复里说明。

开工前按顺序读：

1. `README.md`：项目是什么、目录结构、怎么跑。
2. `docs/DESIGN.md`：三层架构和每个模块该放在哪。
3. `docs/PROGRESS.md`：做到哪了、下一步是什么、当前已知的类型错误。
4. `../docs/decisions/README.md`、`../docs/designs/README.md`：搜 `mini-pi` 相关的决定和设计。

## 1. 这是个学习项目

- 代码由用户自己写，用来学 agent 的内部结构。默认做法是**讲解、指出问题、给提示和思考题**，不要直接替用户把 `packages/*/src` 里的功能写完。
- 用户明确说"你来写""帮我实现"时才写。写完附导读：讲清楚这段代码在三层架构里的位置、数据怎么流过它，最后给 2～3 个思考题（只提问，不代答）。
- `learn-note/` 是用户自己的学习笔记，不要代填内容，只能在对话里提问或给反馈。
- 搬文件、改 import 路径、修配置这类机械改动可以直接做，但不要顺手改用户代码的逻辑或命名。发现问题写进回复或 `docs/PROGRESS.md`，让用户自己改。

## 2. 目录和依赖规则

npm workspaces monorepo：

| 包 | 目录 | 放什么 |
|---|---|---|
| `@mini-pi/ai` | `packages/ai/` | 模型接入：中间格式类型、provider translator、mock、factory |
| `@mini-pi/agent` | `packages/agent/` | agent_loop：Agent、事件总线、Tool 接口、注册表、executor |
| `@mini-pi/coding-agent` | `packages/coding-agent/`（待建） | 宿主（CLI/TUI）、内置工具、sandbox、session、hooks、plugins |

硬性规则：

1. **依赖只能往下**：`coding-agent → agent → ai`。`ai` 不能 import 其他包；`agent` 不能 import `coding-agent`。需要反向依赖时，说明接口放错了层，停下来和用户讨论，不要绕。
2. **跨包只用包名导入**，例如 `import type { Message } from "@mini-pi/ai"`。不要写 `../../ai/src/...`。
3. 每个包只通过 `src/index.ts` 对外暴露。新增要给别的包用的东西，记得在 `index.ts` 里导出；包内部文件之间用相对路径 + `.ts` 后缀。
4. 包的 `exports` 直接指向 `.ts` 源码，没有构建步骤，不要加 `dist/`、不要加 build 脚本。
5. 新增依赖加在用到它的那个包的 `package.json` 里，在根目录执行 `npm install` 更新 `package-lock.json`。工具类依赖（`tsx`、`typescript`、`@types/node`）只放根目录。
6. `demo/` 里每个文件都是自包含的单文件 demo，**不 import 任何 `@mini-pi/*` 包**，复制出去就能跑。
7. 新建 `packages/coding-agent` 时照抄 `packages/agent/package.json` 的写法，并把根 `package.json` 的 `cli` / `tui` 脚本加回来。

## 3. 怎么验证

改完至少跑：

```bash
npm install          # 新增包或依赖之后
npm run smoke        # 不需要 key：包能互相导入，mock 先要工具再结束
npm run typecheck    # 现在有 wip 类型错误，见 docs/PROGRESS.md
```

- typecheck 还没清零之前，判断标准是**错误数不增加、没有新的错误种类**。把改动前后的错误列表都贴出来对比，不要只说"没有新错误"。
- 改了 `demo/` 就跑对应的 `npm run demo:mock` / `demo:loop`。
- 需要真实模型时用 `.env`（照 `.env.example`），`.env` 不提交。

## 4. 分支、提交和 PR

- **不直接推 `master`。** 每个功能、修复都从 `master` 开分支，推上去提 PR，用户在 GitHub 上合并。
- 分支名：`feat/<描述>`、`fix/<描述>`、`chore/<描述>`、`docs/<描述>`，描述用英文短横线，例如 `feat/agent-loop`。
- 提交信息用 Conventional Commits（`feat:`、`fix:`、`refactor:`、`docs:`、`chore:`），说明可以写中文。
- CI（`.github/workflows/ci.yml`）在 PR 上跑 `npm ci`、`npm run smoke`、`npm run typecheck`。typecheck 目前设了 `continue-on-error`；`docs/PROGRESS.md` 第 8 步完成后删掉这一行。
- PR 描述写：改了什么、怎么验证的（贴命令和结果）、是否触发了代码审查（按 `../AGENTS.md` 的触发条件）。

## 5. 对外呈现

- mini-pi-agent 是独立的公开仓库。README、`docs/` 和提交信息里**不提其他项目的名字**，也不写"第几天做了什么""调试了多久"这类过程叙事；需要经验总结时，写成通用的注意事项。
- 参考 pi 的设计可以写"参考 pi"，不要复制它的代码。
