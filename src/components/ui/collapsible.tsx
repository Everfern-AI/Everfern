"use client";

import React, { createContext, useContext, useState, forwardRef } from "react";
import { cn } from "@/lib/utils";

interface CollapsibleContextType {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CollapsibleContext = createContext<CollapsibleContextType | null>(null);

export interface CollapsibleProps extends React.HTMLAttributes<HTMLDivElement> {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export const Collapsible = forwardRef<HTMLDivElement, CollapsibleProps>(({
  open: controlledOpen,
  onOpenChange,
  defaultOpen = false,
  className,
  children,
  ...props
}, ref) => {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;

  const handleOpenChange = (newOpen: boolean) => {
    if (!isControlled) {
      setUncontrolledOpen(newOpen);
    }
    onOpenChange?.(newOpen);
  };

  return (
    <CollapsibleContext.Provider value={{ open, onOpenChange: handleOpenChange }}>
      <div
        ref={ref}
        data-slot="collapsible"
        data-state={open ? "open" : "closed"}
        className={cn(className)}
        {...props}
      >
        {children}
      </div>
    </CollapsibleContext.Provider>
  );
});
Collapsible.displayName = "Collapsible";

export interface CollapsibleTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
}

export const CollapsibleTrigger = forwardRef<HTMLButtonElement, CollapsibleTriggerProps>(({
  className,
  onClick,
  children,
  ...props
}, ref) => {
  const ctx = useContext(CollapsibleContext);

  return (
    <button
      ref={ref}
      type="button"
      data-slot="collapsible-trigger"
      data-state={ctx?.open ? "open" : "closed"}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented && ctx) {
          ctx.onOpenChange(!ctx.open);
        }
      }}
      className={cn(className)}
      {...props}
    >
      {children}
    </button>
  );
});
CollapsibleTrigger.displayName = "CollapsibleTrigger";

export interface CollapsibleContentProps extends React.HTMLAttributes<HTMLDivElement> {}

export const CollapsibleContent = forwardRef<HTMLDivElement, CollapsibleContentProps>(({
  className,
  children,
  style,
  ...props
}, ref) => {
  const ctx = useContext(CollapsibleContext);
  const open = ctx?.open ?? true;

  if (!open) return null;

  return (
    <div
      ref={ref}
      data-slot="collapsible-content"
      data-state="open"
      className={cn(className)}
      style={style}
      {...props}
    >
      {children}
    </div>
  );
});
CollapsibleContent.displayName = "CollapsibleContent";

export default Collapsible;
