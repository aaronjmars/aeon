// Flat ESLint config for the dashboard (Next 16 + React 19).
// eslint-config-next 16 exports a native flat array - do NOT wrap it in
// FlatCompat (that throws "Converting circular structure to JSON" on the
// react plugin). `next lint` was removed in Next 16, so CI runs eslint directly.
import next from 'eslint-config-next/core-web-vitals'

export default [
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'public/**'] },
  ...next,
  {
    // New react-hooks v6 rules flag pre-existing, intentional patterns across
    // the app. Kept visible as warnings so they don't red-wall the gate on
    // arrival; tighten to error once the flagged effects are refactored.
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'import/no-anonymous-default-export': 'warn',
    },
  },
]
