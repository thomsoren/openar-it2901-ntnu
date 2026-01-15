# One-page website plan (no docs/spec)

## Primary goals
- Explain OpenAR in 15 seconds: web based video overlay + AIS + OpenBridge.
- Convert visitors to: try demo, schedule a meeting, contact, and optionally contribute (GitHub).
- Establish credibility: bachelor project, team of 7, OpenBridge collaboration, open source.

## Primary actions
1. View live demo
2. Schedule a meeting

Secondary: GitHub repo, contact email

---

## Site structure (single page)

### Navigation (sticky, minimal)
Left: OpenAR logo + name

Center links (max 3):
- Demo
- Team
- Contact

Right:
- Button: View live demo
- Optional: “Schedule a meeting” as a simple text link (not a second button)

Navbar styling (contrast + minimal)
- Use a dark translucent navbar surface for readability (not dark page edges):
  - bg: #060A12 at ~50–60% opacity
  - backdrop blur
  - 1px bottom border: white at ~10% opacity
- Nav link text: white at ~80% opacity, hover to full white

---

## Sections (in order)

### 1) Hero (Option C, centered, minimal, glass visual)
Eyebrow:
Open source · Built with OpenBridge · Team of 7 · Maritime industry

H1:
A standard for web based maritime AR overlays

Sub:
OpenAR unifies data vision detections and AIS into a simple contract, and renders a clean video overlay with OpenBridge components in the browser.

Hero text styling
- H1 and key hero text must be white for contrast on the light-blue background.
- Secondary hero text can be white at 70–85% opacity.

CTAs (hero)
- Primary: View live demo
- Secondary: Schedule a meeting (outline or text-link style)

CTA styling (no teal)
- Keep text pure white.
- Primary button should not be teal. Use a deep navy/ink button that fits the light-blue background.
  - Primary bg: #0B1224
  - Primary hover: #111C36
  - Border: white at ~10%
  - Shadow: minimal or none
- Secondary outline:
  - Transparent bg
  - Border: white at ~18–22%
  - Hover: white at ~5% background fill

Hero visual
A glass “video player” frame with a screenshot or short loop showing overlay + AIS selection.

Micro trust line:
Bachelor project in Informatics in collaboration with OpenBridge.

Design notes
- No dark vignette edges anywhere on the page.
- Glass used only for the video frame (and maybe one highlight card).
- Keep the hero background as a smooth light-blue gradient.

---

### 2) Overview (what it is, who it is for)
Two-column:
- Left: short definition + who benefits
- Right: 3 minimal cards

Cards (examples):
- Standardized inputs: video, detections, AIS
- Web based video overlay in the browser
- Reference implementation built with OpenBridge components

Keep it non-technical, 2 to 3 sentences per block.

---

### 3) Why now (problem and motivation)
3 problem cards:
- Proprietary overlay stacks and custom integrations
- Hard to synchronize video, detections, and AIS reliably
- Reusable UI components exist, but no shared overlay contract

3 outcome cards:
- Faster prototyping and integration
- Shared contract reduces rework
- Consistent UI via OpenBridge components

---

### 4) How it works (simple pipeline)
A 3-step diagram (horizontal, stacked on mobile):
1) Inputs: video + detections + AIS
2) Timeline: sync + replay (testing)
3) Output: web based video overlay + interactive AIS UI

Note:
Build end-to-end offline first (recorded video + mock data), then swap in real AIS and more realistic detections.

---

### 5) MVP deliverables (what we are building)
Use a clean checklist layout.

OpenAR SDK (npm)
- Video input: file or stream
- Detection events: bbox, label, confidence, timestamp
- AIS: position, course, speed, identity, timestamp
- Stable API surface (schemas later)

Demo web app
- Video playback in browser
- OpenBridge overlay components rendered over video
- AIS panel with targets + selection
- Baseline link between selected vessel and AIS target

Developer experience
- Simple install and run
- Example data for replay
- Clear API surface

---

### 6) Demo section (high emphasis)
- Large image/GIF or short embedded clip
- Buttons:
  - View live demo
  - View GitHub
- “What to try” (max 3 bullets):
  - Play video and toggle overlay
  - Select an AIS target
  - See matched overlay state

Optional disclaimer:
Prototype. Limitations documented as the project evolves.

---

### 7) Roadmap (simple)
Minimal timeline with 4 phases:
- Scope and MVP lock
- End-to-end demo with replay
- Matching and robustness
- Polish and delivery

Keep it short.

---

### 8) Team (7 people)
Grid with:
- Name
- Focus area (SDK, pipeline, overlay, AIS, matching, demo, report)
- Optional one-liner

One sentence:
We are a group of 7 Informatics bachelor students building an open source reference implementation.

---

### 9) Partners / collaborators
Logo row:
- OpenBridge
- Any lab or partner you have permission to show

One-liner per collaborator (very short).

---

### 10) Contact
Two-column:
- Left: contact info
  - Email
  - GitHub link
  - Short “What we want to talk about” bullets (integrations, data access, feedback)
- Right: scheduling block
  - Schedule a meeting button
  - Embedded calendar optional

---

### 11) Footer
Links:
- Live demo
- GitHub
- Contact
- Meeting link
- License (once decided)

---

## Visual design system (modern minimal + glass)
- Background: smooth light-blue gradient, no dark edge vignette.
- Text: white for hero headings and primary copy on the light-blue background.
- Accent: keep accents subtle; avoid teal for primary CTAs.
- Glass: used sparingly (hero video frame, possibly one highlight card).
- Typography: Fraunces for H1/H2 only, Inter for body/UI.
- Minimal shadows, soft borders, strong spacing.

---

## Technical implementation
- Framework: Next.js (App Router) + TypeScript
- UI: shadcn/ui + Tailwind
- Package manager: pnpm
- Assets: Hetzner S3 bucket at https://hel1.your-objectstorage.com/bridgable/openar (no subfolders under openar)
- Deployment: Coolify

Recommended repo layout:
- /landing (site)
- /sdk (npm package)
- /demo (demo app)

---

## Content checklist to fill in
- Live demo URL
- Meeting scheduling URL
- GitHub repo URL
- Team list + roles
- Approved logos
- One good screenshot or short loop of the overlay demo
