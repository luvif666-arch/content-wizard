import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 纯前端应用：不配置任何代理，也不依赖后端服务。
// 模型调用由 src/lib/model.ts 在浏览器里直接发起，失败即回退到预设库。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5233,
    strictPort: true,
  },
  preview: {
    port: 5234,
    strictPort: true,
  },
});
