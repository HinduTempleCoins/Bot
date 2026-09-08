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

// ── Oklab / Oklch ────────────────────────────────────────────────────────────────────────────────
//
// Added for the free-colour-naming exam, which needs to SAMPLE colours evenly rather than measure
// distances between them. Sampling in HSL would cluster swatches in the yellows and starve the
// blues, because HSL's "hue" is an sRGB-cube hack whose lightness swings wildly around the circle.
// Oklch's hue circle is near-perceptually-even, which is what makes an even sample even.
//
// Björn Ottosson (2020), "A perceptual color space for image processing" — the published matrices.

/** Re-apply the sRGB transfer function. Inverse of srgbToLinear, in 0–255. */
export function linearToSrgb(v) {
  const c = clamp(Number(v), 0, 1);
  const enc = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(clamp(enc, 0, 1) * 255);
}

export function rgbToOklab(rgb) {
  const [r, g, b] = (Array.isArray(rgb) ? rgb : [0, 0, 0]).map(srgbToLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  };
}

/** Oklab back to sRGB 0–255, plus whether the colour was inside the display's gamut BEFORE clipping. */
export function oklabToRgb({ L = 0, a = 0, b = 0 } = {}) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
  // Clipping is NOT noise — it is a systematic compression toward the gamut edge. Report it so the
  // caller can avoid presenting a clipped swatch rather than silently pretending it was the colour
  // that was asked for.
  const inGamut = lin.every((v) => v >= -1e-6 && v <= 1 + 1e-6);
  return { rgb: lin.map(linearToSrgb), inGamut };
}

export function oklchToRgb({ L = 0, C = 0, H = 0 } = {}) {
  const h = (Number(H) * Math.PI) / 180;
  return oklabToRgb({ L: Number(L), a: Number(C) * Math.cos(h), b: Number(C) * Math.sin(h) });
}

export function rgbToOklch(rgb) {
  const { L, a, b } = rgbToOklab(rgb);
  const H = (Math.atan2(b, a) * 180) / Math.PI;
  return { L, C: Math.hypot(a, b), H: (H + 360) % 360 };
}

/** Euclidean distance in Oklab — the space's own ΔE. */
export function deltaOklab(c1, c2) {
  const a = rgbToOklab(c1);
  const b = rgbToOklab(c2);
  return dist([a.L, b.L], [a.a, b.a], [a.b, b.b]);
}

export default {
  D65, hexToRgb, rgbToHex, srgbToLinear, linearToSrgb, rgbToXyz, rgbToLab, rgbToLuv, lightness,
  rgbToOklab, oklabToRgb, oklchToRgb, rgbToOklch, deltaOklab,
  deltaLab, deltaLuv, deltaRgbUnit, MAX_RGB_UNIT_DISTANCE,
};
