import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Khi chạy `npm run dev`, /api và /socket.io được chuyển tới backend ở cổng 3001.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
      '/socket.io': { target: 'http://localhost:3001', ws: true },
    },
  },
});
