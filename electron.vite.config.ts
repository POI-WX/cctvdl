import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'))

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({
      exclude: ['p-queue', 'electron-store']
    })],
    build: {
      rollupOptions: {
        output: { format: 'cjs' }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: { format: 'cjs' }
      }
    }
  },
  renderer: {
    root: resolve('src/renderer'),
    build: {
      rollupOptions: {
        input: resolve('src/renderer/index.html')
      }
    },
    plugins: [vue()],
    define: {
      // Read version directly from package.json — reliable on all platforms
      __APP_VERSION__: JSON.stringify(pkg.version)
    }
  }
})
