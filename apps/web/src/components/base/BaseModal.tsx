// wjz新建文件，新建原因：封装基础模态框组件 BaseModal，修改时间：2026-08-18。
// 文件内容概述：基于 Radix Dialog 封装遮罩层、居中窗口、头部标题、内容区域、底部按钮与关闭动作。
import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { BaseIcon } from './BaseIcon';

export interface BaseModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '4xl' | 'full';
  showCloseButton?: boolean;
}

export const BaseModal: React.FC<BaseModalProps> = ({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  maxWidth = 'md',
  showCloseButton = true,
}) => {
  const widthClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '4xl': 'max-w-4xl',
    full: 'max-w-[95vw] h-[90vh]',
  }[maxWidth];

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 animate-fade-in" />
        <Dialog.Content
          className={`
            fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 
            w-full ${widthClasses} bg-[var(--mac-card-bg,#ffffff)] 
            rounded-2xl border border-[var(--mac-border)] shadow-2xl z-50 
            flex flex-col max-h-[90vh] overflow-hidden animate-scale-in
          `}
        >
          {(title || showCloseButton) && (
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--mac-border)]">
              <div>
                {title && (
                  <Dialog.Title className="text-base font-semibold text-[var(--mac-text)]">
                    {title}
                  </Dialog.Title>
                )}
                {description && (
                  <Dialog.Description className="text-xs text-[var(--mac-text-muted,#6b7280)] mt-0.5">
                    {description}
                  </Dialog.Description>
                )}
              </div>
              {showCloseButton && (
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="w-7 h-7 rounded-full flex items-center justify-center text-[var(--mac-text-muted,#6b7280)] hover:bg-[var(--mac-surface-hover,rgba(0,0,0,0.05))] hover:text-[var(--mac-text)] transition-colors"
                  >
                    <BaseIcon name="x" size={15} />
                  </button>
                </Dialog.Close>
              )}
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>

          {footer && (
            <div className="flex items-center justify-end gap-2 px-6 py-3.5 bg-[var(--mac-surface-muted,rgba(0,0,0,0.015))] border-t border-[var(--mac-border)]">
              {footer}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export default BaseModal;
// wjz新建文件结束。
