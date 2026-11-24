import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

const proxy = {
  '/api/auth/': process.env['SENTINEL_AUTH_ORIGIN'] ?? 'http://127.0.0.1:3001',
  '/api/live/radar-settings': process.env['SENTINEL_LIVE_ORIGIN'] ?? 'http://127.0.0.1:3001',
  '/api/replays': process.env['SENTINEL_LIVE_ORIGIN'] ?? 'http://127.0.0.1:3001',
  '/api/live/calibration': process.env['SENTINEL_LIVE_ORIGIN'] ?? 'http://127.0.0.1:3001',
};

export default defineConfig({
  plugins: [vue()],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        showcase: fileURLToPath(new URL('./showcase/index.html', import.meta.url)),
      },
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/echarts/')) return 'echarts';
          if (id.includes('node_modules/zrender/')) return 'zrender';
          if (
            id.includes('node_modules/@vue/') ||
            id.includes('node_modules/vue/') ||
            id.includes('node_modules/pinia/')
          )
            return 'vue-vendor';
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    open: false,
    proxy,
  },
  preview: { proxy },
});
