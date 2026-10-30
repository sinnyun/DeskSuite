---
target_identity: "file:E:\\ai\\DeskSuite\\src-renderer-src-plugins-system-basic-shell"
timestamp: 2026-10-30T14-01-05Z
slug: src-renderer-src-plugins-system-basic-shell
closed: true
---
# DeskSuite design critique — 2026-10-30

Assessment provenance: two isolated sub-agents completed independent design review and detector/browser evidence; the parent synthesized both after completion.
Target: `src/renderer/src/plugins/system-basic-shell` and the rendered DeskSuite workbench. Operating mode: Operate.
Direction: a bright, light workbench; clear, friendly, low-pressure; soft rounded shared controls with quiet feedback.

## Design specificity
The interface reads as a modular desktop workbench, with file/project navigation, docked inspector, console, and resizable work areas. It fits DeskSuite, though multiple simultaneously visible surfaces can make the screen feel like several tools assembled together.

## Nielsen heuristics (0–4)
1. Visibility of system status: 3 — Active states, badges, version history, and logs give feedback, but signals are spread across the screen.
2. Match between system and the real world: 3 — Chinese labels and desktop metaphors help; MCP/plugin terminology assumes technical knowledge.
3. User control and freedom: 3 — Dock controls, resizing, shortcuts, and undo/redo help; recovery varies by plugin.
4. Consistency and standards: 2 — Shared primitives exist, but plugin-owned styling remains in some feature areas.
5. Error prevention: 2 — The reviewed evidence does not establish consistent validation and confirmation for consequential actions.
6. Recognition rather than recall: 3 — Labels and breadcrumbs help, while some icon actions depend on tooltips.
7. Flexibility and efficiency: 4 — Resizable layout, shortcuts, and panel controls serve repeat users.
8. Aesthetic and minimalist design: 2 — Shell, floating work surface, inspector, and console can compete for attention.
9. Error recovery: 2 — Logs exist, but task-local recovery guidance is not consistently visible.
10. Help and documentation: 3 — Help is represented, but targeting and contextual guidance are unclear.

## Cognitive load and emotional journey
The captured dense workspace presents more than four visible tool actions and several competing surfaces. Grouping and active states help, but the primary task can lose focus. The shell feels capable and familiar on entry; opening more work surfaces can feel crowded. Version history and logs offer reassurance, though recovery can feel technical when separated from the task.

## Strengths
- Desktop workbench structure suits a modular tool with docked, resizable panels.
- Shared blue accent and soft surfaces make the visual language recognizable.
- Shortcuts, panel toggles, and workspace history support efficient repeat use.

## Priority issues
1. Reduce simultaneous competing surfaces in the default workspace; reveal secondary work areas on demand.
2. Keep shared semantic tokens and UI primitives as the source for repeated shell/plugin colors, radii, spacing, and states.
3. Standardize buttons, tabs, icon actions, and fields; reserve custom styles for distinct information models.
4. Group dense toolbars and distinguish the primary action.
5. Show localized error recovery and the next useful action at the point of failure.

## Detector and browser evidence
The initial scan found 117 findings (73 low contrast, 36 undersized text, 6 tiny text, 1 nested-card heuristic, 1 pulsing status dot). After the shared token/style pass, the final source scan reported 181 recommendations: 176 advisory token mismatches (134 type size, 23 color, 18 radius) and 5 font warnings. The font warnings are in the whiteboard's canvas/document rendering declarations (Arial), which may be intentionally separate from interface typography and need an explicit documented exception or alignment.

The final live CDP scan reported one nested-card warning. Read-only DOM evidence shows the detected rounded bordered content is the empty inspector information block inside a normal flex column; this is a detector false positive. The final app screenshot was obtained through the DeskSuite MCP `capture_window` tool and reviewed. Guard, typecheck, production build, and design sidecar JSON parsing passed. The build retains the existing Leafer dynamic/static import notice.

Final artifact: `artifacts/verify/design-system-final-light.png`; detector JSON: `artifacts/verify/impeccable-final.json`.

## Remaining design questions
The token extraction and common style consolidation substantially reduce drift, but the detector still counts deliberate domain colors, canvas typography, compact metadata sizes, and micro-radii as deviations. Classify intended exceptions in the design system and progressively migrate repeated UI instances.
