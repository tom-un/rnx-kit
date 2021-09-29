import ts from "typescript";
import { createDiagnosticWriter, DiagnosticWriter } from "./diagnostics";
import { isNonEmptyArray } from "./util";

export type CommandLine = ts.ParsedCommandLine;

export function parseCommandLine(
  args: string[],
  diagnosticWriter?: DiagnosticWriter
): CommandLine | undefined {
  const commandLine = ts.parseCommandLine(args, ts.sys.readFile);
  if (commandLine) {
    if (isNonEmptyArray(commandLine.errors)) {
      const writer = diagnosticWriter ?? createDiagnosticWriter();
      commandLine.errors.forEach((e) => writer.print(e));
      return undefined;
    }
  }

  return commandLine;
}
