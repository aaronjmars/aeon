// Server-only: open the operator's browser at `url`. The dashboard runs on the
// operator's own machine, so MCP OAuth can drive it directly - there the
// dashboard builds the authorize URL itself and no CLI is involved. The harness
// logins (grok/codex/kimi) deliberately do NOT call this: their CLIs open the
// browser themselves, and opening it again duplicates the tab.
import { execFile } from 'child_process'

// Fire-and-forget; a failure to auto-open isn't fatal - every caller also
// surfaces the URL to the operator.
export function openBrowser(url: string): void {
  if (process.platform === 'win32') {
    // NOT `cmd /c start "" <url>`: cmd.exe parses an unquoted `&` in the URL as
    // a command separator, so an OAuth authorize URL
    // (.../authorize?client_id=...&redirect_uri=...) is chopped at the first `&`
    // and the operator lands on a 400. PowerShell's Start-Process takes the URL
    // as a single argument; single-quoting it (with '' escaping) stops
    // PowerShell treating `&` as its call operator.
    const psUrl = url.replace(/'/g, "''")
    execFile('powershell', ['-NoProfile', '-Command', `Start-Process '${psUrl}'`], () => {})
    return
  }
  const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open'
  execFile(cmd, [url], () => {})
}
