import { addRange } from "@rnx-kit/tools-language";
import { createDiagnosticWriter } from "@rnx-kit/typescript-service";
import ts from "typescript";

import { parseCommandLine } from "./command-line";
import { getTsConfigFromFile } from "./config";
import { reportUnsupportedTscOptions } from "./error";
import { showAllHelp, showHelp } from "./help";
import { createProgram } from "./program";
import { showVersion } from "./version";

export function cli(): void {
  const cmdLine = parseCommandLine(process.argv);

  if (cmdLine.ts.options.version) {
    showVersion();
    return;
  }
  if (cmdLine.ts.options.help) {
    showHelp();
    return;
  }
  if (cmdLine.ts.options.all) {
    showAllHelp();
    return;
  }

  reportUnsupportedTscOptions(cmdLine.ts.options, [
    "generateCpuProfile",
    "build",
    "locale",
    "init",
  ]);

  const config = getTsConfigFromFile(cmdLine);
  if (config) {
    cmdLine.ts = config;
  }

  reportUnsupportedTscOptions(cmdLine.ts.options, [
    "showConfig",
    "diagnostics",
    "extendedDiagnostics",
    "generateTrace",
    "watch",
    "baseUrl",
    "paths",
    "rootDirs",
    "incremental",
    "composite",
  ]);

  const program = createProgram(cmdLine);

  const isListFilesOnly = program.getCompilerOptions().listFilesOnly;

  const allDiagnostics = program.getConfigFileParsingDiagnostics().slice();
  const configFileParsingDiagnosticsLength = allDiagnostics.length;
  addRange(
    allDiagnostics,
    program.getSyntacticDiagnostics() as ts.Diagnostic[]
  );
  if (allDiagnostics.length === configFileParsingDiagnosticsLength) {
    addRange(allDiagnostics, program.getOptionsDiagnostics());
    if (!isListFilesOnly) {
      addRange(allDiagnostics, program.getGlobalDiagnostics());
      if (allDiagnostics.length === configFileParsingDiagnosticsLength) {
        addRange(allDiagnostics, program.getSemanticDiagnostics());
      }
    }
  }

  const emitResult = isListFilesOnly
    ? { emitSkipped: true, diagnostics: [] }
    : program.emit();
  addRange(allDiagnostics, emitResult.diagnostics);

  const diagnostics = Array.from(
    ts.sortAndDeduplicateDiagnostics(allDiagnostics)
  );
  if (diagnostics.length > 0) {
    const writer = createDiagnosticWriter();
    let errors = 0;

    diagnostics.forEach((d) => {
      writer.print(d);
      if (d.category === ts.DiagnosticCategory.Error) {
        errors++;
      }
    });

    if (errors > 0) {
      console.log("");
      console.log(errors === 1 ? "Found 1 error." : `Found ${errors} errors.`);
      console.log("");
    }
  }
}
