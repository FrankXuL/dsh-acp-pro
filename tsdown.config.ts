import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsdown'

const { name } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { name: string }

/** Modules the DSH web module table supplies to client bundles at runtime. */
const CLIENT_SEEDS = ['react', 'react/jsx-runtime', /^@deepseek-ai\//]

export default defineConfig([
  // Host half: an ES module loaded by the DSH host (Node).
  {
    entry: { index: 'src/index.ts' },
    format: 'esm',
    platform: 'node',
    target: 'node22',
    fixedExtension: false,
    dts: true,
    clean: true,
    deps: {
      neverBundle: [/^@deepseek-ai\//],
      onlyBundle: false,
    },
  },
  // Browser half: a classic script that only registers a factory with the DSH web
  // ModuleLoader; the loader runs it with its own `require` over the module table.
  {
    entry: { client: 'src/client/index.ts' },
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    outExtensions: () => ({ js: '.cjs' }),
    dts: false,
    clean: false,
    sourcemap: true,
    minify: true,
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    deps: {
      neverBundle: CLIENT_SEEDS,
      onlyBundle: false,
    },
    banner: { js: `window.__ModuleLoader__.load({id:${JSON.stringify(name)},factory:(require)=>{var module={exports:{}};var exports=module.exports;` },
    footer: { js: 'return module.exports;}});' },
  },
])
