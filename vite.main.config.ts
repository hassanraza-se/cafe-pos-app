import { defineConfig } from 'vite';
import { resolve } from 'path';

// https://vitejs.dev/config
export default defineConfig({
    build: {
        rollupOptions: {
            external: [
                // External modules that shouldn't be bundled
                'electron',
                'better-sqlite3',
                'mysql2',
            ],
        },
    },
    resolve: {
        alias: {
            '@': resolve(__dirname, './src/main'),
        },
    },
});