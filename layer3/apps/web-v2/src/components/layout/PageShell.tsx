import { cn } from "@/lib/utils";

interface Props {
  children: React.ReactNode;
  className?: string;
}

export function PageShell({ children, className }: Props) {
  return (
    <div className={cn("max-w-screen-2xl mx-auto px-4 py-3 h-full min-h-0", className)}>
      {children}
    </div>
  );
}
