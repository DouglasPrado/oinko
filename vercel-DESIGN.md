---
version: alpha
name: Vercel-dashboard-inspired
description: 'A high-density operational dashboard system inspired by the Vercel Deployments interface. The system is overwhelmingly neutral: white canvas, off-white navigation surfaces, #171717 primary text, restrained gray hierarchy, hairline borders, and semantic color reserved for status, focus, environment, and warnings. Geist Sans carries almost all UI copy; Geist Mono is used for hashes, branch names, technical identifiers, and code-like metadata. Hierarchy comes from layout, density, typography, surface shifts, and 1px borders rather than shadows. Rows are compact, controls are quiet, radii stay small, and pill geometry is reserved for filters, badges, statuses, and compact actions.'

colors:
  primary: '#171717'
  on-primary: '#ffffff'
  focus: '#0072f5'

  canvas: '#ffffff'
  surface-sidebar: '#fafafa'
  surface-subtle: '#fafafa'
  surface-hover: '#f2f2f2'
  surface-selected: '#ebebeb'
  surface-active: '#e6e6e6'

  ink: '#171717'
  ink-muted: '#666666'
  ink-subtle: '#8f8f8f'
  ink-disabled: '#a8a8a8'

  hairline: '#ebebeb'
  hairline-strong: '#dcdcdc'

  semantic-info: '#0072f5'
  semantic-info-bg: '#eaf6ff'
  semantic-ready: '#45d6b6'
  semantic-ready-bg: '#e9fbf6'
  semantic-error: '#e5484d'
  semantic-error-bg: '#fdebec'
  semantic-warning: '#f5a623'
  semantic-warning-bg: '#fff5e5'

  overlay: 'rgba(0, 0, 0, 0.45)'

typography:
  page-title:
    fontFamily: Geist Sans
    fontSize: 24px
    fontWeight: 600
    lineHeight: 1.30
    letterSpacing: -0.4px

  section-title:
    fontFamily: Geist Sans
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.30
    letterSpacing: -0.3px

  label-lg:
    fontFamily: Geist Sans
    fontSize: 16px
    fontWeight: 500
    lineHeight: 1.40
    letterSpacing: -0.1px

  label:
    fontFamily: Geist Sans
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.40
    letterSpacing: 0

  label-strong:
    fontFamily: Geist Sans
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.40
    letterSpacing: 0

  body:
    fontFamily: Geist Sans
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.50
    letterSpacing: 0

  body-sm:
    fontFamily: Geist Sans
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: 0

  caption:
    fontFamily: Geist Sans
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.40
    letterSpacing: 0

  button:
    fontFamily: Geist Sans
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.20
    letterSpacing: 0

  mono:
    fontFamily: Geist Mono
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.40
    letterSpacing: 0

rounded:
  xs: 4px
  sm: 6px
  md: 8px
  lg: 12px
  pill: 9999px
  full: 9999px

spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
  section: 64px

components:
  button-primary:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.on-primary}'
    typography: '{typography.button}'
    rounded: '{rounded.sm}'
    padding: 8px 12px

  button-secondary:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
    typography: '{typography.button}'
    rounded: '{rounded.sm}'
    padding: 8px 12px

  button-ghost:
    backgroundColor: 'transparent'
    textColor: '{colors.ink-muted}'
    typography: '{typography.button}'
    rounded: '{rounded.sm}'
    padding: 8px 10px

  icon-button:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink-muted}'
    typography: '{typography.label}'
    rounded: '{rounded.sm}'
    padding: 8px

  sidebar:
    backgroundColor: '{colors.surface-sidebar}'
    textColor: '{colors.ink}'
    typography: '{typography.label}'
    rounded: '{rounded.xs}'
    padding: 0

  sidebar-nav-item:
    backgroundColor: 'transparent'
    textColor: '{colors.ink-muted}'
    typography: '{typography.label}'
    rounded: '{rounded.sm}'
    padding: 8px 10px

  sidebar-nav-item-selected:
    backgroundColor: '{colors.surface-selected}'
    textColor: '{colors.ink}'
    typography: '{typography.label-strong}'
    rounded: '{rounded.sm}'
    padding: 8px 10px

  search-input:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
    typography: '{typography.label}'
    rounded: '{rounded.sm}'
    padding: 8px 10px

  filter-button:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
    typography: '{typography.label-strong}'
    rounded: '{rounded.pill}'
    padding: 7px 12px

  filter-chip:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink-subtle}'
    typography: '{typography.body-sm}'
    rounded: '{rounded.pill}'
    padding: 7px 12px

  badge-neutral:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink-muted}'
    typography: '{typography.caption}'
    rounded: '{rounded.pill}'
    padding: 4px 8px

  badge-info:
    backgroundColor: '{colors.semantic-info-bg}'
    textColor: '{colors.semantic-info}'
    typography: '{typography.caption}'
    rounded: '{rounded.pill}'
    padding: 4px 8px

  badge-error:
    backgroundColor: '{colors.semantic-error-bg}'
    textColor: '{colors.semantic-error}'
    typography: '{typography.caption}'
    rounded: '{rounded.pill}'
    padding: 4px 8px

  badge-warning:
    backgroundColor: '{colors.semantic-warning-bg}'
    textColor: '{colors.semantic-warning}'
    typography: '{typography.caption}'
    rounded: '{rounded.pill}'
    padding: 4px 8px

  data-table:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
    typography: '{typography.label}'
    rounded: '{rounded.sm}'
    padding: 0

  data-row:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
    typography: '{typography.label}'
    rounded: '{rounded.xs}'
    padding: 10px 12px

  status-ready:
    backgroundColor: '{colors.semantic-ready}'
    textColor: '{colors.semantic-ready}'
    typography: '{typography.caption}'
    rounded: '{rounded.full}'
    padding: 0

  upgrade-panel:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
    typography: '{typography.body-sm}'
    rounded: '{rounded.md}'
    padding: 12px

  top-context-bar:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
    typography: '{typography.label-strong}'
    rounded: '{rounded.xs}'
    padding: 0
---

## Overview

This system is based primarily on the supplied Vercel **Deployments** dashboard screenshot and is intended for dense operational products: infrastructure panels, deployment consoles, observability tools, admin systems, developer tooling, and data-heavy SaaS backoffices.

Official Geist documentation is used only to validate the underlying design principles:

- Vercel's Geist system uses a high-contrast color model with separate roles for backgrounds, component backgrounds, borders, high-contrast fills, and text/icons.
- Geist Sans and Geist Mono are the canonical type families.
- The official typography system separates headings, labels, copy, buttons, and mono roles.
- The dashboard screenshot supplied by the user is the primary visual reference for density, composition, sidebar behavior, row geometry, visual hierarchy, and semantic status treatment.

Reference material:

- Supplied Vercel Deployments screenshot.
- https://vercel.com/geist/introduction
- https://vercel.com/geist/colors
- https://vercel.com/geist/typography

### Visual DNA

**Hierarchy engine:** layout + typography + hairlines + subtle surface shifts.

**Depth engine:** borders and background changes, not large shadows.

**Color strategy:** grayscale by default. Color appears only when it communicates state, focus, environment, risk, or identity.

**Density:** compact and operational. The interface should show substantial information without visually feeling noisy.

**Typography character:** small, precise, highly legible, neutral, and technical. The UI is dominated by 13–14px labels rather than oversized text.

**Shape language:** mostly 4–8px radii. Pills are deliberate exceptions for filters, badges, statuses, environment labels, and compact metadata.

**Interaction character:** quiet by default. Hover, selection, and focus should be visible without shifting layout or introducing decorative motion.

**Signature moves:**

- persistent light sidebar with selected navigation using a gray fill;
- dense full-width rows rather than card-per-record layouts;
- small semantic status dots;
- branch names, hashes, and IDs rendered as technical metadata;
- border-based section separation;
- subtle rounded filters above data tables;
- monochrome icons with semantic color introduced only when meaningful;
- large whitespace reserved for page structure, not inside every row.

**Forbidden moves:**

- large drop shadows on common panels;
- gradient backgrounds;
- oversized card radii;
- colorful navigation;
- glassmorphism;
- cardifying every table row;
- excessive vertical padding;
- decorative accent colors without semantic meaning.

## Colors

### Core Neutral System

The interface should remain overwhelmingly neutral.

| Token                       |     Value | Use                                     |
| --------------------------- | --------: | --------------------------------------- |
| `{colors.canvas}`           | `#ffffff` | Main content canvas, table rows, inputs |
| `{colors.surface-sidebar}`  | `#fafafa` | Persistent sidebar                      |
| `{colors.surface-subtle}`   | `#fafafa` | Secondary low-emphasis regions          |
| `{colors.surface-hover}`    | `#f2f2f2` | Hover state                             |
| `{colors.surface-selected}` | `#ebebeb` | Selected navigation item                |
| `{colors.surface-active}`   | `#e6e6e6` | Pressed/strong active state             |
| `{colors.ink}`              | `#171717` | Primary text and icons                  |
| `{colors.ink-muted}`        | `#666666` | Secondary text                          |
| `{colors.ink-subtle}`       | `#8f8f8f` | Metadata, placeholders                  |
| `{colors.ink-disabled}`     | `#a8a8a8` | Disabled controls                       |
| `{colors.hairline}`         | `#ebebeb` | Default borders/dividers                |
| `{colors.hairline-strong}`  | `#dcdcdc` | Stronger control outlines               |

### Semantic Color

Semantic colors must remain scarce.

| Token                       | Role                                                            |
| --------------------------- | --------------------------------------------------------------- |
| `{colors.semantic-info}`    | Production/environment badges, links, focus-related information |
| `{colors.semantic-ready}`   | Healthy/ready status dot                                        |
| `{colors.semantic-error}`   | Failed/blocked/error states                                     |
| `{colors.semantic-warning}` | Attention-required and upgrade warnings                         |
| `{colors.focus}`            | Keyboard focus and high-priority interactive outline            |

### Color Rules

1. Neutral is the default.
2. A row does **not** become green when successful; use a small status dot or compact badge.
3. A row does **not** become red when failed; use a red dot/badge and keep the row neutral.
4. Blue represents interaction, environment, or selected informational state — not decoration.
5. Warning amber is reserved for actionable warnings.
6. Avoid using semantic colors as large page backgrounds.
7. Prefer gray-alpha overlays for hover/pressed behavior when implementing dark mode later.

### Geist Color Model

The official Geist color system separates roles rather than treating colors as arbitrary swatches:

- background colors;
- component background states;
- border states;
- high-contrast component fills;
- text and icon colors.

Follow the same role-based thinking even when adapting the exact values to the product brand.

## Typography

### Families

**Geist Sans**

- Default family for navigation, tables, forms, headings, buttons, dialogs, and explanatory copy.
- Fallback: `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.

**Geist Mono**

- Technical identifiers only.
- Suitable for commit hashes, branches, IDs, tokens, timestamps when fixed-width alignment helps, CLI fragments, and code.
- Fallback: `ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace`.

### Dashboard Scale

| Token                        | Size | Weight | Use                                                  |
| ---------------------------- | ---: | -----: | ---------------------------------------------------- |
| `{typography.page-title}`    | 24px |    600 | Main page title such as “Deployments”                |
| `{typography.section-title}` | 20px |    600 | Major subsection heading                             |
| `{typography.label-lg}`      | 16px |    500 | Important entity/header labels                       |
| `{typography.label}`         | 14px |    400 | Most navigation and table content                    |
| `{typography.label-strong}`  | 14px |    500 | Selected nav, filter labels, emphasized cell content |
| `{typography.body}`          | 14px |    400 | General UI copy                                      |
| `{typography.body-sm}`       | 13px |    400 | Secondary metadata and dense descriptions            |
| `{typography.caption}`       | 12px |    400 | Badges, tertiary metadata, compact labels            |
| `{typography.button}`        | 14px |    500 | Buttons                                              |
| `{typography.mono}`          | 13px |    400 | Hashes, branches, technical identifiers              |

### Principles

- Most dashboard text should live at 13–14px.
- Do not create hierarchy by making everything bigger.
- Use weight, alignment, color, spacing, and position before adding font size.
- Page titles can be 20–24px; avoid marketing-sized headings in application surfaces.
- Technical values should use Geist Mono only when monospace adds information or scanability.
- Avoid weight 700 for ordinary dashboard UI.
- Keep labels concise and single-line when possible.
- Truncate long technical identifiers rather than wrapping dense rows to multiple lines.

## Layout

### Global Composition

The reference uses two primary regions:

1. **Persistent sidebar**
2. **Main content area**

The sidebar carries product navigation and account context. The main area carries page scope, title, filters, and the operational data surface.

### Sidebar

Observed visual behavior from the supplied screenshot:

- approximately 248px wide at the displayed desktop viewport;
- full-height;
- `{colors.surface-sidebar}` background;
- 1px right divider;
- navigation grouped vertically;
- selected item uses `{colors.surface-selected}`;
- icons remain monochrome;
- bottom account controls remain anchored near the viewport bottom;
- warning/upgrade panel appears inside the sidebar without visually dominating it.

Recommended geometry:

- width: `240–256px`;
- nav item height: `36–40px`;
- nav icon: `16px`;
- left/right item padding: `10–12px`;
- gap between icon and text: `8px`.

### Main Content

Use a fluid content region.

For operations dashboards, avoid an artificially narrow marketing container. Large tables should consume the available width while preserving a consistent page gutter.

Recommended:

- desktop page gutter: `{spacing.lg}` 24px;
- compact viewport gutter: `{spacing.md}` 16px;
- title → controls gap: 12–16px;
- controls → data surface gap: 12px.

### Data-Dense Layout

The deployment list is the protagonist.

Do:

- use rows;
- preserve column alignment;
- allow technical fields to truncate;
- reserve fixed widths for status, environment, date, and actions;
- let descriptive/name columns absorb remaining width.

Do not:

- place every deployment in a standalone elevated card;
- center-align operational data;
- make every column equally wide.

### Row Rhythm

Recommended row height: approximately `44–48px`.

Internal row spacing should feel compact:

- vertical padding: 9–11px;
- horizontal padding: 12px;
- small icon/text gaps: 6–8px.

### Spacing System

Base rhythm: **4px**.

| Token               | Value |
| ------------------- | ----: |
| `{spacing.xxs}`     |   4px |
| `{spacing.xs}`      |   8px |
| `{spacing.sm}`      |  12px |
| `{spacing.md}`      |  16px |
| `{spacing.lg}`      |  24px |
| `{spacing.xl}`      |  32px |
| `{spacing.xxl}`     |  48px |
| `{spacing.section}` |  64px |

In this interface, 8px and 12px are the most important operational gaps.

## Elevation & Depth

Vercel-style application surfaces should feel almost flat.

### Level 0 — Canvas

- `{colors.canvas}`
- no shadow
- no border unless needed for structural separation

Use for:

- main page body;
- table rows;
- most content.

### Level 1 — Structural Separation

- subtle alternate surface or sidebar background;
- 1px `{colors.hairline}` divider.

Use for:

- sidebar;
- table shell;
- filter control boundaries;
- separators.

### Level 2 — Floating UI

Use shadow sparingly for:

- dropdown menus;
- command palette;
- popovers;
- tooltip surfaces;
- context menus;
- modal/sheet layering.

Do not use elevated shadows for every card.

### Focus Depth

Keyboard focus is one of the few intentionally high-contrast depth indicators.

Prefer a visible blue focus treatment around interactive controls. Never remove focus indication merely for visual cleanliness.

## Shapes

### Radius Scale

| Token            |  Value | Use                                                    |
| ---------------- | -----: | ------------------------------------------------------ |
| `{rounded.xs}`   |    4px | Tiny technical surfaces                                |
| `{rounded.sm}`   |    6px | Default buttons, nav items, inputs                     |
| `{rounded.md}`   |    8px | Larger panels, alert/upgrade panel                     |
| `{rounded.lg}`   |   12px | Modals/popovers only when more softness is appropriate |
| `{rounded.pill}` | 9999px | Filters, badges, status/environment pills              |
| `{rounded.full}` | 9999px | Avatars, status dots                                   |

### Shape Rules

- Default control geometry: 6px.
- Selected sidebar rows should be softly rounded, not pill-shaped.
- Filters and status labels may use full pills.
- Full cards should not default to huge 16–24px radii.
- Avatars and tiny status indicators are circular.
- Table container corners may use 6–8px while internal rows remain visually square.

## Components

### Sidebar

**`sidebar`**

Persistent navigation surface.

- Background `{colors.surface-sidebar}`.
- Right edge uses a 1px `{colors.hairline}` divider.
- Keep visual noise low.
- Avoid shadows.
- Use 16px line icons.
- Organize navigation in predictable vertical groups.

### Sidebar Navigation Item

**`sidebar-nav-item`**

Default:

- transparent background;
- `{colors.ink-muted}`;
- 14px Geist Sans;
- 6px radius.

Hover:

- `{colors.surface-hover}`;
- `{colors.ink}`.

**`sidebar-nav-item-selected`**

Selected:

- `{colors.surface-selected}`;
- `{colors.ink}`;
- weight 500.

Selection must be communicated through surface + text contrast, not through bright brand color.

### Search Input

**`search-input`**

Compact command/search control:

- white background;
- 1px hairline border;
- 6px radius;
- 14px text;
- search icon leading;
- optional keyboard shortcut suffix.

The screenshot uses a compact `F` shortcut affordance. Maintain this keyboard-forward character.

### Page Header

Recommended structure:

1. context/project switcher;
2. page title;
3. filter/action row;
4. primary data surface.

Do not add unnecessary subtitle prose unless the page actually needs explanation.

### Filter Button

**`filter-button`**

Use for actions such as `Add Filter`.

- white surface;
- hairline border;
- 14px medium text;
- icon optional;
- compact pill or near-pill geometry;
- 36–40px height.

### Filter Chip

**`filter-chip`**

Use for active filter descriptors.

Examples:

- `Author douglas-4799`
- `Environment Production`
- `Status Error`

Characteristics:

- white or subtle surface;
- quiet gray text;
- dashed or subtle border is acceptable for filter semantics;
- pill geometry;
- never visually compete with primary actions.

### Data Table

**`data-table`**

The deployment list should behave like a structured operational table even when implemented with CSS grid.

- full available width;
- hairline outer border;
- 6–8px outer radius;
- clip rows to container radius;
- horizontal separators between rows;
- no zebra striping unless data density makes it necessary;
- no large shadow.

### Data Row

**`data-row`**

Recommended column logic:

1. deployment/commit description — flexible;
2. status — fixed;
3. environment — fixed;
4. project/source — fixed or semi-flexible;
5. hash — compact;
6. branch — compact;
7. date — fixed;
8. actor/avatar — compact.

Hover:

- `{colors.surface-hover}` or a more subtle alpha equivalent.

Selected:

- use a distinct neutral surface plus focus/selection semantics.

Do not significantly alter row height on hover.

### Status Indicator

Ready state should be communicated with a small `{colors.semantic-ready}` dot plus text.

Example:

`● Ready 1m 59s`

Rules:

- dot: approximately 8px;
- text remains dark;
- elapsed time may use muted text;
- do not fill the entire status cell green.

### Environment Badge

Environment/state labels may use compact semantic badges.

`Preview`:

- neutral white/gray pill.

`Production`:

- blue informational pill when healthy or contextually selected;
- red semantic pill only when the badge itself represents an error condition.

Badge height should remain approximately 24px.

### Technical Identifiers

Use `{typography.mono}` for:

- commit hashes;
- branch names when technical scanning benefits;
- IDs;
- machine-generated tokens.

Examples:

- `b8b9f89`
- `ALB-6092`
- `develop`

Do not use mono for normal navigation or descriptive copy.

### Avatar

- 20–24px inside dense rows;
- circular;
- keep at the far edge of row metadata;
- do not increase row height solely for avatar presence.

### Upgrade / Warning Panel

**`upgrade-panel`**

The sidebar alert in the reference is intentionally compact.

Characteristics:

- white surface;
- subtle warning-colored outline/accent;
- 8px radius;
- short title;
- 12–13px explanatory copy;
- full-width secondary button.

The warning color should support the message, not turn the entire panel amber.

### Buttons

**Primary**

- black `{colors.primary}`;
- white text;
- 6px radius;
- compact dimensions.

**Secondary**

- white;
- hairline border;
- dark text.

**Ghost**

- transparent;
- muted text/icon;
- hover uses `{colors.surface-hover}`.

Avoid large colored CTA buttons inside routine operational interfaces unless there is one clear high-priority action.

### Icons

Use a single line-icon family throughout.

Recommended:

- Lucide or Geist Icons;
- 16px default;
- stroke approximately 1.5–2px;
- inherit text color;
- semantic color only where icon state carries meaning.

Do not mix filled icon sets and outline icon sets casually.

### Tooltips

Use tooltips for:

- icon-only controls;
- truncated technical identifiers;
- unfamiliar status icons.

Avoid tooltips for text already visible and self-explanatory.

### Menus and Popovers

Floating surfaces may use stronger separation than normal page content:

- white background;
- 8–12px radius;
- hairline border;
- subtle shadow;
- dense 32–40px menu items.

Keep menus action-oriented and concise.

## Do's and Don'ts

### Do

- Keep the base interface monochromatic.
- Use `{colors.canvas}` and `{colors.surface-sidebar}` as the dominant surfaces.
- Build hierarchy with hairlines, spacing, typography, and subtle background shifts.
- Keep ordinary dashboard copy around 13–14px.
- Use Geist Sans as the default interface family.
- Use Geist Mono selectively for technical identifiers.
- Keep common controls at 6–8px radius.
- Use pills only where the semantic model benefits from them.
- Use small status dots for healthy states.
- Let tables and rows span available dashboard width.
- Keep navigation selected state neutral gray.
- Make keyboard focus unmistakable.
- Prefer icon + concise label over decorative illustration.
- Truncate long commit descriptions, branch names, and identifiers where necessary.
- Preserve high information density while maintaining consistent alignment.
- Use semantic color only when state actually matters.

### Don't

- Don't use gradients.
- Don't use glassmorphism.
- Don't use oversized marketing headings inside product screens.
- Don't use 16–24px radius on every surface.
- Don't turn every row into a floating card.
- Don't add shadows to ordinary sidebar or table surfaces.
- Don't make successful rows green.
- Don't make warning sections entirely orange.
- Don't use brand color as the selected navigation background.
- Don't introduce multiple decorative accent colors.
- Don't mix several icon styles.
- Don't center-align operational tables.
- Don't wrap technical table content into tall multi-line rows by default.
- Don't increase padding just to make the product feel “premium.”
- Don't replace hairline structure with heavy borders.
- Don't hide keyboard focus.

## Responsive Behavior

The supplied reference is a desktop screenshot. The transformations below are implementation guidance consistent with the observed desktop system, not directly observed mobile evidence.

### Wide Desktop

- Persistent sidebar.
- Full deployment/data table.
- Preserve all high-value columns.
- Main content consumes remaining width.
- 24px page gutter.

### Compact Desktop / Tablet

Recommended:

- preserve sidebar when there is sufficient room;
- reduce main content gutter to 16px;
- collapse lower-priority columns first;
- keep name, status, environment, branch/source, and date visible;
- use truncation before wrapping;
- allow horizontal scrolling for power-user tables where column loss would harm workflow.

### Narrow Tablet / Mobile

Recommended transformation:

- sidebar becomes drawer/sheet;
- top context switcher moves into compact header;
- filters become horizontally scrollable chips or a filter sheet;
- data rows become structured stacked rows rather than tiny compressed desktop columns;
- retain status and primary identity in the first line;
- move hash, branch, author, and timestamp into secondary metadata;
- maintain minimum touch targets around 40–44px.

### Column Priority

When width decreases, preserve in this order:

1. primary record/deployment name;
2. status;
3. environment;
4. project/source;
5. date;
6. branch;
7. hash;
8. actor/avatar.

Adjust this order when a product's actual workflow gives different columns higher operational importance.

### Touch

On touch devices:

- 44px is a safer minimum interaction target;
- icon-only buttons need larger invisible hit areas than their visual icon size;
- hover-only information must have a tap/focus equivalent.

## Iteration Guide

1. Start new screens with `{colors.canvas}`, `{colors.surface-sidebar}`, `{colors.hairline}`, and the 13–14px type scale before introducing any semantic color.
2. When adding a component, first decide whether it is a page-level surface, inline control, status element, or floating surface. Do not default everything to a card.
3. Prefer 6px radius for ordinary controls. Use `{rounded.pill}` only for badges, filters, and compact metadata.
4. New table/list views should preserve alignment and dense row rhythm before adding visual decoration.
5. Use `{typography.mono}` only where the value is machine-like or technical.
6. Any new bright color must have a semantic reason that can be named in one sentence.
7. New sidebar items should reuse `sidebar-nav-item` and `sidebar-nav-item-selected`; do not invent alternate selection treatments per section.
8. New statuses should use compact dot/badge semantics, not full-row color fills.
9. Keep ordinary product headings within the dashboard scale; do not import marketing hero typography into application pages.
10. Verify that hover, active, focus, disabled, loading, empty, and error states remain visually consistent with the same neutral hierarchy.
11. When changing density, change spacing tokens globally rather than hand-tuning each row.
12. Run `npx -y @google/design.md lint DESIGN.md` after edits when the CLI is available.

## Known Gaps

- The supplied evidence contains a single desktop screenshot, so mobile/tablet behavior is recommended rather than directly observed.
- Exact computed CSS values cannot be recovered from the screenshot alone.
- Neutral values such as `{colors.surface-selected}` and `{colors.hairline}` are reconstructed to closely match the visible Vercel dashboard and Geist conventions; they should be treated as high-confidence approximations rather than pixel-extracted canonical Vercel tokens.
- `{colors.semantic-ready}` is visually reconstructed from the supplied screenshot and may differ from Vercel's internal canonical success token.
- Exact hover and pressed states are not visible in the static screenshot.
- Dropdown, modal, sheet, command-menu, toast, loading, skeleton, and empty-state styling are not directly visible in the supplied screenshot.
- Dark mode is intentionally not specified here because the supplied reference is light mode.
- Exact breakpoint values are not asserted because they are not visible in the supplied reference.
- The screenshot suggests a sidebar width near 248px at its captured viewport, but implementations should use the 240–256px range rather than hard-coding the screenshot measurement.
- Geist's official typography documentation confirms role families and named scales, but this document intentionally narrows the scale to the sizes relevant to a dense dashboard.
