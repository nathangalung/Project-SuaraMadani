import { paraglideVitePlugin } from "@inlang/paraglide-js"
import { reactRouter } from "@react-router/dev/vite"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"

// Fewer first-load client chunks
const CLIENT_CHUNKS = [
  {
    name: "framework",
    test: /node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/,
    priority: 2,
  },
  // Root and its static imports
  { name: "shell", test: /app[\\/]root\.tsx$/, priority: 1 },
]

export default defineConfig({
  plugins: [
    paraglideVitePlugin({
      project: "./project.inlang",
      outdir: "./app/paraglide",
      strategy: ["baseLocale"],
      emitTsDeclarations: true,
    }),
    tailwindcss(),
    reactRouter(),
  ],
  resolve: {
    tsconfigPaths: true,
  },
  environments: {
    client: {
      build: {
        rolldownOptions: {
          output: { codeSplitting: { groups: CLIENT_CHUNKS } },
        },
      },
    },
  },
})
