import { Moon, Sun } from "lucide-react";
import { useDashboardStore } from "@/store/dashboard.store";
import { Button } from "@/components/ui/button";
import { useEffect } from "react";

export function ThemeToggle() {
  const { theme, toggleTheme } = useDashboardStore();

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
    >
      {theme === "light" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
    </Button>
  );
}
