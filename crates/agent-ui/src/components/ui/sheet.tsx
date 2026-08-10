import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";
import { X } from "@liveagent/app/components/icons";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "../../lib/shared/utils";
import { Button } from "./button";

export const Sheet = SheetPrimitive.Root;
export const SheetTrigger = SheetPrimitive.Trigger;
export const SheetClose = SheetPrimitive.Close;

const sheetVariants = cva(
  "fixed z-[101] flex flex-col bg-background text-foreground shadow-2xl outline-none transition-[transform,opacity] duration-200 ease-out data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
  {
    variants: {
      side: {
        top: "inset-x-0 top-0 max-h-[85dvh] border-b data-[starting-style]:-translate-y-full data-[ending-style]:-translate-y-full",
        bottom:
          "inset-x-0 bottom-0 max-h-[85dvh] border-t data-[starting-style]:translate-y-full data-[ending-style]:translate-y-full",
        left: "inset-y-0 left-0 h-full w-full border-r data-[starting-style]:-translate-x-full data-[ending-style]:-translate-x-full sm:max-w-lg",
        right:
          "inset-y-0 right-0 h-full w-full border-l data-[starting-style]:translate-x-full data-[ending-style]:translate-x-full sm:max-w-lg",
      },
    },
    defaultVariants: {
      side: "right",
    },
  },
);

type SheetContentProps = React.ComponentPropsWithoutRef<typeof SheetPrimitive.Popup> &
  VariantProps<typeof sheetVariants> & {
    closeLabel?: string;
    showClose?: boolean;
  };

export const SheetContent = React.forwardRef<HTMLDivElement, SheetContentProps>(
  ({ side, className, children, closeLabel = "Close", showClose = true, ...props }, ref) => (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Backdrop className="fixed inset-0 z-[100] bg-black/35 backdrop-blur-[2px] transition-opacity duration-200 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0" />
      <SheetPrimitive.Popup ref={ref} className={cn(sheetVariants({ side }), className)} {...props}>
        {children}
        {showClose ? (
          <SheetPrimitive.Close
            render={
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-4 top-4 h-8 w-8 text-muted-foreground hover:text-foreground"
                aria-label={closeLabel}
                title={closeLabel}
              />
            }
          >
            <X className="h-4 w-4" />
          </SheetPrimitive.Close>
        ) : null}
      </SheetPrimitive.Popup>
    </SheetPrimitive.Portal>
  ),
);

SheetContent.displayName = "SheetContent";

export const SheetHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col gap-1.5", className)} {...props} />
  ),
);
SheetHeader.displayName = "SheetHeader";

export const SheetFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("mt-auto flex items-center justify-end gap-2", className)}
      {...props}
    />
  ),
);
SheetFooter.displayName = "SheetFooter";

export const SheetTitle = React.forwardRef<
  HTMLHeadingElement,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title
    ref={ref}
    className={cn("text-base font-semibold text-foreground", className)}
    {...props}
  />
));
SheetTitle.displayName = "SheetTitle";

export const SheetDescription = React.forwardRef<
  HTMLParagraphElement,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
SheetDescription.displayName = "SheetDescription";
