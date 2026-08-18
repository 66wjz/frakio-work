// wjz新建文件，新建原因：封装规范化 Card 基础公共组件，修改时间：2026-08-18。
// 文件内容概述：包含 Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter 的通用卡片组件。
import React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'elevated' | 'outlined' | 'muted';
}

export function Card({ variant = 'default', className = '', children, ...props }: CardProps) {
  return (
    <div className={['card-container', `card-${variant}`, className].filter(Boolean).join(' ')} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ className = '', children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={['card-header', className].filter(Boolean).join(' ')} {...props}>
      {children}
    </div>
  );
}

export function CardTitle({ className = '', children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={['card-title', className].filter(Boolean).join(' ')} {...props}>
      {children}
    </h3>
  );
}

export function CardDescription({ className = '', children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={['card-description', className].filter(Boolean).join(' ')} {...props}>
      {children}
    </p>
  );
}

export function CardContent({ className = '', children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={['card-content', className].filter(Boolean).join(' ')} {...props}>
      {children}
    </div>
  );
}

export function CardFooter({ className = '', children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={['card-footer', className].filter(Boolean).join(' ')} {...props}>
      {children}
    </div>
  );
}
// wjz新建文件结束。
