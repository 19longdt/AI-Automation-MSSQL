import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-content-center gap-1.5 whitespace-nowrap rounded-md text-[13px] font-medium transition-all duration-150 cursor-pointer border select-none disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-1 active:scale-[0.98]",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--color-primary)] text-white border-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] hover:border-[var(--color-primary-hover)]",
        secondary:
          "bg-[var(--color-surface-2)] text-[var(--color-text)] border-[var(--color-border-2)] hover:bg-[var(--color-surface-3)]",
        ghost:
          "bg-transparent border-transparent text-[var(--color-muted)] hover:bg-[var(--color-row-hover)] hover:text-[var(--color-text)]",
        danger:
          "bg-[var(--color-critical-soft)] text-[var(--color-critical)] border-[var(--color-critical-soft)] hover:bg-[var(--color-critical)] hover:text-white hover:border-[var(--color-critical)]",
        outline:
          "bg-transparent text-[var(--color-text)] border-[var(--color-border-2)] hover:bg-[var(--color-row-hover)]",
      },
      size: {
        default: "h-8 px-3.5 py-1.5",
        sm:      "h-7 px-2.5 py-1 text-xs",
        lg:      "h-10 px-5 py-2 text-sm",
        icon:    "h-8 w-8 p-0",
      },
    },
    defaultVariants: { variant: "secondary", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        disabled={disabled || loading}
        aria-busy={loading}
        {...props}
      >
        {loading && (
          <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
        )}
        {children}
      </Comp>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
