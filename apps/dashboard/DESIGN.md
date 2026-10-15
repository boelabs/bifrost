# Bifrost Dashboard — Design Guidelines

Source of truth for how the operator dashboard looks and is built. Read it before adding a screen
or component; follow it exactly. When something is missing here, extend this document in the same
change instead of improvising.

The dashboard is a sibling of Billete's (`billete/apps/dashboard/DESIGN.md`): same tokens, same
vendored coss UI primitives, same shell, same page anatomy. A screen that would look out of place in
Billete is wrong here too. Product behavior, permissions, API contracts and server boundaries remain
Bifrost's own; the shared appearance never introduces a dependency on Billete.

The visual language is **quiet, dense and precise**: neutral surfaces, one accent (the primary
neutral), soft hairline borders, rounded panels, tabular numbers. Color only carries meaning
(status, chart series), never decoration.

## 1. Foundations

### Stack

- **coss UI** primitives (Base UI + Tailwind CSS), vendored in `src/components/ui/primitives`.
  Treat them as a library: extend with variants in the component file, never fork a copy.
  `src/components/ui/<component>.tsx` adapts them to the dashboard's callers (`label`/`description`
  props on fields, `variant="secondary"` for coss `outline`…). Import from `#/components/ui/<name>`.
- **New components:** reuse or compose the local kit first. If one is missing, take coss UI's
  official component, example or particle ([coss.com/ui/docs](https://coss.com/ui/docs)) — or
  Billete's vendored copy, which is the same source — into `primitives`, keeping Base UI's behavior
  and accessibility. Only build from scratch when coss has nothing suitable, following its geometry,
  states, focus and keyboard patterns.
- **Icons:** `lucide-react` only, `aria-hidden` when decorative, sized with `size-*` classes. The
  Bifrost mark (`BifrostMark`) is the one brand asset.
- **Charts:** `recharts` through `src/components/ui/chart.tsx`.
- **Font:** Google Sans Flex, the only UI font, headings included (`src/shared/fonts`). Google Sans
  Code for identifiers and code. Never set a font family anywhere else.

### Tokens (never raw palette classes)

| Purpose | Token classes |
| --- | --- |
| Page background | `bg-background` |
| Primary text / secondary text | `text-foreground` / `text-muted-foreground` |
| Subtle fills, hovers | `bg-muted`, `bg-accent`, `hover:bg-accent/50` |
| Hairlines | `border` (inherits `--border`) |
| Primary action / selected nav | `bg-primary text-primary-foreground`, `bg-primary/10 text-primary` |
| Status | `success`, `warning`, `destructive`, `info` (+ `-foreground`) |
| Charts | `var(--chart-1…5)` |

Light and dark tokens live in `src/components/ui/styles.css` and are Billete's, value for value.
Add a token there before using a new color. `--alpha()` is intentional Tailwind syntax. The older
aliases (`fg`, `fg-muted`, `surface`, `danger`…) resolve to these tokens; new code uses the
semantic names.

### Typography

| Use | Classes |
| --- | --- |
| Page title | `font-semibold text-xl` (`PageHeader`) |
| Section title | `font-semibold text-base` (`Section`) |
| Panel title | `font-semibold text-sm` (provided by `Panel`, `FrameTitle`, `CardTitle`) |
| Body | inherited: 14px, line-height 1.5 (`styles.css`); never set it per page |
| Secondary / helper | `text-muted-foreground text-sm` or `text-xs` |
| Big figures | `font-semibold text-2xl tabular-nums` |
| IDs, keys, model ids | `font-mono text-xs` |

Amounts, counts, durations and dates use `tabular-nums`.

### Spacing, radius, elevation

- Layout with `flex flex-col gap-*` / `grid gap-*`; never `space-*`.
- Page sections `gap-6`; panels of one form or one record `gap-3`; inside a panel and between form
  fields `gap-4`; inline items `gap-2`.
- Radius comes from the primitives: outer surfaces `rounded-2xl`, inner panels `rounded-xl`,
  controls `rounded-lg`. Do not add radius classes to primitives.
- Elevation is the primitives' built-in hairline shadow. No extra shadows, except popovers'
  `shadow-lg/5` on things that float over content.

### Controls

Desktop density changes at `sm`; mobile controls use 16px text so iOS does not zoom.

| Adapter size | Mobile height | Desktop height |
| --- | --- | --- |
| `xs` | 28px | 24px |
| `sm` | 32px | 28px |
| `md` (default) | 36px | 32px |
| `lg` | 40px | 36px |

Page, form and toolbar controls (search, filters, export, header buttons) use the default size,
matching the inputs beside them. Compact sizes (`sm`, `xs`) belong inside table rows and popups,
never beside full-size inputs.

Button variants (adapter names, coss names in parentheses):

- `primary` (`default`): the single main action of a page, form or dialog.
- `secondary` (`outline`): every other decision — *Cancel*, *Back*, *Disable*, *Load more*, a
  report or secondary page linked from a list.
- `danger-outline` (`destructive-outline`): destructive actions in a page header (*Delete*,
  *Revoke*). `danger` (filled) only for the confirm button of a destructive dialog.
- `ghost`: where a border would fight the surface — icon buttons inside a field or a row, the
  shell's chrome (search, menu, close), option lists inside a popup.
- `link`: a quiet text action that is not one of the decisions in front of the operator (*View
  all*, *Change*).

Icon-only buttons are square (`mode="icon"`) and always have an `aria-label`.

## 2. Surfaces

- **`Frame`** is the default container: a muted tray (`rounded-2xl bg-muted/72 p-1`) holding one or
  more `FramePanel`s (`rounded-xl border bg-background p-5`). Use it for stat tiles, tables, detail
  lists, charts and form sections.
- **`Panel`** (`src/shared/components/Panel.tsx`) is a `Frame` with its title, description and
  action in the tray and the content in the panel: every titled block (a form section, a detail
  list, a table with a heading). `flush` drops the padding for edge-to-edge content.
- **`Card`** is for standalone, self-contained flows: sign-in, confirmations.
- **`Dialog`** only for short create/edit forms (**six fields or fewer**), confirmations and
  show-once secrets. Longer or multi-section editors get their own page. Records are inspected and
  edited on their own pages with real URLs, never in a modal or side sheet.
- Never nest a `Frame` inside a `Frame` or a `Card` inside a `Card`. Tables and empty states inside
  an existing panel use their plain variant. No decorative fieldsets.

## 3. App shell

Billete's shell, value for value (`src/features/shell`):

```
┌ Sidebar (268px) ──┬──────────────────────────────────────────────────┐
│ ◠ Bifrost      🔍 │                                                  │
│ ───────────────── │  main: centered max-w-6xl, p-4 sm:p-6, gap-6     │
│ Overview          │                                                  │
│ Metrics           │                                                  │
│ Gateway           │                                                  │
│   Models …        │                                                  │
│ Administration    │                                                  │
│   Extensions …    │                                                  │
│ ───────────────── │                                                  │
│ (A) admin      ⇅  │                                                  │
└───────────────────┴──────────────────────────────────────────────────┘
```

- **No header.** The desktop sidebar is `--app-sidebar-width` (268px, shared with Billete), with no
  collapsed mode. Top: the logo (link to Overview) and a quiet square search button, separated
  from the navigation by a hairline. Middle: the navigation groups in a `ScrollArea` with
  `scrollFade` and the thin `edge` scrollbar. Foot: the operator (`UserMenu`).
- **Navigation** is one list, `src/features/shell/navigation.ts` (`NAVIGATION`), read by the
  sidebar, the command palette and the keyboard shortcuts. Each entry declares the permissions it
  needs; an operator never sees a page whose calls would come back 403. Rows are quiet (`NAV_ROW`:
  `text-muted-foreground`, `p-2`, 16px icon); the open page is `bg-primary/10 text-primary`
  (`aria-current="page"`) and is active on every page nested under it (`/models/new`,
  `/models/<id>`). Group captions are `text-xs font-medium text-muted-foreground`. A new page joins
  the group of its area; a new group is for a new area.
- **UserMenu** at the sidebar's foot: avatar initial, name and a chevron; it opens upward with
  name and role, the theme (*Light theme*, *Dark theme*, *Automatic*), *Keyboard shortcuts* and
  *Sign out*.
- **Command palette:** the search button beside the logo (and in the mobile bar) or Ctrl/⌘+K opens
  one coss `CommandDialog` with the pages and the create actions the role allows. The trigger has
  no visible text; its accessible name and title carry the action and shortcut. Triggers reach the
  dialog through a Base UI handle (`CommandCreateHandle`), never by wrapping the app in a dialog
  root (that would make every other dialog a nested one, drawn without its backdrop).
- **Keyboard shortcuts:** `g` then a letter goes to a page (`NavItem.key`), `c` then a letter
  creates (`CREATE_ACTIONS`), `?` lists them (`Kbd` keycaps, uppercase). Keys typed in a field, an
  editable area, a menu, a list or a dialog are never shortcuts, nor any with Ctrl, ⌘ or Alt.
- **Phones:** a slim `MobileBar` (menu button, logo, search) opens the same sidebar as a left
  `Sheet`.
- The shell never reads the pathname outside a `<Suspense>` boundary (it would block prerendering
  every dynamic route). A page that scrolls its own content (the playground) marks its root
  `data-fill-viewport` and gets the main column's exact height.

## 4. Page anatomy

Every page is built from the same pieces, in this order:

1. `Breadcrumbs` (`src/shared/components/Breadcrumbs.tsx`) — only on record and creation pages,
   back to their list (*Models › New*, *Models › gpt-5*).
2. `PageHeader` (`src/components/ui/page.tsx`) — `title`, one-line `description`, `badge` (a
   record's status) and `actions` on the right: one primary button at most, the rest `secondary`.
3. A toolbar row for lists (search and filters on one row that wraps), then the content: `Frame`s,
   `Panel`s, tables, charts, `StatCard` grids.

**List pages:** `PageHeader` with the create action as its primary button → toolbar (search,
filters, *Columns*) → table with pagination and a visible result count → empty state that says what
the list is for and offers the primary action. A narrowed list that comes back empty says so and
offers to clear the filters, never the first-use empty state. Filters live in the URL so a filtered
list survives reload, back and sharing. Table rows that have a page are links: the first column's
link stretches over the row (`after:absolute after:inset-0`), and the row's own controls (its menu)
sit `relative z-10` above it.

**Creation and record pages** (`/models/new`, `/models/[deployment]`, `/keys/new`, `/keys/[key]`,
`/logs/[id]`): `Breadcrumbs` → `PageHeader` (the record's name, its status badge, header actions:
destructive ones `danger-outline`, toggles `secondary`, at most one primary) → the form or the
record's body. An editable record's page is its form, pre-filled; a read-only record uses
`DetailLayout` (main column and an aside of `Panel`s holding `DetailList`s, side by side only when
the content area fits both — a container query, not the window).

**Settings:** `PageHeader` with only its title → the sections nav (a sticky column of titled groups
beside the content on wide screens, a row of tabs on phones) → the open section, one settings card
per group of values saved together. A card is a title and description, its fields, and a footer
with a note and *Save*, enabled only while the card differs from what it loaded. Each section is its
own URL under `/settings`.

**Overview and Metrics:** `PageHeader` with the period and refresh controls as its actions →
`StatCard` grids (as many columns as cards, up to four; label, value and tray each on one line) →
chart and table `Frame`s.

## 5. Shared components (use these, do not re-create them)

| Need | Component |
| --- | --- |
| Page title + actions | `#/components/ui/page` → `PageHeader` |
| Back trail on record and creation pages | `#/shared/components/Breadcrumbs` → `Breadcrumbs` |
| Titled content block, form section | `#/shared/components/Panel` → `Panel` |
| Titled block of a page above its own panels | `#/shared/components/Section` → `Section` |
| Body of a read-only record page | `#/shared/components/DetailLayout` → `DetailLayout` |
| Key/value details | `#/shared/components/DetailList` → `DetailList` (empty values read as —) |
| Full-page form footer | `#/shared/components/FormActions` → `FormActions` (error, *Cancel* link, single primary submit) |
| Metric tile | `#/features/observability/StatCard` → `StatCard` |
| Status of a resource | `#/components/ui/status` → `Status` (tone `success`, `warning`, `danger`, `neutral`, `muted`) |
| Tables | `#/components/ui/datatable` → `DataTable` (`rowHref` makes each row open its record); `#/components/ui/table` for bespoke ones |
| A row's secondary actions | `#/shared/components/RowActions` → `RowActions` (one "…" menu, destructive items set apart) |
| Nothing to show | `#/components/ui/page` → `EmptyState` |
| Errors of a form or a page | `#/components/ui/page` → `ErrorNote`; route failures `RouteBoundary` |
| A list's search | `#/shared/components/SearchField` (icon inside, asks after a 300 ms pause, × clears; the term goes to the URL) |
| A group of settings saved together | `#/features/settings/SettingsCard` → `SettingsCard`, `SettingRow`, `SettingsCardSkeleton` |
| Model and deployment pickers | `#/shared/components/ModelPicker`, `SearchableSelect` from `#/components/ui/select` |
| Destructive confirmation | `useConfirm()` from `#/shared/feedback/confirm` |
| Results of actions | `useNotify()` from `#/shared/feedback/notifications`; mutations through `useMutation` / `useRowActions` |
| Permission-gated UI | `Can` / `useSession().can` from `#/features/auth/session` |
| Loading | `#/shared/components/Skeleton` and `TextSkeleton` (see below) |

If a pattern repeats twice, promote it to `src/shared/components` and add it to this table.
Reusable primitives belong in `src/components/ui`; product compositions in their feature or in
`src/shared/components`. A feature never imports another feature's components.

### Loading states

A skeleton is **the page with the data taken out**: nothing moves when the data arrives, at any
width. Build it from the page's own components and layout:

- Text the page always shows is itself; data is `TextSkeleton length={n}` with the usual length;
  IDs are `IdSkeleton`.
- Controls are ghosts (`ButtonSkeleton`, `GhostSkeleton` around the real control) — never a bar
  with a hand-written height. A form's skeleton is the real form inside `FormSkeleton` (inert,
  text masked), and lives next to the form (`DeploymentFormSkeleton` in `DeploymentForm.tsx`).
- Tables keep their headers, per-column placeholders and pagination. Unknown counts use the usual
  case.
- Use the shared shimmer in both themes; hide placeholders from assistive technology and announce
  loading once. Reduced motion disables shimmer and movement.

## 6. Forms

- **One primary submit** per form, showing `loading` while pending. A submit that leads to another
  page keeps loading until that page is on screen (navigate inside a transition and pass
  `pending || navigating`). A failure never navigates, so the button unlocks with the error.
- Full-page forms are a column of `Panel`s, one per group of related fields, then `FormActions`.
  Forms whose fields read better narrow use a bounded column (`w-full max-w-3xl`), skeleton
  included. Required panels come first; optional groups follow in their own panels, labelled
  *(optional)* field by field.
- Labels are sentence case; optional fields say "(optional)" in the label.
- Creation selects for providers, models and roles start with a placeholder and require an explicit
  choice; editing preserves stored values; filters may default to *All*.
- Put required credentials directly in the form flow. Keep help that changes a decision (*Leave a
  field blank to keep the stored value*); drop copy about encryption or adapter internals.
- Use a combobox with search inside its popup for models, deployments, adapters and definitions.
  Opening shows the options before typing; model fields that accept custom ids keep doing so.
- Preserve server errors next to the submit (`FormActions`, `ErrorNote`) and field errors on their
  field.
- Destructive or irreversible actions confirm with `useConfirm`; cancel buttons in overlays are
  `secondary`.

## 7. Data display

- Model rows show the public name above the upstream name; secondary details stay muted.
- Optional table columns live in a *Columns* menu; tables have row pagination and a visible count.
- Repeat identifying context in each row rather than inserting group banners or nested tables.
- Dates in tables: date over time, UTC, `tabular-nums`; exact timestamp on hover.
- Statuses always through `Status`: success = enabled/succeeded, warning = degraded/retried,
  danger = failed/revoked, neutral = disabled.
- Numbers right-aligned in tables; text left-aligned.

## 8. Charts

Areas for activity over time, lines for latency, bars for interval volumes and comparisons,
continuous donuts for mutually exclusive shares. Use `--chart-1` through `--chart-5`, UTC
intervals, units, exact values, readable legends and accessible data tables. Compare each series
from zero; missing measurements stay missing, never zero. Container width decides the layout.

The playground composer is an intentional exception to the shared control geometry (a 28px
surface, 40px circular actions and a pill model picker); its palette is scoped to the composer.

## 9. Copy

English, second person, short and concrete: "Create a deployment to make its public model
available", not "Here you can manage deployments". Buttons are verbs: *Create deployment*, *Save
changes*, *Revoke key*. Domain words, used consistently: **public model**, **deployment**,
**adapter**, **upstream model**, **API key** (virtual key), **operator**.

## 10. Accessibility and verification

- Every control has a visible label or `aria-label`; overlays trap focus (primitives handle it).
- Contrast comes from tokens; never lower text opacity below `text-muted-foreground`.
- Verify both themes, desktop and phone widths, narrow panels, empty and loading states, keyboard
  navigation and reduced motion, in the browser. Run lint, typecheck, unit tests and the dashboard
  build without weakening any gate.
