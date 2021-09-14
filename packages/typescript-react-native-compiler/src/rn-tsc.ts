#!/usr/bin/env node

import { findPackage, readPackage } from "@rnx-kit/tools-node";
import { createResolverHost } from "@rnx-kit/typescript-react-native-resolver";
import {
  Service,
  createDiagnosticWriter,
  parseCommandLine,
} from "@rnx-kit/typescript-service";
import chalk from "chalk";
import child_process from "child_process";
import fs from "fs";
import isString from "lodash/isString";
import os from "os";
import path from "path";

// TODO: remove this -- careful, it is needed for running 'tsc', not just access ts APIs
import ts from "typescript";

function usage() {
  const scriptName = path.basename(process.argv[1]);
  console.log(
    chalk.whiteBright("USAGE: ") +
      chalk.white(scriptName + " [options] [tsc command-line]") +
      os.EOL
  );
  console.log(chalk.whiteBright("OPTIONS") + os.EOL);
  console.log(
    chalk.white(
      "  --platform <android|ios|windows|macos|win32>                     [required]"
    )
  );
  console.log(
    chalk.white(
      "  --disableReactNativePackageSubstitution                          [optional]"
    )
  );
  console.log("");

  const pkgFile = findPackage(__dirname);
  if (pkgFile) {
    const { homepage } = readPackage(pkgFile);
    if (isString(homepage)) {
      console.log(chalk.white(`Full documentation: ${homepage}`) + os.EOL);
    }
  }
}

function tsc(...args: string[]): number | undefined {
  const child = child_process.spawnSync(
    process.execPath,
    [require.resolve("typescript/lib/tsc"), ...args],
    {
      stdio: "inherit",
    }
  );
  process.exit(child.status ?? 0);
}

// TODO: move to tools-node
function statSync(p: string): fs.Stats | undefined {
  try {
    return fs.statSync(p);
  } catch (_) {
    return undefined;
  }
}

function isDirectory(p: string): boolean {
  return statSync(p)?.isDirectory() ?? false;
}

function isFile(p: string): boolean {
  return statSync(p)?.isFile() ?? false;
}

// TODO: move to tools-language
function toOffset<T>(array: readonly T[], offset: number) {
  return offset < 0 ? array.length + offset : offset;
}

function addRange<T>(
  to: T[] | undefined,
  from: readonly T[] | undefined,
  start?: number,
  end?: number
) {
  if (from === undefined || from.length === 0) {
    return to;
  }
  if (to === undefined) {
    return from.slice(start, end);
  }
  start = start === undefined ? 0 : toOffset(from, start);
  end = end === undefined ? from.length : toOffset(from, end);
  for (let i = start; i < end && i < from.length; i++) {
    if (from[i] !== undefined) {
      to.push(from[i]);
    }
  }
  return to;
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

function cli(): ExitCode {
  // Platform (required)
  const idxPlatform = process.argv.indexOf("--platform");
  if (idxPlatform === -1 || idxPlatform === process.argv.length - 1) {
    usage();
    return error("platform not specified", ExitCode.UsageError);
  }
  const platform = process.argv[idxPlatform + 1];
  process.argv.splice(idxPlatform, 2);

  // Disable react-native package substitution (optional)
  const idxDisableRNSub = process.argv.indexOf(
    "--disableReactNativePackageSubstitution"
  );
  let disableReactNativePackageSubstitution = false;
  if (idxDisableRNSub !== -1) {
    disableReactNativePackageSubstitution = true;
    process.argv.splice(idxDisableRNSub, 1);
  }

  if (process.argv.length > 0) {
    // TSC command line

    if (process.argv[0].toLowerCase() === "--build") {
      return errorUnsupportTscCliArgument("--build");
    } else if (process.argv[0].toLowerCase() === "-b") {
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
    diagnosticWriter.print(parsedCommandLine.errors);
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
    return tsc("--version") ?? ExitCode.Success;
  }
  if (parsedCommandLine.options.help) {
    usage();
    return tsc("--help") ?? ExitCode.Success;
  }
  if (parsedCommandLine.options.all) {
    usage();
    return tsc("--all") ?? ExitCode.Success;
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
    return tsc("--help") ?? ExitCode.Success;
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

    return emit(parsedConfig, platform, disableReactNativePackageSubstitution);
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
    disableReactNativePackageSubstitution
  );
}

function emit(
  parsedCommandLine: ts.ParsedCommandLine,
  platform: string,
  disableReactNativePackageSubstitution: boolean
): ExitCode {
  const compilerHost = ts.createCompilerHost(parsedCommandLine.options);

  // TODO: needed?
  // changeCompilerHostLikeToUseCache -- assuming this is only an optimization

  // Configure the compiler host to use the react-native module/type resolvers
  const resolverHost = createResolverHost(
    parsedCommandLine,
    platform,
    disableReactNativePackageSubstitution
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
  const diagnosticWriter = createDiagnosticWriter();
  diagnosticWriter.print(diagnostics);

  let count = 0;
  diagnostics.forEach(
    (d) => d.category === ts.DiagnosticCategory.Error && count++
  );
  if (count > 0) {
    console.log("");
    console.log(count === 1 ? "Found 1 error." : `Found ${count} errors.`);
    console.log("");
  }

  if (emitResult.emitSkipped) {
    return ExitCode.EmitSkipped;
  } else if (diagnostics.length > 0) {
    return ExitCode.EmitFailed;
  }
  return ExitCode.Success;
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
