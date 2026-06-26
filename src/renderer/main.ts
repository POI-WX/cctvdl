import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/dist/locale/zh-cn.mjs'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import App from './App.vue'
import { applyAccentColor } from './utils/accent'

const app = createApp(App)
app.use(createPinia())
app.use(ElementPlus, { locale: zhCn })
app.mount('#app')

// Design token system — overrides Element Plus defaults for a unified visual language
const designTokens = document.createElement('style')
designTokens.textContent = `
  /* === 亮色模式设计令牌 === */
  :root {
    /* 主题色：现代深蓝，比默认蓝更有质感 */
    --el-color-primary: #2563EB;
    --el-color-primary-light-3: #3b82f6;
    --el-color-primary-light-5: #60a5fa;
    --el-color-primary-light-7: #93c5fd;
    --el-color-primary-light-8: #bfdbfe;
    --el-color-primary-light-9: #eff6ff;
    --el-color-primary-dark-2: #1d4ed8;

    /* 圆角系统：8px 基础，更现代 */
    --el-border-radius-base: 8px;
    --el-border-radius-small: 6px;
    --el-border-radius-large: 12px;
    --el-border-radius-round: 20px;

    /* 阴影系统：三级深度 */
    --app-shadow-sm: 0 1px 3px 0 rgba(0,0,0,.08), 0 1px 2px -1px rgba(0,0,0,.06);
    --app-shadow-md: 0 4px 6px -1px rgba(0,0,0,.08), 0 2px 4px -2px rgba(0,0,0,.06);
    --app-shadow-lg: 0 10px 15px -3px rgba(0,0,0,.08), 0 4px 6px -4px rgba(0,0,0,.06);

    /* 字体栈：优先系统字体，覆盖 Windows / macOS / Linux CJK */
    --el-font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
      'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei',
      'Noto Sans CJK SC', 'Source Han Sans SC', 'WenQuanYi Micro Hei',
      Arial, Helvetica, sans-serif;

    /* 字重系统 */
    --app-font-weight-normal: 400;
    --app-font-weight-medium: 500;
    --app-font-weight-semibold: 600;
    --app-font-weight-bold: 700;

    /* 间距基准（4px 网格） */
    --app-spacing-xs: 4px;
    --app-spacing-sm: 8px;
    --app-spacing-md: 12px;
    --app-spacing-lg: 16px;
    --app-spacing-xl: 24px;
    --app-spacing-2xl: 32px;

    /* 背景层次 */
    --app-bg-page: #f0f4f8;
    --app-bg-card: #ffffff;
    --app-bg-sidebar: #f8fafc;

    /* 边框 */
    --app-border-subtle: rgba(0,0,0,.06);
  }

  /* === 暗色模式设计令牌 === */
  html.dark {
    --el-color-primary: #3b82f6;
    --el-color-primary-light-3: #60a5fa;
    --el-color-primary-light-5: #93c5fd;
    --el-color-primary-light-7: #1e3a5f;
    --el-color-primary-light-8: #172554;
    --el-color-primary-light-9: #0f172a;
    --el-color-primary-dark-2: #2563eb;

    --app-shadow-sm: 0 1px 3px 0 rgba(0,0,0,.3), 0 1px 2px -1px rgba(0,0,0,.2);
    --app-shadow-md: 0 4px 6px -1px rgba(0,0,0,.3), 0 2px 4px -2px rgba(0,0,0,.2);
    --app-shadow-lg: 0 10px 15px -3px rgba(0,0,0,.3), 0 4px 6px -4px rgba(0,0,0,.2);

    --app-bg-page: #0f172a;
    --app-bg-card: #1e293b;
    --app-bg-sidebar: #1e293b;
    --app-border-subtle: rgba(255,255,255,.06);
  }

  /* === 全局基础样式 === */
  html, body, #app {
    height: 100%;
    margin: 0;
    font-family: var(--el-font-family);
  }

  body {
    background: var(--el-bg-color);
    color: var(--el-text-color-primary);
    transition: background-color .2s ease, color .2s ease;
  }

  /* 统一滚动条样式（Webkit） */
  ::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }
  ::-webkit-scrollbar-track {
    background: transparent;
  }
  ::-webkit-scrollbar-thumb {
    background: var(--el-border-color);
    border-radius: 3px;
  }
  ::-webkit-scrollbar-thumb:hover {
    background: var(--el-text-color-placeholder);
  }

  /* 统一按钮字重 */
  .el-button { font-weight: var(--app-font-weight-medium); }

  /* 统一表格行高 */
  .el-table .el-table__cell { padding: 8px 0; }

  /* 标签样式增强 */
  .el-tag { font-weight: var(--app-font-weight-medium); }

  /* 输入框聚焦环 */
  .el-input__wrapper.is-focus {
    box-shadow: 0 0 0 2px var(--el-color-primary-light-7) !important;
  }

  /* Page roots fill app-content (position:relative) absolutely
     so height:100% works for both v-show and v-if siblings */
  .app-content > *,
  .app-content > .v-enter-from,
  .app-content > .v-leave-to {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }
`
document.head.appendChild(designTokens)

// Apply dark mode class to document root
function applyDarkMode(isDark: boolean) {
  if (isDark) {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }
}

// Apply saved accent colour on startup (from localStorage)
applyAccentColor(localStorage.getItem('cctvdl-accent-color') || '#2563EB')

// Restore dark-mode preference from settings
window.cctvdlApi?.getSettings().then((settings: any) => {
  applyDarkMode(settings.darkMode || false)
})
