// wjz新建文件，新建原因：封装规范化 Modal 对话框基础公共组件，修改时间：2026-08-18。
// 文件内容概述：基于 Radix Dialog 封装的标准化 Modal 组件，包含标题、描述、关闭按钮与操作栏。
import React from 'react';
import { X } from 'lucide-react';
import {
  AppDialog,
  AppDialogClose,
  AppDialogContent,
  AppDialogDescription,
  AppDialogTitle,
} from '../../overlay-primitives';

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className = '',
  size = 'md',
}: ModalProps) {
  return (
    <AppDialog open={open} onOpenChange={onOpenChange}>
      <AppDialogContent className={['modal-dialog-content', `modal-${size}`, className].filter(Boolean).join(' ')}>
        <div className="modal-dialog-header">
          {title && <AppDialogTitle className="modal-dialog-title">{title}</AppDialogTitle>}
          {description && <AppDialogDescription className="modal-dialog-description">{description}</AppDialogDescription>}
          <AppDialogClose className="modal-dialog-close-btn" aria-label="关闭">
            <X size={16} aria-hidden="true" />
          </AppDialogClose>
        </div>

        <div className="modal-dialog-body">{children}</div>

        {footer && <div className="modal-dialog-footer">{footer}</div>}
      </AppDialogContent>
    </AppDialog>
  );
}
// wjz新建文件结束。
