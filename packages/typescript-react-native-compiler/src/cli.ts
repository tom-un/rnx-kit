import { parseCommandLine } from "./command-line";
import { compile, showAllHelp, showHelp, showVersion } from "./commands";
import { getTsConfigFromFile } from "./config";
import { reportUnsupportedTscOptions } from "./unsupported";

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

  compile(cmdLine);
}
