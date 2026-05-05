import { ValidationResult } from "../types/plan";

export function validateShowPlan(xml: string): ValidationResult {
  const errors: string[] = [];

  if (!xml || !xml.trim()) {
    errors.push("Empty XML input.");
    return { valid: false, errors };
  }

  if (!/<\?xml|<ShowPlanXML[\s>]/i.test(xml)) {
    errors.push("Not a SQL Server ShowPlan XML document.");
  }

  // A lightweight structural guard (full XML validation is deferred to browser parser / future Phase C).
  const openTag = (xml.match(/<ShowPlanXML\b/gi) || []).length;
  const closeTag = (xml.match(/<\/ShowPlanXML>/gi) || []).length;
  if (openTag === 0 || closeTag === 0) {
    errors.push("ShowPlanXML root tag is missing or incomplete.");
  }

  return { valid: errors.length === 0, errors };
}
