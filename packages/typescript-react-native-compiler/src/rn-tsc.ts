#!/usr/bin/env node

import { addRange } from "@rnx-kit/tools-language";
import {
  findPackage,
  readPackage,
  isDirectory,
  isFile,
} from "@rnx-kit/tools-node";
import { createResolverHost } from "@rnx-kit/typescript-react-native-resolver";
import {
  Service,
  createDiagnosticWriter,
  parseCommandLine,
} from "@rnx-kit/typescript-service";
import chalk from "chalk";
import child_process from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { usage } from "./usage";

// TODO: remove this -- careful, it is needed for running 'tsc', not just access ts APIs
import ts from "typescript";

function tsc(...args: string[]): number {
  const child = child_process.spawnSync(
    process.execPath,
    [require.resolve("typescript/lib/tsc"), ...args],
    {
      stdio: "inherit",
    }
  );

  // No status means that the child process exited because of a signal.
  // Treat that as an internal error.
  return child.status ?? ExitCode.InternalError;
}

const enum ExitCode {
  Success = 0,
  UsageError = 1,
  UnsupportedTscFeature = 2,
  EmitSkipped = 3,
  EmitFailed = 4,
  InternalError = 5,
}

function error(message: string, code: ExitCode): ExitCode {
  console.error(chalk.redBright("ERROR: ") + chalk.red(message) + os.EOL);
  return code;
}

function errorUnsupportTscCliArgument(argName: string): ExitCode {
  console.error(
    chalk.redBright("ERROR: ") +
      chalk.red(
        `tsc command-line parameter '${argName}' is not currently supported`
      ) +
      os.EOL
  );
  return ExitCode.UnsupportedTscFeature;
}

function errorUnsupportTscOption(optionName: string): ExitCode {
  console.error(
    chalk.redBright("ERROR: ") +
      chalk.red(`tsc option '${optionName}' is not currently supported`) +
      os.EOL
  );
  return ExitCode.UnsupportedTscFeature;
}

function extractCommandLineParameterValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index !== -1) {
    if (index === process.argv.length - 1) {
      usage();
      throw error(`${name} must be followed by a value`, ExitCode.UsageError);
    }
    const value = process.argv[index + 1];
    process.argv.splice(index, 2);
    return value;
  }
  return undefined;
}

function extractCommandLineParameterFlag(name: string): boolean {
  const index = process.argv.indexOf(name);
  if (index !== -1) {
    process.argv.splice(index, 1);
    return true;
  }
  return false;
}

function reportCommandLineParameterDependencyViolation(
  dependent: string,
  dependee: string
): never {
  usage();
  throw error(
    `${dependent} can only be used in conjunction with ${dependee}`,
    ExitCode.UsageError
  );
}

function cli(): ExitCode {
  let platform: string | undefined;
  let platformExtensions: string[] | undefined;
  let disableReactNativePackageSubstitution: boolean;
  let traceReactNativeModuleResolutionErrors: boolean;
  let traceResolutionLog: string | undefined;

  try {
    platform = extractCommandLineParameterValue("--platform");

    platformExtensions = extractCommandLineParameterValue(
      "--platformExtensions"
    )?.split(",");
    if (!platform && platformExtensions) {
      reportCommandLineParameterDependencyViolation(
        "--platformExtensions",
        "--platform"
      );
    }

    disableReactNativePackageSubstitution = extractCommandLineParameterFlag(
      "--disableReactNativePackageSubstitution"
    );
    if (!platform && disableReactNativePackageSubstitution) {
      reportCommandLineParameterDependencyViolation(
        "--disableReactNativePackageSubstitution",
        "--platform"
      );
    }

    traceReactNativeModuleResolutionErrors = extractCommandLineParameterFlag(
      "--traceReactNativeModuleResolutionErrors"
    );
    if (!platform && traceReactNativeModuleResolutionErrors) {
      reportCommandLineParameterDependencyViolation(
        "--traceReactNativeModuleResolutionErrors",
        "--platform"
      );
    }

    traceResolutionLog = extractCommandLineParameterValue(
      "--traceResolutionLog"
    );
  } catch (exitCode) {
    return typeof exitCode === "number" ? exitCode : ExitCode.InternalError;
  }

  if (process.argv.length > 2) {
    // TSC command line

    if (process.argv[2].toLowerCase() === "--build") {
      return errorUnsupportTscCliArgument("--build");
    } else if (process.argv[2].toLowerCase() === "-b") {
      return errorUnsupportTscCliArgument("-b");
    }
  }

  const diagnosticWriter = createDiagnosticWriter();
  const parsedCommandLine = parseCommandLine(
    process.argv.slice(2),
    diagnosticWriter
  );
  if (!parsedCommandLine) {
    return ExitCode.UsageError;
  }

  if (parsedCommandLine.options.generateCpuProfile) {
    return errorUnsupportTscOption("generateCpuProfile");
  }

  if (parsedCommandLine.options.build) {
    return errorUnsupportTscOption("build");
  }
  if (parsedCommandLine.options.locale) {
    return errorUnsupportTscOption("locale");
  }
  if (parsedCommandLine.errors.length > 0) {
    parsedCommandLine.errors.forEach((e) => diagnosticWriter.print(e));
    return ExitCode.UsageError;
  }

  if (parsedCommandLine.options.init) {
    return errorUnsupportTscOption("init");
  }
  if (parsedCommandLine.options.version) {
    const pkgFile = findPackage(module.filename);
    if (pkgFile) {
      const pkg = readPackage(pkgFile);
      console.log("rn-tsc Version " + pkg.version);
    } else {
      console.log("rn-tsc Version <unknown>");
    }
    return tsc("--version");
  }
  if (parsedCommandLine.options.help) {
    usage();
    return tsc("--help");
  }
  if (parsedCommandLine.options.all) {
    usage();
    return tsc("--all");
  }

  let configFileName: string | undefined = undefined;
  if (parsedCommandLine.options.project) {
    // project config file was given. make sure no individual files were given.
    if (parsedCommandLine.fileNames.length !== 0) {
      return error(
        "Cannot use a tsc project file and individually named files together on the command-line",
        ExitCode.UsageError
      );
    }

    const fileOrDirectory = path.normalize(parsedCommandLine.options.project);
    if (!fileOrDirectory || isDirectory(fileOrDirectory)) {
      configFileName = path.join(fileOrDirectory, "tsconfig.json");
      if (!isFile(configFileName)) {
        return error(
          `Cannot find a tsconfig.json file at the specified directory: ${parsedCommandLine.options.project}`,
          ExitCode.UsageError
        );
      }
    } else {
      configFileName = fileOrDirectory;
      if (!isFile(configFileName)) {
        return error(
          `The specified path does not exist: ${parsedCommandLine.options.project}`,
          ExitCode.UsageError
        );
      }
    }
  } else if (parsedCommandLine.fileNames.length === 0) {
    // project config file was not given, and no individual files were given.
    // search for a project file.

    configFileName = ts.findConfigFile(process.cwd(), ts.sys.fileExists);
  }

  // at this point, there should be a config file or individual files.
  // if not, then print help and exit.
  if (parsedCommandLine.fileNames.length === 0 && !configFileName) {
    usage();
    return tsc("--help");
  }

  // TODO: needed?
  // ts.convertToOptionsWithAbsolutePaths -- create new ParsedCommandLine with all path props made absolute using the cwd

  if (configFileName) {
    const service = new Service();
    const parsedConfig = service
      .getProjectConfigLoader()
      .load(
        configFileName,
        parsedCommandLine.options,
        parsedCommandLine.watchOptions
      );
    if (parsedConfig.options.showConfig) {
      return errorUnsupportTscOption("showConfig");
    }
    if (
      parsedConfig.options.watch &&
      Object.prototype.hasOwnProperty.call(parsedConfig.options, "watch")
    ) {
      return errorUnsupportTscOption("watch");
    }

    if (parsedConfig.options.diagnostics) {
      return errorUnsupportTscOption("diagnostics");
    }
    if (parsedConfig.options.extendedDiagnostics) {
      return errorUnsupportTscOption("extendedDiagnostics");
    }
    if (parsedConfig.options.generateTrace) {
      return errorUnsupportTscOption("generateTrace");
    }

    //  we don't support TypeScripts specialized resolver config -- only normal node lookups
    if (parsedConfig.options.baseUrl) {
      return errorUnsupportTscOption("baseUrl");
    }
    if (parsedConfig.options.paths) {
      return errorUnsupportTscOption("paths");
    }
    if (parsedConfig.options.rootDirs) {
      return errorUnsupportTscOption("rootDirs");
    }

    if (parsedConfig.options.incremental) {
      // TODO: performIncrementalCompilation
      return errorUnsupportTscOption("incremental");
    }
    if (parsedConfig.options.composite) {
      // TODO: performIncrementalCompilation
      return errorUnsupportTscOption("composite");
    }

    return emit(
      parsedConfig,
      platform,
      platformExtensions,
      disableReactNativePackageSubstitution,
      traceReactNativeModuleResolutionErrors,
      traceResolutionLog
    );
  }
  // no config file -- just file names on the command-line

  if (
    parsedCommandLine.options.watch &&
    Object.prototype.hasOwnProperty.call(parsedCommandLine.options, "watch")
  ) {
    return errorUnsupportTscOption("watch");
  }

  //  we don't support TypeScripts specialized resolver config -- only normal node lookups
  if (parsedCommandLine.options.baseUrl) {
    return errorUnsupportTscOption("baseUrl");
  }
  if (parsedCommandLine.options.paths) {
    return errorUnsupportTscOption("paths");
  }
  if (parsedCommandLine.options.rootDirs) {
    return errorUnsupportTscOption("rootDirs");
  }

  if (parsedCommandLine.options.incremental) {
    // TODO: performIncrementalCompilation
    return errorUnsupportTscOption("incremental");
  }
  if (parsedCommandLine.options.composite) {
    // TODO: performIncrementalCompilation
    return errorUnsupportTscOption("composite");
  }

  return emit(
    parsedCommandLine,
    platform,
    platformExtensions,
    disableReactNativePackageSubstitution,
    traceReactNativeModuleResolutionErrors,
    traceResolutionLog
  );
}

function createProgram(
  parsedCommandLine: ts.ParsedCommandLine,
  platform: string | undefined,
  platformExtensions: string[] | undefined,
  disableReactNativePackageSubstitution: boolean,
  traceReactNativeModuleResolutionErrors: boolean,
  traceResolutionLog: string | undefined
) {
  const compilerHost = ts.createCompilerHost(parsedCommandLine.options);

  if (platform) {
    // TODO: needed?
    // changeCompilerHostLikeToUseCache -- assuming this is only an optimization

    // Configure the compiler host to use the react-native module/type resolvers
    const resolverHost = createResolverHost(
      parsedCommandLine,
      platform,
      platformExtensions,
      disableReactNativePackageSubstitution,
      traceReactNativeModuleResolutionErrors,
      traceResolutionLog
    );
    compilerHost.resolveModuleNames =
      resolverHost.resolveModuleNames.bind(resolverHost);
    compilerHost.resolveTypeReferenceDirectives =
      resolverHost.resolveTypeReferenceDirectives.bind(resolverHost);

    const programOptions = {
      rootNames: parsedCommandLine.fileNames,
      options: parsedCommandLine.options,
      projectReferences: parsedCommandLine.projectReferences,
      host: compilerHost,
      configFileParsingDiagnostics:
        ts.getConfigFileParsingDiagnostics(parsedCommandLine),
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
    parsedCommandLine.fileNames,
    parsedCommandLine.options,
    compilerHost
  );
  return program;
}

function emit(
  parsedCommandLine: ts.ParsedCommandLine,
  platform: string | undefined,
  platformExtensions: string[] | undefined,
  disableReactNativePackageSubstitution: boolean,
  traceReactNativeModuleResolutionErrors: boolean,
  traceResolutionLog: string | undefined
): ExitCode {
  const program = createProgram(
    parsedCommandLine,
    platform,
    platformExtensions,
    disableReactNativePackageSubstitution,
    traceReactNativeModuleResolutionErrors,
    traceResolutionLog
  );

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

  if (emitResult.emitSkipped) {
    return ExitCode.EmitSkipped;
  } else if (diagnostics.length > 0) {
    return ExitCode.EmitFailed;
  }
  return ExitCode.Success;
}

export type ParsedCommandLine = ts.ParsedCommandLine;
export enum DiagnosticCategory {
  Warning = ts.DiagnosticCategory.Warning,
  Error = ts.DiagnosticCategory.Error,
  Suggestion = ts.DiagnosticCategory.Suggestion,
  Message = ts.DiagnosticCategory.Message,
}
export type Diagnostic = ts.Diagnostic;

export function build(
  parsedCommandLine: ParsedCommandLine,
  platform: string | undefined,
  platformExtensions: string[],
  disableReactNativePackageSubstitution: boolean,
  traceReactNativeModuleResolutionErrors: boolean,
  traceResolutionLog: string | undefined
): Diagnostic[] {
  const program = createProgram(
    parsedCommandLine,
    platform,
    platformExtensions,
    disableReactNativePackageSubstitution,
    traceReactNativeModuleResolutionErrors,
    traceResolutionLog
  );

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
  let exitCode: number;
  try {
    exitCode = cli();
  } catch (e) {
    if (e instanceof Error) {
      console.error(chalk.redBright("ERROR: ") + chalk.red(e.message));
      if (e.stack) {
        console.error(chalk.red(e.stack));
      }
      console.error("");
    } else if (typeof e in ["string", "number", "boolean", "object"]) {
      console.error(
        chalk.redBright("ERROR: ") +
          chalk.red(
            (
              e as string | number | boolean | Record<string, unknown>
            ).toString()
          ) +
          os.EOL
      );
    } else {
      console.error(
        chalk.redBright("ERROR: ") +
          chalk.red("Internal error occurred") +
          os.EOL
      );
    }
    exitCode = ExitCode.InternalError;
  }

  process.exit(exitCode);
}
