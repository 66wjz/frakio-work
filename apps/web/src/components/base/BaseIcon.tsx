// wjz新建文件，新建原因：封装全局统一图标中心 BaseIcon，收拢 Lucide 矢量图标与项目专属运行时 SVG 图标，修改时间：2026-08-18。
// 文件内容概述：支持 80+ 常用矢量图标名称映射及 hermes/pi/codex/claude/brand-logo 等专属 SVG 图标。
import React from 'react';
import * as LucideIcons from 'lucide-react';
import hermesRuntimeLogoUrl from '../../assets/runtime-logos/hermes.svg';
import piRuntimeLogoUrl from '../../assets/runtime-logos/pi.svg';
import codexRuntimeLogoUrl from '../../assets/runtime-logos/codex.svg';
import claudeRuntimeLogoUrl from '../../assets/runtime-logos/claude.svg';
import frakioBrandLogoUrl from '../../assets/frakio-brand-logo.png';
import launchDinoUrl from '../../assets/launch-dino.png';

// 自定义/项目专属 SVG 图标映射
const customSvgMap: Record<string, string> = {
  hermes: hermesRuntimeLogoUrl,
  'hermes-runtime': hermesRuntimeLogoUrl,
  pi: piRuntimeLogoUrl,
  'pi-runtime': piRuntimeLogoUrl,
  codex: codexRuntimeLogoUrl,
  'codex-runtime': codexRuntimeLogoUrl,
  claude: claudeRuntimeLogoUrl,
  'claude-runtime': claudeRuntimeLogoUrl,
  'brand-logo': frakioBrandLogoUrl,
  'launch-dino': launchDinoUrl,
};

// Lucide 图标名称别名与映射字典
const iconMap: Record<string, React.ComponentType<any>> = {
  activity: LucideIcons.Activity,
  'alert-circle': LucideIcons.AlertCircle,
  'alert-triangle': LucideIcons.AlertTriangle,
  'triangle-alert': LucideIcons.TriangleAlert,
  archive: LucideIcons.Archive,
  'arrow-down': LucideIcons.ArrowDown,
  'arrow-down-to-line': LucideIcons.ArrowDownToLine,
  'arrow-left': LucideIcons.ArrowLeft,
  'arrow-right': LucideIcons.ArrowRight,
  'arrow-up': LucideIcons.ArrowUp,
  'arrow-up-from-line': LucideIcons.ArrowUpFromLine,
  'arrow-up-right': LucideIcons.ArrowUpRight,
  bell: LucideIcons.Bell,
  bot: LucideIcons.Bot,
  'book-open': LucideIcons.BookOpen,
  'book-open-text': LucideIcons.BookOpenText,
  boxes: LucideIcons.Boxes,
  brain: LucideIcons.Brain,
  briefcase: LucideIcons.Briefcase,
  building: LucideIcons.Building2,
  building2: LucideIcons.Building2,
  cable: LucideIcons.Cable,
  calendar: LucideIcons.Calendar,
  check: LucideIcons.Check,
  'check-circle': LucideIcons.CheckCircle2,
  'check-circle-2': LucideIcons.CheckCircle2,
  'chevron-down': LucideIcons.ChevronDown,
  'chevron-left': LucideIcons.ChevronLeft,
  'chevron-right': LucideIcons.ChevronRight,
  'chevron-up': LucideIcons.ChevronUp,
  circle: LucideIcons.Circle,
  'circle-help': LucideIcons.CircleHelp,
  clock: LucideIcons.Clock3,
  clock3: LucideIcons.Clock3,
  code: LucideIcons.Code2,
  code2: LucideIcons.Code2,
  copy: LucideIcons.Copy,
  cpu: LucideIcons.Cpu,
  database: LucideIcons.Database,
  download: LucideIcons.Download,
  edit: LucideIcons.Pencil,
  'external-link': LucideIcons.ExternalLink,
  eye: LucideIcons.Eye,
  'eye-off': LucideIcons.EyeOff,
  file: LucideIcons.File,
  'file-text': LucideIcons.FileText,
  folder: LucideIcons.Folder,
  'folder-open': LucideIcons.FolderOpen,
  gauge: LucideIcons.Gauge,
  'git-branch': LucideIcons.GitBranch,
  'git-compare': LucideIcons.GitCompareArrows,
  'git-compare-arrows': LucideIcons.GitCompareArrows,
  globe: LucideIcons.Globe2,
  globe2: LucideIcons.Globe2,
  hand: LucideIcons.Hand,
  'help-circle': LucideIcons.CircleHelp,
  image: LucideIcons.Image,
  info: LucideIcons.Info,
  library: LucideIcons.Library,
  link: LucideIcons.Link2,
  link2: LucideIcons.Link2,
  lightbulb: LucideIcons.Lightbulb,
  loader: LucideIcons.LoaderCircle,
  'loader-circle': LucideIcons.LoaderCircle,
  lock: LucideIcons.Lock,
  'maximize-2': LucideIcons.Maximize2,
  maximize2: LucideIcons.Maximize2,
  message: LucideIcons.MessageSquare,
  'message-square': LucideIcons.MessageSquare,
  'message-square-plus': LucideIcons.MessageSquarePlus,
  minus: LucideIcons.Minus,
  monitor: LucideIcons.Monitor,
  moon: LucideIcons.Moon,
  'more-horizontal': LucideIcons.MoreHorizontal,
  'mouse-pointer': LucideIcons.MousePointer2,
  'mouse-pointer-2': LucideIcons.MousePointer2,
  network: LucideIcons.Network,
  palette: LucideIcons.Palette,
  'panel-left-close': LucideIcons.PanelLeftClose,
  'panel-left-open': LucideIcons.PanelLeftOpen,
  'panel-right': LucideIcons.PanelRight,
  'panel-right-open': LucideIcons.PanelRightOpen,
  pause: LucideIcons.Pause,
  'pause-circle': LucideIcons.PauseCircle,
  pencil: LucideIcons.Pencil,
  pin: LucideIcons.Pin,
  play: LucideIcons.Play,
  plus: LucideIcons.Plus,
  refresh: LucideIcons.RefreshCw,
  'refresh-cw': LucideIcons.RefreshCw,
  rotate: LucideIcons.RotateCcw,
  scan: LucideIcons.Scan,
  search: LucideIcons.Search,
  send: LucideIcons.Send,
  settings: LucideIcons.Settings,
  shield: LucideIcons.ShieldCheck,
  'shield-alert': LucideIcons.ShieldAlert,
  'shield-check': LucideIcons.ShieldCheck,
  sparkles: LucideIcons.Sparkles,
  square: LucideIcons.Square,
  sun: LucideIcons.Sun,
  terminal: LucideIcons.Terminal,
  'thumbs-down': LucideIcons.ThumbsDown,
  'thumbs-up': LucideIcons.ThumbsUp,
  trash: LucideIcons.Trash2,
  trash2: LucideIcons.Trash2,
  'user-circle': LucideIcons.UserCircle,
  'user-plus': LucideIcons.UserPlus,
  users: LucideIcons.UsersRound,
  'users-round': LucideIcons.UsersRound,
  x: LucideIcons.X,
  zap: LucideIcons.Zap,
};

export interface BaseIconProps extends React.HTMLAttributes<HTMLElement> {
  name: string;
  size?: number | string;
  color?: string;
  strokeWidth?: number | string;
  clickable?: boolean;
  spinning?: boolean;
  className?: string;
}

export const BaseIcon: React.FC<BaseIconProps> = ({
  name,
  size = 16,
  color,
  strokeWidth = 2,
  clickable = false,
  spinning = false,
  className = '',
  style,
  onClick,
  ...rest
}) => {
  const normalizedKey = String(name || '').trim().toLowerCase();

  // 1. 自定义 SVG 运行时/品牌 Logo
  if (customSvgMap[normalizedKey]) {
    const src = customSvgMap[normalizedKey];
    const numSize = typeof size === 'number' ? size : parseInt(String(size), 10) || 16;
    return (
      <img
        src={src}
        alt={normalizedKey}
        width={numSize}
        height={numSize}
        className={`base-icon base-icon-custom ${clickable ? 'base-icon-clickable' : ''} ${spinning ? 'base-icon-spinning' : ''} ${className}`}
        style={{
          width: numSize,
          height: numSize,
          objectFit: 'contain',
          display: 'inline-flex',
          flexShrink: 0,
          verticalAlign: 'middle',
          ...style,
        }}
        onClick={clickable || onClick ? onClick : undefined}
        {...(rest as any)}
      />
    );
  }

  // 2. Lucide 矢量图标
  const LucideComp = iconMap[normalizedKey] || (LucideIcons as any)[name] || LucideIcons.CircleHelp;

  return (
    <span
      className={`base-icon ${clickable ? 'base-icon-clickable' : ''} ${spinning ? 'base-icon-spinning' : ''} ${className}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        verticalAlign: 'middle',
        cursor: clickable ? 'pointer' : undefined,
        ...style,
      }}
      onClick={clickable || onClick ? onClick : undefined}
      {...rest}
    >
      <LucideComp
        size={size}
        color={color}
        strokeWidth={Number(strokeWidth) || 2}
      />
    </span>
  );
};

export default BaseIcon;
// wjz新建文件结束。
