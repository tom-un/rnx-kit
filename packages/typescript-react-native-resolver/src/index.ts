import {
  createDefaultResolverHost,
  ProjectConfig,
  Extension,
  ResolvedModuleFull,
  ResolvedModuleWithFailedLookupLocations,
  ResolvedProjectReference,
  ResolvedTypeReferenceDirective,
  ResolverHost,
} from "@rnx-kit/typescript-service";
import {
  findPackageDependencyDir,
  isPackageModuleRef,
  isFileModuleRef,
  parseModuleRef,
  PackageModuleRef,
  readPackage,
  getMangledPackageName,
  FileModuleRef,
} from "@rnx-kit/tools-node";
import fs from "fs";
import isString from "lodash/isString";
import { builtinModules } from "module";
import os from "os";
import path from "path";
import { getWorkspaces, WorkspaceInfo } from "workspace-tools";

// TODO: use @rnx-kit/console

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

/**
 * Get the name of an out-of-tree platform's react-native package.
 *
 * @param platform Platform
 * @returns Name of the out-of-tree platform's react-native package, or `undefined` if it is in-tree.
 */
export function getReactNativePackageName(
  platform: string
): string | undefined {
  switch (platform) {
    case "windows":
      return "react-native-windows";
    case "macos":
      return "react-native-macos";
    case "win32":
      return "@office-iss/react-native-win32";
    case "ios":
    case "android":
      return undefined;
    default:
      throw new Error(`Unknown react-native platform ${platform}`);
  }
}

const Extensions = [
  Extension.Dts,
  Extension.Tsx,
  Extension.Ts,
  Extension.Json,
  Extension.Jsx,
  Extension.Js,
];

function hasExtension(p: string, ext: Extension): boolean {
  return p.length > ext.length && p.endsWith(ext);
}

function getExtensionFromPath(p: string): Extension | undefined {
  return Extensions.find((e) => hasExtension(p, e));
}

/**
 * Module reference relative to a workspace (in-repo package).
 */
type WorkspaceModuleRef = {
  workspace: WorkspaceInfo[number];
  path?: string;
};

class ResolverLog {
  private messages: string[];

  constructor() {
    this.messages = [];
  }

  log(message: string): void {
    this.messages.push(message);
  }

  serialize(): string {
    return this.messages.join(os.EOL);
  }

  clear(): void {
    this.messages = [];
  }
}

/**
 * Implementation of ResolverHost for use with react-native applications.
 */
class ReactNativeResolverHost {
  private platform: string;
  private disableReactNativePackageSubstitution: boolean;
  private options: ProjectConfig["options"];
  private platformExtensions: string[];
  private reactNativePackageName: string | undefined;
  private workspaces: WorkspaceInfo;
  private defaultResolverHost: ResolverHost;
  private extensionsDtsOnly: Extension[];
  private extensionsSourceOnly: Extension[];
  private extensionsAll: Extension[];
  private resolverLog: ResolverLog | undefined;
  private showResolverLogOnSuccess: boolean;
  private showResolverLogOnFailure: boolean;

  constructor(
    platform: string,
    platformExtensions: string[],
    disableReactNativePackageSubstitution: boolean,
    verbose: boolean,
    options: ProjectConfig["options"]
  ) {
    this.platform = platform.toLowerCase();
    this.disableReactNativePackageSubstitution =
      disableReactNativePackageSubstitution;
    this.options = options;
    this.platformExtensions = [this.platform, ...platformExtensions].map(
      (e) => `.${e}` // prepend a '.' to each extension
    );
    this.reactNativePackageName = disableReactNativePackageSubstitution
      ? undefined
      : getReactNativePackageName(this.platform);
    this.workspaces = getWorkspaces(process.cwd());
    this.defaultResolverHost = createDefaultResolverHost(options);
    this.extensionsDtsOnly = [Extension.Dts];
    this.extensionsSourceOnly = [Extension.Ts, Extension.Tsx];
    this.extensionsAll = [Extension.Ts, Extension.Tsx, Extension.Dts];
    if (this.options.checkJs) {
      this.extensionsSourceOnly.push(Extension.Js, Extension.Jsx);
      this.extensionsAll.push(Extension.Js, Extension.Jsx);
    }
    if (this.options.resolveJsonModule) {
      this.extensionsSourceOnly.push(Extension.Json);
      this.extensionsAll.push(Extension.Json);
    }
    this.showResolverLogOnSuccess = !!this.options.traceResolution;
    this.showResolverLogOnFailure = !!this.options.traceResolution || verbose;
    this.resolverLog =
      this.showResolverLogOnSuccess || this.showResolverLogOnFailure
        ? new ResolverLog()
        : undefined;
  }

  private isFile(p: string): boolean {
    const result = isFile(p);
    if (!result && this.resolverLog) {
      this.resolverLog.log(`File ${p} does not exist.`);
    }
    return result;
  }

  private isDirectory(p: string): boolean {
    const result = isDirectory(p);
    if (!result && this.resolverLog) {
      this.resolverLog.log(`Directory ${p} does not exist.`);
    }
    return result;
  }

  /**
   * If the module references 'react-native', and the current platform has a
   * specific react-native name (e.g. out-of-tree platform), update the
   * module reference.
   *
   * @param m Module
   * @returns If the module refers to `react-native`, an updated module reference. Otherwise, the original string.
   */
  private replaceReactNativePackageName(m: string): string {
    //
    //  This is currently controlled by a command-line option because the
    //  windows platform (react-native-windows) doesn't yet support it.
    //  react-native-windows doesn't export a complete set of react-native
    //  types, leading to errors about missing names like 'AppRegistry'
    //  and 'View':
    //
    //       https://github.com/microsoft/react-native-windows/issues/8627
    //
    if (this.disableReactNativePackageSubstitution) {
      return m;
    }

    if (!this.reactNativePackageName) {
      return m;
    }
    const rn = "react-native";
    if (!m.startsWith(rn)) {
      return m;
    }

    const replaced = this.reactNativePackageName + m.substring(rn.length);
    if (this.resolverLog) {
      this.resolverLog.log(`Substituting module '${m}' with '${replaced}'.`);
    }
    return replaced;
  }

  /**
   * Find out if this module is part of a workspace (in-repo package), or an
   * external dependency.
   *
   * @param moduleName Module
   * @param containingFile File which imported/required the module
   * @returns Workspace reference, if the module is part of an in-repo package. Otherwise, `undefined`.
   */
  private queryWorkspaceModuleRef(
    moduleName: string,
    containingFile: string
  ): WorkspaceModuleRef | undefined {
    let workspace: WorkspaceInfo[number] | undefined = undefined;
    let workspaceModulePath;

    const ref = parseModuleRef(moduleName);
    if (isPackageModuleRef(ref)) {
      //
      //  This module is rooted in a package, like '@babel/code' or
      //  'react-native'. See if the package name/scope matches one
      //  our of our workspace (in-repo) packages.
      //
      const n = ref.scope ? `${ref.scope}/${ref.name}` : ref.name;
      workspace = this.workspaces.find((w) => w.name === n);
      workspaceModulePath = workspace ? ref.path : undefined;
    } else if (isFileModuleRef(ref)) {
      //
      //  This module is a file-system path. Resolve it using the
      //  containing file path. Then see if the resolved path lands
      //  under one of our workspace (in-repo) packages.
      //
      const p = path.resolve(path.dirname(containingFile), ref.path);
      workspace = this.workspaces.find((w) => {
        const normalized = path.normalize(w.path);
        const trailingSeparator = normalized.endsWith(path.sep)
          ? normalized
          : normalized + path.sep;
        return p.startsWith(trailingSeparator);
      });
      if (workspace) {
        const wp = path.normalize(workspace.path);
        workspaceModulePath = p.substr(
          wp.endsWith(path.sep) ? wp.length : wp.length + 1
        );
      }
    }

    if (workspace) {
      return { workspace, path: workspaceModulePath };
    }

    return undefined;
  }

  /**
   * Find a file for the module which matches one of the given extensions
   * The extensions are ordered from highest precedence (index 0) to lowest.
   * When searching, look for platform override extensions as well.
   *
   * Most modules will not typically include a file extension:
   *
   *   "./App"
   *   "react-native"
   *   "lodash/isString"
   *
   * That's not always the case, though:
   *
   *   "./assets/Logo.png"
   *   "../app.json"
   *   "./cjs/react.development.js"
   *
   * Start the search by seeing if the module has an extension that is in the
   * list. If so, stop there, and return a path to the module file or
   * `undefined` if the file doesn't exist.
   *
   * Next, perform a more broad search. Combine each platform override with
   * each extension, preferring a platform override match before moving to the
   * next extension. Return as soon as an existing module file is found.
   *
   * If a module file was not found and the module refers to a directory,
   * repeat the search within that directory using "index" as the module name.
   * This is deliberately done after searching for the module as a file, since
   * that is a better match.
   *
   * @param searchDir Directory to use when searching for the module
   * @param modulePath Module path
   * @param extensions List of allowed file extensions, in order from highest precedence (index 0) to lowest.
   * @returns Module file path and extension, or `undefined` if nothing was found.
   */
  private findModuleFile(
    searchDir: string,
    modulePath: string,
    extensions: Extension[]
  ): ResolvedModuleFull | undefined {
    // TODO: security: if join(searchDir, modulePath) takes you outside of searchDir, return undefined without touching the disk

    //
    //  See if the module has an extension that is in the list. If so, return
    //  the module path if it exists, or `undefined`.
    //
    const extension = getExtensionFromPath(modulePath);
    if (extension && extensions.indexOf(extension) !== -1) {
      const p = path.join(searchDir, modulePath);
      return this.isFile(p) ? { resolvedFileName: p, extension } : undefined;
    }

    //
    //  Assume the module file does not have an extension. Perform a broad
    //  search, combining platform extensions with the list of allowed
    //  file extensions.
    //
    //  If no platform extension file is found, make one more pass using
    //  only the list of allowed extensions.
    //
    for (const pext of [...this.platformExtensions, ""]) {
      for (const ext of extensions) {
        const p = path.join(searchDir, `${modulePath}${pext}${ext}`);
        if (this.isFile(p)) {
          return {
            resolvedFileName: p,
            extension: ext,
          };
        }
      }
    }

    //
    //  The module was not found, but it may refer to a directory name.
    //  If so, search within that directory for a module named "index".
    //
    if (this.isDirectory(path.join(searchDir, modulePath))) {
      return this.findModuleFile(
        path.join(searchDir, modulePath),
        "index",
        extensions
      );
    }

    return undefined;
  }

  /**
   * Resolve a module reference within a given package directory.
   *
   * If a module path is given, use that to find the corresponding module
   * file.
   *
   * Otherwise, consult `package.json` for properties which refer to
   * "entry points" within the package (e.g. `types`, `typings` and `main`).
   * If those properties don't resolve the module, then fall back to looking
   * for an "index" file.
   *
   * @param packageDir Root of the package which contains the module
   * @param modulePath Optional relative path to the module
   * @param extensions List of allowed module file extensions
   * @returns Resolved module, or `undefined` if resolution fails
   */
  private resolveModule(
    packageDir: string,
    modulePath: string | undefined,
    extensions: Extension[]
  ): ResolvedModuleFull | undefined {
    //  A module path was given. Use that to resolve the module to a file.
    if (modulePath) {
      return this.findModuleFile(packageDir, modulePath, extensions);
    }

    let module: ResolvedModuleFull | undefined;

    //  No path was given. Try resolving the module using package.json
    //  properties.
    const { types, typings, main } = readPackage(packageDir);

    //  Only consult 'types' and 'typings' properties when looking for
    //  type files (.d.ts).
    if (extensions.indexOf(Extension.Dts) !== -1) {
      if (isString(types)) {
        if (this.resolverLog) {
          this.resolverLog.log(`Package has 'types' field '${types}'.`);
        }
        module = this.findModuleFile(packageDir, types, extensions);
      } else if (isString(typings)) {
        if (this.resolverLog) {
          this.resolverLog.log(`Package has 'typings' field '${typings}'.`);
        }
        module = this.findModuleFile(packageDir, typings, extensions);
      }
    }
    //  Only consult the 'main' property when looking for source files.
    if (extensions.some((e) => this.extensionsSourceOnly.indexOf(e) !== -1)) {
      if (!module && isString(main)) {
        if (this.resolverLog) {
          this.resolverLog.log(`Package has 'main' field '${main}'.`);
        }
        module = this.findModuleFile(packageDir, main, extensions);
      }
    }

    //  Properties from package.json weren't able to resolve the module.
    //  Try resolving it to an "index" file.
    if (!module) {
      if (this.resolverLog) {
        this.resolverLog.log(`Searching for index file.`);
      }
      module = this.findModuleFile(packageDir, "index", extensions);
    }

    return module;
  }

  /**
   * This module is part of a workspace (in-repo package). Search for it
   * within that package.
   *
   * @param moduleRef Module to resolve
   * @param extensions List of allowed module file extensions
   * @returns Resolved module, or `undefined` if resolution fails
   */
  private resolveWorkspaceModule(
    moduleRef: WorkspaceModuleRef,
    extensions: Extension[]
  ): ResolvedModuleFull | undefined {
    if (this.resolverLog) {
      this.resolverLog.log(
        `Loading module from workspace package '${moduleRef.workspace.name}'.`
      );
    }

    return this.resolveModule(
      moduleRef.workspace.path,
      moduleRef.path,
      extensions
    );
  }

  /**
   * The module refers to an external package.
   *
   * Search for the package under node_modules, starting from the given search
   * directory, and moving up through each parent. If found, resolve the module
   * to a file within the package.
   *
   * If the module wasn't resolved, repeat the process using the corresponding
   * at-types package.
   *
   * @param moduleRef Module to resolve
   * @param searchDir Directory to start searching for the module's package
   * @param extensions List of allowed module file extensions
   * @returns Resolved module, or `undefined` if resolution fails
   */
  private resolvePackageModule(
    moduleRef: PackageModuleRef,
    searchDir: string,
    extensions: Extension[]
  ): ResolvedModuleFull | undefined {
    let module: ResolvedModuleFull | undefined = undefined;

    // Resolve the module to a file within the package
    const pkgDir = findPackageDependencyDir(moduleRef, {
      startDir: searchDir,
      // TODO: stopDir ==> workspace root? security & perf
    });
    if (pkgDir) {
      if (this.resolverLog) {
        this.resolverLog.log(
          `Loading module from external package '${pkgDir}'.`
        );
      }

      module = this.resolveModule(pkgDir, moduleRef.path, extensions);
      if (!module && moduleRef.path) {
        // Try again, without using a path, but only look for type (.d.ts)
        // files. Hand-crafted type modules in the package don't have to
        // use the same file layout as the associated JS/TS module.
        module = this.resolveModule(pkgDir, undefined, this.extensionsDtsOnly);
      }
    }

    if (!module) {
      // Resolve the module to a file within the corresponding @types package
      const typesModuleRef: PackageModuleRef = {
        scope: "@types",
        name: getMangledPackageName(moduleRef),
        path: moduleRef.path,
      };
      const typesPkgDir = findPackageDependencyDir(typesModuleRef, {
        startDir: searchDir,
        // TODO: stopDir ==> workspace root? security & perf
      });
      if (typesPkgDir) {
        if (this.resolverLog) {
          this.resolverLog.log(
            `Loading module from external @types package '${typesPkgDir}'.`
          );
        }

        module = this.resolveModule(
          typesPkgDir,
          typesModuleRef.path,
          this.extensionsDtsOnly
        );
        if (!module && typesModuleRef.path) {
          // Try again, without using a path. @types modules don't have to use
          // the same file layout as the associated JS/TS module.
          module = this.resolveModule(
            typesPkgDir,
            undefined,
            this.extensionsDtsOnly
          );
        }
      }
    }

    return module;
  }

  /**
   * This module refers to a specific file.
   *
   * Search for it using the given directory.
   *
   * @param moduleRef Module to resolve
   * @param searchDir Directory to search for the module file
   * @param extensions List of allowed module file extensions
   * @returns Resolved module, or `undefined` if module fails
   */
  private resolveFileModule(
    moduleRef: FileModuleRef,
    searchDir: string,
    extensions: Extension[]
  ): ResolvedModuleFull | undefined {
    if (this.resolverLog) {
      this.resolverLog.log(`Loading module from directory '${searchDir}'.`);
    }

    return this.findModuleFile(searchDir, moduleRef.path, extensions);
  }

  /**
   * Decide whether or not to show failure information for the named module.
   *
   * @param moduleName Module
   */
  private shouldShowResolverFailure(moduleName: string): boolean {
    // ignore resolver errors for built-in node modules
    if (
      builtinModules.indexOf(moduleName) !== -1 ||
      moduleName === "fs/promises" || // doesn't show up in the list, but it's a built-in
      moduleName.toLowerCase().startsWith("node:") // explicit use of a built-in
    ) {
      return false;
    }

    // ignore resolver errors for multimedia files
    const multimediaExts =
      /\.(aac|aiff|bmp|caf|gif|html|jpeg|jpg|m4a|m4v|mov|mp3|mp4|mpeg|mpg|obj|otf|pdf|png|psd|svg|ttf|wav|webm|webp)$/i;
    if (path.extname(moduleName).match(multimediaExts)) {
      return false;
    }

    return true;
  }

  //
  //  ResolverHost API
  //

  resolveModuleNames(
    moduleNames: string[],
    containingFile: string,
    _reusedNames: string[] | undefined,
    _redirectedReference?: ResolvedProjectReference
  ): (ResolvedModuleFull | undefined)[] {
    //
    //  If the containing file is a type file (.d.ts), it can only import
    //  other type files. Restrict module resolution accordingly.
    //
    const extensions = hasExtension(containingFile, Extension.Dts)
      ? this.extensionsDtsOnly
      : this.extensionsAll;

    const resolutions: (ResolvedModuleFull | undefined)[] = [];

    for (let moduleName of moduleNames) {
      if (this.resolverLog) {
        this.resolverLog.clear();
        this.resolverLog.log(
          `======= Resolving module '${moduleName}' from '${containingFile}' =======`
        );
      }

      //
      //  Replace any reference to 'react-native' with the platform-specific
      //  react-native package name.
      //
      moduleName = this.replaceReactNativePackageName(moduleName);

      let module: ResolvedModuleFull | undefined = undefined;

      const workspaceRef = this.queryWorkspaceModuleRef(
        moduleName,
        containingFile
      );
      if (workspaceRef) {
        module = this.resolveWorkspaceModule(workspaceRef, extensions);
      } else {
        const moduleRef = parseModuleRef(moduleName);
        if (isPackageModuleRef(moduleRef)) {
          module = this.resolvePackageModule(
            moduleRef,
            path.dirname(containingFile),
            extensions
          );
        } else if (isFileModuleRef(moduleRef)) {
          module = this.resolveFileModule(
            moduleRef,
            path.dirname(containingFile),
            extensions
          );
        }
      }

      resolutions.push(module);
      if (this.resolverLog) {
        if (module) {
          this.resolverLog.log(
            `File ${module.resolvedFileName} exists - using it as a module resolution result.`
          );
          this.resolverLog.log(
            `======= Module name '${moduleName}' was successfully resolved to '${module.resolvedFileName}' =======`
          );
          if (this.showResolverLogOnSuccess) {
            console.log(this.resolverLog.serialize());
          }
        } else {
          this.resolverLog.log(
            `Failed to resolve module ${moduleName} to a file.`
          );
          this.resolverLog.log(
            `======= Module name '${moduleName}' failed to resolve to a file' =======`
          );
          if (
            this.showResolverLogOnFailure &&
            this.shouldShowResolverFailure(moduleName)
          ) {
            console.log(this.resolverLog.serialize());
          }
        }
      }
    }

    return resolutions;
  }

  getResolvedModuleWithFailedLookupLocationsFromCache(
    moduleName: string,
    containingFile: string
  ): ResolvedModuleWithFailedLookupLocations | undefined {
    return this.defaultResolverHost.getResolvedModuleWithFailedLookupLocationsFromCache(
      moduleName,
      containingFile
    );
  }

  resolveTypeReferenceDirectives(
    typeDirectiveNames: string[],
    containingFile: string,
    redirectedReference?: ResolvedProjectReference
  ): (ResolvedTypeReferenceDirective | undefined)[] {
    return this.defaultResolverHost.resolveTypeReferenceDirectives(
      typeDirectiveNames,
      containingFile,
      redirectedReference
    );
  }
}

export function createResolverHost(
  config: ProjectConfig,
  platform: string,
  platformExtensions: string[],
  disableReactNativePackageSubstitution: boolean,
  verbose: boolean
): ResolverHost {
  const host = new ReactNativeResolverHost(
    platform,
    platformExtensions,
    disableReactNativePackageSubstitution,
    verbose,
    config.options
  );
  return host;
}
