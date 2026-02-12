import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import vuetify, { transformAssetUrls } from 'vite-plugin-vuetify'
import fonts from 'unplugin-fonts/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue({
      template: { transformAssetUrls },

    }),
    //vueDevTools(),
    vuetify({
      autoImport: true,
      styles: {
        configFile: "src/styles/settings.scss",
      },
    }),
    fonts({
      fontsource: {
        families: [
          {
            name: 'Roboto',
            weights: [100, 300, 400, 500, 700, 900],
            styles: ['normal', 'italic'],
          },
        ],
      },
    }),

    VitePWA({
      registerType: 'autoUpdate',
      devOptions: {
        enabled: true,
      },
      manifest: {
        name: "VatEFS",
        short_name: "VatEFS",
        description: "VATSIM Electronic Flight Strip application",
        theme_color: "#1e2022",
        icons: [
            {
                src: "/android-icon-192x192.png",
                sizes: "192x192",
                type: "image/png",
            }
        ],
        screenshots: [
            {
                src: "/screenshots/1024.png",
                sizes: "1024x768",
                type: "image/png",
                form_factor: "wide",
                label: "VatEFS",
            }
        ],
      },
    }),

  ],
  optimizeDeps: {
    exclude: [
      'vuetify',
      'vue-router',
    ],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
  build: {
    chunkSizeWarningLimit: 2000,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:17770',
    },
  }
})
