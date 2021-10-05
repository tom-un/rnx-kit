import { isDirectory, isFile } from "@rnx-kit/tools-node";
import {
  createDiagnosticWriter,
  findConfigFile,
  readConfigFile,
} from "@rnx-kit/typescript-service";
import path from "path";
import ts from "typescript";

import type { CommandLine } from "./command-line";

export function getTsConfigFileName(
  cmdLineTs: ts.ParsedCommandLine
): string | undefined {
  let configFileName: string | undefined = undefined;

  if (cmdLineTs.options.project) {
    //  A project configuration file was given. Make sure no individual files
    //  were specified (these concepts are mutually exclusive).

    if (cmdLineTs.fileNames.length !== 0) {
      throw new Error(
        "Cannot use a TypeScript configuration file and individually named source files together on the command-line"
      );
    }

    const fileOrDirectory = path.normalize(cmdLineTs.options.project);
    if (!fileOrDirectory || isDirectory(fileOrDirectory)) {
      configFileName = path.join(fileOrDirectory, "tsconfig.json");
      if (!isFile(configFileName)) {
        throw new Error(
          `Cannot find a tsconfig.json file at the specified directory: ${cmdLineTs.options.project}`
        );
      }
    } else {
      configFileName = fileOrDirectory;
      if (!isFile(configFileName)) {
        throw new Error(
          `The specified path does not exist: ${cmdLineTs.options.project}`
        );
      }
    }
  } else if (cmdLineTs.fileNames.length === 0) {
    //  A project configuration file was not given, and neither were any
    //  individual files. Search for a project configuration file.

    configFileName = findConfigFile(process.cwd());
  }

  //  At this point, we should have either a configuration file or
  //  individual files.

  if (cmdLineTs.fileNames.length === 0 && !configFileName) {
    throw new Error(
      "The command-line must include either a TypeScript configuration file or individually named source files"
    );
  }

  return configFileName;
}

export function getTsConfigFromFile(
  cmdLine: CommandLine
): ts.ParsedCommandLine | undefined {
  const configFileName = getTsConfigFileName(cmdLine.ts);

  if (configFileName) {
    const parsedConfig = readConfigFile(
      configFileName,
      cmdLine.ts.options,
      cmdLine.ts.watchOptions
    );
    if (!parsedConfig) {
      throw new Error(
        `Failed to load TypeScript configuration file '${configFileName}'`
      );
    } else if (parsedConfig.errors.length > 0) {
      const writer = createDiagnosticWriter();
      parsedConfig.errors.forEach((e) => writer.print(e));
      throw new Error(
        `Failed to load TypeScript configuration file '${configFileName}'`
      );
    }

    // TODO: needed?
    // ts.convertToOptionsWithAbsolutePaths -- create new ParsedCommandLine with all path props made absolute using the cwd

    return parsedConfig;
  }

  return undefined;
}
