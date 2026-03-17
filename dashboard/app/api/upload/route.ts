import { NextResponse } from 'next/server'
import { createFile, getFileContent, updateFile } from '@/lib/github'

export async function POST(request: Request) {
  try {
    const { files } = await request.json() as {
      files: Array<{ path: string; content: string }>
    }

    if (!files || files.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 })
    }

    // Find the SKILL.md to extract the skill name
    const skillFile = files.find(f => f.path.endsWith('SKILL.md'))
    if (!skillFile) {
      return NextResponse.json({ error: 'No SKILL.md found in uploaded files' }, { status: 400 })
    }

    // Derive skill name from directory structure or filename
    const parts = skillFile.path.split('/')
    // If path is "my-skill/SKILL.md" use "my-skill", otherwise use first directory
    const skillName = parts.length > 1 ? parts[parts.length - 2] : skillFile.path.replace('/SKILL.md', '')

    if (!skillName || skillName === 'SKILL.md') {
      return NextResponse.json({ error: 'Could not determine skill name from file structure' }, { status: 400 })
    }

    // Write all files under skills/<name>/
    for (const file of files) {
      // Normalize: strip leading skill name dir if present, then prepend skills/<name>/
      let relativePath = file.path
      if (relativePath.startsWith(skillName + '/')) {
        relativePath = relativePath.slice(skillName.length + 1)
      }
      await createFile(
        `skills/${skillName}/${relativePath}`,
        file.content,
        `feat: upload ${skillName} skill`,
      )
    }

    // Add to aeon.yml
    try {
      const config = await getFileContent('aeon.yml')
      if (!config.content.includes(`  ${skillName}:`)) {
        const updated = config.content.replace(
          '  # --- Fallback',
          `  ${skillName}:\n    enabled: false\n    schedule: "0 12 * * *"\n\n  # --- Fallback`,
        )
        await updateFile('aeon.yml', updated, config.sha, `chore: add ${skillName} to config`)
      }
    } catch {
      // Config update failed — skill files were still created
    }

    return NextResponse.json({ name: skillName, filesWritten: files.length })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
