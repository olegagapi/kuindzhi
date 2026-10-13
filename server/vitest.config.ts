import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Same single-zod setup as the wrangler bundle (see wrangler.jsonc).
    alias: { zod: fileURLToPath(new URL('./node_modules/zod', import.meta.url)) },
  },
  test: { include: ['test/**/*.test.ts'] },
});
