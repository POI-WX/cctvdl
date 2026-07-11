<h1 align="center">📺 cctvdl</h1>

<p align="center">跨平台央视视频下载器 · 粘贴链接即可下载 · 开箱即用</p>

<p align="center">
  <a href="https://github.com/POI-WX/cctvdl/actions/workflows/ci.yml"><img src="https://github.com/POI-WX/cctvdl/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-green.svg" alt="Platform">
</p>

cctvdl 让央视视频下载变得简单——粘贴链接、选清晰度、批量下载，全程开箱即用。支持 Windows / macOS / Linux。

<p align="center">
  <img src="docs/assets/home.png" width="820" alt="cctvdl 主界面">
</p>

## ✨ 功能特性

**📥 内容管理**
- **栏目与节目集导入** — 支持央视栏目、节目概览页、电视剧和 4K 选集页；内容默认从早到晚显示，节目集会边读取边显示选集和已加载数量，也可切换正序或倒序
- **单视频下载** — 电影、新闻文章、导视片段和央视新闻视频页等链接可直接加入下载；标题、封面和发布时间会一并保留
- **收藏与备份** — 收藏置顶常用内容，JSON 导入/导出备份；单视频集合持久收藏
- **快速导入** — 支持把链接拖到窗口；也可开启剪贴板提示，复制央视链接后即可导入

**⬇️ 下载引擎**
- **高清画质** — 常规央视节目可选流畅、标清、高清、超清和蓝光（最高 1080p）；没有对应档位时会自动调整
- **并行与断点续传** — 失败或取消后保留进度，可随时重试；意外退出后，未完成任务会在重启应用时自动恢复。最多同时下载 3 个视频。
- **队列管理** — 批量下载前会确认数量、清晰度和保存位置；可拖拽排序或一键置顶，实时查看速度、剩余时间和进度；可以先在不同月份、不同栏目勾选视频，再一次下载

**📁 文件与历史**
- **下载历史** — 自动记录，防止重复下载；支持关键词搜索、一键重新下载、文件定位与单条删除
- **封面保存** — 预览面板一键将视频封面保存到本地图片目录

**🎨 使用体验**
- **现代化界面** — 垂直侧边栏（`Ctrl+\` 折叠）、深色模式、6 种主题色；封面大图预览
- **系统集成** — 系统托盘常驻，支持 Windows / macOS / Linux；版本更新提醒；收藏栏目有新内容时红点提示

## 🖼️ 界面一览

| 大图预览 | 下载管理 |
|:---:|:---:|
| <img src="docs/assets/lightbox.png" width="400" alt="大图预览"> | <img src="docs/assets/download.png" width="400" alt="下载管理"> |
| **任务排序** | **设置** |
| <img src="docs/assets/download-queue.png" width="400" alt="任务排序"> | <img src="docs/assets/settings.png" width="400" alt="设置"> |
| **深色模式** | **单视频直链下载** |
| <img src="docs/assets/home-dark.png" width="400" alt="深色模式"> | <img src="docs/assets/single-video.png" width="400" alt="单视频直链下载"> |

## 💻 系统要求

- **Windows** 10 及以上（64 位）
- **macOS** 11 Big Sur 及以上（Intel 与 Apple Silicon 均支持）
- **64 位主流 Linux 发行版**（通过 AppImage 运行）

## 📦 下载安装

前往 [Releases](../../releases) 页面，下载对应平台的安装包：

| 平台 | 安装包 |
|------|--------|
| Windows | `.exe` |
| macOS | `.dmg`（分别提供 Intel 与 Apple Silicon） |
| Linux | `.AppImage` |

> **开箱即用**：无需安装任何额外软件（ffmpeg 已内置），下载安装包即可使用。
>
> 安装包未做 Apple 开发者签名，首次打开时系统可能提示风险：macOS 在「系统设置 → 隐私与安全性」底部点「仍要打开」，Windows 在 SmartScreen 提示里点「更多信息 → 仍要运行」。详见 [常见问题](docs/FAQ.md)。

## 🚀 使用

1. 复制央视栏目页、节目页、新闻文章视频页、单视频链接或央视新闻移动端视频页链接，粘贴到首页导入栏（或拖放到窗口）。
2. 点击左侧内容加载视频列表；栏目可切月份，节目集直接显示选集，单视频进入「📌 单个视频」集合。
3. 点击「下载选中」，在下载页查看进度、取消或重试。

完整图文步骤、设置说明与快捷键见 [使用指南](docs/USAGE.md)。

## ❓ 常见问题

安装、导入、下载、合并、日志等问题排查见 [常见问题](docs/FAQ.md)。

## 🤝 贡献

欢迎提交 Issue 与 Pull Request。开发环境、项目结构、提交规范与打包流程见 [贡献指南](CONTRIBUTING.md)；报告问题可使用内置的 [Issue 模板](.github/ISSUE_TEMPLATE)。

## 🙏 致谢

- [CCTVVideoDownloader](https://github.com/letr007/CCTVVideoDownloader) — 界面参考、接口参考
- [videodl](https://github.com/CharlesPikachu/videodl) — 解密方案

## 📄 许可

源代码以 [MIT](LICENSE) 许可发布。安装包内含的第三方组件（如 ffmpeg）适用其各自许可。

## ⚠️ 免责声明

本项目为个人开源项目，与中央广播电视总台（CCTV）无任何隶属或授权关系。

本工具仅供技术研究与个人学习使用。所有节目内容版权归中央广播电视总台所有，请勿将下载内容用于商业目的或二次分发。使用本工具所产生的一切后果由使用者自行承担。
