export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface Statement {
  statement_text: string;
}

export interface MissingIndex {
  database?: string;
  schema?: string;
  table?: string;
  equality_columns: string[];
  inequality_columns: string[];
  include_columns: string[];
}

export interface ParsedPlan {
  statements: Statement[];
  missing_indexes: MissingIndex[];
}
