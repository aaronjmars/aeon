import { SKILL_ICONS } from '../../lib/skill-icons.data'

// Per-skill glyph. Renders the skill's icon from the generated map (keyed by
// slug) as an inline SVG that inherits `currentColor`, so the caller controls
// the tint via text colour. Returns null for any slug without a glyph (e.g. a
// freshly installed community skill) — callers fall back to their initials/dot.
// Source of truth: catalog/skill-icons.json → bin/generate-skill-icons.
export function SkillGlyph({ slug, className }: { slug: string; className?: string }) {
  const inner = SKILL_ICONS[slug]
  if (!inner) return null
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: inner }}
    />
  )
}

// Whether a slug has a dedicated glyph — lets callers pick the icon over their
// existing initials/dot fallback without rendering an empty box.
export function hasSkillGlyph(slug: string): boolean {
  return !!SKILL_ICONS[slug]
}
