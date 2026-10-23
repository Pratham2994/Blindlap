---
name: Blind Lap
description: An anonymous F1 qualifying lap read the way a tyre reads a track, through grip.
colors:
  rubber: "#0e0e0e"
  rubber-2: "#151515"
  rubber-3: "#1e1e1e"
  groove: "#2b2b2b"
  raised: "#3a3a3a"
  ink: "#f2f0ea"
  ink-2: "#c2bfb7"
  ink-3: "#8f8c85"
  soft: "#e8312a"
  medium: "#f5c518"
  hard: "#f2f0ea"
  inter: "#3fae49"
  wet: "#2f7fe0"
typography:
  display:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "clamp(3.4rem, 9vw, 6rem)"
    fontWeight: 850
    lineHeight: 0.92
    letterSpacing: "0.01em"
    fontVariation: "\"wdth\" 125"
  headline:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "clamp(2.2rem, 4.6vw, 4rem)"
    fontWeight: 850
    lineHeight: 0.92
    letterSpacing: "0.01em"
    fontVariation: "\"wdth\" 125"
  title:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 850
    letterSpacing: "0.02em"
    fontVariation: "\"wdth\" 125"
  code:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "0.86rem"
    fontWeight: 850
    letterSpacing: "0.02em"
    fontVariation: "\"wdth\" 125"
    fontFeature: "\"tnum\""
  body:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "1.02rem"
    fontWeight: 400
    lineHeight: 1.65
    fontVariation: "\"wdth\" 100"
  label:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "0.72rem"
    fontWeight: 650
    letterSpacing: "0.08em"
    fontVariation: "\"wdth\" 112"
  button:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "0.85rem"
    fontWeight: 800
    letterSpacing: "0.06em"
    fontVariation: "\"wdth\" 120"
rounded:
  chip: "2px"
  bar: "4px"
  square: "5px"
  row: "10px"
  panel: "22px"
  card: "26px"
  pill: "999px"
spacing:
  gutter: "clamp(16px, 2.4vw, 36px)"
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "22px"
  xl: "28px"
components:
  button:
    backgroundColor: "{colors.rubber-3}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: "16px 26px 15px"
  segmented:
    backgroundColor: "{colors.rubber}"
    rounded: "{rounded.pill}"
    padding: "3px"
  segmented-option:
    textColor: "{colors.ink-3}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "8px 12px"
  segmented-option-active:
    backgroundColor: "{colors.rubber-3}"
    textColor: "{colors.ink}"
  nav-link:
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "9px 14px"
  nav-link-current:
    backgroundColor: "{colors.rubber-3}"
    textColor: "{colors.ink}"
  lineup-panel:
    backgroundColor: "{colors.rubber-2}"
    rounded: "{rounded.panel}"
    padding: "14px 10px 10px"
  lineup-row:
    backgroundColor: "{colors.rubber-2}"
    textColor: "{colors.ink}"
    typography: "{typography.code}"
    rounded: "{rounded.row}"
    height: "34px"
    padding: "0 8px"
  lineup-row-pick:
    textColor: "{colors.medium}"
  reveal-card:
    backgroundColor: "{colors.rubber}"
    rounded: "{rounded.card}"
    padding: "30px 32px 28px"
  tag:
    backgroundColor: "{colors.rubber-3}"
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "7px 12px 6px"
  tag-win:
    backgroundColor: "{colors.inter}"
    textColor: "#04140a"
  evidence-line:
    backgroundColor: "{colors.rubber}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "14px 20px"
    height: "56px"
  dna-panel:
    backgroundColor: "{colors.rubber}"
    rounded: "{rounded.panel}"
    padding: "22px"
---

# Design System: Blind Lap

## Overview

**Creative North Star: "The Moulded Sidewall"**

Blind Lap is set in vulcanised rubber. The ground is matte black with fine concentric grooves, the lettering is raised from it as if moulded by the same press, and one raking light picks out the relief. Every hue on the page is a tyre compound band, and each band has one job. The world reads the lap the way a tyre reads a track: through grip, not through broadcast chrome.

The density is instrument-like. The 3D track is full-bleed and carries the story; the UI sits on it as rubber pieces pressed into or lifted out of the surface: a sidewall gauge bleeding off the bottom-left, a line-up of embossed rows down the right edge, a pill-shaped evidence line along the bottom. Reading pages (How it works) keep the same rubber, with a faint radial groove pattern behind a single 70ch column.

The confirmed rejection is the broadcast look: team-colour glass panels and chyrons on blue-black. Team colour exists only as a thin chip beside a driver code.

**Key Characteristics:**
- Rubber-black ground, warm off-white ink, no surface hue.
- Five compound hues, one meaning each.
- Archivo variable with the width axis doing the hierarchy work: extended caps for anything moulded, normal width for reading.
- Depth through emboss, deboss and lift, never through glass or blur panels.
- State shown as a mark (ring, notch, half-filled disc) before it is shown as a colour.

## Colors

A rubber-and-chalk neutral ladder carrying five compound bands, each band a single meaning.

### Primary
- **Soft Red** (soft): the model's pick. The leading bar in the line-up, the model's choice in the duel replay, and the start lights (real start lights are red; this is the world's own device).

### Secondary
- **Medium Yellow** (medium): your pick. The ring and code colour of the row you chose, the bold code in the line-up hint, and by extension anything that is your own input: the focus outline and the text selection.

### Tertiary
- **Inter Green** (inter): correct. The truth row ring after the reveal, the "right" verdict tag, a right square in the daily grid, the duel gap when you are ahead.
- **Wet Blue** (wet): braking. Only in the lap: brake segments of the rubber line in WebGL and the brake arc inside the tyre gauge.
- **Hard White** (hard): data. Same value as ink, but named for its role in the instruments: full-throttle segments of the rubber line, the lap progress band and throttle arc on the gauge, the reference car in the duel, chart fills.

### Neutral
- **Rubber** (rubber): page ground and translucent panel bases (at 72 to 97% opacity over the 3D scene). The 3D sky and fog are a neutral haze one step lighter, so the far circuit fades out rather than cutting off.
- **Rubber Two** (rubber-2): the line-up panel and its rows, the radio strip.
- **Rubber Three** (rubber-3): raised pieces at rest: buttons, active segments, tags, bar tracks.
- **Groove** (groove): one-pixel rules in captions, tables, pipeline lists and tells; the reading-mode top bar underline.
- **Raised** (raised): the centre tick on DNA axis tracks and unlit disc rims.
- **Ink** (ink): primary text and numbers.
- **Ink Two** (ink-2): secondary text, ledes, team lines, caption body.
- **Ink Three** (ink-3): labels, meta, inactive segments, figcaptions, partial-throttle and idle bars.

### Named Rules
**The One Compound, One Job Rule.** Each compound hue means one thing everywhere: soft = the model's pick, medium = your pick, hard = data, inter = correct, wet = braking. A new surface that needs a sixth meaning uses ink and a mark, not a new hue or a borrowed one.

**The Team Chip Rule.** Team colour appears only as a small chip (4px wide by 14 to 16px tall in the UI, a 36 by 8 bar on DNA discs) beside a driver code. It never fills a panel, a bar, a button or text.

## Typography

**Display Font:** Archivo Variable (with Archivo, system-ui)
**Body Font:** Archivo Variable at normal width
**Label/Mono Font:** Archivo Variable at width 112; a system monospace stack appears only for inline code in prose.

**Character:** One family stretched across its width axis. Extended, heavy caps read as letters moulded into a sidewall; normal-width text reads as the printed spec sheet beside it.

### Hierarchy
- **Display** (850, wdth 125, clamp(3.4rem, 9vw, 6rem) on the title, 0.92 line-height, uppercase, embossed): the title, page heads (Driver DNA, How it knows) and the circuit name in the HUD, sized per context with clamps between 2.4rem and 6rem.
- **Headline** (850, wdth 125, clamp(2.2rem, 4.6vw, 4rem), uppercase): the driver name on the reveal card, the DNA panel code (2rem), Daily five.
- **Title** (850, wdth 125, 1.25rem, uppercase): section heads in reading pages. The evidence corner label uses 900 at 1.1rem with a 2px underline.
- **Code** (850, wdth 125, 0.86rem, tabular): three-letter driver codes in rows, captions and the duel bar; also big numbers (gauge speed 900 at 64px, gear 30px).
- **Body** (400, wdth 100, 1.02rem, 1.65 line-height, max 70ch): reading pages. Ledes run 1.02 to 1.2rem at 1.5 line-height, max 44ch.
- **Label** (650, wdth 112, 0.72rem, 0.08em, uppercase): panel labels, meta under headings, team lines, stats labels, table heads.

### Named Rules
**The Width Is Rank Rule.** Hierarchy rides the width axis as much as the size: wdth 125 for anything moulded (display, codes, numbers), 112 to 120 for labels and buttons, 100 for sentences. Never set reading text extended or headings at normal width.

**The Tabular Numbers Rule.** Every changing number (percentages, lap times, counts, speed) is set tabular so the line-up and gauge do not jitter while they update.

## Layout

The 3D scene is fixed full-bleed behind everything; UI pieces are absolutely placed against a fluid gutter (clamp(16px, 2.4vw, 36px)). The top bar is transparent over the scene and turns solid rubber with a groove underline on reading pages. In play: session name top-left, view and sound controls top-right, the line-up panel down the right edge (min(300px, 34vw)), the tyre gauge bleeding off the bottom-left (clamp(300px, 34vw, 440px)), the evidence line between them at the bottom. The reveal card replaces the gauge and evidence on the left, vertically centred, while the line-up stays.

Line-up rows are 34px and shrink to a 24px floor so all 20 drivers fit without scrolling. Reading pages are one centred column (max 70ch) with 64px above each section head.

At 860px and below the line-up moves to a 210px strip above the evidence line, the gauge shrinks to 230px and moves up, the evidence line becomes an 18px-radius block, the reveal card spans both gutters and scrolls, and the title scrim turns from a left-to-right to a bottom-up gradient. At 520px and below the controls drop under the wordmark, the gauge goes to 190px, the line-up hides after the reveal, and the duel bar and radio strip wrap into rounded blocks.

## Elevation & Depth

Depth is moulded, not floated. Three tokens carry all of it: emboss on raised lettering, deboss on wells pressed into the rubber, and lift on the one piece that is active or pressable. Panels over the scene are translucent rubber (no backdrop blur), debossed into the surface. The WebGL world matches: the ground is a 4096px sidewall texture with concentric moulding grooves, two raised rims and arc-set lettering, rendered as colour plus bump map (bumpScale 6, roughness 0.92, metalness 0) under a single warm directional key light. The track is a 3 m asphalt strip floating 10 m above it, so its shadow draws the circuit on the sidewall. The car is a low-poly F1 shape in hard white (the duel rival in soft red) with rubber wheels carrying a painted band, so the spin reads; read corners send out a hard-white pulse ring.

### Shadow Vocabulary
- **Emboss** (`text-shadow: 0 -1px 0 rgba(0,0,0,0.9), 0 1px 0 rgba(255,255,255,0.07)`): display type, the wordmark and driver codes, as if raised under a raking light.
- **Deboss** (`box-shadow: inset 0 1px 2px rgba(0,0,0,0.85), inset 0 -1px 0 rgba(255,255,255,0.05)`): wells and tracks: nav and segmented housings, the line-up, evidence line, DNA panel, bar tracks, unlit start lights, a pressed button.
- **Lift** (`box-shadow: 0 6px 18px -6px rgba(0,0,0,0.8), 0 1px 0 rgba(255,255,255,0.04) inset`): raised pieces: buttons at rest, the active segment and current nav link, the start-light housing; combined with deboss on the reveal card.

### Named Rules
**The Pressed Into Rubber Rule.** Containers are wells (deboss); the thing you can press or the option that is on is the raised piece inside them (lift). Pressing a button swaps lift for deboss.

## Shapes

Soft, moulded corners. Controls, tags, the evidence line and the duel bar are full pills (999px); panels are 22px and the reveal card 26px; rows 10px; bars and chips 2 to 4px; daily squares 5px. Circles appear where the world is circular: the tyre gauge, start lights, radio play button, DNA wheel-nut discs. Rules are one-pixel groove lines, never boxes.

## Components

### Buttons
Raised rubber slugs with extended caps.
- **Shape:** full pill (999px).
- **Default:** rubber-3 fill, ink text, button type (800, wdth 120, 0.85rem, 0.06em caps), lift shadow, 16px icon at a 12px gap.
- **Hover / Active:** rises 1px and lightens slightly; on press drops 1px and swaps lift for deboss; transform on the out-curve over 0.25s.
- **Disabled:** 45% opacity, no movement.
- **Primary (as shipped):** the "Start" and "Next lap" action is filled soft red. This overlaps the model's hue; see Do's and Don'ts.

### Segmented controls and navigation
A debossed pill housing (rubber at 72 to 78% opacity, 3 to 4px padding) holding label-type options in ink-3 (ink-2 in nav). The selected option is a lifted rubber-3 pill in ink. Used for playback speed, camera (with 15px authored icons) and the main nav. On play the nav hides; on reading pages the top bar becomes solid.

### Line-up rows (signature)
The model's grid: 20 buttons stacked absolutely, each a 4px team chip, an embossed code, a debossed 8px bar track and a tabular percentage. Bars are ink-3; the leader's bar is soft. Your pick gets a 1.5px medium inset ring, a 12% medium wash and a medium code. After the reveal the true driver gets the same ring in inter. Rows re-sort by translating on the out-curve (0.26s), higher-ranked rows passing over lower ones; bar widths ease over 0.6s.

### Tyre gauge (signature)
An SVG sidewall bleeding off the bottom-left: shaded rubber disc, groove rings, raised lettering on an arc, corner ticks around the rim (taken corners get ink labels), the lap progress band in hard white, throttle arc in hard white and brake arc in wet, speed (900, 64px) and gear (30px) set inside.

### Evidence line
A debossed pill along the bottom: the corner label (900, wdth 125, underlined 2px), the evidence sentence in ink, and "points to" with driver codes in label type. It flashes a 2px ink-3 ring for 0.9s when new evidence lands.

### Reveal card with ruled caption
A 26px rubber card (90% opacity) with lift plus deboss, rising 24px and un-blurring over 0.9s. Verdict tags (pill, label type; inter fill for right, a half-filled ink disc for teammate, ink-3 text for wrong), the driver name as headline with a team chip line, stats in label-over-value pairs, then the caption: a groove-ruled list, one row per piece of evidence, a 48px code column and the sentence in ink-2. The team radio strip is a debossed pill with a round ink play button and a 36-bar waveform.

### Duel bar
A centred debossed pill at the bottom: small car swatches (22 by 8, hard for your lap, soft for the rival), codes in display weight, and a large gap figure that turns inter when you are ahead.

### Daily grid
A borderless table ruled with groove lines: label-type heads, ink-2 cells, codes and totals in display weight, 18px rounded squares for results (inter right, half ink and half rubber for a teammate, debossed rubber-3 wrong).

### DNA panel
A debossed 22px panel over a 3D field of wheel-nut discs (rubber disc, moulded rim lit ink when selected, raised code, team chip). Style axes are debossed tracks with a raised centre tick and an ink fill that slides on the out-curve; tells are a groove-ruled list.

### How charts
Reading-page bars: label column, a 12px rubber-3 track with an ink fill and a 2px soft line marking chance, a tabular value; the headline rows are 18px tall with 900-weight values. The confusion matrix is drawn to canvas in rubber and ink-3.

### Start lights
Five circles in a lifted rubber housing, unlit as debossed dark-red discs, lit in soft with a glow, one every 700ms.

### Motion
One curve, cubic-bezier(0.16, 1, 0.3, 1), for every movement: row re-sort (0.26s), bars and axes (0.6s), HUD exit on reveal (0.8s, fade and 24px drop), reveal rise (0.9s, 24px and 6px blur), evidence flash (0.9s). Colour changes run 0.2 to 0.3s. Under reduced motion every CSS animation and transition collapses to 0.01ms, and the title orbit and the DNA field stop turning on their own.

## Do's and Don'ts

### Do:
- **Do** keep every hue on the page to the five compounds plus team chips, each compound in its one job.
- **Do** set anything moulded (display, codes, big numbers) at wdth 125 with the emboss shadow, and reading text at wdth 100.
- **Do** put panels in as debossed wells and lift only the active or pressable piece.
- **Do** show state with a mark first (ring, notch under a corner number, half-filled disc), then colour.
- **Do** rule lists and tables with one-pixel groove lines.
- **Do** use the single out-curve (cubic-bezier(0.16, 1, 0.3, 1)) for movement and set changing numbers tabular.

### Don't:
- **Don't** use team-colour glass panels, chyrons or a blue-black broadcast ground.
- **Don't** use team colour anywhere except a small chip beside a driver code.
- **Don't** introduce a sixth hue or lend a compound a second meaning; new soft-red actions in particular extend a known overlap.
- **Don't** use backdrop blur or frosted glass for panels; use translucent rubber with deboss.
- **Don't** set long text in extended width or in uppercase.
