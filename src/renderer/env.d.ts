/// <reference types="vite/client" />

declare const __APP_VERSION__: string

// Single-file components: let tsc resolve `*.vue` imports to a Vue component.
// (Full SFC template type-checking is done by the Vue tooling at build time.)
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

// Element Plus ships its locale bundles as untyped .mjs files.
declare module 'element-plus/dist/locale/*.mjs' {
  import type { Language } from 'element-plus/es/locale'
  const locale: Language
  export default locale
}
