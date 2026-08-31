import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const pages = process.env.GITHUB_PAGES === "1";

export default defineConfig({
  base: pages ? "/colorado-trip-app/" : "/",
  publicDir: "public",
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-180.png", "trip-bundle.json", "extras-moose.json"],
      manifest: false,
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest,json,woff2}"],
        navigateFallback: pages ? "/colorado-trip-app/index.html" : "/index.html",
        runtimeCaching: [
          {
            urlPattern: /trip-bundle\.json$/,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "trip-bundle",
              expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            urlPattern: /^https:\/\/.*\.tile\.openstreetmap\.org\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "osm-tiles",
              expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
