# Products

Config for the product-aware skills: `bd-radar` and `product-pulse`.
One `##` block per product. While this file holds only the unconfigured template below,
those skills log `<SKILL>_NO_PRODUCTS_CONFIG` and degrade (falling back to
`memory/watched-repos.md` for repos where possible) — fill it in to activate them.

> **Status:** unconfigured template. Replace the example block with your own products
> and delete this line once it's yours.

## Example Product
- **repos:** `owner/repo` (public), `owner/repo-private` (private), `owner/repo-agent` (automation)
- **handles:** `@product_handle`, `@founder_handle`   <!-- X accounts to track follower/engagement deltas -->
- **terms:** `Product Name`, `product tagline`, `unique-search-string`   <!-- bd-radar + mention search -->
- **surface:** one line — what it is and the primitives it exposes   <!-- capability surface -->

<!--
Fields:
  repos    — owner/repo entries; tag each public / private / automation(agent) so
             product-pulse can bucket repo health and flag automation repos.
  handles  — product + founder X handles for follower/engagement tracking.
  terms    — product-name / tagline / distinctive search strings (used by bd-radar to
             find who's building/forking/mentioning, and by mention search).
  surface  — short capability description of what the product exposes.
Add one ## block per product. Repos may be public or private (gh access permitting).
-->
