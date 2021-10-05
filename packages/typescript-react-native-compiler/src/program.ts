import { ReactNativeResolverHost } from "@rnx-kit/typescript-react-native-resolver";
import fs from "fs";
import os from "os";
import ts from "typescript";

import type { CommandLine } from "./command-line";

export function createProgram(cmdLine: CommandLine): ts.Program {
  const {
    platform,
    platformExtensions,
    disableReactNativePackageSubstitution,
    traceReactNativeModuleResolutionErrors,
    traceResolutionLog,
  } = cmdLine.rnts;

  const compilerHost = ts.createCompilerHost(cmdLine.ts.options);

  // TODO: needed?
  // changeCompilerHostLikeToUseCache -- assuming this is only an optimization

  if (platform) {
    //  A react-native target platform was specified. Use the react-native
    //  TypeScript resolver. Route module resolution trace message to the
    //  react-native resolver.
    //
    const resolverHost = new ReactNativeResolverHost(
      compilerHost,
      cmdLine.ts.options,
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
    compilerHost.trace = resolverHost.trace.bind(resolverHost);
  } else {
    //  No react-native platform was specified. Use the standard TypeScript
    //  resolver. Capture module resolution trace messages in a file or on
    //  the console.
    //
    if (traceResolutionLog) {
      compilerHost.trace = (message: string): void => {
        fs.writeFileSync(traceResolutionLog, message + os.EOL, {
          encoding: "utf-8",
          flag: "a",
        });
      };
    } else {
      compilerHost.trace = ts.sys.write;
    }
  }

  const programOptions = {
    rootNames: cmdLine.ts.fileNames,
    options: cmdLine.ts.options,
    projectReferences: cmdLine.ts.projectReferences,
    host: compilerHost,
    configFileParsingDiagnostics: ts.getConfigFileParsingDiagnostics(
      cmdLine.ts
    ),
  };
  const program = ts.createProgram(programOptions);
  return program;
}
