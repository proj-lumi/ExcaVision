---
name: excavision-admin-landing-system
version: compact-operations-dashboard
scope: staff-ops admin dashboard + public landing
last-lock: 2026-09-13
---

# Design System - Working Direction

Purpose: keep ExcaVision coherent while UI changes are made in small, reversible commits.

## Product identity
- ExcaVision is a physical sensing system with a monitoring app.
- Sensor nodes, gateway, readings, history, alerts, and field workflows are the product.
- Customer sites are context for the product, not the visual identity.

## Typography
- Shared brand face: Inter across landing and admin, self-hosted through `@fontsource/inter`.
- Headings use the same Inter family at a stronger weight, not a separate display face.
- Technical metadata only: IBM Plex Mono for MAC addresses, node identifiers, readings, timestamps, and other machine-shaped values.
- No uppercase for hierarchy; size, weight, and color carry label distinction.

## Spacing scale
- Base: 4px (`--space-unit`)
- Buttons/min-controls: 34–36px min-height; use larger touch targets only where mobile interaction requires them
- Dashboard shell: 216px sidebar, 72px desktop header, 24px workspace inset
- Cards/sections: 7px controls, 9px surfaces, 11px overlays, and 1px `--line` borders

## Color tokens (only these — no literal hex outside root definitions)
- Light: neutral gray `--paper` canvas, white `--panel` surfaces, marine brand text, and orange reserved for active navigation and primary workflow actions
- Tokens: `--ink`, `--ink-soft`, `--muted`, `--line`, `--paper`, `--panel`, `--marine`, `--orange`, `--orange-deep`, `--orange-soft`, `--action`, `--on-action`, `--green`, `--green-soft`, `--error`, `--danger`, `--shadow`, `--backdrop`
- Dark override: charcoal canvas and panels with the same hierarchy and accent roles; dark renders via `prefers-color-scheme: dark`

## Component primitives (locked)
- `.sidebar` — 216px neutral panel; 38px navigation rows; soft orange active state; 17px inline outline icons
- `.page-header` — 72px desktop bar with a small page title and bordered Refresh control
- `.request-queue-tabs` — two integrated workflow tabs above the Requests toolbar; 40px rows; quiet inactive text; orange active underline; never a detached queue dropdown
- `.card-footer-action` — full-width bottom card action; `--action` text; `--paper` background; hover `--orange-soft`; text only
- `.move-button` — 24px icon-only reorder control; transparent rest; `--orange-soft` hover / `--ink-soft` disabled; no border at rest
- `.manifest-table-header` — sticky 40px; `--muted` uppercase removed; lowercase `Move` / `Node` / `Action`
- `.hardware-plan-summary` — flex single-row context; `--paper`; compact `min-height: 52px`

## Visual direction (locked)
- Reference family: Tabler, dark analytics dashboards, and Berry-style admin composition
- Shared traits to preserve: neutral canvas, quiet panels, compact controls, clear side navigation, practical data rows, restrained accent use, and both coherent light and dark modes
- ExcaVision signature: marine wordmark, orange workflow emphasis, serial-first hardware rows, chain ordering, and gateway state
- Do not copy reference palettes, metric-card grids, decorative charts, or generic welcome banners

## Interaction patterns (locked)
- Search fields use a small CSS-drawn magnifying glass; search-only pickers have no caret and no drag/drop
- Collection search is one live server-side free-text field with a 280ms debounce; each surface searches every promised key, while compact selects handle only structured filters such as stage, type, state, or assignment. Do not add a Search button or “Search in” selector
- Modal pickers use the same one-key rule and state accepted keys directly: unit or site, site name, or serial or MAC
- Installation planning uses repeatable named-unit rows. Saving creates all named draft units; never ask for only a quantity and never repeat unit naming in a later create step. Unfinished units appear as equal outlined setup actions because they have no inherent priority
- Database-backed regions show structure-matched skeleton placeholders for at least 180ms, then swap loaded rows into the same footprint without content transitions; never flash stale content or an empty state during a request
- Empty results keep the same outer region and structural footprint as their loading skeleton; the empty message sits inside that reserved region instead of collapsing the view
- Select controls use the accessible `app-select` primitive with immediate open and close behavior; no dropdown or caret transitions
- Collection filter selects stay compact on desktop and expand to full width only in the narrow mobile layout; toolbar inputs, selects, segmented controls, and buttons share a 36px control height
- Drag/drop ordering removed; replaced by one-slot `.move-button` with keyboard fallback (`ArrowUp` / `ArrowDown` not yet added, to be confirmed)
- Mobile add-node: `.node-add-sheet` bottom sheet; search pinned; result list scrollable; sheet backdrop `color-mix`
- Background scroll locked via `body:has(.modal-backdrop)` / `.modal-open` (`overflow: hidden`)
- App-style textareas use `resize: none`; preserve a deliberate fixed or minimum height
- Decorative arrows and icons are not action affordances; use concise text and hierarchy instead
- Landing anchor navigation uses reduced-motion-aware smooth scrolling; section state is driven by an `IntersectionObserver` focus line, and back-to-top targets document position 0
- Back-to-top visibility is driven by a page-start sentinel so it appears as soon as the page leaves position 0
- Mobile navigation reveals with opacity, movement, and clipping; active text links underline the full label width
- Admin state changes are immediate. Loading skeleton pulse is the only routine motion; pages, rows, dropdowns, feedback, and overlays do not transition
- Completed landing requests collapse to one centered column rather than retaining the form's split layout

## Assets
- Current photos are contextual assets, not the product identity. Product hardware and app states should lead future visual work.
- Fonts: Inter 400/600, IBM Plex Mono 400/600.

## What is NOT allowed (post-audit rules)
- `text-transform: uppercase` for hierarchy; `uppercase` only acceptable for `sr-only` and small technical labels where needed
- Component-level literal hex colors outside token definition; `var()` only for components
- Placeholder explanation blocks above lists (`Excavation opening`, `Deepest assigned node`); replaced by derived `Gateway` badge on first row
- Duplicate header cards in unified hardware setup; condensed to `.hardware-plan-summary` single line
- Full-screen keyboard collapse: `inputmode="numeric"`, `scroll-margin-block`, focused-field `scrollIntoView({ block: 'nearest' })`
- Decorative row arrows, repeated footer arrows, large icon-only refresh controls, resizable textarea handles, submit buttons beside collection search fields, and duplicate secondary hero CTAs

## Gaps / to confirm
- Design-system file saved here
- User preferences recorded in `AGENTS.md`: concise staff UI, compact functional controls, no decorative arrows or redundant icons, live collection search, and no visible textarea resize handles
