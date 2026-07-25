---
name: LLM Team Knowledge Base — Admin
description: An evidence-custody bench for knowledge an AI agent is allowed to trust.
colors:
  slate-ground: "#0E1214"
  slate-cabinet: "#12171A"
  slate-bench: "#171D20"
  slate-raised: "#1D2429"
  rule-hair: "#262F34"
  rule-strong: "#36424A"
  ink: "#E6EAE9"
  ink-secondary: "#A2ADB1"
  ink-meta: "#8A969B"
  ink-dormant: "#5A666C"
  tag-stock: "#E3DAC6"
  tag-stock-edge: "#CFC3A9"
  tag-ink: "#1A1815"
  tag-ink-secondary: "#4A453C"
  mark: "#E3DAC6"
  seal-mark: "#E86B38"
  seal-fill: "#9A3414"
typography:
  display:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "26px"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  title:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  register:
    fontFamily: "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "normal"
  label:
    fontFamily: "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.11em"
rounded:
  none: "0px"
  chip: "2px"
spacing:
  hair: "4px"
  tight: "8px"
  snug: "12px"
  base: "16px"
  loose: "24px"
  section: "32px"
  gutter: "40px"
components:
  button-primary:
    backgroundColor: "{colors.tag-stock}"
    textColor: "{colors.tag-ink}"
    rounded: "{rounded.none}"
    padding: "10px 18px"
    typography: "{typography.label}"
  button-primary-hover:
    backgroundColor: "#F1EADA"
    textColor: "{colors.tag-ink}"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.none}"
    padding: "9px 14px"
    typography: "{typography.label}"
  button-void:
    backgroundColor: "transparent"
    textColor: "{colors.seal-mark}"
    rounded: "{rounded.none}"
    padding: "5px 10px"
    typography: "{typography.label}"
  input-field:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "8px 0"
    typography: "{typography.body}"
  chip-unsealed:
    backgroundColor: "transparent"
    textColor: "{colors.ink-meta}"
    rounded: "{rounded.chip}"
    padding: "3px 7px"
    typography: "{typography.label}"
  chip-signed:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.chip}"
    padding: "3px 7px"
    typography: "{typography.label}"
  chip-sealed:
    backgroundColor: "{colors.seal-fill}"
    textColor: "{colors.tag-stock}"
    rounded: "{rounded.chip}"
    padding: "3px 7px"
    typography: "{typography.label}"
  tag-credential:
    backgroundColor: "{colors.tag-stock}"
    textColor: "{colors.tag-ink}"
    rounded: "{rounded.chip}"
    padding: "16px 18px"
    typography: "{typography.register}"
---

# Design System: LLM Team Knowledge Base — Admin

## Overview

**Creative North Star: "The Custody Bench"**

This is not a dashboard. It is the bench in an evidence room, seen under task
lighting: a dark slate working surface where the only bright objects are small
pieces of tag stock carrying accession numbers, seal states, and
initial-and-date blocks. Everything the product does is a custody operation.
An identity is a badge issued to a named holder. An API key is a sealed
credential, readable exactly once and thereafter only as a stub. Revoking is
voiding, not erasing. Authority is a seal state. The event log is the custody
line.

The system earns its character from structure and material rather than from
novelty typefaces or ornament: hairline rules instead of boxes, square corners,
tracked mono field labels, register-set numerals, and one oxide accent held in
reserve. Because the product is self-hosted and frequently runs on private
infrastructure, the type stack is deliberately network-free — no webfont
request ever leaves the host. That constraint is a feature of the world, not a
compromise against it.

Density is high and deliberate. This surface will grow to hold source
registers, review queues, revision lineage, and retrieval audits, so its
grammar is built for long tabular reading rather than for a landing
impression.

**Key Characteristics:**
- Dark slate ground; manila tag stock as the only light material
- One accent — oxide seal — spent only on sealing, voiding, and destruction
- Zero radius on structure; 2px only on applied chips and tags
- Hairline rules and ground shifts instead of cards
- Provenance always on the surface, never one click deep

## Colors

A near-monochrome slate field interrupted by two materials that mean something:
manila tag stock for anything issued or applied, and oxide seal for anything
sealed or voided.

### Primary
- **Oxide Seal** (`{colors.seal-mark}` mark, `{colors.seal-fill}` fill): the
  only chromatic color in the system. Used for `CANONICAL` seal chips, `VOID`
  and `REVOKED` marks, and destructive controls. Never used for a primary
  affirmative action, never for links, never for decoration.

### Secondary
- **Manila Tag Stock** (`{colors.tag-stock}`): the material of anything issued
  or applied to an object — credential tags, primary buttons, the wordmark
  plate. It reads as a physical label laid on the bench. Its ink is
  `{colors.tag-ink}`.

### Neutral
- **Slate Ground** (`{colors.slate-ground}`): the page field.
- **Slate Cabinet** (`{colors.slate-cabinet}`): the navigation rail, recessed
  slightly below the ground so the rail reads as the drawer face.
- **Slate Bench** (`{colors.slate-bench}`): raised working surfaces — the
  detail pane and any inspected object.
- **Slate Raised** (`{colors.slate-raised}`): row hover and the selected row.
- **Hairline / Strong Rule** (`{colors.rule-hair}` / `{colors.rule-strong}`):
  all structural separation, and the resting state of input underlines.
- **Ink / Secondary / Meta / Dormant** (`{colors.ink}`,
  `{colors.ink-secondary}`, `{colors.ink-meta}`, `{colors.ink-dormant}`): the
  text ramp. Dormant is reserved for genuinely disabled affordances and never
  carries information a user must read.

- **Mark** (`{colors.mark}`): tag stock used as *ink* rather than as ground —
  the active drawer rule and glyph, the selected row's accession, a credential
  prefix. It is a separate token from `tag-stock` precisely so the light theme
  can darken the mark to oxide-brown without darkening the tag surface, which
  is what makes the theme a swap rather than a rewrite.

### Named Rules
**The Reserved Seal Rule.** Oxide appears only where something is sealed,
voided, or about to be destroyed. If a screen shows oxide in more than two
places, one of them is decoration and must be removed.

**The Issued-Material Rule.** Manila is not a highlight color. A surface may
only be tag stock if it represents something issued, applied, or handed over —
a credential, a primary commitment, an identifying plate.

**The Two-Material Rule.** Slate and manila are the whole palette. A new hue
requires a new custody concept, not a new state.

**The Role-Is-Not-A-Seal Rule.** A holder's role (`reader`, `writer`,
`reviewer`, `admin`) is authority to act, not a seal state. Roles render as a
tracked `{colors.ink-secondary}` label and never as a chip, so all four stay
distinguishable and `admin` never spends oxide.

## Typography

**UI Font:** system stack (`ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto`)
**Register Font:** system monospace (`ui-monospace, SF Mono, Menlo, Consolas`)

**Character:** Two workhorses, no display face. The system's voice comes from
case, tracking, rule weight, and the discipline of the register column. Mono is
never a costume here: it appears only where the content is genuinely an
identifier, a hash, a timestamp, a count, or a key — the things a custody form
would have typed into a fixed field.

### Hierarchy
- **Display** (600, 26px, 1.15, -0.02em): the page title in the masthead. One
  per screen.
- **Title** (600, 15px, 1.3): object names — an identity, a source, a section
  heading inside the detail pane.
- **Body** (400, 14px, 1.55): prose, descriptions, help text. Measure capped at
  68ch.
- **Register** (400, 12.5px mono): identifiers, key prefixes, timestamps,
  counts, accession numbers.
- **Label** (600, 11px mono, 0.11em, uppercase): field labels, column heads,
  drawer labels, chip text.

### Named Rules
**The Field-Label Rule.** Tracked uppercase is a records-form field label, not
a section eyebrow. It may head a field, a column, or a drawer. It may never sit
above a page section as decoration.

**The Register Rule.** If a value could be typed into a fixed-width box on a
paper form, it is set in the register font. If it is language, it is not.

## Layout

A fixed two-part shell: a 236px cabinet rail and a fluid main column. Inside
main, a masthead strip sits above a split of a 340px index pane and a fluid
detail pane. The index lists objects; the detail holds the selected one. This
split is the durable pattern for every future workbench screen — sources,
review queue, activity — not a one-off for identities.

Spacing runs on a 4px base (`{spacing.hair}` through `{spacing.gutter}`), with
more space above a heading than below it. Rows are 1px-ruled rather than
gapped, so long registers stay scannable.

Above 860px the shell is `100dvh` with `overflow: hidden`, and the cabinet,
index and detail each scroll independently with the register's column head
sticky. A filing cabinet does not slide away while you read one folder.

Below 1080px the index and detail panes stack, index first. Below 860px the
cabinet rail collapses to a horizontal drawer strip above the masthead. The
shell never becomes a hamburger: wayfinding stays visible because the surface
is a filing system.

## Elevation & Depth

Flat by doctrine. Depth is tonal — cabinet sits below ground, bench sits above
it — and separation is always a hairline rule, never a shadow and never a box.

### Shadow Vocabulary
- **Issued lift** (`box-shadow: 0 10px 28px -6px rgba(0,0,0,0.55), 0 2px 0 rgba(0,0,0,0.4)`):
  the single shadow in the system. It exists only under a freshly issued
  credential tag, for the one moment that credential is readable.

### Named Rules
**The One Shadow Rule.** Exactly one element in this product casts a shadow:
the credential tag at the instant of issue. Anything else that appears lifted
is a bug.

## Shapes

Square by default (`{rounded.none}`) — panels, inputs, buttons, rows. The only
rounded things are applied chips and tags (`{rounded.chip}`, 2px), which read
as die-cut label stock. No pills, no capsules, no rounded cards.

Borders are 1px hairlines. A 2px rule is permitted only as a masthead underline
or a table head divider. Colored left-borders are not part of this language;
selection is expressed by ground shift and by the accession number changing to
tag stock.

## Components

### Buttons
- **Shape:** square (0px), 1px hairline where outlined.
- **Primary:** manila tag stock ground with tag ink, label typography, 10px/18px
  padding. It is the "issue / commit / sign in" action.
- **Hover / Focus:** primary lightens to `#F1EADA`; focus draws a 2px offset
  outline in `{colors.ink}`. Transitions are 120ms and report state only.
- **Quiet:** transparent with secondary ink; hover raises ground to
  `{colors.slate-raised}`.
- **Void:** transparent with oxide mark and a 1px oxide hairline. Used for
  revoke and delete. Never filled — a filled oxide button reads as an
  affirmative, and destruction is not affirmative.

### Chips (seal states)
Seal state escalates by material commitment, not by hue:
- **Unsealed** (`UNVERIFIED`): dashed hairline, meta ink, no fill.
- **Signed** (`APPROVED`): solid hairline, primary ink, no fill.
- **Sealed** (`CANONICAL`): oxide fill with tag-stock text.
- **Void** (`WITHDRAWN` / `REVOKED`): oxide mark, struck through.

### Containers
There are no cards. Regions are declared by a ground shift plus a hairline
rule, with a tracked label at the top-left of the region.

### Inputs / Fields
Underline fields, not boxes: transparent ground, a 1px `{colors.rule-strong}`
bottom rule, tracked label above. Focus thickens the underline to 2px in
`{colors.ink}`. Error adds an oxide underline and an oxide message naming the
problem and the recovery. Selects carry a drawn chevron in hairline stroke.

### Navigation
The cabinet rail is a drawer index. Groups carry tracked labels; items are
14px body with a register-set count on the right. Active items take the bench
ground plus a 1px left hairline in tag stock and an ink-weight bump. Sections
that do not exist yet render as genuinely `disabled` buttons with an uppercase
`PENDING` register mark and a visually hidden explanation — honest about what
is built rather than linking to nothing.

### Credential Tag (signature component)
The one-time key reveal. A manila plate carrying the full secret in register
type, a tracked `READ ONCE` label, a copy control, and the single shadow in the
system. Its arrival is the one authored motion in the product — a 320ms
exponential ease-out settling the tag onto the bench; everything else is a
120ms state report. Dismissing it removes the tag entirely, leaving only the
stub the database keeps.

Because the clipboard API is absent on insecure origins and the default
deployment is plain HTTP, the copy control reports only a resolved write. When
the clipboard is unavailable it says so, selects the secret, and keeps the tag
on the bench. Focus rings inside the tag switch to tag ink; the bench ink ring
is invisible on manila.

## Do's and Don'ts

### Do:
- **Do** express selection with a ground shift and an accession-number color
  change, not a colored left-border.
- **Do** set every identifier, prefix, timestamp, and count in the register
  font, and everything that is language in the UI font.
- **Do** keep destructive controls outlined in oxide and named for their
  action (`REVOKE`, `WITHDRAW`), never softened to "remove" or "clear".
- **Do** show authority, holder, and time on the object itself; provenance
  never hides behind a disclosure.
- **Do** define every color as a token pair so the light theme is a token
  swap, not a rewrite.

### Don't:
- **Don't** introduce cards, rounded panels, pastel fills, gradient buttons,
  illustrations, or celebratory empty states. The register is the interface.
- **Don't** animate anything that is not reporting a state change. There is
  one authored motion in this product.
- **Don't** spend oxide on a link, a focus ring, a chart, or an affirmative
  button.
- **Don't** load a webfont. The type stack must resolve with no network.
- **Don't** use monospace for prose, headings, or button labels that are
  language rather than data — except the tracked field label, which is a
  records-form convention and is spelled out in the Field-Label Rule.
- **Don't** link a navigation item to a route that does not exist; render it
  dormant and marked `PENDING`.
- **Don't** render a role, a count, or any non-custody value as a seal chip.
- **Don't** report a completed action the code has not confirmed — a copy, a
  void, or a load. Every destructive and asynchronous control carries its own
  pending and failure state.
- **Don't** put a synthesized timeline under a label that implies the real
  event log. The custody line is captioned as derived until the `events` table
  is reachable.
