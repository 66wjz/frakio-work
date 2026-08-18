// wjz新建文件，新建原因：解耦 main.tsx 中的 RightRailTabIcon 右侧抽屉标签图标组件，修改时间：2026-08-17。
// 文件内容概述：按 Tab 渲染对应 SVG 图标（浏览器、文件、代码审阅、资料库、协作）。
// wjz新建文件结束。

import React from 'react';
import { Database, FolderOpen, GitCompareArrows, Globe2, Network } from 'lucide-react';
import type { RightRailTab } from '../../types/workbench';

export function RightRailTabIcon({ tab, size = 14 }: { tab: RightRailTab; size?: number }) {
  const Icon =
    tab === 'browser'
      ? Globe2
      : tab === 'files'
        ? FolderOpen
        : tab === 'review'
          ? GitCompareArrows
          : tab === 'sources'
            ? Database
            : Network;

  return <Icon size={size} aria-hidden="true" />;
}
