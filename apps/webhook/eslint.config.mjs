// Cloudflare Worker (plain JS). Lints for correctness with the core recommended
// set; Worker/service-worker runtime globals are declared so no-undef stays quiet.
import js from '@eslint/js'
import globals from 'globals'

export default [
  { ignores: ['node_modules/**', '.wrangler/**'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.serviceworker, ...globals.worker, ...globals.node },
    },
  },
]
