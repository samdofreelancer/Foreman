import { defineConfig } from "vite"
import solid from "vite-plugin-solid"

export default defineConfig({
  plugins: [solid()],
  root: "src/ui",
  publicDir: "public",
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
  },
})
