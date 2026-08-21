import { getFileContent, saveFile } from './github'

// Auto-allowlist MCP secret names into the workflow ALL_SECRETS blob.
//
// The run workflows (.github/workflows/aeon.yml + messages.yml) expose secrets to
// .mcp.json ${VAR} refs and per-skill `requires:` from a single explicit
// allowlist - a minified JSON blob under `ALL_SECRETS: >-`, one "NAME":${{
// toJSON(secrets.NAME) }} pair per secret. It is an allowlist rather than
// toJSON(secrets) on purpose: GitHub's public-repo malicious-workflow scanner
// HOLDS any run that serializes the whole secret store. The runtime loop resolves
// each ${VAR} from this blob, so a name that is NOT in it is silently not
// injected and the MCP server is skipped with a log-only warning.
//
// Connecting an MCP writes .mcp.json (which names the ${VAR}s) but did not touch
// the blob, so a freshly connected key-based MCP failed on the first headless run
// until the operator hand-edited the workflow. This module closes that gap: after
// .mcp.json is saved, splice any newly referenced secret name into the blob in
// both workflow files. Adding a single named toJSON(secrets.NAME) keeps the same
// safe shape the scanner already accepts.

const WORKFLOW_FILES = ['.github/workflows/aeon.yml', '.github/workflows/messages.yml']

// Secret names are `[A-Z_][A-Z0-9_]*` (matches the runtime loop's own extraction
// regex). Anything else is rejected so a malformed ref can't corrupt the blob.
const SECRET_NAME_RE = /^[A-Z_][A-Z0-9_]*$/
// The ${VAR} refs inside a .mcp.json (single-brace, same as the runtime grep).
const MCP_VAR_RE = /\$\{([A-Z_][A-Z0-9_]*)\}/g

export interface AllowlistResult {
  added: string[]           // secret names newly spliced into the blob (union across files)
  files: string[]           // workflow files actually changed
  synced: boolean           // false if a local-mode commit/push failed
  reason?: string           // why a file could not be patched (read/write/scope error)
}

// Pull the unique ${VAR} names a .mcp.json servers object references.
export function referencedSecrets(servers: unknown): string[] {
  const json = JSON.stringify(servers ?? {})
  const names = new Set<string>()
  for (const m of json.matchAll(MCP_VAR_RE)) names.add(m[1])
  return [...names]
}

// Locate the single physical line holding the ALL_SECRETS blob: the minified JSON
// object (starts with `{"`, references toJSON(secrets.…)). Returns -1 if absent
// (a custom fork may not carry it).
function findBlobLine(lines: string[]): number {
  return lines.findIndex(
    (l) => l.includes('toJSON(secrets.') && l.trimStart().startsWith('{"'),
  )
}

// Splice `"NAME":${{ toJSON(secrets.NAME) }}` for each not-yet-present name in,
// just before the blob's closing `}`. Preserves the line's indent and any
// trailing whitespace. Returns the new line and the names it added.
function spliceBlob(line: string, names: string[]): { line: string; added: string[] } {
  const trailing = line.match(/\s*$/)?.[0] ?? ''
  const core = line.slice(0, line.length - trailing.length) // ends with the JSON `}`
  if (!core.endsWith('}')) return { line, added: [] }
  const missing = names.filter((n) => !core.includes(`"${n}":`))
  if (missing.length === 0) return { line, added: [] }
  // Single-quoted concatenation so the literal `${{` is emitted verbatim (a
  // template literal would treat `${` as interpolation).
  const additions = missing
    .map((n) => ',"' + n + '":${{ toJSON(secrets.' + n + ') }}')
    .join('')
  const spliced = core.slice(0, -1) + additions + '}' + trailing
  return { line: spliced, added: missing }
}

// Pure transform of a whole workflow file: allowlist the (already validated)
// names in its ALL_SECRETS blob. Returns the new content and the names added
// (empty when the file has no blob or every name is already present, in which
// case `content` is returned unchanged). Exported for unit testing.
export function patchWorkflowContent(
  content: string,
  names: string[],
): { content: string; added: string[] } {
  const lines = content.split('\n')
  const idx = findBlobLine(lines)
  if (idx === -1) return { content, added: [] }
  const { line, added } = spliceBlob(lines[idx], names)
  if (added.length === 0) return { content, added: [] }
  lines[idx] = line
  return { content: lines.join('\n'), added }
}

// Ensure every given secret name is present in the ALL_SECRETS blob of both run
// workflows, committing any change. Best-effort per file: a read/write failure on
// one file (e.g. a token without `workflow` scope) is reported via `reason`, not
// thrown - the caller's primary write (.mcp.json) has already succeeded.
export async function ensureSecretsAllowlisted(names: string[]): Promise<AllowlistResult> {
  const wanted = [...new Set(names)].filter((n) => SECRET_NAME_RE.test(n))
  const result: AllowlistResult = { added: [], files: [], synced: true }
  if (wanted.length === 0) return result

  const added = new Set<string>()
  for (const file of WORKFLOW_FILES) {
    try {
      const { content } = await getFileContent(file)
      const { content: patched, added: fileAdded } = patchWorkflowContent(content, wanted)
      if (fileAdded.length === 0) continue // no blob, or all names already present
      const sync = await saveFile(file, patched, {
        updateMsg: `chore: allowlist MCP secret(s) ${fileAdded.join(', ')} in ${file.split('/').pop()}`,
        createMsg: `chore: allowlist MCP secret(s) in ${file.split('/').pop()}`,
      })
      result.files.push(file)
      fileAdded.forEach((n) => added.add(n))
      if (!sync.synced) {
        result.synced = false
        result.reason = sync.reason
      }
    } catch (e) {
      result.synced = false
      result.reason = e instanceof Error ? e.message : String(e)
    }
  }
  result.added = [...added]
  return result
}
