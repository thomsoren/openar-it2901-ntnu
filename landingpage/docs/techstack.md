Tech stack (adjusted)
	•	Next.js (App Router) + TypeScript
	•	Tailwind CSS
	•	shadcn/ui + Radix
	•	lucide-react
	•	pnpm
	•	Assets: Hetzner S3 bucket
	•	Deploy: Coolify

⸻

Minimal folder structure (clean, section-based)

openar-landing/
  README.md
  package.json
  pnpm-lock.yaml
  next.config.mjs
  postcss.config.mjs
  tailwind.config.ts
  tsconfig.json
  components.json              # shadcn config
  .env.example

  public/
    favicon.ico
    og.png

  src/
    app/
      layout.tsx
      page.tsx
      globals.css

    components/
      layout/
        navbar.tsx
        footer.tsx
        section.tsx

      sections/
        hero.tsx
        overview.tsx
        why-now.tsx
        how-it-works.tsx
        mvp.tsx
        demo.tsx
        roadmap.tsx
        team.tsx
        partners.tsx
        contact.tsx

      ui/
        button.tsx
        card.tsx
        badge.tsx
        separator.tsx

    data/
      links.ts
      team.ts
      partners.ts

    lib/
      cn.ts
      site.ts


⸻

Environment variables (Hetzner S3)

# .env
NEXT_PUBLIC_ASSETS_BASE_URL=https://hel1.your-objectstorage.com/bridgable/openar
NEXT_PUBLIC_DEMO_URL=https://<your-demo-url>
NEXT_PUBLIC_MEETING_URL=https://<your-meeting-url>
NEXT_PUBLIC_GITHUB_URL=https://github.com/<org>/<repo>
NEXT_PUBLIC_CONTACT_EMAIL=<email>


⸻

S3 layout (no subfolders under openar)

Store files directly at:
	•	https://hel1.your-objectstorage.com/bridgable/openar/<filename>

Example filenames:
	•	loop.mp4
	•	poster.jpg
	•	screenshot-1.png
	•	openbridge.svg
	•	partner-1.svg

Then reference assets like:
	•	${NEXT_PUBLIC_ASSETS_BASE_URL}/loop.mp4
	•	${NEXT_PUBLIC_ASSETS_BASE_URL}/poster.jpg

Keep a fallback: if the video fails to load, show the poster image.

⸻

pnpm setup (expected)
	•	package.json should include:
	•	"packageManager": "pnpm@<version>"
	•	scripts: dev, build, start, lint

shadcn/ui works with pnpm. components.json at repo root.

⸻

Coolify deployment notes (no CloudFront)
	•	Ensure the container serves Next.js output (next start) or use standalone output.
	•	If your bucket is public: direct asset URLs are fine.
	•	If not public: avoid client-side asset fetching unless you introduce signed URLs. For a landing page, public assets are simplest.
