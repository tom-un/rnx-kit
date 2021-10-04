import ts from "typescript";
import { extractParameterFlag, extractParameterValue } from "./extract";

function reportParameterDependencyViolation(
  dependent: string,
  dependee: string
): never {
  throw new Error(
    `${dependent} can only be used in conjunction with ${dependee}`
  );
}

function reportUnsupportTscCliArgument(argName: string): never {
  throw new Error(
    `tsc command-line parameter '${argName}' is not currently supported`
  );
}

export type ParsedCommandLineRnTsc = {
  platform?: string;
  platformExtensions?: string[];
  disableReactNativePackageSubstitution?: boolean;
  traceReactNativeModuleResolutionErrors?: boolean;
  traceResolutionLog?: string;
};

export type CommandLine = {
  rntsc: ParsedCommandLineRnTsc;
  tsc: ts.ParsedCommandLine;
};

export function parseRnTsc(args: string[]): {
  rntsc: ParsedCommandLineRnTsc;
  tscArgs: string[];
} {
  const argsCopy = [...args];

  const platform = extractParameterValue(argsCopy, "--platform");

  const platformExtensions = extractParameterValue(
    argsCopy,
    "--platformExtensions"
  )?.split(",");
  if (!platform && platformExtensions) {
    reportParameterDependencyViolation("--platformExtensions", "--platform");
  }

  const disableReactNativePackageSubstitution = extractParameterFlag(
    argsCopy,
    "--disableReactNativePackageSubstitution"
  );
  if (!platform && disableReactNativePackageSubstitution) {
    reportParameterDependencyViolation(
      "--disableReactNativePackageSubstitution",
      "--platform"
    );
  }

  const traceReactNativeModuleResolutionErrors = extractParameterFlag(
    argsCopy,
    "--traceReactNativeModuleResolutionErrors"
  );
  if (!platform && traceReactNativeModuleResolutionErrors) {
    reportParameterDependencyViolation(
      "--traceReactNativeModuleResolutionErrors",
      "--platform"
    );
  }

  const traceResolutionLog = extractParameterValue(
    argsCopy,
    "--traceResolutionLog"
  );

  return {
    rntsc: {
      platform,
      platformExtensions,
      disableReactNativePackageSubstitution,
      traceReactNativeModuleResolutionErrors,
      traceResolutionLog,
    },
    tscArgs: argsCopy,
  };
}

export function parseTsc(args: string[]): ts.ParsedCommandLine {
  if (args.length > 2) {
    if (args[2].toLowerCase() === "--build") {
      reportUnsupportTscCliArgument("--build");
    } else if (args[2].toLowerCase() === "-b") {
      reportUnsupportTscCliArgument("-b");
    }
  }

  const cmdLine = ts.parseCommandLine(args.slice(2));
  if (!cmdLine) {
    throw new Error("failed to parse TypeScript command-line options");
  }

  return cmdLine;
}

export function parse(args: string[]): CommandLine {
  const { rntsc, tscArgs } = parseRnTsc(args);
  const tsc = parseTsc(tscArgs);

  return {
    rntsc,
    tsc,
  };
}
