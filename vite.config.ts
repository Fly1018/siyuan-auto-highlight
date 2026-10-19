import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { viteStaticCopy } from "vite-plugin-static-copy";

const root = import.meta.dirname;
const manifest = JSON.parse(readFileSync(resolve(root, "plugin.json"), "utf8"));
const images = ["icon", "preview"]
    .map((field) => manifest[field])
    .filter((fileName) => typeof fileName === "string" && fileName.length > 0)
    .filter((fileName) => existsSync(resolve(root, fileName)))
    .map((fileName) => ({ src: `./${fileName}`, dest: "./" }));

export default defineConfig({
    resolve: { alias: { "@": resolve(root, "src") } },
    plugins: [
        svelte(),
        viteStaticCopy({
            targets: [
                ...images,
                { src: "./plugin.json", dest: "./" },
                { src: "./README*.md", dest: "./" },
                { src: "./LICENSE", dest: "./" },
            ],
        }),
    ],
    build: {
        outDir: "dist",
        emptyOutDir: true,
        minify: true,
        sourcemap: false,
        lib: {
            entry: resolve(root, "src/index.ts"),
            fileName: () => "index.js",
            cssFileName: "index",
            formats: ["cjs"],
        },
        rollupOptions: {
            external: ["siyuan", "process"],
            output: {
                entryFileNames: "[name].js",
                assetFileNames: "[name][extname]",
            },
        },
    },
});
