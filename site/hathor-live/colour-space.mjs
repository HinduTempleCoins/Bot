// site/hathor-live/colour-space.mjs — sRGB into perceptually-meaningful spaces, and back.
//
// WHY THIS FILE EXISTS AT ALL. The grapheme–colour consistency score is a DISTANCE between the
// colours one person picked for the same letter on three separate trials. Distance in RGB is the
// easy thing to compute and the wrong thing to compute: the RGB cube is perceptually
// non-uniform, so the same numeric gap means a large perceived difference in one region and a
// negligible one in another, and a scoring function built on it misclassifies people.
//
// Rothen, Seth, Witzel & Ward (2013), "Diagnosing synaesthesia with online colour pickers:
// maximising sensitivity and specificity", J Neurosci Methods 215(1):156–160, compared RGB, HSV,
// CIELUV and CIELAB with city-block and Euclidean metrics precisely because this matters.
//
// ⚠ WHAT THIS MODULE DELIBERATELY DOES NOT CONTAIN. Rothen et al.'s space-specific cut-offs are not
// hard-coded here, because they have not been read off the paper in this build and inventing a
// threshold is worse than having none. The exam reports the score and cites the landmark's
// provenance; it never prints a verdict, so it does not need a cut-off to function. If someone
// reads the paper, the number goes in exam-grapheme.mjs § THRESHOLDS with the page reference —
// not here, and not from memory.
//
// Everything is pure, offline, and never throws. Out-of-range input is clamped, because a clamped
// colour is a real colour and a thrown exception in a scoring loop loses the whole sitting.

const clamp = (n, lo, hi) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo);
const clamp255 = (n) => clamp(Math.round(Number(n)), 0, 255);

/** CIE standard illuminant D65, the sRGB white point, normalised to Y = 1. */
export const D65 = Object.freeze({ X: 0.95047, Y: 1, Z: 1.08883 });

/** Parse '#rrggbb' or '#rgb' into [r,g,b] 0–255. Anything unparseable is black, never a throw. */
export function hexToRgb(hex) {
  const h = String(hex == null ? '' : hex).trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) {
    return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)];
  }
  if (/^[0-9a-f]{6}$/i.test(h)) {
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  return [0, 0, 0];
}

export function rgbToHex(rgb) {
  const [r, g, b] = (Array.isArray(rgb) ? rgb : [0, 0, 0]).map(clamp255);
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

/** Undo the sRGB transfer function. NOT gamma 2.2 — sRGB has a linear segment near black. */
export function srgbToLinear(channel) {
  const c = clamp(Number(channel), 0, 255) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** sRGB (0–255) to CIE XYZ, D65, Y in 0–1. The standard sRGB matrix. */
export function rgbToXyz(rgb) {
  const [r, g, b] = (Array.isArray(rgb) ? rgb : [0, 0, 0]).map(srgbToLinear);
  return {
    X: 0.4124564 * r + 0.3575761 * g + 0.1804375 * b,
    Y: 0.2126729 * r + 0.7151522 * g + 0.0721750 * b,
    Z: 0.0193339 * r + 0.1191920 * g + 0.9503041 * b,
  };
}

// CIE L* companding, with the linear segment below the (6/29)^3 knee.
const KNEE = (6 / 29) ** 3;
const f = (t) => (t > KNEE ? Math.cbrt(t) : t / (3 * (6 / 29) ** 2) + 4 / 29);

/** L* alone — shared by CIELAB and CIELUV, which agree exactly on lightness. */
export function lightness(Y) {
  return 116 * f(clamp(Y, 0, 1e6) / D65.Y) - 16;
}

export function rgbToLab(rgb) {
  const { X, Y, Z } = rgbToXyz(rgb);
  const fx = f(X / D65.X);
  const fy = f(Y / D65.Y);
  const fz = f(Z / D65.Z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

// The D65 white point in u'v' chromaticity, computed rather than typed so it cannot drift from D65.
const DEN_N = D65.X + 15 * D65.Y + 3 * D65.Z;
const UN = (4 * D65.X) / DEN_N;
const VN = (9 * D65.Y) / DEN_N;

export function rgbToLuv(rgb) {
  const { X, Y, Z } = rgbToXyz(rgb);
  const L = lightness(Y);
  const den = X + 15 * Y + 3 * Z;
  // Black has no chromaticity. Placing it at the white point makes u = v = 0 there, which is the
  // conventional definition and keeps the distance metric finite instead of NaN.
  const up = den > 0 ? (4 * X) / den : UN;
  const vp = den > 0 ? (9 * Y) / den : VN;
  return { L, u: 13 * L * (up - UN), v: 13 * L * (vp - VN) };
}

const dist = (...pairs) => Math.sqrt(pairs.reduce((n, [p, q]) => n + (p - q) ** 2, 0));

/** Euclidean distance in CIELAB — the 1976 ΔE*ab. */
export function deltaLab(c1, c2) {
  const a = rgbToLab(c1);
  const b = rgbToLab(c2);
  return dist([a.L, b.L], [a.a, b.a], [a.b, b.b]);
}

/** Euclidean distance in CIELUV. */
export function deltaLuv(c1, c2) {
  const a = rgbToLuv(c1);
  const b = rgbToLuv(c2);
  return dist([a.L, b.L], [a.u, b.u], [a.v, b.v]);
}

/**
 * Euclidean distance in RGB with each channel scaled 0–1.
 *
 * Present ONLY so the Synesthesia Battery's published 1.0 landmark stays readable against a score
 * computed the way that landmark was computed. It is not the primary metric and must never be
 * described as the better one.
 */
export function deltaRgbUnit(c1, c2) {
  const a = (Array.isArray(c1) ? c1 : [0, 0, 0]).map((n) => clamp255(n) / 255);
  const b = (Array.isArray(c2) ? c2 : [0, 0, 0]).map((n) => clamp255(n) / 255);
  return dist([a[0], b[0]], [a[1], b[1]], [a[2], b[2]]);
}

/** The maximum possible unit-RGB distance, √3 — black to white. Useful for describing the range. */
export const MAX_RGB_UNIT_DISTANCE = Math.sqrt(3);

export default {
  D65, hexToRgb, rgbToHex, srgbToLinear, rgbToXyz, rgbToLab, rgbToLuv, lightness,
  deltaLab, deltaLuv, deltaRgbUnit, MAX_RGB_UNIT_DISTANCE,
};
