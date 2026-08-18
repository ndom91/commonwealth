---
name: Commonwealth — Admin
description: An evidence-custody bench for knowledge an AI agent is allowed to trust.
colors:
  slate-ground: "#0A0A0A"
  slate-cabinet: "#0F0F0F"
  slate-bench: "#151515"
  slate-raised: "#282828"
  row-hover: "#1B1B1B"
  rule-hair: "#2A2A2A"
  rule-strong: "#646464"
  ink: "#EDEDED"
  ink-secondary: "#A6A6A6"
  ink-meta: "#919191"
  ink-dormant: "#5C5C5C"
  tag-stock: "#E3DAC6"
  tag-stock-edge: "#CFC3A9"
  tag-ink: "#1A1815"
  tag-ink-secondary: "#4A453C"
  mark: "#E3DAC6"
  seal-mark: "#F6713B"
  seal-fill: "#9A3414"
colors-light:
  slate-ground: "#FFFFFF"
  slate-cabinet: "#FAFAFA"
  slate-bench: "#FFFFFF"
  slate-raised: "#E4E4E4"
  row-hover: "#F4F4F4"
  rule-hair: "#DBDBDB"
  rule-strong: "#909090"
  ink: "#0F0F0F"
  ink-secondary: "#555555"
  ink-meta: "#666666"
  ink-dormant: "#A0A0A0"
  tag-stock: "#B9A882"
  tag-stock-edge: "#8F8161"
  mark: "#7A2E14"
  seal-mark: "#A23410"
  seal-fill: "#9A3414"
typography:
  hero:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "38px"
    fontWeight: 600
    lineHeight: 1.12
    letterSpacing: "-0.025em"
  display:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "32px"
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
  register-value:
    fontFamily: "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "normal"
  plate:
    fontFamily: "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "26px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.12em"
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
  gutter: "64px"
components:
  button-primary:
    backgroundColor: "{colors.tag-stock}"
    textColor: "{colors.tag-ink}"
    rounded: "{rounded.none}"
    padding: "9px 18px"
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
    padding: "9px 12px"
    typography: "{typography.label}"
  button-row:
    backgroundColor: "transparent"
    textColor: "{colors.ink-secondary}"
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
  chip-suspended:
    backgroundColor: "transparent"
    textColor: "{colors.seal-mark}"
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

# Design System: Commonwealth — Admin

## Overview

**Creative North Star: "The Custody Bench"**

This is not a dashboard. It is the bench in an evidence room, seen under task
lighting: a neutral near-black working surface where the only bright objects are small
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
- Neutral near-black ground; manila tag stock as the only light material
- One accent — oxide seal — spent only on sealing, voiding, and destruction
- Zero radius on structure; 2px only on applied chips and tags
- Hairline rules and ground shifts instead of cards
- Provenance always on the surface, never one click deep

## Colors

A neutral greyscale field interrupted by two materials that mean something:
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
- **Slate Cabinet** (`{colors.slate-cabinet}`): the navigation rail, set a hair
  off the ground so the rail reads as the drawer face. In the dark scheme that
  means a shade lighter; in the light scheme, a shade darker — white is a
  ceiling, so the offset flips rather than the metaphor.
- **Slate Bench** (`{colors.slate-bench}`): raised working surfaces — the
  detail pane and any inspected object.
- **Slate Raised** (`{colors.slate-raised}`): **the current state** — a selected
  register row, the active drawer, the authority already in force, the tag chip
  and the tooltip. It used to be the *hover* value while selection borrowed
  `slate-bench`, which put hover above selection in weight and, once the grounds
  were compressed, left a selected row at 1.08:1 in the dark and 1.00:1 in the
  light. The pane's ground and the selected row's ground are two jobs, and they
  came apart under a flat palette.
- **Row Hover** (`{colors.row-hover}`): row and drawer hover, and nothing else.
  It sits deliberately *under* Slate Raised so a hovered row never outweighs the
  open one. Small targets — buttons, icon buttons — keep Slate Raised on hover,
  because a control the size of a word needs a definite answer.
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
**The Quiet Structure Rule.** *Supersedes the Amplitude Rule, which stood from the
first correction until this one. The history is kept because the failure it fixed
is real and easy to walk back into.*

This system carries *all* structure on hairline rules and tonal ground shifts, so
the page acquires its shape from those two mechanisms and nothing else. There are
two ways to make that work, and this system has now shipped both.

The first was **amplitude**: push every rule until it is audible. It was a
correction to values that had shipped at the bottom of their range — rules at
1.38:1, input underlines at 1.82:1, a selected row at 1.084:1, nothing structural
above 1.65:1 — which read as a flat dark field with text on it. Amplitude fixed
that and cost something for it: rules at 3.74:1 in a blue-teal slate put a
permanent grid of lines over every page, and on a surface whose subject is quiet
records the loudest object was the ruling.

The second, in force now, is **space**. Structural hairlines fall back to 1.38:1
— the value the first version shipped and the correction rejected — and the
gutter goes to 64px to carry what they no longer carry. This is not a
reversal, because **the two halves are one decision**. A 1.38:1 rule inside a
40px gutter is the original failure. A 1.38:1 rule inside a 64px gutter is a
well-set page. Anyone tightening the gutter must put the amplitude back.

Floors that survive, and are still measured rather than chosen by eye:

| what | floor | why |
|---|---|---|
| `rule-strong` under an input | **3:1** | fields are transparent with no box, so the rule *is* the affordance — WCAG 1.4.11. This is the one rule that does not get to be quiet, and the reason it is a separate token from `rule-hair`. Relaxed from a self-imposed 4.5:1 to the actual requirement; `#646464` / `#939393` are the quietest greys clearing it. |
| any ink that carries language, on any ground including a selected row | **4.5:1** | `.label` alone appears 76 times |
| `slate-raised` against the ground it sits on | perceptible, and **above `row-hover`** | selection is the one interaction index-and-bench is built around, and it now carries more than it used to because the divider crossing a selected row has gone faint. 1.34:1 dark / 1.27:1 light, with hover held at 1.15:1 / 1.10:1 beneath it. Solved jointly with `ink-meta`, which has to clear AA *on* it. |
| `rule-hair` against any ground | **none** | it is decoration once space is doing the separating, and WCAG asks nothing of it |

**The hue is gone.** The grounds and rules are neutral greys, not slate. The old
rules carried 33–43 points of channel spread, which is what made the surface read
as a themed panel rather than as a working ground. Manila and oxide keep their
warmth and are now the only hues on the page, which is what the Two-Material Rule
always wanted and the slate cast was quietly working against.

**The Applied-Edge Rule.** Every manila surface carries a 1px `tag-stock-edge`,
in both themes. Tag stock is *applied to* the bench rather than part of it, and
an edge is what says so. On the dark ground the fill alone carried that at
13.1:1; on a light ground manila is 2.34:1 and needs the die-cut line to read as
a label at all. It is applied to both themes so the palette stays a symmetrical
swap rather than growing a light-only exception.

**The Reserved Seal Rule.** Oxide appears only where something is sealed,
voided, or about to be destroyed. If a screen shows oxide in more than two
places, one of them is decoration and must be removed. The source bench broke
this by stating a source's authority as a chip twice — beside the title and again
in the authority row — which put three oxide elements on a canonical source. The
second chip is gone; the bench head states the seal, and the control set marks
the option already in force.

**The Silent Default Rule.** A register marks only what departs from the
ordinary. `approved` + `active` is the common case and takes no chip, because a
mark every row carries has stopped carrying information: a healthy workspace
showed ten identical `APPROVED` outlines out of thirteen rows, out-shouting the
one `CANONICAL` a reader needed to find. Sealed, unverified, withdrawn, stale and
failed still mark themselves, and the absence of a mark is legible precisely
because everything else is not. Authority is still stated in full on the bench.

**The Issued-Material Rule.** Manila is not a highlight color. A surface may
only be tag stock if it represents something issued, applied, or handed over —
a credential, a primary commitment, an identifying plate.

**The Two-Material Rule.** Slate and manila are the whole palette. A new hue
requires a new custody concept, not a new state.

**The Role-Is-Not-A-Seal Rule.** A holder's role (`reader`, `writer`,
`reviewer`, `admin`) is authority to act, not a seal state. Roles render as a
tracked `{colors.ink-secondary}` label and never as a chip, so all four stay
distinguishable and `admin` never spends oxide.

**The Untrusted-Body Rule.** Source content is submitted by agents and this
surface can revoke credentials. Bodies render as preformatted text on a
recessed ground, never parsed to HTML — Markdown structure stays visible as
literal `#` and backticks. The block carries a caption saying so, because a
reader who does not know it is unrendered will read the syntax as a mistake.
Rendering it later needs a sanitiser and a deliberate decision, not a default.

## Themes

Both schemes ship. Dark is the bench as designed and is what the product is named
for; light is the same bench under daylight, and is a full peer rather than a
courtesy.

**One declaration per colour.** Every token is
`light-dark(light, dark)` in a single `:root` block, resolved by the used
`color-scheme`. The palette previously existed in three hand-synced copies — dark
in `:root`, light in a `prefers-color-scheme` block, light again under
`[data-theme="light"]` — which is how the light theme came to have a manila that
had stopped being a material without anyone noticing. This costs a browser floor:
`light-dark()` needs Chrome 123, Safari 17.5, or Firefox 120, so every engine from
2024 onward.

**Three states, two of them pinned.** No `data-theme` attribute means the
operating system decides, which is `color-scheme: light dark` doing its job.
`[data-theme="light"]` and `[data-theme="dark"]` pin a scheme. The rail's toggle
writes the pin.

**The pin arrives before the paint.** A server-set, `httpOnly` cookie is read
during SSR and put on `<html>`, so a pinned scheme is already correct in the first
frame. The alternative — `localStorage` and a blocking inline script — renders the
wrong scheme and corrects itself visibly, and would be the only thing in the
product needing a script-src exception. Nothing on the client needs to read the
cookie, because the scheme in force is on the document already.

**Light is not dark with the values flipped.** Two things genuinely differ. Manila
darkens to `#B9A882`, because at the original value it was 1.23:1 against a light
ground and read as a faintly beige rectangle rather than a physical label. And the
mark darkens to oxide-brown while tag stock does not, which is the reason `mark`
was ever a separate token from `tag-stock`.

**Light went white.** It was a grey theme — a `#E8E9E6` ground with `#F4F5F2`
benches — which is a different room from the dark bench rather than the same one
under daylight. Ground and bench are now both `#FFFFFF`, the rail `#FAFAFA`, and
the panes are told apart by their rules and their gutters exactly as they are in
the dark. The one place the two schemes still differ in *structure* is that light
has no tonal separation left to spend, which is fine: the dark side barely does
either, at 1.09:1 from ground to bench.

## Typography

**UI Font:** system stack (`ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto`)
**Register Font:** system monospace (`ui-monospace, SF Mono, Menlo, Consolas`)

**Character:** Two workhorses, no display face. The system's voice comes from
case, tracking, rule weight, and the discipline of the register column. Mono is
never a costume here: it appears only where the content is genuinely an
identifier, a hash, a timestamp, a count, or a key — the things a custody form
would have typed into a fixed field.

### Hierarchy
- **Hero** (600, 38px, 1.12, -0.025em): the name of the object on the bench. One
  per screen at most, and only when a specific thing is open.
- **Display** (600, 32px, 1.15, -0.02em): the page title in the masthead. One
  per screen. Moved up from 26px when the gutter went to 64px — at the wider
  measure a 26px title no longer held the top of the page.
- **Title** (600, 15px, 1.3): object names in a register row, and section
  headings inside the detail pane.
- **Body** (400, 14px, 1.55): prose, descriptions, help text. Measure capped at
  68ch.
- **Register** (400, 12.5px mono): identifiers, key prefixes, timestamps,
  counts, accession numbers.
- **Register value** (400, 15px mono): a register figure that *is* the content of
  its pane rather than a field inside a row of prose. Used only in the bench's
  standing, where at 12.5px the figures read quieter than the sentence
  introducing them. Not a hero metric — still smaller than any heading.
- **Label** (600, 11px mono, 0.11em, uppercase): field labels, column heads,
  drawer labels, chip text.
- **Plate** (600, 26px mono, 0.12em, uppercase): the product name on manila at the
  threshold, and nowhere else. Register face at a heading size because the wordmark
  on a filing label is stamped, not set. It held 26px when Display moved to 32:
  tracked mono grows about 19px per character per rung, and at 32px the plate
  overruns a 320px viewport. It is the one rung that answers to a measure rather
  than to the ramp.

### Named Rules
**The Field-Label Rule.** Tracked uppercase is a records-form field label, not
a section eyebrow. It may head a field, a column, or a drawer. It may never sit
above a page section as decoration.

**The Register Rule.** If a value could be typed into a fixed-width box on a
paper form, it is set in the register font. If it is language, it is not.

**The Object Outranks Its Route.** Where a bench and a masthead are on screen
together, the largest type names the *thing*, not the section it lives in. The
bench title was 22px against a 26px masthead, so on a source bench the word
"Sources" was larger than the name of the source — the most generic word on the
page was the biggest thing on it, and with nothing above 26px anywhere the eye had
no focal point at all. The masthead keeps Display, because on a register-only
page like Activity the route name *is* the subject.

The margin is thinner than it was. Display moved to 32px against Hero's 38px, so
the rule holds on six points rather than sixteen — deliberate, because on Sources
and Activity the masthead *is* the page's title and was reading as a caption at
26px. **Hero moves first if Display moves again**, and it may not go below 38px
while a bench and a masthead can share a screen.

That 22px was also off this ramp, invented because there was no step between 15
and 26. A missing rung gets filled by whoever needs it next; the ramp now runs
11 / 12.5 / 13 / 14 / 15 / 26 / 32 / 38 — where 26 survives only as the
threshold Plate, which answers to a viewport measure rather than to this ramp.

## Layout

A fixed two-part shell: a 236px cabinet rail and a fluid main column. Inside
main, a masthead strip sits above a split of a 420px index pane and a fluid
detail pane. The index lists objects; the detail holds the selected one. This
split is the durable pattern for every future workbench screen — sources,
review queue, activity — not a one-off for identities.

Spacing runs on a 4px base (`{spacing.hair}` through `{spacing.gutter}`), with
more space above a heading than below it. Rows are 1px-ruled rather than
gapped, so long registers stay scannable.

**The 64px gutter is structural, not generous.** Every main-column edge runs on
`{spacing.gutter}`, and it is what separates the page now that the rules have
gone quiet — see the Quiet Structure Rule. Tightening it without restoring rule
contrast returns the surface to a flat field. Inside the index pane the
equivalent inset is `{spacing.section}`: register rows, the filter bar, the
search field and the column head all share it, so the column has one edge rather
than four.

Above 860px the shell is `100dvh` with `overflow: hidden`, and the cabinet,
index and detail each scroll independently with the register's column head
sticky. A filing cabinet does not slide away while you read one folder.

Below 1300px the gutter steps back to `{spacing.section}` while the panes stay
side by side. The rail and the register take 656px before the bench begins, so
at ~1100px two 64px gutters left it barely 300px and its title wrapped mid-word.
The wide gutter exists to substitute for rule contrast; at this width there is
no space to substitute with, and taking it from the shortest pane is the wrong
trade.

Below 1080px the index and detail panes stack, index first — and the register
gives up its own tighter inset there, because stacked it is no longer a narrow
column beside a wide one. Below 860px the
cabinet rail collapses to a horizontal drawer strip above the masthead. The
shell never becomes a hamburger: wayfinding stays visible because the surface
is a filing system.

## Elevation & Depth

Flat by doctrine, and flatter since the grounds were compressed: the whole
distance from ground to bench is 1.09:1 in the dark scheme and nothing at all in
the light one, where both are white. What tone remains only orders the surfaces —
it does not separate them. **Separation is the gutter first and a hairline
second**, never a shadow and never a box.

### Shadow Vocabulary
- **Issued lift** (`box-shadow: 0 10px 28px -6px rgba(0,0,0,0.55), 0 2px 0 rgba(0,0,0,0.4)`):
  the single shadow in the system. It exists only under a freshly issued
  credential tag, for the one moment that credential is readable.

  The second component is a hard, unblurred `0 2px 0` — the thickness of the card
  stock where it meets the bench, not a glow. **It is sized to a credential tag
  and does not survive being borrowed.** The tooltip wore this lift for a while,
  and at 24px tall the card-stock edge stopped reading as thickness and started
  reading as a bottom border four times the weight of the other three sides. That
  it was borrowable at all was the bug; a tooltip casting the issue shadow was a
  second shadow in a system that permits one.

### Named Rules
**The One Shadow Rule.** Exactly one element in this product casts a shadow:
the credential tag at the instant of issue. Anything else that appears lifted
is a bug.

## Shapes

Square by default (`{rounded.none}`) — panels, inputs, buttons, rows. The only
rounded things are applied chips and tags (`{rounded.chip}`, 2px), which read
as die-cut label stock. No pills, no capsules, no rounded cards.

Borders are 1px hairlines, the masthead underline included. A doubled-weight
rule reads at this density as two stacked hairlines rather than as emphasis, so
hierarchy comes from ground and spacing and never from thickening a rule. Two
boundaries meeting must resolve to one line: where a closing rule and an
opening rule coincide, the lower element drops its own. **There is no structural
exception.** The sign-in form used to hold one — a 2px opening rule, on the
argument that it stood on a bare page with no register grammar around it to set
its scale. The threshold has register grammar now, so the argument expired and the
rule went with it. 2px means focus and nothing else: the field underline and the
focus ring. Colored left-borders are not part of this language; selection is
expressed by ground shift and by the accession number changing to tag stock.

## Components

### Buttons
- **Shape:** square (0px), 1px hairline where outlined.
- **Height:** every variant shares one block padding (9px). Variants change
  colour and horizontal padding only, so any two controls sitting side by side
  are the same height without per-pair correction.
- **Row variant:** `btn--sm` (5px block) is the one exception, for controls
  inside a register row. It applies to every control in that row, never to one
  of a pair.
- **Primary:** manila tag stock ground with tag ink, label typography, 10px/18px
  padding. It is the "issue / commit / sign in" action.
- **Hover / Focus:** primary lightens to `#F1EADA`; focus draws a 2px offset
  outline in `{colors.ink}`. Transitions are 120ms and report state only.
- **Quiet:** transparent with secondary ink; hover raises ground to
  `{colors.slate-raised}`.
- **Void:** transparent with oxide mark and a 1px oxide hairline. Used for
  revoke and delete. Never filled — a filled oxide button reads as an
  affirmative, and destruction is not affirmative.
- **Current:** the option already in force inside a set of mutually exclusive
  actions — the authority a source already carries. Raised ground with the mark
  as ink and a neutral border, reusing the ground-shift-plus-mark pair the
  register already uses for a selected row and the active drawer.

  It is deliberately **not** `btn--primary:disabled`: that pair means a primary
  action mid-flight and carries `cursor: progress`, which would claim work is
  happening. Nor is it outlined in the mark, because in the light theme the mark
  is oxide-brown and an oxide-outlined control beside Withdraw would put two of
  them in one row and blunt the Reserved Seal Rule.

**A button is a button however it is implemented.** Several of these are `<a>`
rather than `<button>` because they navigate — *New source*, *Issue identity*,
the invite's *Sign in*, the rail's *Account*. The class kills the anchor
underline, so the two cannot be told apart by eye. The omission hid for a long
time precisely because it was invisible on the majority of controls: a
`<button>` has no underline to lose, so only the handful that navigate showed
one, and a primary button with an underlined label sat beside identical buttons
without one.

**Actions are verbs; chips are states.** The authority controls read *Unverify*,
*Approve*, *Mark canonical* — what a person would be doing — while the chip
beside the title reads *APPROVED*. Labelling the controls with the state names
made a row of three buttons look like a status display, and hid the fact that a
human is the one who decides.

### Chips (seal states)
Seal state escalates by material commitment, not by hue:
- **Unsealed** (`UNVERIFIED`): dashed hairline, meta ink, no fill.
- **Signed** (`APPROVED`, `TRUSTED`, `CURRENT`): solid hairline, primary ink,
  no fill.
- **Sealed** (`CANONICAL`): oxide fill with tag-stock text.
- **Suspended** (`DISABLED`, `STALE`): oxide outline, no fill, no strike —
  withdrawn from service but intact. It is the one seal state that can be
  reversed.
- **Void** (`WITHDRAWN` / `REVOKED`): oxide mark, struck through.

A source's authority maps onto these with no new states: `unverified →
unsealed`, `approved → signed`, `canonical → sealed`. Withdrawn and stale
override the authority chip in list views, because a reader scanning the
register needs the reason a row cannot be trusted before its rank.

### Tags
Source tags are the smallest register object: uppercase register type on
`{colors.slate-raised}` inside a hairline box, in a wrapping row under the
bench head. They are labels an agent applied, not states the product assigns,
so they take no seal material — no oxide, no tag stock.

### Filter bar
Underline selects above the register, each with its tracked label. Filters live
in the URL, not component state: a filtered register is a thing people send each
other, and the review queue hands off into it. The bar sits at the top of the
index pane and closes with a hairline, so it reads as a property of the
register rather than of the page.

Authority, type and status share a row of equal columns — their values are
fixed words of known length. **Submitted by** takes a full row of its own: its
values are holder names, and four equal columns in a 340px register would
truncate every one of them to a few characters. A filter you cannot read is not
a filter.

### Section tabs
A section with more than one face carries them in a row directly beneath the
masthead, sharing its gutter and closing with a hairline — the same
construction as the filter bar, so the row reads as a property of the section
rather than as a strip of page chrome. The masthead drops its own bottom rule
when tabs follow it: one hairline for the pair.

The active tab takes a 2px bottom edge in tag stock and an ink-weight bump.
This is not a new treatment — it is the rail's active drawer rotated, the same
form the drawers themselves take at the narrow breakpoint. The inactive weight
is reserved with `text-shadow`, so the row does not shift as you move along it.

Links, not an ARIA `tablist`: tabs are routes here. They are in history, Back
moves between them, and one can be pasted to a colleague.

**A tabbed section holds its frame still.** The masthead and tab row keep the
gutter across every tab, including one that splits into a register and a bench.
Identities is the only Settings tab that does, and letting it align its title to
its register — which is what an untabbed split page like Sources does — moved the
whole column 32px as the reader moved along a row of three tabs. Tabs are a set:
what changes when you click one should be the content, not the frame around it.
The register keeps its own tighter inset underneath, so on that page a
gutter-inset title sits above an inset column. That is the smaller error, and a
static one rather than one that only appears in motion.

A tab whose page is a register carries that register's size, set in register face
at the rail count's weight. This does not compete with the rail: a register's
size is stated once, in the navigation that owns it, and for People and
Identities that navigation *is* this row. A tab whose page is not a register —
the Workspace tab — carries nothing.

An unknown count is **omitted, not dashed**, here and in the rail alike: a label
reading *People —* invites the reader to wonder what the dash says about the
register, when in fact it says something about the database.

### Source body
The recessed content block: `{colors.slate-ground}` inside a hairline box,
register type, `pre-wrap`. See the Untrusted-Body Rule — this block is never
rendered HTML, and its caption says so in plain words.

### Review queue
Two named groups, not one list: **Never verified** and **Changed since
verification**. Each carries a count in its head and one sentence of
consequence saying what the group means for agents right now. The groups are
separate because they are different failures — nobody has looked, versus
somebody looked and then the text moved underneath them.

### Icon button
A 30px square control for rows where a worded button would crowd out the field
beside it. No fill, glyph in `{colors.ink-meta}`; the `void` tone spends an oxide
outline and never a fill, exactly as `btn--void` does.

**Its box is `{colors.rule-strong}`, not the hairline** — the one place besides
the input underline where a rule is an affordance rather than decoration. With no
fill and no word, the border is the entire statement that a control is there, so
it answers to WCAG 1.4.11's 3:1 like a field does. It rode the hairline for as
long as the hairline was loud, and followed it down to 1.38:1 when structure went
quiet, which is the wrong direction for the only edge a reader has to find.

The glyph then came down a step to `{colors.ink-meta}` to match: it is a graphic,
not language, and with the frame no longer shouting there was nothing for it to
shout over. At body-ink weight on a white rail it was the heaviest object in the
corner of the page, beside hairlines a fifth of its weight.

The label is never dropped — it moves to `aria-label` and `title`, so the
control still names itself to a screen reader and on hover. Icon-only is
reserved for actions a conventional glyph carries on its own. A magnifier is
unambiguous; *withdraw* is not, and keeps its word.

### Keyword search
A single underline field above the register with its own tracked label, an
icon-button submit, and an icon-button Clear that appears only while a query is
live. The browser's own `type=search` clear is suppressed: the row already has
a Clear that resets the URL too, and offering both invites the one that only
empties the field.

A query **narrows** the filtered register rather than replacing it. The filter
bar stays visible and stays applied: "everything this agent submitted, about
deployments" is one question, not two, and hiding the filters would force it to
be asked in two steps with the second done by eye.

Two ways to match, because they fail in opposite directions. **Titles match by
substring** — full-text search only matches whole stemmed words, so typing
`escala` would otherwise miss *Support escalation ladder* entirely, and a
half-remembered title is the commonest way anyone searches a register.
**Bodies match by keyword**, ranked by term proximity. A title hit outranks any
body hit: naming the thing you want is a stronger signal than mentioning it.

Body results carry an excerpt in register type with matched terms marked in
`{colors.mark}` — tag stock as ink, because a match is a mark on the record and
not something issued. The excerpt arrives with terms delimited by control
characters and is split into React children, so the highlight is real without
any body text being parsed as HTML.

No standing caption explains the matching. What matched is visible in the
results — a highlighted excerpt for a body hit, the title itself for a title
hit — and a paragraph of explanation over every search reads as apology rather
than help. That admin search is lexical while agents retrieve by meaning is
recorded here and in the code, not restated on screen.

### Custody line
A single hairline rail down the left with a square tick at each entry, one row
per moment, newest first. The rail belongs to the list rather than to each row:
drawn per row it was broken by the gap between rows, which read as unrelated
ticks rather than as one unbroken chain — the opposite of what the component is
for. Rows are separated by their own block padding so the rail stays continuous.

Only immutable moments belong on it. A mutable column such as `last_used_at`
would make the line rewrite itself every time an agent presented a key, so it
lives on the credential stub instead.

### Activity log
The workspace-wide custody line: one ruled row per event, newest first, in four
columns — when, what, which source, who. Event types are rendered as the
sentence a person would say ("Voided a credential"), with an unmapped type
falling back to its raw name so a new writer shows up legibly without a code
change. One line of detail rides in the *what* column and nothing more; the
benches have room for the rest.

**The Attribution Rule.** Every row names an actor or says it cannot. Agents
carry their holder name, people their email, and rows written before events
recorded a person read `unattributed` in dormant italic. They
are shown rather than hidden or backfilled — the log is append-only, and a
gap in the record is itself part of the record.

### The bench's standing
What the bench holds while nothing is selected. `IN CUSTODY` over a
`{colors.rule-strong}` rule, then one sentence of consequence, then ruled rows of
tracked label and Register value: canonical, never vouched for, changed since
vouched, withdrawn, passages indexed, last vouched for, last retrieved.

It exists because the resting state of the surface where the recurring job
happens was 48% of the viewport holding a twelve-word instruction to click
something. It is not a dashboard, and the distinction is load-bearing: no tiles,
no figure set large enough to be a hero, no chart, no sparkline, and no
reassurance invented to fill the space. A custody form's rows.

**No count here may be one the rail already carries.** The register's own size is
stated once, in the navigation that owns it, and the review queue's total is
stated on its drawer — so the standing splits that total into its two populations
instead, which is the thing the rail cannot say.

The consequence sentence is present only when something is genuinely owed a
human, and it uses the review queue's own two descriptions because they are the
same two populations. When nothing is owed it says so in `{colors.ink-secondary}`
and stops.

### Containers
There are no cards. Regions are declared by a ground shift plus a hairline
rule, with a tracked label at the top-left of the region.

A ground shift stops reading as a region and starts reading as a box the moment
all four of its edges are visible at once — so a region either fills its
container or runs off an edge of the viewport. Nothing floats.

### Inputs / Fields
Underline fields, not boxes: transparent ground, a 1px `{colors.rule-strong}`
bottom rule, tracked label above. Focus thickens the underline to 2px in
`{colors.ink}`. Error adds an oxide underline and an oxide message naming the
problem and the recovery. Selects carry a drawn chevron in hairline stroke.

### The threshold (sign-in)
The one surface where nothing is being operated, and the only place most people
meet this world — an invited teammate arrives from a link with no idea what is
behind it. So it states the world by *being the shape of the product*: cabinet
ground on the left, bench ground on the right, one hairline between them, both
full height, at the same width where the cabinet and the bench split. Signing in
walks into a room the reader has already been looking at.

Left is the corpus half: `INTAKE` at the region's top-left, the Plate on manila,
one sentence of orientation, then two ruled label-and-body rows for the two
recurring jobs the product is built around — credentialing and curating. Right is
the form, capped at 360px and centred in its own half so it does not hug the
dividing rule.

**Nothing here describes this instance.** Counts, names and corpus size are not
knowable before authentication and are nobody's business until then, so the
threshold speaks only about what the product is. No illustration, no gradient, no
claim the product cannot keep.

Expression is freer here than anywhere else in Operate, and the licence is
specific: this is a threshold, not a register, so the Plate is allowed Display
size where every other register value is capped at 15px. It buys exactly one
thing — manila at a size that reads as applied material rather than as a caption.

### Navigation
The **plate** at the head of the rail names the corpus you are in and is how
you leave it: a `<details>` disclosure listing the other workspaces you belong
to, or a plain plate when there is nowhere to go.

It carries a **group mark on its right edge and a *Switch workspace* label on
hover**, and only in the disclosure form — a mark on the plain plate would
promise a menu that opens onto a list of one. Both exist because the plate
otherwise gave no sign it was pressable, and a reader had to stumble onto the
switcher to learn it was there; on a surface where every count and every register
below is scoped to the corpus named on that plate, discovering the switcher by
accident is discovering too late that you were reading the wrong one. The mark is
Lucide rather than a drawn drawer mark, for the reason Account and the scheme
toggle are: the hand-drawn grammar belongs to the drawers, and the plate is
chrome. It is not a disclosure triangle and does not rotate — it names
*workspaces* rather than announcing a menu, which is what the Shapes doctrine
objects to.

The label **describes rather than names.** The plate's accessible name stays the
workspace itself, and *Switch workspace* arrives as `aria-describedby` on top of
it. This is the opposite treatment from `Hint`, which serves icon-only controls
where the tooltip merely repeats the `aria-label` and is therefore hidden from
the accessibility tree. Replacing the name with an `aria-label` here would break
Label in Name (WCAG 2.5.3): someone driving the page by voice says the words they
can see, and the words they can see are the workspace's.

It switches and nothing else —
creating a workspace lives in Settings, which has a drawer. A disclosure has no
Escape and no outside-click; that is survivable here because the panel displaces
nothing and covers nothing, and it is the trade a floating menu could not make.

The cabinet rail is a drawer index. Groups carry tracked labels; items are
14px body with a register-set count on the right. Active items take the bench
ground plus a 1px left hairline in tag stock and an ink-weight bump. Sections
that do not exist yet render as genuinely `disabled` buttons with an uppercase
`PENDING` register mark and a visually hidden explanation — honest about what
is built rather than linking to nothing. **No section is dormant today**; every
drawer routes somewhere, so that branch is currently unexercised and kept only
as the pattern for the next unbuilt section.

**The rail is cut to the holder's role.** Every member sees the Workspace group
because anyone may start a project. A reader sees its *Start workspace* entry;
a writer also sees their own Identities; the full Settings entry appears at
`admin`. Review queue appears at `reviewer`. Omitted, not
disabled — a `PENDING` mark says *nobody can open this yet*, which is a
different sentence from *this is not yours to open*, and showing a drawer that
answers with a refusal tells someone about a job they do not have on every
screen. Absence is the quieter and more accurate statement.

Archiving is reversible custody, not destruction. It removes a workspace from
the switcher and rejects its browser and MCP access while retaining its sources,
index, identities, keys and memberships. The unscoped archive register is the
recovery door: administrators can restore a project there even when it was their
last active workspace.

Each drawer carries a hand-drawn mark in the world's own grammar — a filing tab
for Sources, a dashed seal for the review queue, an issued tag for Identities, a
**countersigned tag** for People (the same tag with a signature struck across
it: these are the holders who sign for others rather than the ones issued to),
a **cabinet front** for Settings (the case and its drawer pulls: Settings
configures the thing that holds the drawers rather than indexing one), and a
custody line for Activity. Six marks, no borrowed icon set. The Lucide glyphs in
the chrome sit by the signed-in name — Account, and the scheme toggle — where the
vocabulary is deliberately not the drawer one.

The **scheme toggle** is a sun or a moon naming the bench it would bring, beside
Account for the same reason Account is there: both are preferences of the person,
not sections of the corpus. It is two states rather than three, because a two-glyph
control cannot legibly express a third, and "follow the operating system" is
reachable by clearing the cookie rather than by a position on the button. Which
scheme is in force can only be answered by the browser when nothing is pinned, so
the glyph resolves in an effect; a reader on a light OS who has never pinned
anything sees the shipped default's glyph for one frame. Deciding it in CSS would
fix the icon and not the accessible name, and a control that misnames itself is
worse than one whose icon settles.

Identities and People are tabs of Settings and nothing else. They were briefly
both — drawers in an Access group *and* tabs — and two ways into one page reads
as indecision rather than convenience: the same two words appeared twice on
screen a few inches apart, and either one landed you somewhere that already
showed both. The rail indexes the corpus and the custody line; who may act on
them is administration, and administration has one door.

**A register's size is stated exactly once, in the navigation that owns it.**
For Sources and the review queue that is the rail. For People and Identities it
is the Settings tab bar, which took the counts with it when the drawers went —
so the rule survived the move instead of being quietly dropped. The Workspace
tab carries no number, because it is not a register.

A register never repeats its own count in a head above itself: the number is
already in the navigation a few inches away, and a head carrying nothing but a
number it duplicates is a row of chrome between the reader and the rows. This is
why People has no head — its *Invite* sits in the masthead, where Identities
already keeps *Issue identity*, and both registers begin immediately.

The rail precedes page content in the DOM on every route, so a **skip link** is
the first focusable element: hidden by the same clip as `.sr-only` until it
takes focus, then tag stock at the top-left. It targets the page's `<main>`,
which carries `tabindex="-1"` so following the link moves focus rather than
only scrolling. A skip link that scrolls without moving focus looks correct and
does nothing.

### Credential Tag (signature component)
The one-time key reveal. A manila plate carrying the full secret in register
type, a tracked `READ ONCE` label, a copy control, and the single shadow in the
system. Its arrival is the one authored motion in the product — a 320ms
exponential ease-out settling the tag onto the bench; everything else is a
120ms state report. Dismissing it removes the tag entirely, leaving only the
stub the database keeps.

The motion is a descent, not a fade: the tag travels 18px, settles from 98.5%,
and its shadow contracts from wide-and-soft to tight as it meets the surface —
the same physics the One Shadow Rule already licenses for this element, animated
rather than static. It was a 6px translate, which is to say it was technically an
animation and nobody would ever have seen it. A product with exactly one dramatic
moment can afford that moment to land.

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
- **Do** define every color as a single `light-dark(light, dark)` declaration, so
  a change of palette is one edit and the two themes cannot drift apart.
- **Do** distinguish reversible suspension from destruction: an outlined oxide
  chip for disabled, a struck one for voided.
- **Do** let a control's size follow where it sits — head controls at the
  default size, register-row controls at `btn--sm` — never which variant it
  happens to use.

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
  event log. The holder bench's line is assembled from credential timestamps,
  so it says so and links to the Activity log, which is the real thing.
