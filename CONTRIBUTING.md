# 贡献指南

感谢你对 cctvdl 的兴趣！欢迎提交 Issue 和 Pull Request。

## 开发环境搭建

```bash
git clone https://github.com/POI-WX/cctvdl.git
cd cctvdl
npm install
npm run dev
```

**要求**：

- **Node.js 22.x** —— 与 Electron 35 内置版本一致，也是唯一验证过的版本。
  - 仓库已用 `.nvmrc` 固定为 22，可 `nvm use` 切换。
  - 请勿用更高版本（如 Node 24）跑构建/测试工具链。
- **ffmpeg 无需手动安装** —— 随 `npm install` 作为 `ffmpeg-static` 依赖自动获取；解密、合并与测试均使用该内置二进制，无需系统 ffmpeg/ffprobe。

## Git 钩子（可选）

仓库在 `.githooks/` 提供了一个可选的 `pre-commit` 钩子：提交前自动对暂存的 TS / Vue 等文件运行 `eslint --fix` 并重新暂存；若仍有无法自动修复的错误，则中止本次提交。

启用（每个克隆执行一次即可）：

```bash
git config core.hooksPath .githooks
```

需要临时跳过时，提交时加 `--no-verify`。

## 技术栈

| 组件 | 技术 |
|------|------|
| 框架 | Electron 35 + Vue 3 + TypeScript |
| UI | Element Plus |
| 解密 | 内置 H5E 解密模块（WASM） |
| 合并 | ffmpeg（默认无损流复制，可选重编码） |
| 构建 | electron-vite + electron-builder |
| 测试 | Vitest + Playwright |

## 项目架构

Electron 三进程模型：

```text
main process    → src/main/        # Node.js 环境，负责文件系统、下载、IPC
preload script  → src/preload/     # 桥接主进程和渲染进程的 IPC API
renderer        → src/renderer/    # Vue 3 + Element Plus，纯 UI 逻辑
shared types    → src/shared/      # 跨进程共享的 TypeScript 类型
```

关键模块：
- `src/main/api/cctv.ts` — 视频信息接口、HLS 解析、清晰度选择
- `src/main/download/coordinator.ts` — 下载任务调度，支持队列/取消/续传
- `src/main/download/decryptor.ts` — 在解密子进程中解密分片
- `src/main/download/finalizer.ts` — 调用 ffmpeg 合并分片
- `resources/decrypt/` — 第三方解密脚本（**不可修改**，见下）

## 代码规范

### 代码检查（Lint）

项目使用 ESLint（配置见 `eslint.config.mjs`）。提交前请确保通过：

```bash
npm run lint        # 检查
npm run lint:fix    # 自动修复可修复项
```

CI 会在 lint 关卡拦截，未通过的 PR 无法合并。多数格式类问题可由 `lint:fix` 自动处理，剩余报错按提示手动修复。也可启用 [Git 钩子](#git-钩子可选) 在提交时自动修复。

### 提交信息

使用 [Conventional Commits](https://conventionalcommits.org)：

```text
feat:     新功能
fix:      修复 bug
docs:     文档变更
refactor: 重构（不改变外部行为）
test:     测试相关
chore:    构建/工具/依赖变更
```

### TypeScript

- 严格模式（`strict: true`）
- 主进程输出 CJS（不可设 `"type": "module"`）
- 渲染进程用 Vite ESM

### 代码注释

- **英文**：通用技术注释（架构说明、平台行为、算法逻辑）
- **中文**：业务域专用内容（画质档位名称、CCTV 特定逻辑、UI 文案说明）

### 图标

如需更换应用图标，替换 `resources/icons/icon.png`（1024×1024 PNG），然后运行：

```bash
npm run build:icons
```

此命令使用 `electron-icon-builder` 自动生成 `icon.ico`（Windows）和 `icon.icns`（macOS）。

## 测试

提交 PR 前，请确保静态检查与测试都通过。CI 的 PR 门禁链为 lint/typecheck/build → unit → gui；e2e（联网管线）因 CCTV CDN 封境外 IP 无法在 CI 通过，改为仅手动触发（本地或 workflow_dispatch）：

```bash
npm run lint        # ESLint（flat config）
npm run typecheck   # tsc --noEmit
npm test            # 单元测试（离线，<5s）
npm run test:gui    # GUI 自动化（Playwright，需先 build）
npm run test:e2e    # 端到端联网管线（解析→解密→合并；仅需网络，手动跑）
```

## 打包安装包

```bash
npm run dist        # 当前平台
npm run dist:win    # Windows（.exe）
npm run dist:mac    # macOS（.dmg）
npm run dist:linux  # Linux（.AppImage）
```

> **Windows 本地打包注意**：electron-builder 的 `winCodeSign` 缓存包含 macOS 符号链接，
> Windows 解压需要符号链接权限。若报 `Cannot create symbolic link`，请开启「开发者模式」
> （设置 → 隐私和安全性 → 开发者选项）或以管理员身份运行。CI 上无此问题。
> 跨平台安装包统一由 GitHub Actions 的 release 工作流在打 `v*` tag 时构建。

## 关于解密脚本

`resources/decrypt/` 下含第三方解密脚本与本项目的包装层：

- `decrypt.js`、`cctv_wasm.js` 为第三方文件，**请勿修改**
- 其余包装层（如 `decrypt-wrapper.js`）可按需修改
- 解密运行时由 Electron 内置的 Node 提供（与系统 Node 无关，见上文环境要求）

## Pull Request 流程

1. Fork 仓库，创建功能分支：`git checkout -b feat/your-feature`
2. 实现变更，遵循上述规范
3. 确保本地全量测试通过（见 [测试](#测试)）
4. 提交 PR，清楚描述变更内容和动机
