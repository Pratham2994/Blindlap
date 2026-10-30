---
name: Blind Lap
description: A race poster you can play. Paper, heavy ink type, one F1-red block, team colours as flat fields.
colors:
  paper: "#f1f0ec"
  paper-2: "#e6e4de"
  paper-3: "#d9d6cf"
  ink: "#111111"
  ink-2: "#3a3936"
  ink-3: "#5f5d58"
  red: "#e10600"
  red-deep: "#b00500"
  yellow: "#f5c518"
  green: "#11803d"
typography:
  display:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "min(13cqi, 7.6rem) on the home hero; clamp(2.6rem, 6vw, 5.6rem) on page heads"
    fontWeight: 900
    lineHeight: 0.9
    letterSpacing: "-0.01em"
    fontVariation: "\"wdth\" 125"
  headline:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "clamp(2rem, 3.6vw, 3.6rem)"
    fontWeight: 900
    lineHeight: 0.9
    fontVariation: "\"wdth\" 125"
  numeral:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "clamp(2.6rem, 5vw, 4.6rem)"
    fontWeight: 900
    lineHeight: 0.85
    fontVariation: "\"wdth\" 125"
    fontFeature: "\"tnum\""
  code:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "0.86rem"
    fontWeight: 900
    fontVariation: "\"wdth\" 125"
  body:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "1.02rem"
    fontWeight: 400
    lineHeight: 1.65
    fontVariation: "\"wdth\" 100"
  label:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "0.72rem"
    fontWeight: 700
    letterSpacing: "0.07em"
    fontVariation: "\"wdth\" 112"
  button:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "0.82rem"
    fontWeight: 850
    letterSpacing: "0.05em"
    fontVariation: "\"wdth\" 118"
rounded:
  everything: "0"
  light: "50%"
spacing:
  gutter: "clamp(16px, 2.6vw, 40px)"
  rule: "3px"
  hair: "1px"
components:
  button:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    border: "3px solid {colors.ink}"
    typography: "{typography.button}"
    padding: "13px 20px 12px"
  button-primary:
    backgroundColor: "{colors.red}"
    textColor: "#ffffff"
  segmented:
    border: "3px solid {colors.ink}"
    backgroundColor: "{colors.paper}"
  segmented-option-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  nav-link-current:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  lineup-row:
    height: "var(--row), 30px max"
    typography: "{typography.code}"
  lineup-row-pick:
    backgroundColor: "{colors.yellow}"
  lineup-row-truth:
    border: "3px inset {colors.green}"
  who-block:
    backgroundColor: "team colour"
    textColor: "ink or paper by luminance"
---

# Design System: Blind Lap

## Overview

**Creative North Star: "The Race Poster"**

Blind Lap is a race poster you can play. The ground is light paper. Type is heavy black ink, set wide and in capitals. F1 red is the one brand block: the hero, the wordmark and the primary action. Team colour appears only where a named driver owns it: as a large flat field on the reveal, or as a chip beside a driver code. The 3D circuit is a framed picture on the poster, never a full-bleed backdrop that UI floats over.

This replaced a first world (matte black tyre rubber, moulded lettering, five compound hues). The owner rejected it as bland and confusing to move through. The poster world fixes both: every page has a visible top bar, every lap has a "Menu" button in its top-left corner, and the home page is a hub of four ways to play.

**Key Characteristics:**
- Paper ground, ink type, one red block. No gradients, no shadows, no glass, no rounded corners.
- 3px ink rules divide the page into panels. 1px paper-3 hairlines divide rows inside a panel.
- Archivo variable: width 125 and weight 900 for anything that is a name or a number, width 100 for sentences.
- The 3D scene is light too: paper ground with a printed grid and the circuit name, red and white barriers and kerbs, an ink car that takes the team colour at the reveal. The car has a small red rear light that glows while the real brake channel is on (red is braking here, as on the meter); its glow grows with distance so the braking point reads from above.

## Colors

### Brand
- **Red** (#e10600): the hero block, the wordmark, the primary button ("Start a lap", "Next lap", "Copy result"), the leading bar in the model's grid, the braking meter, lit start lights, red ticks on the lap rule for corners read, the red marker for chance on charts, the second driver in the lab.
- **Red Deep** (#b00500): reserved for a pressed red surface.

### Signals
- **Yellow** (#f5c518): your own input. The row you picked, the bold code in the grid hint, the pause banner and the active pause button, text selection.
- **Green** (#11803d): correct. The true driver's ring after the reveal, "right" verdict tags and model-table marks, the duel gap when you are ahead.

### Neutrals
- **Paper** (#f1f0ec): page ground, panels, buttons at rest.
- **Paper Two** (#e6e4de): the stage frame behind the canvas, hover fills, bar tracks.
- **Paper Three** (#d9d6cf): hairlines, empty bar tracks in rows, a wrong square.
- **Ink** (#111111): text, rules, active segments, the current nav link, the quick-lap tile, data fills.
- **Ink Two** (#3a3936): body text in reading pages, ledes, idle bars.
- **Ink Three** (#5f5d58): labels, meta, figcaptions.

### Surroundings and time of day
Each circuit's real surroundings come from OpenStreetMap (see docs/HANDOFF.md section 7), in natural colour (the owner found a near-grey first version colourless). Buildings use their mapped wall and roof colours where the map has them (about 2% of buildings), else a typical colour for the type, varied per building: warm renders and brick for houses with terracotta or slate roofs, pale stone and glass for offices, grey steel for sheds; grandstands are a dark structure with red seating seen from above. Trees vary in green from tree to tree. Water (#6fa8c7), woods (#7fa865), parks (#a9c98a), tarmac run-off (#7c7b78), gravel traps (#d9c89c) and a base verge along the track (grass #9cc07a, or pavement #b9b6af at street circuits) are printed into the ground. Grandstands are raked grey decks facing the track, filled with spectators in a mix of shirt colours, with the circuit name faintly over them. In the dark theme and at night the same colours are dimmed, not removed. Night races (from the real session time) get the dark sky and floodlight masts whatever the page theme; a race at sunset gets a warm horizon.

### Dark theme
The same poster printed in negative, chosen with the Dark/Light button in the top bar (remembered) or by the system setting. Paper becomes #121212 (paper-2 #1c1c1b, paper-3 #34332f), ink becomes #f1f0ec (ink-2 #c9c7c1, ink-3 #9a978f), green lifts to #2fb062 for contrast. Red, yellow and team colours do not change; text on yellow stays #111 in both themes (`--on-signal`). Ink blocks invert with the tokens, so the active nav link and Quick lap tile become light blocks. The 3D scene follows: a near-black sky and fog, a dark printed ground, paper-coloured corner labels, and a paper car while the driver is hidden.

### Named Rules
**The Owned Colour Rule.** Team colour is shown only where a named driver owns it: the reveal's who-block (full field, with text in ink or paper chosen by luminance), the 6px chip beside a code, the car after the reveal, the duel car swatches, DNA disc chips. Never on a button, a chart or body text.

**The One Red Rule.** Red is the brand and the primary action. A second red meaning (the model's lead bar, braking) is allowed because both are "the strongest signal right now"; anything else that wants attention uses ink.

## Typography

One family across its width axis.

- **Display** (900, wdth 125, uppercase, 0.9 line-height): "Who's driving?", page heads, the circuit name in the play bar, mode tiles. The hero size is a container query (13cqi, max 7.6rem) so "DRIVING?" always fits one line in its red block at any width.
- **Headline** (900, wdth 125): the driver's name on the reveal, hyphenated when a surname is longer than the block (HULKEN-BERG).
- **Numeral** (900, wdth 125, tabular): speed (up to 4.6rem), gear, the duel gap, home facts.
- **Code** (900, wdth 125): three-letter driver codes.
- **Body** (400, wdth 100, 1.65 line-height): reading pages, max 76ch.
- **Label** (700, wdth 112, 0.72rem, 0.07em tracking, uppercase): meta, table heads, captions on frames.
- **Button** (850, wdth 118, 0.82rem, uppercase).

**The Width Is Rank Rule.** Names and numbers are wide, sentences are normal width. Never set a sentence wide or in capitals.

## Layout

A sticky 60px top bar on every page except a lap: red wordmark left, nav right, the current page as an ink block. Under 860px the nav folds into a "Menu" button that opens a full-width sheet.

**Home.** A two-column hero framed in a 3px rule: red block with the title, lede and "Start a lap" on the left; a framed orbiting circuit on the right with a caption tab. Under it, three mode tiles in one row (Quick lap in ink, Teammates, Pick a circuit with a select), then a facts strip with the real held-out accuracy. The reading pages (DNA, Lab, How) are reached from the top bar only, so nothing on the page repeats the navigation.

**Play.** A fixed full-viewport grid: play bar across the top (Menu, circuit and year, mode, score, pause, speed, camera, sound), the framed 3D stage on the left, the model's grid in a right column (260 to 330px), and a band under the stage with the telemetry (speed, gear, throttle and brake meters, a lap rule with a tick per corner) and the evidence line. On the reveal the band becomes three panels (who, facts, why) plus an action row, and the stage shrinks. On a phone the play view becomes one scrolling column: bar, stage, band, then the grid.

**Reading pages** (DNA, Lab, How): a two-column page head (huge title, lede), then content. DNA is a framed 3D field beside a panel. Lab and How are a centred column.

## Elevation & Depth

None in the UI. Depth is the 3D picture inside the frame. Separation is done with 3px ink rules and flat fills.

## Shapes

Square everywhere. Circles appear only where the real thing is round: start lights.

## Components

### Buttons
3px ink border, paper fill, button type. Hover inverts to ink. Primary is red with white text, hover ink. On the red hero the button is paper with no visible border. Ghost buttons have a transparent border until hover.

### Segmented controls
A 3px-bordered strip; options are divided by 3px rules; the active option is an ink block with paper text. Used for speed, camera and the model switch (Boosted trees / Random forest / Logistic), which works during the lap and after the reveal.

### Model's grid (signature)
Rows stacked absolutely and re-sorted by transform (0.26s, out-curve): a 6px team chip, the code, an 8px bar (ink-2, the leader red), a tabular percentage. Your pick is a yellow row. After the reveal the true driver gets a 3px green inset ring and a green code.

### Telemetry band
Huge speed numeral with km/h, gear, two 12px meters (throttle ink, brake red) in 2px ink borders, and a lap rule: a 14px bordered bar that fills ink with the lap, with a tick above for every corner that turns red once read.

### Lap bar and volume
The lap rule doubles as a slider: a transparent range input over it, with a 6px red handle, and small bordered −5 s / +5 s buttons beside the clock (disabled until the lights go out). Volume is a 90px range input in a 3px-bordered box beside the Sound button, accent ink.

### Track map
A 2px-bordered paper card (86% opaque) in the top-right corner of the stage, 110 to 210 px wide (92 to 96 px on phones), as tall as the circuit's shape needs. Track in ink over a paper casing, the driven part red, corner marks paper with an ink rim that fill red once read, the car a red dot with a paper ring; in the duel both dots take their team colours. It is the one piece of UI besides the lights and the pause banner allowed over the scene, because broadcasts always show it.

### Evidence line
An ink tag with the corner ("T7"), the sentence, and "points to" codes. The tag flashes red when new evidence lands.

### Reveal band (signature)
The who-block floods with the team colour from the left (clip-path, 0.7s): verdict tags, the name as a headline, team, lap and time, career line. Facts: the model's rank and confidence, then a table of how each of the three models ranked the driver (green "Right" where it was first). Why: the three corners that pointed hardest at the driver, the team radio strip (ink play square, waveform) and the auto caption line. Each of the three corners has a small bordered "Replay" button (ink on hover) that drives that corner again from the chase camera at half speed. Actions: Next lap (red), Race it against X, X's driver DNA, Watch the whole session, Copy challenge link. (No Menu button here: the top bar has it.)

### The model's call
Above the grid, a paper-2 note with a 4px left rule: the call in bold ("Not sure", "Leaning", "Fairly sure", "Very sure") and the driver (three codes when it is not sure), then in small ink-3 how often calls that sure were right. The rule is ink-3 when unsure, ink when leaning, red when sure. On the reveal the model's verdict tag carries its percentage, and a plain line under the rank says the same in words.

### Hint ladder
Under the model's grid: "Hints · small to big" and what a right guess is still worth. Six bordered buttons in two rows of three, from a nudge to nearly the answer (Result, Career, Style, More laps, Team, Number), each with its cost in small ink-3 figures and a red bar along its bottom edge that grows with how much it gives away. A taken hint turns yellow and its text joins a list with a yellow left rule. In a column narrower than 330px the costs go into the tooltip; the bars stay.

### What's real
An info button in the play bar opens a paper card with a 3px rule over the lower left of the stage: a note on a paper-2 panel with a red left rule (what is the car's data, what is drawn), the keyboard keys in ink-3 caps, and "Got it". The same note sits on the first lap's rules card and on the home page under How to play.

### Teammate battles
A two-column grid (one on phones) of team cards: a 10px top rule in the team colour, the team in ink-3 caps, the two codes set wide and heavy with the tally between them, an ink split bar for the first driver's share, the median gap sentence, and one 14px bordered square per session (filled ink when the first driver was ahead) that opens a blind lap there. Mid-season pairings follow smaller, under a hairline. Under each pairing, a "How they drive differently" disclosure (a 18px bordered +/− box): seven trait rows whose red bar grows from an ink centre line toward the driver who did more of it (first driver to the left, as in the score), the sessions it held in, then the clearest corners as linked lines under hairlines.

### Which is which
The play layout and bar of a normal lap (five cameras, drag to look around, What's real, sound, the seekable lap bar) with two cars on one racing line: the plain car (ink swatch) and the red car (red swatch) as a 45% see-through ghost, each laying its own thin rubber mark on its side of the line. The side column asks "Which car is …?" as a headline, two big bordered pick buttons (yellow when chosen, a green ring on the right one after), then "How the cars run" with its key (a two-option strip: Together at each corner / As driven; under it the live distance between the cars on track as a heavy numeral, then a one-line note) and "Camera on" (Plain / Red), then the model's read as a split bar (an ink field with a red bar scaled from the right) with its call note. The band shows both cars' speed, gear and pedals, the lap bar (ink fill for the plain car, a 4px red mark for the red one, the real gap in its head) and the evidence line: the corner both cars just left and how they took it differently, in words. The reveal puts the two drivers side by side, each flooding in its team colour; each of the three corners that told them apart has a Replay button that drives both cars through it again, level, at half speed.

### Duel bar
Car swatches in team colours with ink borders, codes, a huge gap numeral (green when ahead), where the gap was measured, and "Back to result".

### DNA
A framed 3D field of paper roundels with an ink rim (heavier when selected), the code in ink and a team chip, on range rings. The panel lists seven axes as bars from a centre line, the tells, closest matches and a jump select. Team moves: cards with an 8px team-colour top rule, the code set heavy and the move in ink-3 caps, seven axes where the red bar is what happened and a paper ring with an ink rim is the guess made before, then three short "miss" bars (the best one ink and bold). Any driver, any car: two selects and the same axes, with the driver as really driven as a grey tick.

### Lab
Three bordered selects, an SVG chart on white in a 3px frame: driver A solid ink, driver B dashed red, braking as ink and red marks under the trace.

### Motion
One curve, cubic-bezier(0.16, 1, 0.3, 1): row re-sort 0.26s, bars 0.5s, reveal flood 0.7s, evidence flash 0.8s. Under reduced motion all CSS motion collapses to 0.01ms.

## Do's and Don'ts

### Do:
- **Do** frame the 3D stage with a 3px rule and caption it with a paper tab.
- **Do** give every lap screen a "Menu" exit in the top-left corner and every page the top bar.
- **Do** set names and numbers wide and heavy, sentences at normal width.
- **Do** use team colour as a whole field when a driver is named.

### Don't:
- **Don't** use shadows, gradients, glass, blur or rounded corners.
- **Don't** float UI over a full-bleed scene; the scene sits in a frame.
- **Don't** use team colour on buttons, charts or text.
- **Don't** add a third signal colour; use ink and a mark.
