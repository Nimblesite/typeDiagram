export type Severity = "error" | "warning";

export interface Diagnostic {
  severity: Severity;
  message: string;
  line: number;
  col: number;
  length: number;
}

export class DiagnosticBag {
  readonly items: Diagnostic[] = [];

  error(message: string, line: number, col: number, length = 1): void {
    this.items.push({ severity: "error", message, line, col, length });
  }

  warning(message: string, line: number, col: number, length = 1): void {
    this.items.push({ severity: "warning", message, line, col, length });
  }

  hasErrors(): boolean {
    return this.items.some((d) => d.severity === "error");
  }
}

export function formatDiagnostic(d: Diagnostic): string {
  const pos = `${String(d.line)}:${String(d.col)}`.padStart(6);
  return `${pos}  ${d.severity.padEnd(7)} ${d.message}`;
}

export function formatDiagnostics(items: readonly Diagnostic[]): string {
  return items.map(formatDiagnostic).join("\n");
}
