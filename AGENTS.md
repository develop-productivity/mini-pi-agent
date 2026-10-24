# mini-pi-agent 协作规则

写给在本项目工作的 AI agent。本文件是自包含的：所有规则都写在这里，不依赖仓库外的任何文件。如果你在本地还加载到了上级目录的规则，和本文件冲突时以本文件为准，并在回复里说明。

开工前按顺序读：

1. `README.md`：项目是什么、目录结构、怎么跑。
2. `docs/DESIGN.md`：三层架构和每个模块该放在哪。
3. `docs/PROGRESS.md`：做到哪了、下一步是什么、当前已知的类型错误。
4. `docs/decisions/`、`docs/designs/`、`docs/reviews/`（有的话）：搜和这次改动相关的决定、设计和审查记录。

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
- PR 描述写：改了什么、怎么验证的（贴命令和结果）、是否触发了代码审查（见第 5 节）。

## 5. 设计和审查

### 先写设计的改动

新增包、改包之间的接口（`@mini-pi/*` 导出的类型和函数）、改目录结构或 CI、删除已有功能、预计改动超过约 200 行：先在 `docs/designs/YYYY-MM-DD-主题.md` 写设计——要解决什么、考虑过哪些方案、选哪个和为什么、风险（能否回滚）、怎么验证。自己对照已有决定审一遍：没问题就开工；发现问题就停下，把设计和问题交给用户。

### 代码审查

**触发**（满足任一条）：走过上面的设计；改了 agent 循环、工具执行、provider 格式转换这类逻辑；改了 CI；用户要求审查。
**不触发**：纯文档、注释、`demo/` 的小修、只在本地用的一次性脚本。

触发时：

1. 改完、验证通过后，交给审查人审 PR 的 diff。
2. 审查人必须是新上下文、不继承写代码时对话的 agent。只给它：设计文档（有的话）、相关决定、怎么拿 diff、验证命令；不解释实现思路。
3. 审查人用 manager 视角：改动是否解决了问题、是否和已有决定冲突、有没有超出范围、能否回滚、结论有没有测试支撑；不挑代码风格。每条问题标「必须修 / 建议 / 需要人判断」，写出文件、行号和具体失败场景；说不出失败场景的只能算「建议」。
4. 问题**全部列给用户，由用户决定改哪些**，AI 不自己判断"这条不用改"。
5. 按用户的决定改完再审一次，这算一轮。**最多三轮**：第三轮后还有「必须修」，就停下，按设计问题交给用户。

## 6. 记录

决定、设计、审查都写进本仓库的 `docs/`：

- `docs/decisions/YYYY-MM-DD-主题.md`：开头一行写日期、谁拍板（用户 / AI）、状态（生效 / 已被替代，写明被哪个文件替代）；「决定」一句话，「为什么」最多三条。用户在对话里拍板的事也要记。旧决定不删，只改状态。
- `docs/designs/YYYY-MM-DD-主题.md`：设计，末尾附自审结论和用户的决定。
- `docs/reviews/YYYY-MM-DD-主题.md`：每轮审查的问题、用户的决定、怎么改的。
- 每个目录放一个 `README.md` 索引，新增或改状态时同步更新。
- `docs/PROGRESS.md` 记进度，每完成 PROGRESS 里的一步就更新。

## 7. 对外呈现

- mini-pi-agent 是独立的公开仓库。README、`docs/`、代码注释和提交信息里**不提其他项目或目录的名字**，不引用仓库外的文件，也不写"第几天做了什么""调试了多久"这类过程叙事；需要经验总结时，写成通用的注意事项。
- 参考 pi 的设计可以写"参考 pi"，不要复制它的代码。
