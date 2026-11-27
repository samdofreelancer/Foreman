import { defineConfig } from "vite"
import solid from "vite-plugin-solid"
import { gui } from "@opencode/plugin/gui/vite"

export default defineConfig({
  plugins: [solid(), gui()],
  build: {
    outDir: "dist",
    lib: {
      entry: "src/gui.tsx",
      formats: ["cjs"],
      fileName: "gui-experimental",
    },
    rollupOptions: {
      external: ["effect", "solid-js", "solid-js/web", "@opencode/plugin", "@opencode/plugin/gui"],
    },
  },
})
