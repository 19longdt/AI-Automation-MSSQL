import { MissingIndex, ParsedPlan, Statement } from "../types/plan";

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function attrValue(tag: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`${escaped}="([^"]*)"`, "i").exec(tag);
  return m ? decodeXmlEntities(m[1]) : undefined;
}

export function extractStatementsFromXml(xml: string): Statement[] {
  const out: Statement[] = [];
  const re = /<[^>]*\bStatementText="([^"]*)"[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) != null) {
    out.push({ statement_text: decodeXmlEntities(m[1]) });
  }
  return out;
}

export function extractMissingIndexesFromXml(xml: string): MissingIndex[] {
  const out: MissingIndex[] = [];
  const missingIndexRe = /<MissingIndex\b[^>]*>([\s\S]*?)<\/MissingIndex>/gi;
  let m: RegExpExecArray | null;

  while ((m = missingIndexRe.exec(xml)) != null) {
    const fullTagStart = /<MissingIndex\b[^>]*>/i.exec(m[0]);
    const header = fullTagStart ? fullTagStart[0] : "";
    const body = m[1] || "";

    const item: MissingIndex = {
      database: attrValue(header, "Database"),
      schema: attrValue(header, "Schema"),
      table: attrValue(header, "Table"),
      equality_columns: [],
      inequality_columns: [],
      include_columns: []
    };

    const groupRe = /<ColumnGroup\b[^>]*Usage="([^"]*)"[^>]*>([\s\S]*?)<\/ColumnGroup>/gi;
    let g: RegExpExecArray | null;
    while ((g = groupRe.exec(body)) != null) {
      const usage = (g[1] || "").toUpperCase();
      const cols = g[2] || "";
      const colRe = /<Column\b[^>]*Name="([^"]*)"[^>]*\/?>(?:<\/Column>)?/gi;
      let c: RegExpExecArray | null;
      while ((c = colRe.exec(cols)) != null) {
        const name = decodeXmlEntities(c[1]);
        if (usage === "EQUALITY") item.equality_columns.push(name);
        else if (usage === "INEQUALITY") item.inequality_columns.push(name);
        else item.include_columns.push(name);
      }
    }

    out.push(item);
  }

  return out;
}

export function extractStatements(docLike: { xml?: string }): Statement[] {
  return extractStatementsFromXml(String((docLike && docLike.xml) || ""));
}

export function extractMissingIndexes(docLike: { xml?: string }): MissingIndex[] {
  return extractMissingIndexesFromXml(String((docLike && docLike.xml) || ""));
}

export function parseShowPlan(xml: string): ParsedPlan {
  return {
    statements: extractStatementsFromXml(xml),
    missing_indexes: extractMissingIndexesFromXml(xml)
  };
}
