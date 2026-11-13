import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server:{proxy:{'/api/analysis':'http://127.0.0.1:5174'}},
  preview:{proxy:{'/api/analysis':'http://127.0.0.1:5174'}},
  build: { rolldownOptions: { output: { codeSplitting: { groups: [{name:'vendor',test:/node_modules/}] } } } },
  test: { include: ['tests/state/**/*.test.ts','tests/runtime/**/*.test.ts'], environment: 'node' },
});
