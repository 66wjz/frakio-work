// wjz新建文件，新建原因：解耦 Space 主题调色板、动态渐变色、壁纸材质对比度及颜色计算纯函数，修改时间：2026-08-17。
// 文件内容概述：导出 defaultProductSpaceTheme 常量、预设生成函数及全套主题计算纯函数。
import { contrastForegroundForTint, workspaceTintAlpha } from '../theme-contrast.mjs';
import { clampNumber } from './formatters';
import type {
  Space,
  SpaceTheme,
  SpaceThemePalette,
  SpaceThemeAppearance,
  SpaceThemeColorMode,
  SpaceGradientColor,
  ThemePreset,
  ThemeHarmony,
  SpaceIconKind,
} from '../types/workbench';

export const defaultProductSpaceTheme: SpaceThemePalette = {
  accentColor: '#dce8e3',
  sidebarBg: '#f3f7f5',
  opacity: 0.5,
  noise: 0.01,
  texture: 0.03,
  mode: 'soft',
  gradientColors: [{ id: 'primary', color: '#dce8e3', x: 0.5, y: 0.5, isPrimary: true }],
};

export const zenPresetPositions = [
  [240, 240],
  [233, 157],
  [236, 111],
  [234, 173],
  [220, 187],
  [225, 237],
  [147, 195],
  [81, 84],
] as const;

export const zenPoint = ([x, y]: readonly [number, number]) => ({ x: x / 360, y: y / 360 });

export const zenPresetPage = (
  page: number,
  prefix: string,
  palettes: string[][],
  harmony: ThemeHarmony,
): ThemePreset[] =>
  palettes.map((colors, index) => ({
    id: `zen-${prefix}-${index + 1}`,
    page,
    colors,
    point: zenPoint(zenPresetPositions[index]),
    harmony,
  }));

export const themePresets: ThemePreset[] = [
  ...zenPresetPage(
    0,
    'light-solid',
    [['#f4efdf'], ['#f0b8cd'], ['#e9c3e3'], ['#da7682'], ['#eb8570'], ['#dcce7f'], ['#5becad'], ['#919bb5']],
    'floating',
  ),
  ...zenPresetPage(
    1,
    'light-gradient',
    [
      ['#f5edd6', '#ddf3d8', '#f3d8e1'],
      ['#f3bede', '#f7deba', '#dfc3ee'],
      ['#e5b3e4', '#ecacb2', '#c5b9df'],
      ['#eb7a9f', '#efef76', '#d285e0'],
      ['#f2737b', '#aff273', '#e67de8'],
      ['#ddcd55', '#61d45e', '#d75b7c'],
      ['#4be7d2', '#54afde', '#3ef470'],
      ['#7a849e', '#8975a4', '#74a2a4'],
    ],
    'analogous',
  ),
  ...zenPresetPage(
    2,
    'dark-solid',
    [['#5d566a'], ['#997096'], ['#956066'], ['#9c6645'], ['#517b6c'], ['#576e75'], ['#836d5f'], ['#447464']],
    'floating',
  ),
  ...zenPresetPage(
    3,
    'dark-gradient',
    [
      ['#171122', '#250e23', '#121621'],
      ['#804c7c', '#8d3f42', '#615874'],
      ['#7a3840', '#7e7934', '#6f446e'],
      ['#834116', '#408019', '#7a1f5b'],
      ['#2d6c55', '#345565', '#347623'],
      ['#2d4a53', '#2e3251', '#265a41'],
      ['#402f26', '#374026', '#3b2b34'],
      ['#16503d', '#1a3c4c', '#1b570f'],
    ],
    'analogous',
  ),
  ...[28, 33, 64, 97, 128, 161, 191, 224, 255].map(
    (value, index): ThemePreset => ({
      id: `zen-grayscale-${index + 1}`,
      page: 4,
      colors: [`#${value.toString(16).padStart(2, '0').repeat(3)}`],
      point: { x: [340, 337.5, 315, 292.5, 270, 247.5, 225, 202.5, 180][index] / 360, y: 0.5 },
      harmony: 'floating',
      type: 'grayscale',
    }),
  ),
];

export const themePresetPages = Array.from({ length: 5 }, (_, page) =>
  themePresets.filter((preset) => preset.page === page),
);

export const spaceEmojiOptions = ['✨', '💼', '🧠', '🚀', '🌿', '🎨', '📚', '🧩', '🛠️', '🪐', '🔥', '💎'];
export const spaceIconOptions = ['folder', 'briefcase', 'sparkles', 'library'];
export const spaceIconLabels: Record<string, string> = {
  folder: 'Folder',
  briefcase: 'Briefcase',
  sparkles: 'Sparkles',
  library: 'Library',
};

export function hslToHex(h: number, s: number, l: number) {
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = light - c / 2;
  const [r1, g1, b1] =
    h < 60
      ? [c, x, 0]
      : h < 120
      ? [x, c, 0]
      : h < 180
      ? [0, c, x]
      : h < 240
      ? [0, x, c]
      : h < 300
      ? [x, 0, c]
      : [c, 0, x];
  return `#${[r1, g1, b1].map((channel) => Math.round((channel + m) * 255).toString(16).padStart(2, '0')).join('')}`;
}

export function colorFromThemePoint(x: number, y: number) {
  const cx = clampNumber(x, 0, 1) - 0.5;
  const cy = clampNumber(y, 0, 1) - 0.5;
  const distance = Math.min(Math.sqrt(cx * cx + cy * cy) / 0.5, 1);
  let angle = (Math.atan2(cy, cx) * 180) / Math.PI;
  if (angle < 0) angle += 360;
  const hue = Math.round(angle);
  const saturation = Math.round(48 + distance * 44);
  const lightness = Math.round(76 - distance * 32);
  return hslToHex(hue, saturation, lightness);
}

export function mixHexWithColor(hex: string, targetHex: string, targetRatio: number) {
  const clean = String(hex || '').replace('#', '');
  const target = String(targetHex || '').replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean) || !/^[0-9a-fA-F]{6}$/.test(target)) return '#f3f4ff';
  const ratio = clampNumber(targetRatio, 0, 1);
  const rgb = [clean.slice(0, 2), clean.slice(2, 4), clean.slice(4, 6)].map((part) => Number.parseInt(part, 16));
  const targetRgb = [target.slice(0, 2), target.slice(2, 4), target.slice(4, 6)].map((part) => Number.parseInt(part, 16));
  const mixed = rgb.map((channel, index) => Math.round(channel * (1 - ratio) + targetRgb[index] * ratio));
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

export function mixHexWithWhite(hex: string, whiteRatio: number) {
  return mixHexWithColor(hex, '#ffffff', whiteRatio);
}

export function hexLuminance(hex: string) {
  const clean = String(hex || '').replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return 0.7;
  const channels = [clean.slice(0, 2), clean.slice(2, 4), clean.slice(4, 6)].map((part) => {
    const value = Number.parseInt(part, 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

export function hexToRgb(value: string) {
  const clean = String(value || '').replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return '243 244 255';
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}

export function normalizeGradientColors(theme?: Partial<SpaceTheme>): SpaceGradientColor[] {
  const source = Array.isArray(theme?.gradientColors) ? theme!.gradientColors! : [];
  const valid = source
    .filter((color) => /^#[0-9a-fA-F]{6}$/.test(color.color || ''))
    .slice(0, 3)
    .map((color, index) => ({
      id: String(color.id || `color_${index}`),
      color: color.color,
      x: clampNumber(Number(color.x ?? (index === 0 ? 0.18 : index === 1 ? 0.62 : 0.38)), 0, 1),
      y: clampNumber(Number(color.y ?? (index === 0 ? 0.72 : index === 1 ? 0.28 : 0.27)), 0, 1),
      isPrimary: Boolean(color.isPrimary),
    }));
  if (!valid.length) {
    valid.push({
      id: 'primary',
      color: /^#[0-9a-fA-F]{6}$/.test(theme?.accentColor || '') ? theme!.accentColor! : '#8b8cf6',
      x: 0.18,
      y: 0.72,
      isPrimary: true,
    });
  }
  const primaryIndex = Math.max(0, valid.findIndex((color) => color.isPrimary));
  return valid.map((color, index) => ({ ...color, isPrimary: index === primaryIndex }));
}

export function primaryGradientColor(theme?: Partial<SpaceTheme>) {
  const colors = normalizeGradientColors(theme);
  return colors.find((color) => color.isPrimary) || colors[0];
}

export function normalizeSpaceThemePalette(
  theme?: Partial<SpaceThemePalette>,
  fallback: SpaceThemePalette = defaultProductSpaceTheme,
): SpaceThemePalette {
  const accentColor = /^#[0-9a-fA-F]{6}$/.test(theme?.accentColor || '') ? theme!.accentColor! : fallback.accentColor;
  const sidebarBg = /^#[0-9a-fA-F]{6}$/.test(theme?.sidebarBg || '') ? theme!.sidebarBg! : fallback.sidebarBg;
  const texture = clampNumber(Number(theme?.texture ?? (theme?.noise == null ? fallback.texture || 0 : theme.noise / 0.35)), 0, 1);
  return {
    accentColor,
    sidebarBg,
    opacity: clampNumber(Number(theme?.opacity ?? fallback.opacity), 0.3, 0.9),
    noise: clampNumber(Number(theme?.noise ?? texture * 0.35), 0, 0.35),
    texture,
    mode: theme?.mode === 'crisp' ? 'crisp' : fallback.mode,
    gradientColors: normalizeGradientColors({ ...theme, accentColor, sidebarBg }),
  };
}

export function deriveDarkThemePalette(theme: SpaceThemePalette): SpaceThemePalette {
  const colors = normalizeGradientColors(theme).map((color) => ({
    ...color,
    color: mixHexWithColor(color.color, '#11131a', 0.46),
  }));
  const primary = colors.find((color) => color.isPrimary) || colors[0];
  return {
    ...theme,
    accentColor: primary?.color || mixHexWithColor(theme.accentColor, '#11131a', 0.46),
    sidebarBg: mixHexWithColor(theme.sidebarBg || theme.accentColor, '#12151c', 0.68),
    opacity: clampNumber(Math.max(theme.opacity, 0.76), 0.3, 0.9),
    mode: 'crisp',
    gradientColors: colors,
  };
}

export function normalizeSpaceTheme(theme?: Partial<SpaceTheme>): SpaceTheme {
  const colorMode: SpaceThemeColorMode = theme?.colorMode === 'native' ? 'native' : 'custom';
  const appearance: SpaceThemeAppearance =
    theme?.appearance === 'auto' || theme?.appearance === 'dark' || theme?.appearance === 'light'
      ? theme.appearance
      : 'light';
  const legacyPalette = normalizeSpaceThemePalette(theme as Partial<SpaceThemePalette> | undefined);
  const lightTheme = normalizeSpaceThemePalette(theme?.lightTheme || legacyPalette, legacyPalette);
  const darkTheme = normalizeSpaceThemePalette(theme?.darkTheme || deriveDarkThemePalette(lightTheme), deriveDarkThemePalette(lightTheme));
  const activePalette = appearance === 'dark' ? darkTheme : legacyPalette;
  return {
    ...activePalette,
    colorMode,
    appearance,
    lightTheme,
    darkTheme,
    renderVersion: Math.max(3, Number(theme?.renderVersion) || 0),
  };
}

export function isThemeNightTime(date = new Date()) {
  const hour = date.getHours();
  return hour >= 18 || hour < 6;
}

export function resolveEffectiveSpaceTheme(theme?: Partial<SpaceTheme>): SpaceTheme {
  const normalized = normalizeSpaceTheme(theme);
  if (normalized.appearance === 'dark')
    return {
      ...normalized.darkTheme!,
      colorMode: normalized.colorMode,
      appearance: normalized.appearance,
      lightTheme: normalized.lightTheme,
      darkTheme: normalized.darkTheme,
      renderVersion: normalized.renderVersion,
    };
  if (normalized.appearance === 'auto' && isThemeNightTime())
    return {
      ...normalized.darkTheme!,
      colorMode: normalized.colorMode,
      appearance: normalized.appearance,
      lightTheme: normalized.lightTheme,
      darkTheme: normalized.darkTheme,
      renderVersion: normalized.renderVersion,
    };
  return {
    ...normalized.lightTheme!,
    colorMode: normalized.colorMode,
    appearance: normalized.appearance,
    lightTheme: normalized.lightTheme,
    darkTheme: normalized.darkTheme,
    renderVersion: normalized.renderVersion,
  };
}

export function resolveSpaceThemeForAppearance(theme: Partial<SpaceTheme> | undefined, dark: boolean): SpaceTheme {
  const normalized = normalizeSpaceTheme(theme);
  const palette = normalizeSpaceThemePalette(theme as Partial<SpaceThemePalette> | undefined);
  return {
    ...palette,
    colorMode: normalized.colorMode,
    appearance: dark ? 'dark' : 'light',
    lightTheme: normalized.lightTheme,
    darkTheme: normalized.darkTheme,
    renderVersion: normalized.renderVersion,
  };
}

export function withDraftThemePalette(theme: SpaceTheme, palette: SpaceThemePalette): SpaceTheme {
  const normalized = normalizeSpaceTheme(theme);
  const editsDark = normalized.appearance === 'dark' || (normalized.appearance === 'auto' && isThemeNightTime());
  const lightTheme = editsDark ? normalized.lightTheme! : palette;
  const darkTheme = editsDark ? palette : normalized.darkTheme || deriveDarkThemePalette(palette);
  return {
    ...palette,
    colorMode: normalized.colorMode,
    appearance: normalized.appearance,
    lightTheme,
    darkTheme,
    renderVersion: normalized.renderVersion,
  };
}

export function syncThemeFromGradientColors(theme: SpaceTheme): SpaceTheme {
  const gradientColors = normalizeGradientColors(theme);
  const primary = gradientColors.find((color) => color.isPrimary) || gradientColors[0];
  return {
    ...theme,
    accentColor: primary.color,
    sidebarBg: mixHexWithWhite(primary.color, theme.mode === 'crisp' ? 0.66 : 0.78),
    noise: clampNumber(Number(theme.noise ?? (theme.texture ?? 0) * 0.35), 0, 0.35),
    texture: clampNumber(Number(theme.texture ?? (theme.noise == null ? 0 : theme.noise / 0.35)), 0, 1),
    gradientColors,
  };
}

export function updateSpaceThemeColorPoint(
  theme: SpaceTheme,
  colorId: string,
  x: number,
  y: number,
  nextColor = colorFromThemePoint(x, y),
): SpaceTheme {
  const currentColors = normalizeGradientColors(theme);
  const movedColor = currentColors.find((color) => color.id === colorId);
  const movedColors = currentColors.map((color) => (color.id === colorId ? { ...color, x, y, color: nextColor } : color));
  const gradientColors = movedColor?.isPrimary ? calculateHarmonyColors(movedColors, 'update') : movedColors;
  return syncThemeFromGradientColors({ ...theme, gradientColors });
}

export function promoteGradientColor(theme: SpaceTheme, colorId: string): SpaceTheme {
  const colors = normalizeGradientColors(theme);
  const promoted = colors.find((color) => color.id === colorId);
  if (!promoted?.id) return syncThemeFromGradientColors({ ...theme, gradientColors: colors });
  const gradientColors = calculateHarmonyColors(
    colors.map((color) => ({ ...color, isPrimary: color.id === colorId })),
    'update',
  );
  return syncThemeFromGradientColors({ ...theme, gradientColors });
}

export function buildSpaceThemeFromPoint(
  x: number,
  y: number,
  color = colorFromThemePoint(x, y),
  mode: SpaceTheme['mode'] = 'soft',
): SpaceTheme {
  return {
    accentColor: color,
    sidebarBg: mixHexWithWhite(color, mode === 'crisp' ? 0.66 : 0.78),
    opacity: 0.5,
    noise: 0,
    texture: 0,
    mode,
    gradientColors: [{ id: 'primary', color, x, y, isPrimary: true }],
    colorMode: 'custom',
    renderVersion: 3,
  };
}

export function clampThemePointToSquare(xValue: number, yValue: number) {
  return {
    x: clampNumber(Number.isFinite(xValue) ? xValue : 0.5, 0, 1),
    y: clampNumber(Number.isFinite(yValue) ? yValue : 0.5, 0, 1),
  };
}

export function calculateHarmonyColors(
  colors: SpaceGradientColor[],
  action: 'add' | 'remove' | 'update' = 'update',
  harmony?: ThemeHarmony,
) {
  const normalized = normalizeGradientColors({ gradientColors: colors });
  const targetCount = clampNumber(action === 'add' ? normalized.length + 1 : normalized.length, 1, 3);
  const primary = normalized.find((color) => color.isPrimary) || normalized[0];
  const center = { x: 0.5, y: 0.5 };
  const dx = primary.x - center.x;
  const dy = primary.y - center.y;
  const radius = clampNumber(Math.sqrt(dx * dx + dy * dy), 0, 0.5);
  const baseAngle = Math.atan2(dy, dx);
  const nextColors: SpaceGradientColor[] = [{ ...primary, isPrimary: true }];
  const secondaries = normalized.filter((color) => !color.isPrimary);
  const activeHarmony: ThemeHarmony =
    harmony || (targetCount === 1 ? 'floating' : targetCount === 2 ? 'complementary' : 'splitComplementary');
  const angleOffsets =
    targetCount === 2
      ? [activeHarmony === 'singleAnalogous' ? 310 : 180]
      : targetCount === 3
      ? activeHarmony === 'analogous'
        ? [50, 310]
        : activeHarmony === 'triadic'
        ? [120, 240]
        : [150, 210]
      : [];
  angleOffsets.forEach((offset, index) => {
    const angle = baseAngle + (offset * Math.PI) / 180;
    const point = clampThemePointToSquare(center.x + radius * Math.cos(angle), center.y + radius * Math.sin(angle));
    const existing = secondaries[index];
    nextColors.push({
      id: existing?.id || `secondary_${index + 1}`,
      color: colorFromThemePoint(point.x, point.y),
      x: point.x,
      y: point.y,
      isPrimary: false,
    });
  });
  return nextColors;
}

export function buildPresetGradientColors(
  colors: string[],
  point: { x: number; y: number },
  harmony: ThemeHarmony,
  _type: ThemePreset['type'] = 'color',
): SpaceGradientColor[] {
  const primary = colors[0] || '#8d9bb8';
  if (colors.length === 1) return [{ id: 'primary', color: primary, x: point.x, y: point.y, isPrimary: true }];
  const positioned = calculateHarmonyColors(
    [
      { id: 'primary', color: primary, x: point.x, y: point.y, isPrimary: true },
      { id: 'secondary_a', color: colors[1] || primary, x: point.x, y: point.y },
      { id: 'secondary_b', color: colors[2] || primary, x: point.x, y: point.y },
    ],
    'update',
    harmony,
  );
  return positioned.map((color, index) => ({
    ...color,
    color: colors[index] || primary,
    id: index === 0 ? 'primary' : `secondary_${index}`,
  }));
}

export function themeOpacityProgress(theme: Pick<SpaceTheme, 'opacity'>) {
  return clampNumber((Number(theme.opacity) - 0.3) / 0.6, 0, 1);
}

export function opacityProgress(opacity: number) {
  return clampNumber((opacity - 0.3) / 0.6, 0, 1);
}


export function isNeutralProductTheme(theme: Partial<SpaceTheme>) {
  const colors = normalizeGradientColors(theme);
  return (
    colors.length === 1 &&
    String(colors[0]?.color || '').toLowerCase() === '#dce8e3' &&
    String(theme.sidebarBg || '').toLowerCase() === '#f3f7f5'
  );
}

export function themeGradientBase(theme: SpaceTheme, surface: 'picker' | 'stage' | 'shell') {
  const colors = normalizeGradientColors(theme);
  const primary = colors.find((color) => color.isPrimary) || colors[0];
  const anchor = primary?.color || theme.accentColor;
  const progress = themeOpacityProgress(theme);
  const warmBase = surface === 'stage' ? '#f7f2ee' : surface === 'shell' ? '#f4efe7' : '#f1ebe2';
  const tintSource = mixHexWithColor(anchor, theme.sidebarBg || anchor, surface === 'picker' ? 0.24 : 0.34);
  const lowTint = surface === 'picker' ? 0.18 : surface === 'shell' ? 0.14 : 0.1;
  const highTint = surface === 'picker' ? 0.74 : surface === 'shell' ? 0.66 : 0.5;
  const tintRatio = lowTint + progress * (highTint - lowTint);
  const colorBase = mixHexWithColor(warmBase, tintSource, tintRatio);
  const percent = Math.round(
    (surface === 'picker' ? 72 : surface === 'shell' ? 82 : 60) + progress * (surface === 'stage' ? 12 : 8),
  );
  return `color-mix(in srgb, ${colorBase} ${percent}%, ${warmBase})`;
}

export function softenThemeGradientColor(
  color: string,
  theme: SpaceTheme,
  surface: 'picker' | 'stage' | 'rail' | 'shell',
) {
  const opacityProgress = themeOpacityProgress(theme);
  const isCrisp = theme.mode === 'crisp';
  const strength =
    surface === 'rail'
      ? 0.34 + opacityProgress * 0.48 + (isCrisp ? 0.06 : 0)
      : surface === 'stage'
      ? 0.18 + opacityProgress * 0.5 + (isCrisp ? 0.06 : 0)
      : surface === 'shell'
      ? 0.24 + opacityProgress * 0.54 + (isCrisp ? 0.06 : 0)
      : 0.38 + opacityProgress * 0.5 + (isCrisp ? 0.08 : 0);
  const base =
    surface === 'rail'
      ? mixHexWithColor(
          theme.sidebarBg || color,
          opacityProgress > 0.55 ? '#16191f' : '#f1e9df',
          0.5 - opacityProgress * 0.18,
        )
      : mixHexWithColor(
          theme.sidebarBg || color,
          surface === 'stage' ? '#f8f2ee' : '#f5eee6',
          surface === 'picker' ? 0.62 : 0.72,
        );
  return mixHexWithColor(color, base, 1 - clampNumber(strength, 0.12, 0.9));
}

export function themeZenGradientBackground(theme: SpaceTheme, surface: 'picker' | 'stage' | 'shell') {
  const colors = normalizeGradientColors(theme);
  if (isNeutralProductTheme(theme)) {
    if (surface === 'stage')
      return 'radial-gradient(circle at 68% 18%, rgb(225 232 255 / 34%) 0%, transparent 34%), radial-gradient(circle at 10% 4%, rgb(220 235 228 / 42%) 0%, transparent 38%), #fafbfa';
    if (surface === 'shell')
      return 'linear-gradient(135deg, #f2f7f4 0%, #fafbfa 48%, #f5f7fb 100%)';
    return 'radial-gradient(circle at 16% 10%, rgb(214 231 223 / 72%) 0%, transparent 54%), #f5f8f6';
  }
  const base = themeGradientBase(theme, surface);
  if (colors.length <= 1) {
    const primary = softenThemeGradientColor(colors[0]?.color || theme.accentColor, theme, surface);
    return [
      `radial-gradient(circle at 12% 0%, ${primary} 0%, transparent ${surface === 'stage' ? '74%' : '68%'})`,
      base,
    ].join(', ');
  }
  if (colors.length === 2) {
    const first = softenThemeGradientColor(colors[0].color, theme, surface);
    const second = softenThemeGradientColor(colors[1].color, theme, surface);
    return [
      `linear-gradient(-45deg, ${second} 0%, transparent 100%)`,
      `linear-gradient(135deg, ${first} 0%, transparent 100%)`,
      base,
    ].join(', ');
  }
  const first = softenThemeGradientColor(colors[0].color, theme, surface);
  const second = softenThemeGradientColor(colors[1].color, theme, surface);
  const third = softenThemeGradientColor(colors[2].color, theme, surface);
  return [
    `linear-gradient(-5deg, ${third} 10%, transparent 80%)`,
    `radial-gradient(circle at 95% 0%, ${second} 0%, transparent 75%)`,
    `radial-gradient(circle at 0% 0%, ${first} 10%, transparent 70%)`,
    base,
  ].join(', ');
}

export function themeGradientBackground(theme: SpaceTheme) {
  return themeZenGradientBackground(theme, 'picker');
}

export function themeStageBackground(theme: SpaceTheme) {
  return themeZenGradientBackground(theme, 'stage');
}

export function themeShellBackground(theme: SpaceTheme) {
  return themeZenGradientBackground(theme, 'shell');
}

export function macThemeBackground(theme: SpaceTheme) {
  const colors = normalizeGradientColors(theme);
  const strength = Math.round(workspaceTintAlpha(theme.opacity) * 100);
  const tint = (color: string) => `color-mix(in srgb, ${color} ${strength}%, transparent)`;
  if (colors.length <= 1)
    return `linear-gradient(${tint(colors[0]?.color || theme.accentColor)}, ${tint(colors[0]?.color || theme.accentColor)})`;
  if (colors.length === 2) {
    return `linear-gradient(-45deg, ${tint(colors[1].color)} 0%, transparent 100%), linear-gradient(135deg, ${tint(colors[0].color)} 0%, transparent 100%)`;
  }
  return `linear-gradient(-5deg, ${tint(colors[2].color)} 10%, transparent 80%), radial-gradient(circle at 95% 0%, ${tint(colors[1].color)} 0%, transparent 75%), radial-gradient(circle at 0% 0%, ${tint(colors[0].color)} 10%, transparent 70%)`;
}

export function spaceRailContrastTokens(theme: SpaceTheme, dark: boolean) {
  if (theme.colorMode === 'native') {
    return dark
      ? { text: '#f1f1f1', muted: 'rgb(241 241 241 / 66%)' }
      : { text: '#202124', muted: 'rgb(32 33 36 / 60%)' };
  }
  const primary = primaryGradientColor(theme).color;
  const foreground = contrastForegroundForTint(primary, workspaceTintAlpha(theme.opacity), dark);
  return foreground === 'light'
    ? { text: '#ffffff', muted: 'rgb(255 255 255 / 70%)' }
    : { text: '#111214', muted: 'rgb(17 18 20 / 64%)' };
}

export function themeRailBackground(theme: SpaceTheme) {
  const colors = normalizeGradientColors(theme);
  if (isNeutralProductTheme(theme)) {
    return 'linear-gradient(180deg, rgb(249 252 250 / 76%), rgb(239 246 242 / 68%)), rgb(243 247 245 / 58%)';
  }
  const primary = colors.find((color) => color.isPrimary) || colors[0];
  const primaryColor = primary?.color || theme.accentColor;
  const progress = themeOpacityProgress(theme);
  const railPrimary = softenThemeGradientColor(primaryColor, theme, 'rail');
  const railChrome = mixHexWithColor(primaryColor, '#15181d', theme.mode === 'crisp' ? 0.24 : 0.3);
  const railMist = mixHexWithColor(theme.sidebarBg || primaryColor, '#f2ece3', 0.42);
  const railBase = mixHexWithColor(railMist, railChrome, 0.34 + progress * 0.52);
  const railLift = mixHexWithColor(railPrimary, progress < 0.5 ? '#fbf4ed' : '#ffffff', 0.3 - progress * 0.12);
  const glowStrength = Math.round(18 + progress * 20);
  const baseStrength = Math.round(42 + progress * 34);
  if (colors.length <= 1) {
    return [
      `linear-gradient(180deg, color-mix(in srgb, ${railLift} ${glowStrength + 8}%, transparent) 0%, color-mix(in srgb, ${railBase} ${baseStrength + 16}%, transparent) 100%)`,
      `color-mix(in srgb, ${railPrimary} ${24 + Math.round(progress * 24)}%, transparent)`,
    ].join(', ');
  }
  if (colors.length === 2) {
    const secondary = mixHexWithColor(
      softenThemeGradientColor(colors[1].color, theme, 'rail'),
      railBase,
      0.34 + progress * 0.2,
    );
    return [
      `radial-gradient(circle at 88% 4%, color-mix(in srgb, ${secondary} ${glowStrength + 4}%, transparent) 0%, transparent 62%)`,
      `linear-gradient(180deg, color-mix(in srgb, ${railLift} ${glowStrength + 6}%, transparent) 0%, color-mix(in srgb, ${railBase} ${baseStrength + 16}%, transparent) 100%)`,
      `color-mix(in srgb, ${railBase} ${baseStrength}%, transparent)`,
    ].join(', ');
  }
  const secondaryA = mixHexWithColor(
    softenThemeGradientColor(colors[1].color, theme, 'rail'),
    railBase,
    0.38 + progress * 0.18,
  );
  const secondaryB = mixHexWithColor(
    softenThemeGradientColor(colors[2].color, theme, 'rail'),
    railBase,
    0.42 + progress * 0.16,
  );
  return [
    `radial-gradient(circle at 86% 0%, color-mix(in srgb, ${secondaryA} ${glowStrength + 4}%, transparent) 0%, transparent 58%)`,
    `radial-gradient(circle at 4% 92%, color-mix(in srgb, ${secondaryB} ${glowStrength}%, transparent) 0%, transparent 56%)`,
    `linear-gradient(180deg, color-mix(in srgb, ${railLift} ${glowStrength + 6}%, transparent) 0%, color-mix(in srgb, ${railBase} ${baseStrength + 14}%, transparent) 100%)`,
    `color-mix(in srgb, ${railBase} ${baseStrength}%, transparent)`,
  ].join(', ');
}

export function textureSurfaceVars(theme: SpaceTheme, surface: 'rail' | 'stage') {
  const colors = normalizeGradientColors(theme);
  const primary = colors.find((color) => color.isPrimary) || colors[0];
  const anchor =
    surface === 'rail'
      ? mixHexWithColor(primary?.color || theme.accentColor, '#171a1f', theme.mode === 'crisp' ? 0.34 : 0.42)
      : mixHexWithWhite(primary?.color || theme.accentColor, 0.68);
  const luminance = hexLuminance(anchor);
  const lightBias = clampNumber((luminance - 0.48) / 0.52, 0, 1);
  const darkBias = clampNumber((0.56 - luminance) / 0.56, 0, 1);
  const base = surface === 'rail' ? 0.48 : 0.38;
  return {
    '--texture-grain-opacity': String(base + lightBias * 0.2 + darkBias * 0.16),
    '--texture-grain-contrast': String(1.2 + lightBias * 0.55 + darkBias * 0.36),
    '--texture-haze-opacity': String((surface === 'rail' ? 0.36 : 0.28) + darkBias * 0.14),
  };
}

export function spaceIconKind(space: Space): SpaceIconKind {
  if (space.iconKind === 'dot') return 'dot';
  if (space.id === 'space_default' && space.iconKind === 'emoji' && space.iconValue === '✨') return 'dot';
  return space.iconKind;
}

export function wavePathForOpacity(opacity: number) {
  const progress = clampNumber((opacity - 0.3) / 0.6, 0, 1);
  const startX = 51.373;
  const endX = 419.634;
  const centerY = 27.395;
  if (progress < 0.03) return 'M 51.373 27.395 L 419.634 27.395';
  const amp = 35.898 * progress;
  const segmentCount = 14;
  const segmentWidth = (endX - startX) / segmentCount;
  const segments = Array.from({ length: segmentCount }, (_, index) => {
    const x0 = startX + segmentWidth * index;
    const x1 = startX + segmentWidth * (index + 1);
    const y = centerY + (index % 2 === 0 ? -amp : amp);
    return `C ${(x0 + segmentWidth / 3).toFixed(3)} ${y.toFixed(3)} ${(x0 + (segmentWidth * 2) / 3).toFixed(3)} ${y.toFixed(3)} ${x1.toFixed(3)} ${centerY}`;
  });
  return `M ${startX} ${centerY} ${segments.join(' ')}`;
}

export function textureStepDots(texture = 0) {
  const activeValue = Math.round(clampNumber(texture, 0, 1) * 16) / 16;
  return Array.from({ length: 16 }, (_, index) => {
    const angle = (index / 16) * Math.PI * 2;
    let order = index + 4;
    if (order >= 16) order -= 16;
    return {
      id: index,
      left: 50 + Math.cos(angle) * 50,
      top: 50 + Math.sin(angle) * 50,
      active: activeValue > 0 && order > 0 && order / 16 <= activeValue,
    };
  });
}

export function textureHandleStyle(texture = 0) {
  const value = clampNumber(texture, 0, 1);
  const rotation = value * 360 - 90;
  const top = Math.sin((rotation * Math.PI) / 180) * 50 + 50;
  const left = Math.cos((rotation * Math.PI) / 180) * 50 + 50;
  return { left: `${left}%`, top: `${top}%`, transform: `translate(-50%, -50%) rotate(${rotation + 90}deg)` };
}
// wjz新建文件结束。
