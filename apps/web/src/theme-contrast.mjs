function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function hexRgbChannels(value) {
  const clean = String(value || '').replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return [139, 140, 246];
  return [0, 2, 4].map((offset) => Number.parseInt(clean.slice(offset, offset + 2), 16));
}

export function compositeTint(color, opacity, dark) {
  const tint = hexRgbChannels(color);
  const base = dark ? [23, 23, 26] : [240, 240, 244];
  const alpha = clamp(Number(opacity) || 0, 0, 1);
  return tint.map((channel, index) => Math.round(channel * alpha + base[index] * (1 - alpha)));
}

export function relativeLuminance(rgb) {
  const channels = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

export function contrastForegroundForTint(color, opacity, dark) {
  const luminance = relativeLuminance(compositeTint(color, opacity, dark));
  const darkContrast = (luminance + 0.05) / 0.05;
  const lightContrast = 1.05 / (luminance + 0.05);
  return lightContrast >= darkContrast ? 'light' : 'dark';
}

export function workspaceTintAlpha(opacity) {
  const stored = clamp(Number(opacity) || 0.5, 0.3, 0.9);
  return Number((0.12 + ((stored - 0.3) / 0.6) * 0.22).toFixed(4));
}
