import ts from "typescript";
import { createDiagnosticWriter } from "./diagnostics";

export function findConfigFile(
  searchPath: string,
  fileName = "tsconfig.json"
): string | undefined {
  return ts.findConfigFile(searchPath, ts.sys.fileExists, fileName);
}

export function readConfigFile(
  configFileName: string,
  optionsToExtend?: ts.CompilerOptions,
  watchOptionsToExtend?: ts.WatchOptions,
  onUnRecoverableConfigFileDiagnostic?: (diagnostic: ts.Diagnostic) => void,
  trace?: (message: string) => void
): ts.ParsedCommandLine | undefined {
  if (!onUnRecoverableConfigFileDiagnostic) {
    const writer = createDiagnosticWriter();
    onUnRecoverableConfigFileDiagnostic = writer.print;
  }
  const host: ts.ParseConfigFileHost = {
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
    readDirectory: ts.sys.readDirectory,
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    trace,
    onUnRecoverableConfigFileDiagnostic,
    getCurrentDirectory: ts.sys.getCurrentDirectory,
  };

  const extendedConfigCache = new Map();

  return ts.getParsedCommandLineOfConfigFile(
    configFileName,
    optionsToExtend,
    host,
    extendedConfigCache,
    watchOptionsToExtend
  );
}
