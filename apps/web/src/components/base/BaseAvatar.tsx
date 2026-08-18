// wjz新建文件，新建原因：封装基础头像组件 BaseAvatar，修改时间：2026-08-18。
// 文件内容概述：支持图片头像、首字缩写、纯色背景与状态角标。
import React, { useState } from 'react';

export interface BaseAvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  src?: string;
  name?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | number;
  color?: string;
  shape?: 'circle' | 'square' | 'rounded';
  status?: 'online' | 'offline' | 'busy' | 'away';
}

export const BaseAvatar: React.FC<BaseAvatarProps> = ({
  src,
  name = '',
  size = 'md',
  color,
  shape = 'circle',
  status,
  className = '',
  style,
  ...props
}) => {
  const [imgError, setImgError] = useState(false);

  const sizePx = typeof size === 'number'
    ? size
    : { xs: 20, sm: 28, md: 36, lg: 48, xl: 64 }[size];

  const fontSize = Math.max(10, Math.floor(sizePx * 0.42));

  const shapeClass = {
    circle: 'rounded-full',
    square: 'rounded-none',
    rounded: 'rounded-xl',
  }[shape];

  // 纯色背景提取首字母或汉字
  const initial = String(name || '').trim().slice(0, 1).toUpperCase() || '?';

  // 默认柔和色板
  const defaultBg = color || 'var(--mac-accent, #0f766e)';

  const statusColors = {
    online: 'bg-emerald-500',
    offline: 'bg-neutral-400',
    busy: 'bg-rose-500',
    away: 'bg-amber-500',
  };

  return (
    <div
      className={`relative inline-flex items-center justify-center flex-shrink-0 select-none overflow-hidden ${shapeClass} ${className}`}
      style={{
        width: sizePx,
        height: sizePx,
        backgroundColor: src && !imgError ? 'transparent' : defaultBg,
        ...style,
      }}
      {...props}
    >
      {src && !imgError ? (
        <img
          src={src}
          alt={name}
          className="w-full h-full object-cover"
          onError={() => setImgError(true)}
        />
      ) : (
        <span
          className="font-semibold text-white leading-none"
          style={{ fontSize }}
        >
          {initial}
        </span>
      )}
      {status && (
        <span
          className={`absolute bottom-0 right-0 rounded-full border-2 border-white dark:border-neutral-900 ${statusColors[status]}`}
          style={{ width: Math.max(6, sizePx * 0.28), height: Math.max(6, sizePx * 0.28) }}
        />
      )}
    </div>
  );
};

export default BaseAvatar;
// wjz新建文件结束。
