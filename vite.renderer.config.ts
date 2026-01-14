import { defineConfig } from 'vite';
import { resolve } from 'path';
import { createRequire } from 'module';

// https://vitejs.dev/config
export default defineConfig(async () => {
    // Dynamically import React plugin (ESM only)
    const react = await import('@vitejs/plugin-react-swc').then(m => m.default);

    const frontendRoot = resolve(__dirname, 'src/frontend');

    // Create require function that resolves from frontend directory
    const frontendRequire = createRequire(resolve(frontendRoot, 'package.json'));

    return {
        // Set root to frontend directory - this makes Vite resolve node_modules from there
        root: frontendRoot,
        base: './',

        plugins: [react()],

        // This ensures module resolution happens from frontend directory
        resolve: {
            alias: {
                '@': resolve(frontendRoot, 'src'),
            },
        },

        // Load PostCSS plugins from frontend's node_modules
        css: {
            postcss: {
                plugins: [
                    frontendRequire('tailwindcss')({
                        config: resolve(frontendRoot, 'tailwind.config.ts'),
                    }),
                    frontendRequire('autoprefixer'),
                ],
            },
        },

        build: {
            outDir: resolve(__dirname, '.vite/renderer/main_window'),
            emptyOutDir: true,
        },

        server: {
            port: 5173,
            strictPort: true,
        },
    };
});