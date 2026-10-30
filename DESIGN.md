---
name: DeskSuite
description: A bright, friendly desktop workbench with calm, efficient tools.
colors:
  primary: "#2563eb"
  primary-hover: "#1d4ed8"
  primary-active: "#1e40af"
  primary-strong: "#60a5fa"
  primary-soft: "#eff6ff"
  dark-accent-container: "#1e293b"
  status-info: "#0369a1"
  status-success: "#047857"
  status-warning: "#a16207"
  workspace: "#f2f4f8"
  surface: "#ffffff"
  surface-subtle: "#fafbfd"
  surface-muted: "#f1f5f9"
  border: "#e2e8f0"
  text-primary: "#1e293b"
  text-secondary: "#334155"
  text-muted: "#475569"
  text-subtle: "#5f6b7c"
  dark-workspace: "#11141a"
  dark-surface: "#161922"
  dark-surface-muted: "#222834"
  dark-border: "#2a3140"
  dark-text-primary: "#f1f5f9"
  dark-text-secondary: "#cbd5e1"
  dark-text-muted: "#a3b1c2"
  dark-text-subtle: "#8491a3"
  dark-accent-soft: "#172c49"
typography:
  body:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', 'Microsoft YaHei UI', -apple-system, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0em"
  page-title:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', 'Microsoft YaHei UI', -apple-system, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0em"
  panel-title:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', 'Microsoft YaHei UI', -apple-system, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0em"
  section-title:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', 'Microsoft YaHei UI', -apple-system, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0em"
  title:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', 'Microsoft YaHei UI', -apple-system, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0em"
  label:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', 'Microsoft YaHei UI', -apple-system, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: "0em"
  metadata:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', 'Microsoft YaHei UI', -apple-system, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0em"
  data:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', 'Microsoft YaHei UI', -apple-system, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.35
    letterSpacing: "0em"
  code:
    fontFamily: "'Cascadia Code', 'JetBrains Mono', Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "0em"
rounded:
  control: "6px"
  panel: "12px"
  card: "16px"
spacing:
  unit: "4px"
  control-gap: "6px"
  panel-inset: "12px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    height: "32px"
    padding: "0 12px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.control}"
    height: "32px"
    padding: "0 12px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.card}"
    padding: "12px"
---

# Design System: DeskSuite

## Overview

**Creative North Star: "The Bright Workbench"**

DeskSuite is a modular desktop workbench for moving between files, notes, projects, and creative tools. Its interface should feel bright, friendly, and low pressure while keeping dense operational information easy to scan. Familiar docked panels, compact toolbars, and resizable work areas serve repeat users; shared colors, spacing, and control states make independently developed plugins feel like one application.

The light theme uses cool, pale work surfaces and a clear blue accent. The dark theme keeps the same hierarchy with deep charcoal surfaces and a brighter blue active state. Rounded controls and panels soften the desktop chrome; motion stays short and functional so it confirms a state change without slowing work.

**Key Characteristics:**
- Bright neutral surfaces with a blue action color.
- Compact desktop density with clear panel boundaries.
- Soft corners and brief, quiet interaction feedback.
- Chinese interface copy and familiar desktop navigation.

**The Shared Surface Rule.** Shell and plugins use the semantic `--ds-*` tokens for repeated surfaces, borders, text, and accent states. Domain-specific data colors remain reserved for statuses, file types, and visualizations.

## Colors

The palette uses one blue action family, cool neutral surfaces, and separate status colors only when they carry data meaning. Dark mode changes semantic token values so components keep their role when the theme changes.

### Primary
- **Workbench Blue** (`#2563eb`): Primary actions, selected controls, focus indicators, and active navigation in the light theme.
- **Workbench Blue Hover** (`#1d4ed8`): Hover feedback for filled primary actions.
- **Workbench Blue Active** (`#1e40af`): Pressed state for primary actions.
- **Clear Sky Blue** (`#60a5fa`): Higher contrast accent text and borders in the dark theme.
- **Blue Wash** (`#eff6ff`): Light selected and active backgrounds.
- **Action Blue Dark** (`#1e40af`): Darker blue for readable selected text on pale blue backgrounds.

### Secondary
- **Clear Information Blue** (`#0369a1`): File and information type labels.
- **Readable Success Green** (`#047857`): Success state labels on pale green backgrounds.
- **Readable Warning Amber** (`#a16207`): Warning state labels on pale amber or white backgrounds.

### Neutral
- **Cool Work Surface** (`#f2f4f8`): Main workspace background.
- **Clean White** (`#ffffff`): Panels, fields, menus, and cards in the light theme.
- **Quiet Surface** (`#fafbfd`): Secondary panel interiors and restrained chrome.
- **Soft Slate Surface** (`#f1f5f9`): Hover, grouped controls, and subtle metadata backgrounds.
- **Soft Slate Border** (`#e2e8f0`): Dividers and low emphasis component outlines.
- **Ink Text** (`#1e293b`): Primary light-theme text.
- **Slate Text** (`#334155`): Secondary labels and field names.
- **Muted Slate** (`#475569`): Supporting notes and metadata.
- **Quiet Slate** (`#5f6b7c`): Lowest priority readable text, such as paths and inactive hints.
- **Night Workspace** (`#11141a`): Dark-theme work area.
- **Night Panel** (`#161922`): Dark-theme shell and shared panels.
- **Night Control Surface** (`#222834`): Dark-theme hover and inset controls.
- **Night Border** (`#2a3140`): Dark-theme dividers and outlines.
- **Cloud Text** (`#f1f5f9`): Primary dark-theme text.
- **Silver Text** (`#cbd5e1`): Secondary dark-theme text.
- **Muted Cloud Text** (`#a3b1c2`): Supporting notes and metadata in dark mode.
- **Quiet Cloud Text** (`#8491a3`): Lowest priority readable dark-mode text.
- **Deep Blue Wash** (`#172c49`): Dark-theme selected background.
**The One Accent Rule.** Use the blue family for shared selection and action states. Green, amber, rose, and other hues are reserved for meaningful status, file type, or visualization data.

## Typography

**Body Font:** Segoe UI Variable Text (with Segoe UI, Microsoft YaHei UI, and system sans-serif fallbacks)
**Label/Mono Font:** Cascadia Code (with JetBrains Mono and Consolas fallbacks)

**Character:** Compact and familiar, with clear weight changes instead of decorative display typography. Chinese UI text remains natural sentence case; monospace is for paths, code, shortcuts, and measured values.

### Hierarchy
- **Page title** (600, 24px, 1.3): One main heading for a page or large work area; use `.ds-type-page-title` / `data-ds-type="page-title"`.
- **Panel title** (600, 20px, 1.3): Floating and sidebar panel titles; use `.ds-type-panel-title` / `data-ds-type="panel-title"`.
- **Content title** (600, 18px, 1.3): Titles within documents and cards; use `.ds-type-title` / `data-ds-type="title"`.
- **Section title** (600, 16px, 1.3): Subsections and cards; use `.ds-type-section-title` / `data-ds-type="section-title"`.
- **Body** (400, 14px, 1.5): Main copy, descriptions, and notes; use `.ds-type-body` / `data-ds-type="body"`.
- **Label** (500, 13px, 1.35): Tabs, field labels, compact actions, and categories; use `.ds-type-label` / `data-ds-type="label"`.
- **Metadata** (400, 12px, 1.5): Supporting counts, timestamps, paths, and secondary notes; use `.ds-type-meta` / `data-ds-type="meta"`.
- **Data** (400, 12px, 1.35): Dense numeric labels and table values; use `.ds-type-data` / `data-ds-type="data"`.
- **Control text** (500, 12–14px): Button, input, and select text follows shared control size variants.
- **Code** (400, 12px, 1.45): Paths, code, shortcuts, and numeric readouts.

Text color roles (`--ds-text-primary`, `secondary`, `muted`, `subtle`) are separate from typography roles. Color contrast communicates priority within a role; it does not determine font size or heading status. L1–L4 in the font audit refer to color roles only.

**The Readable Density Rule.** Compactness comes from grouping and panel structure, not from making interface text smaller than 12px or using pale text on white surfaces.

## Layout

The workbench uses a resizable desktop frame: a narrow activity rail, optional left and right panels, a central workspace, a bottom dock, and a status bar. The shell and panel edges use consistent separators; plugin-owned content controls its internal grid when the task requires a canvas or multi-column tool. Floating panels keep a fixed pixel frame with internal scrolling and must remain inside the visible window. At narrower window widths, toolbars may wrap as coherent groups; controls should not be clipped or require horizontal scrolling to reach primary actions.

Use a 4px spacing base. Tight related controls use 4–8px gaps; panel insets generally use 12px; distinct sections need more separation than items within a section. Prefer one clear content surface per task and reveal secondary work areas on demand.

**The Stable Panel Rule.** A tab change inside a floating panel must not move or resize the panel. Scroll long content inside its fixed frame.

## Elevation & Depth

DeskSuite uses a hybrid of thin structural borders and restrained shadows. Borders define docked panel boundaries; low soft shadows distinguish menus and floating panels. Avoid stacking a pronounced shadow and a second decorative outline on ordinary cards. Reserve blur for a floating surface that needs separation from content behind it.

**The Docked-Flat Rule.** Docked panels are separated by a one-pixel border. Save stronger elevation for menus, draggable floating panels, and deliberate overlays.

## Shapes

Shared controls use softly rounded corners (6px). Menus and nested panel surfaces use 12px corners; content cards and floating panels use a gentler card radius (16px). Pill shapes are reserved for compact tags, badges, and segmented tab treatments. Use the same radius for the same component role across plugins.

## Components

Shared primitives live in `system-provider-ui-kit` and are consumed through the `ui` service. Use these for ordinary buttons, icon actions, fields, cards, tags, tabs, selects, and common panel frames. Keep a plugin-specific component only when its interaction or information model is genuinely distinct, then build its repeated colors and surfaces from the shared tokens.

**Plugin ownership boundary:** a feature plugin owns its content, actions, and placement. It does not own a parallel visual configuration. Standard button variants, control dimensions, typography, colors, radii, borders, shadows, focus, and feedback come from the shared UI Kit and global semantic tokens. A distinct editor may style its document content, but must map its chrome and palette to the shared theme. Never add plugin-specific theme configuration to accommodate one screen.

### Buttons
- **Primary:** Blue fill, white label, 32px default height, 6px corners, brief hover and pressed changes.
- **Control sizes:** xs 28px at 12px text, sm 32px at 13px text, md 36px at 14px text. Shared size tokens live in the global theme; plugins choose a size and semantic variant, not new per-page dimensions.
- **Default:** White surface, neutral border, and a restrained hover surface; selected state uses the accent wash.
- **Ghost:** No resting box; use a quiet hover background and a visible keyboard focus ring.
- **Danger:** Rose is reserved for destructive actions and must retain an explicit action label.
- **Disabled / Focus:** Disabled controls remain visibly disabled; keyboard focus uses a two-pixel blue ring.

### Inputs / Fields
- **Style:** White surface, neutral outline, 32px height, 6px corners, and 12px horizontal inset.
- **Focus:** Accent border and a subtle outer focus ring.
- **Placeholder:** Muted slate; do not rely on placeholder text as the only field label.

### Cards / Containers
- **Style:** The shared surface, neutral border, and 16px card radius from the global theme tokens.
- **Selected:** Blue border and a soft focus-like wash; avoid a permanent blue glow at rest.
- **Padding:** Start at 12px and expand only where the content needs breathing room.

### Navigation
- **Shell:** Activity actions use a consistent 56px rail with 11px labels; docked panel headers share the same border and surface tokens.
- **Tabs:** Reuse the shared tab primitive. Active tabs use the blue action family; inactive tabs remain quiet.
- **Menus:** Use a white/dark panel surface, one-pixel border, compact rows, and a clear hover state.

### Tags and Status
- **Tags:** Use the shared pill primitive for short categorical labels; blue is the default, other hues have semantic meaning.
- **Status:** Pair color with text or an icon. Pulsing indicators are not a default status treatment.

### Floating Panels
- **Frame:** Draggable and resizable with a restrained elevated surface, persistent geometry, and internal scrolling.
- **Header:** A clear title and actions, with tabs in a separate stable row when present.
- **Behavior:** Keep a fixed pixel size while changing tabs; fit the frame within the available viewport.

## Do's and Don'ts

### Do:
- **Do** use the `--ds-*` semantic variables for repeated colors and surfaces across plugins.
- **Do** build standard actions from the shared UI kit through `useUiKit()`.
- **Do** preserve compact workbench density while keeping essential labels readable.
- **Do** group toolbar actions by task and give the primary action a distinct visual weight.
- **Do** keep plugin-specific colors when they encode status, file type, or chart series.

### Don't:
- **Don't** create a second shared button, field, tab, or panel style inside a feature plugin.
- **Don't** introduce a new accent hue for ordinary selection or navigation.
- **Don't** use pale gray text for essential labels or make a permanent pulse the only status signal.
- **Don't** nest decorative cards to imitate layout hierarchy.
- **Don't** place unrelated fixed dimensions or corner radii on repeated instances of the same component role.
