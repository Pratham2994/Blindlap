// The seven style traits (pipeline/dna.py TRAITS) in plain words, for tooltips and keys.
export const TRAIT_HELP: Record<string, string> = {
  "Late braking": "Starts braking closer to the corner",
  "Short braking": "Spends less distance on the brakes",
  "Apex speed": "Carries more speed through the slowest point",
  "Early throttle": "Gets back to full throttle sooner after the apex",
  "Low coasting": "Less time off both pedals before the apex",
  Commitment: "Lifts less in fast corners",
  "Throttle snap": "Opens the throttle quickly rather than squeezing it",
};

/** "Late braking" with its meaning as a tooltip. */
export const traitLabel = (k: string) => `<span title="${TRAIT_HELP[k] ?? k}">${k}</span>`;
