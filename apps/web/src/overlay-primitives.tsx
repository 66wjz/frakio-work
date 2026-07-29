import React from 'react';
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { ChevronRight } from 'lucide-react';

function classes(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

export const AppMenu = DropdownMenuPrimitive.Root;
export const AppMenuTrigger = DropdownMenuPrimitive.Trigger;
export const AppMenuSub = DropdownMenuPrimitive.Sub;

export const AppMenuContent = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 6, collisionPadding = 8, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      className={classes('app-overlay-surface app-menu-surface', className)}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
));
AppMenuContent.displayName = 'AppMenuContent';

export const AppMenuItem = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & { variant?: 'default' | 'destructive' }
>(({ className, variant = 'default', ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={classes('app-menu-item', variant === 'destructive' && 'destructive', className)}
    {...props}
  />
));
AppMenuItem.displayName = 'AppMenuItem';

export const AppMenuSeparator = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator ref={ref} className={classes('app-menu-separator', className)} {...props} />
));
AppMenuSeparator.displayName = 'AppMenuSeparator';

export const AppMenuSubTrigger = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.SubTrigger ref={ref} className={classes('app-menu-item app-menu-sub-trigger', className)} {...props}>
    {children}
    <ChevronRight size={14} aria-hidden="true" />
  </DropdownMenuPrimitive.SubTrigger>
));
AppMenuSubTrigger.displayName = 'AppMenuSubTrigger';

export const AppMenuSubContent = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(({ className, sideOffset = 4, collisionPadding = 8, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.SubContent
      ref={ref}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      className={classes('app-overlay-surface app-menu-surface', className)}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
));
AppMenuSubContent.displayName = 'AppMenuSubContent';

export const AppContextMenu = ContextMenuPrimitive.Root;
export const AppContextMenuTrigger = ContextMenuPrimitive.Trigger;

export const AppContextMenuContent = React.forwardRef<
  React.ComponentRef<typeof ContextMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(({ className, collisionPadding = 8, ...props }, ref) => (
  <ContextMenuPrimitive.Portal>
    <ContextMenuPrimitive.Content
      ref={ref}
      collisionPadding={collisionPadding}
      className={classes('app-overlay-surface app-menu-surface', className)}
      {...props}
    />
  </ContextMenuPrimitive.Portal>
));
AppContextMenuContent.displayName = 'AppContextMenuContent';

export const AppContextMenuItem = React.forwardRef<
  React.ComponentRef<typeof ContextMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item> & { variant?: 'default' | 'destructive' }
>(({ className, variant = 'default', ...props }, ref) => (
  <ContextMenuPrimitive.Item
    ref={ref}
    className={classes('app-menu-item', variant === 'destructive' && 'destructive', className)}
    {...props}
  />
));
AppContextMenuItem.displayName = 'AppContextMenuItem';

export const AppContextMenuSeparator = React.forwardRef<
  React.ComponentRef<typeof ContextMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Separator ref={ref} className={classes('app-menu-separator', className)} {...props} />
));
AppContextMenuSeparator.displayName = 'AppContextMenuSeparator';

export const AppPopover = PopoverPrimitive.Root;
export const AppPopoverTrigger = PopoverPrimitive.Trigger;
export const AppPopoverAnchor = PopoverPrimitive.Anchor;

export const AppPopoverContent = React.forwardRef<
  React.ComponentRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, sideOffset = 6, collisionPadding = 8, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      className={classes('app-overlay-surface app-popover-surface', className)}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
AppPopoverContent.displayName = 'AppPopoverContent';

export const AppDialog = DialogPrimitive.Root;
export const AppDialogTrigger = DialogPrimitive.Trigger;
export const AppDialogClose = DialogPrimitive.Close;

export const AppDialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="app-dialog-backdrop" />
    <DialogPrimitive.Content ref={ref} className={classes('app-overlay-surface app-dialog-surface', className)} {...props}>
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
AppDialogContent.displayName = 'AppDialogContent';

export const AppDialogTitle = DialogPrimitive.Title;
export const AppDialogDescription = DialogPrimitive.Description;

export const AppAlertDialog = AlertDialogPrimitive.Root;
export const AppAlertDialogCancel = AlertDialogPrimitive.Cancel;
export const AppAlertDialogAction = AlertDialogPrimitive.Action;

export const AppAlertDialogContent = React.forwardRef<
  React.ComponentRef<typeof AlertDialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <AlertDialogPrimitive.Portal>
    <AlertDialogPrimitive.Overlay className="app-dialog-backdrop app-alert-backdrop" />
    <AlertDialogPrimitive.Content ref={ref} className={classes('app-overlay-surface app-dialog-surface app-alert-surface', className)} {...props}>
      {children}
    </AlertDialogPrimitive.Content>
  </AlertDialogPrimitive.Portal>
));
AppAlertDialogContent.displayName = 'AppAlertDialogContent';

export const AppAlertDialogTitle = AlertDialogPrimitive.Title;
export const AppAlertDialogDescription = AlertDialogPrimitive.Description;
