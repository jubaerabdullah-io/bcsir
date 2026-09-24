import { defineConfig } from "vite";
import { bcsirPlugin } from "./scripts/vite-plugin-bcsir.mjs";

// Adapted from the reference indoor-mapping project's vite.config.js.
// - Data, GLB models and images are served from public/ (public/data,
//   public/models, public/image); bcsirPlugin() adds the original routing
//   bridge, the building-photo list and live data reload.
// - base is relative so the build works from any folder or sub-path.
export default defineConfig({
  base: "./",
  plugins: [bcsirPlugin()],

  // Same as the reference project: MapLibre ships its renderer as a separate
  // module worker. Vite's dependency optimizer can cache the main package
  // without copying that worker, which prevents map layers from drawing.
  optimizeDeps: {
    exclude: ["maplibre-gl"]
  },

  // The reference exposes the dev server on all interfaces; this project stays
  // on localhost by default. For phone or LAN testing run: npm run dev -- --host
  server: {
    watch: {
      ignored: ["**/dist/**", "**/*.qgz", "**/*.zip"]
    }
  },

  build: {
    // MapLibre (~1 MB) and Three.js (~0.7 MB) get their own long-lived chunks so
    // application updates do not invalidate the cached libraries.
    chunkSizeWarningLimit: 1100,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "maplibre", test: /node_modules[\/]maplibre-gl/ },
            { name: "three", test: /node_modules[\/]three/ }
          ]
        }
      }
    }
  }
});
