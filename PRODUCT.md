# Product

<!-- impeccable:product-schema 1 -->

> Inferred from the owner's brief on 2026-10-23. The owner was asleep and told the builder to proceed
> without questions; facts marked *(inferred)* were not confirmed.

## Platform

web

## Stack

Delegated: Python pipeline (OpenF1 data, scikit-learn) that exports static JSON, and a Vite + TypeScript +
Three.js front end with Web Audio. No UI framework. Static hosting so it can live next to the owner's
portfolio at prathampanchal.dev *(inferred)*.

## Users

- F1 fans who think they can tell drivers apart, playing a short round in the browser *(inferred)*.
- Recruiters and engineers visiting the owner's portfolio, who decide in under a minute whether the
  project shows real backend, data and ML depth *(owner said: resume-worthy, AI/ML or backend)*.

## Product Purpose

BLIND LAP replays a real, anonymous 2025 qualifying lap from telemetry and asks "who is driving?".
A model reads how the car attacks every corner and makes its guess live; the player guesses too. The
reveal plays the driver's real team radio. Success: a visitor plays one round, understands the model is
reading driving style rather than cheating, and wants a second round.

## Positioning

The guess is made from driving style alone: braking points, apex speed, throttle pickup and coasting,
each scored against the whole field at the same corner in the same session. The model that guesses a
lap at a circuit never trained on that circuit. No neighbouring F1 replay tool identifies the driver.

## Operating Context

Played on a desktop browser with sound on, in one sitting of a few minutes. Shared as a portfolio link.

## Capabilities and Constraints

- Data: OpenF1 public API (2025 qualifying, car data ~3.7 Hz, position ~4 Hz, team radio MP3s) and
  MultiViewer circuit corner maps. FastF1's live-timing source returns 401 as of this build.
- Sampling is coarse (about 20 m between samples at top speed), so per-corner numbers are noisy; the
  product must say so rather than overclaim.
- Model accuracy is what leave-one-session-out evaluation measures. It must be shown honestly next to
  chance.
- Engine sound is synthesised from telemetry; no recorded engine audio is used.

## Brand Commitments

Name: BLIND LAP. The owner's portfolio voice is short, dry and specific ("Most of my code exists because
a tool almost did what I needed").

## Evidence on Hand

Real telemetry, positions, corner maps and team radio for 24 qualifying sessions of 2025. Model
metrics come from `pipeline/model_out/report.json`. No testimonials, users or press exist; never invent them.
Driver and team names are real; F1 and team logos are not used.

## Product Principles

1. Prove it, don't claim it: every model guess shows the corner evidence behind it.
2. Honest numbers: accuracy next to chance, and the hard cases (teammates) shown, not hidden.
3. The lap is the hero: real data drives everything on screen and in the speakers.
4. One round should take about two minutes and end with a reveal worth waiting for.

## Accessibility & Inclusion

Sound is a core part of the experience but nothing depends on hearing it: every audio cue has a visual
counterpart, and audio can be muted. Respect reduced-motion.
