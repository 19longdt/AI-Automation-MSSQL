function unwrapPlanValue(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && v.charAt(0) === "(" && v.charAt(v.length - 1) === ")") {
    return v.substring(1, v.length - 1);
  }
  return v;
}

function isIdentChar(ch: string): boolean {
  return /[A-Za-z0-9_#$]/.test(ch);
}

export function replaceSqlParameters(sql: string, paramMap: Record<string, string>): string {
  const caseInsensitiveMap: Record<string, string> = {};
  Object.keys(paramMap).forEach((k) => {
    caseInsensitiveMap[k.toLowerCase()] = paramMap[k];
  });

  let result = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql.charAt(i);
    if (ch === "@") {
      if (i > 0 && isIdentChar(sql.charAt(i - 1))) {
        result += ch;
        i++;
        continue;
      }

      let j = i + 1;
      while (j < sql.length && isIdentChar(sql.charAt(j))) {
        j++;
      }

      const token = sql.substring(i, j);
      const replacement = caseInsensitiveMap[token.toLowerCase()];
      if (replacement != null) {
        result += replacement;
        i = j;
        continue;
      }
    }

    result += ch;
    i++;
  }

  return result;
}

export function stripLeadingParamsPrelude(sql: string): string {
  return sql.replace(/^\s*\((?:[^()]|\([^)]*\))*\)\s*(?=(select|with|insert|update|delete|merge|exec)\b)/i, "");
}

export function resolveStatementQuery(text: string, params: Record<string, string>): string {
  return stripLeadingParamsPrelude(replaceSqlParameters(text, params));
}

export function mergeParamMaps(baseMap: Record<string, string>, overrideMap: Record<string, string>): Record<string, string> {
  return { ...baseMap, ...overrideMap };
}

export function extractParamMap(node: any): Record<string, string> {
  const map: Record<string, string> = {};
  const all = node.getElementsByTagName("*");
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    if (el.localName !== "ColumnReference") continue;

    const paramName = el.getAttribute("Column");
    if (!paramName || paramName.charAt(0) !== "@") continue;

    const value = el.getAttribute("ParameterRuntimeValue") || el.getAttribute("ParameterCompiledValue");
    if (!value) continue;

    map[paramName] = unwrapPlanValue(value);
  }
  return map;
}
