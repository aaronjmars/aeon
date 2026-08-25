// The CLI shares the dashboard's toolchain (see the tsc path in "typecheck").
// It borrows the dashboard's installed eslint + the TypeScript rule set from
// eslint-config-next, so lint stays in lockstep without a second copy. Only the
// TypeScript sub-config is used - the CLI is not a React/Next app.
import ts from '../dashboard/node_modules/eslint-config-next/dist/typescript.js'

export default [
  { ignores: ['node_modules/**'] },
  ...ts,
]
