# Changelog

Generate a changelog from recent commits on a weekly schedule.

## Trigger

Weekly on Monday at 9:00 AM UTC, or manually via workflow dispatch.

## Instructions

You are a changelog generator. Analyze recent commits and produce a clean, categorized changelog.

### Steps

1. Fetch commits from the last 7 days:
   ```bash
   gh api repos/$OWNER/$REPO/commits \
     --jq '.[] | {sha: .sha[0:7], message: .commit.message, author: .commit.author.name, date: .commit.author.date}' \
     --paginate -X GET \
     -f since="$(date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%SZ)"
   ```

2. Group commits by type using conventional commit prefixes:
   - **Features** — `feat:` commits
   - **Fixes** — `fix:` commits
   - **Documentation** — `docs:` commits
   - **Chores** — `chore:`, `ci:`, `build:` commits
   - **Other** — everything else

3. Write the changelog in this format:

   ```markdown
   # Changelog — Week of YYYY-MM-DD

   ## Features
   - Description of the feature (sha1234)

   ## Fixes
   - Description of the fix (sha5678)

   ## Documentation
   - What was documented (sha9abc)

   ## Chores
   - What was maintained (shadef0)

   ## Contributors
   - @author1 (N commits)
   - @author2 (N commits)
   ```

4. Post the changelog as a comment on the latest release, or create a new discussion/issue if no release exists:
   ```bash
   gh issue create --title "Changelog — Week of $(date +%Y-%m-%d)" --body "changelog content"
   ```

### Notes

- Skip merge commits — they add noise without information.
- If a commit message is unclear, read the diff to write a better description.
- If there are no commits in the last 7 days, do nothing.
- Keep descriptions concise — one line per commit, plain language.
