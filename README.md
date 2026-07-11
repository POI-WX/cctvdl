<h1 align="center">📺 cctvdl</h1>

<p align="center">跨平台央视视频下载器 · 开箱即用</p>

<p align="center">
  <a href="https://github.com/POI-WX/cctvdl/actions/workflows/ci.yml"><img src="https://github.com/POI-WX/cctvdl/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-green.svg" alt="Platform">
</p>

粘贴央视栏目、节目集或视频链接，选择想下载的内容和清晰度，即可开始下载。支持 Windows、macOS 和 Linux，无需额外安装工具。

<p align="center">
  <img src="docs/assets/home.png" width="820" alt="cctvdl 主界面">
</p>

## ✨ 功能特性

**📺 支持的链接**
- **栏目链接** — 按月份浏览和搜索节目；可一键下载本月，也可跨月份、跨栏目批量下载
- **节目集链接** — 电视剧、纪录片和 4K 节目可从节目首页或任意一集导入；直接查看全部选集，并按最早或最新排序
- **单视频链接** — 电影、新闻文章中的视频、导视片段和央视新闻视频可直接加入下载列表

**📥 导入与管理**
- **快速导入** — 所有已支持的链接都可粘贴或拖放到窗口；也可开启剪贴板提示
- **预览与整理** — 可查看标题、简介、封面和发布时间；标题、简介可一键复制，封面可保存到本地
- **收藏与备份** — 常用内容可收藏置顶；可导出备份文件，也可随时导入恢复

**⬇️ 下载与队列**
- **画质选择** — 常规央视节目可选流畅、标清、高清、超清和蓝光（最高 1080p）；没有对应档位时自动选择接近的可用画质
- **并行与续传** — 最多同时下载 3 个视频；失败、取消或意外退出后，未完成部分可继续下载
- **队列管理** — 批量下载前确认数量、清晰度和保存位置；支持跨月份、跨栏目勾选，实时查看、排序、取消或重试
- **下载历史** — 自动记录已下载的视频，避免重复下载；支持搜索、重新下载、定位文件和单条删除

**🎨 界面与提醒**
- **界面与操作** — 垂直侧边栏（`Ctrl+\` 折叠）、深色模式、6 种主题色和封面大图预览
- **状态提醒** — 下载时系统托盘显示进度；新版本和收藏内容更新时显示红点

## 🖼️ 界面一览

| 节目集浏览 | 单个视频下载 |
|:---:|:---:|
| <img src="docs/assets/album.png" width="400" alt="节目集浏览"> | <img src="docs/assets/single-video.png" width="400" alt="单个视频下载"> |
| **封面大图预览** | **已选内容** |
| <img src="docs/assets/lightbox.png" width="400" alt="封面大图预览"> | <img src="docs/assets/selected-videos.png" width="400" alt="已选内容"> |
| **下载管理** | **任务排序** |
| <img src="docs/assets/download.png" width="400" alt="下载管理"> | <img src="docs/assets/download-queue.png" width="400" alt="任务排序"> |
| **设置** | **深色模式** |
| <img src="docs/assets/settings.png" width="400" alt="设置"> | <img src="docs/assets/home-dark.png" width="400" alt="深色模式"> |

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

> 安装包已包含下载所需组件，无需额外安装软件，下载安装包即可使用。
>
> 安装包未做 Apple 开发者签名，首次打开时系统可能提示风险：macOS 在「系统设置 → 隐私与安全性」底部点「仍要打开」，Windows 在 SmartScreen 提示里点「更多信息 → 仍要运行」。详见 [常见问题](docs/FAQ.md)。

## 🚀 使用

1. 复制央视栏目页、节目概览页或任意一集、新闻文章视频页、单视频链接或央视新闻移动端视频页链接，粘贴到首页导入栏（或拖放到窗口）。
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
