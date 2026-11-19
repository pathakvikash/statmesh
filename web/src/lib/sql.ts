/** SQL string literal: single quotes doubled. The only way user-influenced text may enter generated SQL. */
export const sqlLiteral = (s: string): string => `'${s.replaceAll("'", "''").replaceAll("\0", "")}'`;
export const sqlList = (xs: string[]): string => xs.map(sqlLiteral).join(", ");
