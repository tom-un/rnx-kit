#!/usr/bin/env node
import { addRange } from "@rnx-kit/tools-language";
import {
  findPackage,
  isDirectory,
  isFile,
  readPackage,
} from "@rnx-kit/tools-node";
import { createResolverHost } from "@rnx-kit/typescript-react-native-resolver";
import {
  createDiagnosticWriter,
  readConfigFile,
} from "@rnx-kit/typescript-service";
import chalk from "chalk";
import child_process from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import ts from "typescript";

import { CommandLine, parse } from "./command-line";
import { usage } from "./usage";

function createProgram(cmdLine: CommandLine) {
  const compilerHost = ts.createCompilerHost(cmdLine.tsc.options);

  const {
    platform,
    platformExtensions,
    disableReactNativePackageSubstitution,
    traceReactNativeModuleResolutionErrors,
    traceResolutionLog,
  } = cmdLine.rntsc;

  if (platform) {
    // TODO: needed?
    // changeCompilerHostLikeToUseCache -- assuming this is only an optimization

    // Configure the compiler host to use the react-native module/type resolvers
    const resolverHost = createResolverHost(
      cmdLine.tsc,
      platform,
      platformExtensions,
      !!disableReactNativePackageSubstitution,
      !!traceReactNativeModuleResolutionErrors,
      traceResolutionLog
    );
    compilerHost.resolveModuleNames =
      resolverHost.resolveModuleNames.bind(resolverHost);
    compilerHost.resolveTypeReferenceDirectives =
      resolverHost.resolveTypeReferenceDirectives.bind(resolverHost);

    const programOptions = {
      rootNames: cmdLine.tsc.fileNames,
      options: cmdLine.tsc.options,
      projectReferences: cmdLine.tsc.projectReferences,
      host: compilerHost,
      configFileParsingDiagnostics: ts.getConfigFileParsingDiagnostics(
        cmdLine.tsc
      ),
    };
    const program = ts.createProgram(programOptions);
    return program;
  }

  // No platform given. Use vanilla TypeScript module resolution.
  if (traceResolutionLog) {
    compilerHost.trace = (message: string): void => {
      fs.writeFileSync(traceResolutionLog, message + os.EOL, {
        encoding: "utf-8",
        flag: "a",
      });
    };
  }

  const program = ts.createProgram(
    cmdLine.tsc.fileNames,
    cmdLine.tsc.options,
    compilerHost
  );
  return program;
}

function tsc(...args: string[]): void {
  child_process.spawnSync(
    process.execPath,
    [require.resolve("typescript/lib/tsc"), ...args],
    {
      stdio: "inherit",
    }
  );
}

function reportUnsupportTscOption(optionName: string): never {
  throw new Error(`tsc option '${optionName}' is not currently supported`);
}

function cli(): void {
  const cmdLine = parse(process.argv);

  if (cmdLine.tsc.options.generateCpuProfile) {
    reportUnsupportTscOption("generateCpuProfile");
  }
  if (cmdLine.tsc.options.build) {
    reportUnsupportTscOption("build");
  }
  if (cmdLine.tsc.options.locale) {
    reportUnsupportTscOption("locale");
  }
  if (cmdLine.tsc.options.init) {
    reportUnsupportTscOption("init");
  }

  if (cmdLine.tsc.options.version) {
    const pkgFile = findPackage(module.filename);
    if (pkgFile) {
      const pkg = readPackage(pkgFile);
      console.log("rn-tsc Version " + pkg.version);
    } else {
      console.log("rn-tsc Version Unknown");
    }
    tsc("--version");
    return;
  }
  if (cmdLine.tsc.options.help) {
    usage();
    tsc("--help");
    return;
  }
  if (cmdLine.tsc.options.all) {
    usage();
    tsc("--all");
    return;
  }

  let configFileName: string | undefined = undefined;
  if (cmdLine.tsc.options.project) {
    // project config file was given. make sure no individual files were given.
    if (cmdLine.tsc.fileNames.length !== 0) {
      throw new Error(
        "Cannot use a tsc project file and individually named files together on the command-line"
      );
    }

    const fileOrDirectory = path.normalize(cmdLine.tsc.options.project);
    if (!fileOrDirectory || isDirectory(fileOrDirectory)) {
      configFileName = path.join(fileOrDirectory, "tsconfig.json");
      if (!isFile(configFileName)) {
        throw new Error(
          `Cannot find a tsconfig.json file at the specified directory: ${cmdLine.tsc.options.project}`
        );
      }
    } else {
      configFileName = fileOrDirectory;
      if (!isFile(configFileName)) {
        throw new Error(
          `The specified path does not exist: ${cmdLine.tsc.options.project}`
        );
      }
    }
  } else if (cmdLine.tsc.fileNames.length === 0) {
    // project config file was not given, and no individual files were given.
    // search for a project file.

    configFileName = ts.findConfigFile(process.cwd(), ts.sys.fileExists);
  }

  // at this point, there should be a config file or individual files.
  // if not, then print help and exit.
  if (cmdLine.tsc.fileNames.length === 0 && !configFileName) {
    throw new Error(
      "command-line must include either a TypeScript project file, or one or more source file(s)"
    );
  }

  // TODO: needed?
  // ts.convertToOptionsWithAbsolutePaths -- create new ParsedCommandLine with all path props made absolute using the cwd

  if (configFileName) {
    const parsedConfig = readConfigFile(
      configFileName,
      cmdLine.tsc.options,
      cmdLine.tsc.watchOptions
    );
    if (!parsedConfig) {
      throw new Error(`failed to load configuration file '${configFileName}'`);
    } else if (parsedConfig.errors.length > 0) {
      const writer = createDiagnosticWriter();
      parsedConfig.errors.forEach((e) => writer.print(e));
      throw new Error(`failed to load configuration file '${configFileName}'`);
    }

    if (parsedConfig.options.showConfig) {
      reportUnsupportTscOption("showConfig");
    }
    if (
      parsedConfig.options.watch &&
      Object.prototype.hasOwnProperty.call(parsedConfig.options, "watch")
    ) {
      reportUnsupportTscOption("watch");
    }

    if (parsedConfig.options.diagnostics) {
      reportUnsupportTscOption("diagnostics");
    }
    if (parsedConfig.options.extendedDiagnostics) {
      reportUnsupportTscOption("extendedDiagnostics");
    }
    if (parsedConfig.options.generateTrace) {
      reportUnsupportTscOption("generateTrace");
    }

    //  we don't support TypeScripts specialized resolver config -- only normal node lookups
    if (parsedConfig.options.baseUrl) {
      reportUnsupportTscOption("baseUrl");
    }
    if (parsedConfig.options.paths) {
      reportUnsupportTscOption("paths");
    }
    if (parsedConfig.options.rootDirs) {
      reportUnsupportTscOption("rootDirs");
    }

    if (parsedConfig.options.incremental) {
      // TODO: performIncrementalCompilation
      reportUnsupportTscOption("incremental");
    }
    if (parsedConfig.options.composite) {
      // TODO: performIncrementalCompilation
      reportUnsupportTscOption("composite");
    }

    cmdLine.tsc = parsedConfig;
  } else {
    // no config file -- just file names on the command-line

    if (
      cmdLine.tsc.options.watch &&
      Object.prototype.hasOwnProperty.call(cmdLine.tsc.options, "watch")
    ) {
      reportUnsupportTscOption("watch");
    }

    //  we don't support TypeScripts specialized resolver config -- only normal node lookups
    if (cmdLine.tsc.options.baseUrl) {
      reportUnsupportTscOption("baseUrl");
    }
    if (cmdLine.tsc.options.paths) {
      reportUnsupportTscOption("paths");
    }
    if (cmdLine.tsc.options.rootDirs) {
      reportUnsupportTscOption("rootDirs");
    }

    if (cmdLine.tsc.options.incremental) {
      // TODO: performIncrementalCompilation
      reportUnsupportTscOption("incremental");
    }
    if (cmdLine.tsc.options.composite) {
      // TODO: performIncrementalCompilation
      reportUnsupportTscOption("composite");
    }
  }

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

export type { CommandLine } from "./command-line";

export enum DiagnosticCategory {
  Warning = ts.DiagnosticCategory.Warning,
  Error = ts.DiagnosticCategory.Error,
  Suggestion = ts.DiagnosticCategory.Suggestion,
  Message = ts.DiagnosticCategory.Message,
}
export type Diagnostic = ts.Diagnostic;

export function build(cmdLine: CommandLine): Diagnostic[] {
  const program = createProgram(cmdLine);
  const emitResult = program.emit();
  const diagnostics = emitResult.diagnostics.concat(
    ts.getPreEmitDiagnostics(program)
  );
  const diagnosticsSortedDeduped = Array.from(
    ts.sortAndDeduplicateDiagnostics(diagnostics)
  );
  return diagnosticsSortedDeduped;
}

if (require.main === module) {
  try {
    cli();
  } catch (e) {
    let message: string;
    if (e instanceof Error) {
      message = e.message;
      if (e.stack) {
        message += os.EOL + e.stack;
      }
    } else if (typeof e in ["string", "number", "boolean", "object"]) {
      message = (
        e as string | number | boolean | Record<string, unknown>
      ).toString();
    } else {
      message = "Internal error occurred";
    }
    console.error(chalk.redBright("ERROR: ") + chalk.red(message) + os.EOL);
    process.exit(1);
  }

  process.exit(0);
}
