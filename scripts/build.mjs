import { build } from 'esbuild'
import { cp, mkdir } from 'node:fs/promises'

await mkdir('lib', { recursive: true })
await cp('src/host/index.js', 'lib/index.js')

await build({
  entryPoints: ['src/client/index.jsx'],
  outfile: 'lib/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['es2022'],
  jsx: 'automatic',
  jsxImportSource: 'react',
  sourcemap: false,
  minify: true,
  external: ['react', 'react/jsx-runtime'],
  banner: {
    js: 'window.__ModuleLoader__.load({ id: "deepseek-pet", factory: (require) => { var module = { exports: {} }; var exports = module.exports;',
  },
  footer: { js: 'return module.exports; } });' },
})

console.log('built lib/index.js and lib/client.js')
