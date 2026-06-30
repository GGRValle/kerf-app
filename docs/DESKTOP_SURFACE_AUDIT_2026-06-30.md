# Right Hand Desktop Surface Audit

Date: 2026-06-30

## Scope

Audited the deployable Astro app desktop shell and the live operator surfaces:
Home, Start, More, Camera, Design, Sales, Projects, Project detail, Money, Field, Schedule, Connections, Settings, and Right Hand.

## Findings

- The shared desktop frame is the correct base: main work surface on the left, Right Hand rail on the right.
- The old floating desktop mic conflicted with the intended rail. It made every page feel like it had a second microphone.
- More still had a desktop layout bug: it reserved an empty right column after the old shortcut panel was removed.
- Desktop top nav still exposed older review shelves as primary chrome: Transcripts, Drafts, Reports, Cost library.
- Home still showed a mic inside the route bar on desktop even though desktop conversation belongs in the right rail.
- Several pages already inherit the shared shell and only need the shell/nav/dock to be corrected before deeper per-page polish.

## Rebuild Rules Applied

- Desktop microphone lives in the Right Hand rail.
- Mobile microphone stays in the bottom Speak slot.
- Capture is separate from discussion: Capture opens Camera; Talk opens Right Hand conversation.
- Primary desktop nav follows the job spine: Home, Start, Design, Sales, Projects, Schedule, Money, Capture, Settings, More.
- Deeper review and learning shelves remain available through More, Settings, and direct links.
- More renders as a work-area grid on desktop, not a sidebar with blank space.
- Home desktop uses the full work area; the route-bar mic is mobile-only.

## Follow-Up Surfaces

- Client, portal, and sub-portal pages still need a later desktop polish pass because they are secondary/access-specific surfaces.
- Wireframes and role-routing remain internal/reference surfaces, not daily operator desktop screens.
