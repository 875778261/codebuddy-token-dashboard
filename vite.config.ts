/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// 纯前端：构建产物是单个 index.html，可直接双击打开或任意静态托管。
const BRIDGE = 'cb-bridge/**'

export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile()],
  build: {
    target: 'es2022',
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 8000,
  },
  // cb-bridge 是 npm run bridge 生成的目录联接，指向 AppData；
  // 必须排除，否则 dev 服务器会把 CodeBuddy 的几万个数据文件纳入监听。
  server: {
    watch: { ignored: [BRIDGE] },
    fs: { strict: true, allow: ['.'] },
  },
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'dist/**', BRIDGE],
  },
})
