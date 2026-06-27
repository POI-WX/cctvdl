# 封面下载功能 — 实现计划

> 版本定位：下一个功能 commit，随后视情况合入 0.4.x release。

---

## 一、需求总结

1. 预览面板操作栏（复制标题 / 复制简介右侧）新增「🖼 保存封面」按钮
2. 设置页「下载」卡片新增「图片保存目录」，与「视频保存目录」并列、样式统一
3. 两者默认路径逻辑对称：视频 → 系统视频文件夹，封面 → 系统图片文件夹
4. 原「文件保存位置」改名为「视频保存目录」，与新增项在命名上统一

---

## 二、UI 变化

### 2.1 预览面板操作栏

当前：
```
[ 📋 复制标题 ]  [ 📄 复制简介 ]
```

修改后：
```
[ 📋 复制标题 ]  [ 📄 复制简介 ]  [ 🖼 保存封面 ]
```

规则：
- 仅当 selectedVideo.coverUrl 存在且 coverError === false 时显示
- 点击时若 coverSavePath 未配置，提示「请先在设置中配置图片保存目录」
- 下载中：文字变为「…」，按钮 disabled
- 完成：ElMessage.success「封面已保存：xxx.jpg」
- 样式：与 preview-action-btn 完全一致

### 2.2 设置页「下载」卡片

修改前：
```
文件保存位置    [路径]  [浏览…]
并发下载数      ...
```

修改后：
```
视频保存目录    [路径]  [浏览…]    下载的视频文件将保存到此目录
图片保存目录    [路径]  [浏览…]    下载的封面图片将保存到此目录
并发下载数      ...
```

---

## 三、文件类型推断

从 HTTP 响应头 Content-Type 推断扩展名：
- image/png → .png
- image/webp → .webp
- 其他 → .jpg（兜底）

同名文件已存在时追加 _2、_3 序号，不覆盖。

---

## 四、默认路径对称设计

| 设置项名     | 字段名         | 默认值       | Electron API            |
|------------|--------------|------------|-------------------------|
| 视频保存目录 | savePath      | 系统视频文件夹 | app.getPath('videos')   |
| 图片保存目录 | coverSavePath | 系统图片文件夹 | app.getPath('pictures') |

---

## 五、需要改动的文件

### 5.1 src/shared/types.ts
- Settings 新增 coverSavePath?: string
- CctvdlApi 新增 downloadCover(url, saveDir, baseName): Promise<{ savedPath: string }>

### 5.2 src/shared/settings.ts
- normalizeSettings 新增 coverSavePath 字段处理

### 5.3 src/main/config.ts
- defaults.settings 新增 coverSavePath: app?.getPath?.('pictures') || ''

### 5.4 src/main/ipc.ts
- reveal-file 之后新增 download-cover handler
- fetch 图片 + Content-Type 推断扩展名 + 序号去重 + fs.writeFileSync

### 5.5 src/preload/index.ts
- revealFile 之后新增 downloadCover 映射

### 5.6 src/renderer/pages/SettingsPage.vue
- form 初始值加 coverSavePath: ''
- 「文件保存位置」改名「视频保存目录」
- 其下方新增「图片保存目录」设置项（复用 path-control 布局）
- 新增 selectCoverDir() 函数

### 5.7 src/renderer/pages/HomePage.vue
- preview-action-bar 内复制简介按钮之后新增「🖼 保存封面」按钮
- 新增 coverDownloading ref 和 downloadCoverImage 函数

### 5.8 docs/USAGE.md
- 设置表「文件保存位置」改为「视频保存目录」
- 新增「图片保存目录」行

---

## 六、测试

| 类型 | 内容 |
|------|------|
| 单元 | settings.test.ts 补 coverSavePath fallback 用例 |
| 单元 | ipc.test.ts mock 补 download-cover |
| GUI  | 设置页「图片保存目录」可见 |
| GUI  | 预览面板有封面时按钮出现，无封面时不出现 |
| GUI  | mock downloadCover 成功 → toast 出现 |

---

## 七、不做

- 不在 lightbox 中额外提供封面下载
- 不支持批量下载多张封面
- coverSavePath 为空时不自动 fallback 到 savePath（两目录完全独立）
