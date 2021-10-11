import {
  FindPackageDependencyOptions,
  findPackageDependencyDir,
  isDirectory,
  isFile,
  PackageManifest,
  PackageRef,
  readPackage,
} from "@rnx-kit/tools-node";

import type { ResolverLog } from "./log";

export type IO = {
  isFile: (p: string) => boolean;
  isDirectory: (p: string) => boolean;
  readPackage: (pkgPath: string) => PackageManifest;
  findPackageDependencyDir: (
    ref: PackageRef,
    options?: FindPackageDependencyOptions
  ) => string | undefined;
};

export function createLoggedIO(resolverLog: ResolverLog): IO {
  function loggedIsFile(p: string): boolean {
    const result = isFile(p);
    if (!result) {
      resolverLog.log("File %s does not exist.", p);
    }
    return result;
  }

  function loggedIsDirectory(p: string): boolean {
    const result = isDirectory(p);
    if (!result) {
      resolverLog.log("Directory %s does not exist.", p);
    }
    return result;
  }

  function loggedReadPackage(pkgPath: string): PackageManifest {
    resolverLog.log("Reading package.json from directory %o.", pkgPath);
    return readPackage(pkgPath);
  }

  function loggedFindPackageDependencyDir(
    ref: PackageRef,
    options?: FindPackageDependencyOptions
  ): string | undefined {
    resolverLog.log(
      "Searching for external package %o starting in %o.",
      ref.scope ? ref.scope + "/" + ref.name : ref.name,
      options?.startDir ?? process.cwd()
    );
    return findPackageDependencyDir(ref, options);
  }

  return {
    isFile: loggedIsFile,
    isDirectory: loggedIsDirectory,
    readPackage: loggedReadPackage,
    findPackageDependencyDir: loggedFindPackageDependencyDir,
  };
}
