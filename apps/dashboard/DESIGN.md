# Bifrost Dashboard — Design Guidelines

The dashboard shares Billete's visual language and vendored coss UI primitives. Product behavior,
permissions, API contracts, and server boundaries remain Bifrost's own. Shared appearance does
not introduce a dependency on Billete. Read this before changing a screen.

## Component source and new components

[coss UI](https://coss.com/ui/docs) is the component library and design reference. Its source is
vendored locally; import components from `#/components/ui/<component>`.

1. Reuse or compose the existing local kit before creating a component.
2. If a component is missing, consult coss UI's official components, examples, and particles first.
   Adapt the appropriate source into the local kit, preserving Base UI behavior and accessibility.
3. If coss UI has no suitable component, build it from the existing primitives and follow its
   composition, geometry, states, focus, and keyboard patterns. Use the shared tokens, typography,
   spacing, radii, and sizes defined here so it matches Billete and the rest of the dashboard.

Do not introduce a separate visual system or duplicate an existing primitive. Reusable UI belongs
in `src/components/ui`; product-specific compositions belong in their feature or shared components.
Update matching skeletons when the component's layout changes.

## Foundations

- Base UI owns interaction, focus, and accessibility. Vendored primitives live in
  `src/components/ui/primitives`; `src/components/ui` adapts their API to existing callers.
- Use `lucide-react` icons with `aria-hidden` for decoration. Size with `size-*` classes.
- Google Sans Flex is the only UI font, including headings.
- Light and dark tokens live in `src/components/ui/styles.css`. Use semantic colors:
  `background`, `foreground`, `muted`, `muted-foreground`, `accent`, `border`, `primary`,
  `success`, `warning`, `destructive`, and `info`. Legacy aliases resolve to these tokens.
- Color indicates status or distinguishes chart series; it is not decorative.

| Element | Typography |
| --- | --- |
| Page heading | `font-semibold text-xl` |
| Section heading | `font-semibold text-base` |
| Panel heading | `font-semibold text-sm` |
| Body | Inherited 14px, line-height 1.5 |
| Helper text | `text-muted-foreground text-sm` or `text-xs` |
| Stat value | `font-semibold text-2xl tabular-nums` |
| Identifier | `font-mono text-xs` |

Use tabular numbers for amounts, counts, and dates. Arrange sections with `gap-6`, panel contents
and fields with `gap-4`, and inline controls with `gap-2`. Use flex or grid, never `space-*`.

Tables use one continuous body with ordinary data rows and the shared table primitives. Repeat
identifying context in each row rather than inserting group banners or nested tables. Model rows
show the public name above the upstream name; secondary details stay muted. Keep optional columns
in a Columns menu, with row pagination and a visible result count.

## Surfaces and shell

`Frame` is the default content surface: a `rounded-2xl bg-muted/72 p-1` tray containing a bordered
`rounded-xl` panel with `p-5` and its built-in hairline highlight. `ContentPanel` composes these
primitives. Stats use `p-4`. Tables use the same tray around the table container.

`Card` is for standalone flows such as sign-in. Use its header, content, and footer instead of
padding the root. Do not nest framed surfaces. Tables and empty states inside an existing panel
use their plain variant. Do not add shadows or decorative fieldsets.

The desktop sidebar is 224px wide; its collapse mode is 64px. The header is 48px tall. Navigation
uses `p-2 gap-2`, 16px icons, muted labels, and `bg-primary/10 text-primary` for the current page.
Group captions use 12px text. Settings sits in the footer. Account and theme controls sit on the
right of the header. Mobile navigation opens a 256px drawer.

The current navigation item keeps its background and text color on hover.

Content scrolls inside the shell, centered at `max-w-6xl`, with `p-4 sm:p-6` and `gap-6`.
The playground keeps its own transcript scrolling and a constrained composer.
Its composer is an intentional exception to shared control geometry: a 28px surface, 40px circular
actions and a pill model picker retain the previous writing experience. Its neutral palette is scoped
to the composer; dialogs, popups and the rest of the dashboard use the shared kit.

## Controls and forms

Controls inherit their corners: 8px for controls, 12px for inner panels, 16px for outer surfaces.
Avoid pill overrides. Mobile controls have 16px text to prevent input zoom; desktop controls use
14px. Desktop density changes at `sm`.

| Compatibility size | Mobile height | Desktop height |
| --- | --- | --- |
| `xs` | 28px | 24px |
| `sm` | 32px | 28px |
| `md` | 36px | 32px |
| `lg` | 40px | 36px |

Input heights include their outer border. Toolbar controls use `sm`. Primary actions use the
neutral fill, secondary actions an outline, quiet actions ghost, and destructive actions the
destructive variant. Icon actions are square and require an accessible label.

Keep required fields in the main form. Creation selects require an explicit choice; editing
preserves stored values. Optional creation fields belong under Advanced options, retain values
when collapsed, and reveal validation failures. Preserve server errors and pending states.

Use a combobox trigger with search inside its popup for model, deployment, adapter, and definition
lists. Opening shows existing options before typing. Filters include an explicit option to reset
the selection. Model fields that accept custom names keep that behavior; multiple selections
retain their order and removable chips.

Dialogs use the shared backdrop, 16px corners, 24px content padding, 20px titles, and a muted footer.
Long existing editors retain their scrollable body and fixed actions. Menus, badges, tabs, switches,
checkboxes, toasts, and tooltips use the vendored primitives' geometry and colors.

## Skeletons

Skeletons reserve the loaded component's geometry: padding, grids, breakpoints, headers, row
heights, and radii. Use `TextSkeleton` for text lengths, invisible controls inside `GhostSkeleton`
for controls, and `ButtonSkeleton` for actions. `FormSkeleton` renders the actual form with inert
controls, so it cannot submit or receive focus.

Tables keep their headers and per-column placeholders. Pagination remains visible. Loading
navigation mirrors the groups; permission-dependent sections resolve with identity. Unknown
record counts cannot be inferred from placeholders.

Use the shared shimmer in both themes. Hide placeholders from assistive technology and announce
loading once. Reduced motion disables shimmer and movement.

## Charts and verification

Use areas for activity, lines for latency, bars for comparisons, and continuous donuts for mutually
exclusive shares. Use `--chart-1` through `--chart-5`, UTC intervals, units, exact values, readable
legends, and accessible data tables. Compare each series from zero. Missing measurements remain
missing, never zero. Container width determines chart layouts.

Verify both themes, desktop and mobile, narrow panels, empty and loading states, keyboard
navigation, scrollable dialogs, and reduced motion. Run lint, typecheck, unit tests, and the
dashboard build without weakening any gate.
