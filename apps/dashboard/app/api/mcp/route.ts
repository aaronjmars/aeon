import { NextResponse } from 'next/server'
import { getFileContent, saveFile } from '@/lib/github'
import { errorResponse, syncResult } from '@/lib/http'
import { ensureSecretsAllowlisted, referencedSecrets } from '@/lib/workflow-secrets'
import type { McpServers } from '@/lib/types'

const FILE = '.mcp.json'

export async function GET() {
  try {
    const { content, sha } = await getFileContent(FILE)
    let servers: McpServers = {}
    try {
      const parsed = JSON.parse(content) as { mcpServers?: McpServers }
      servers = parsed.mcpServers ?? {}
    } catch (e) {
      // Malformed JSON - return raw so the operator can see/fix it, and log so
      // the broken file isn't indistinguishable from an empty server list.
      console.warn(`[mcp] .mcp.json is not valid JSON; returning raw for repair: ${e instanceof Error ? e.message : e}`)
    }
    return NextResponse.json({ exists: true, servers, sha, raw: content })
  } catch {
    return NextResponse.json({ exists: false, servers: {}, sha: '', raw: '' })
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as { servers?: McpServers }
    if (!body.servers || typeof body.servers !== 'object' || Array.isArray(body.servers)) {
      return NextResponse.json({ error: 'servers (object) required' }, { status: 400 })
    }
    const content = JSON.stringify({ mcpServers: body.servers }, null, 2) + '\n'
    const sync = await saveFile(FILE, content, {
      updateMsg: 'chore: update .mcp.json from dashboard',
      createMsg: 'chore: add .mcp.json from dashboard',
    })
    // Auto-allowlist any secret the servers reference into the workflow
    // ALL_SECRETS blob, so a headless run can actually inject it. Without this a
    // key-based MCP connects fine but the first scheduled run reports the secret
    // "not set" and skips the server. Best-effort: never fails the .mcp.json save.
    const allowlist = await ensureSecretsAllowlisted(referencedSecrets(body.servers))
    return NextResponse.json({ ...syncResult(sync), allowlist })
  } catch (error: unknown) {
    return errorResponse(error, 'Unknown error')
  }
}
