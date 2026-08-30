import { describe, it } from 'node:test'
import { strict as assert } from 'node:assert'

import { parseGhAuthToken } from './github-auth'

describe('parseGhAuthToken', () => {
  it('accepts GitHub CLI OAuth tokens', () => {
    assert.equal(parseGhAuthToken('gho_abcdefghijklmnopqrstuvwx\n'), 'gho_abcdefghijklmnopqrstuvwx')
  })

  it('accepts classic and fine-grained PATs', () => {
    assert.equal(parseGhAuthToken('ghp_abcdefghijklmnopqrstuvwx'), 'ghp_abcdefghijklmnopqrstuvwx')
    assert.equal(parseGhAuthToken('github_pat_11AAAA_abcdefghijklmnopqrstuvwx'), 'github_pat_11AAAA_abcdefghijklmnopqrstuvwx')
  })

  it('rejects Actions installation tokens and junk', () => {
    assert.throws(() => parseGhAuthToken('ghs_abcdefghijklmnopqrstuvwx'), /Could not read a GitHub token/)
    assert.throws(() => parseGhAuthToken(''), /Could not read a GitHub token/)
    assert.throws(() => parseGhAuthToken('not-a-token'), /Could not read a GitHub token/)
  })
})
