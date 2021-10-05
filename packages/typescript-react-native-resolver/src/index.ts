import {
  FileModuleRef,
  findPackageDependencyDir,
  getMangledPackageName,
  isDirectory,
  isFile,
  isFileModuleRef,
  isPackageModuleRef,
  PackageModuleRef,
  parseModuleRef,
  readPackage,
} from "@rnx-kit/tools-node";
import {
  createDefaultResolverHost,
  ResolverHost,
} from "@rnx-kit/typescript-service";
import fs from "fs";
import isString from "lodash/isString";
import { builtinModules } from "module";
import os from "os";
import path from "path";
import ts from "typescript";
import util from "util";
import { getWorkspaces, WorkspaceInfo } from "workspace-tools";

/**
 * Get the name of an out-of-tree platform's react-native package.
 *
 * @param platform Platform
 * @returns Name of the out-of-tree platform's react-native package, or `undefined` if it is in-tree or unknown.
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
  }
  return undefined;
}

const Extensions = [
  ts.Extension.Dts,
  ts.Extension.Tsx,
  ts.Extension.Ts,
  ts.Extension.Json,
  ts.Extension.Jsx,
  ts.Extension.Js,
];

function hasExtension(p: string, ext: ts.Extension): boolean {
  return p.length > ext.length && p.endsWith(ext);
}

function getExtensionFromPath(p: string): ts.Extension | undefined {
  return Extensions.find((e) => hasExtension(p, e));
}

/**
 * Module reference relative to a workspace (in-repo package).
 */
type WorkspaceModuleRef = {
  workspace: WorkspaceInfo[number];
  path?: string;
};

const enum ResolverLogMode {
  Never,
  Always,
  OnFailure,
}

class ResolverLog {
  private mode: ResolverLogMode;
  private buffering: boolean;
  private messages: string[];
  private logFile: string | undefined;

  constructor(mode: ResolverLogMode, logFile?: string) {
    this.mode = mode;
    this.buffering = false;
    this.messages = [];
    this.logFile = logFile;
  }

  begin(): void {
    this.buffering = true;
  }

  log(format: string, ...args: string[]): void {
    if (this.mode !== ResolverLogMode.Never) {
      this.messages.push(util.format(format, ...args));
      if (!this.buffering) {
        this.endSuccess();
      }
    }
  }

  endSuccess(): void {
    if (this.mode === ResolverLogMode.Always) {
      this.flush();
    }
    this.reset();
  }

  endFailure(): void {
    if (
      this.mode === ResolverLogMode.OnFailure ||
      this.mode === ResolverLogMode.Always
    ) {
      this.flush();
    }
    this.reset();
  }

  reset(): void {
    if (this.mode !== ResolverLogMode.Never) {
      this.messages = [];
    }
    this.buffering = false;
  }

  private flush(): void {
    const messages = this.messages.join(os.EOL);
    if (this.logFile) {
      fs.writeFileSync(this.logFile, messages + os.EOL, {
        encoding: "utf-8",
        flag: "a",
      });
    } else {
      console.log(messages);
    }
  }
}

/**
 * Implementation of ResolverHost for use with react-native applications.
 */
export class ReactNativeResolverHost {
  private options: ts.ParsedCommandLine["options"];
  private platform: string;
  private platformExtensions: string[];
  private disableReactNativePackageSubstitution: boolean;

  private resolverLog: ResolverLog;
  private defaultResolverHost: ResolverHost;

  private reactNativePackageName: string | undefined;

  private workspaces: WorkspaceInfo;

  private extensionsTypeScript: ts.Extension[];
  private extensionsAll: ts.Extension[];

  constructor(
    moduleResolutionHost: ts.ModuleResolutionHost,
    options: ts.ParsedCommandLine["options"],
    platform: string,
    platformExtensions: string[] | undefined,
    disableReactNativePackageSubstitution: boolean,
    traceReactNativeModuleResolutionErrors: boolean,
    traceResolutionLog: string | undefined
  ) {
    this.platform = platform;
    this.platformExtensions = [
      this.platform,
      ...(platformExtensions || []),
    ].map(
      (e) => `.${e}` // prepend a '.' to each extension
    );
    this.disableReactNativePackageSubstitution =
      disableReactNativePackageSubstitution;
    this.options = options;

    let mode = ResolverLogMode.Never;
    if (this.options.traceResolution) {
      mode = ResolverLogMode.Always;
    } else if (traceReactNativeModuleResolutionErrors) {
      mode = ResolverLogMode.OnFailure;
    }
    this.resolverLog = new ResolverLog(mode, traceResolutionLog);
    this.defaultResolverHost = createDefaultResolverHost(
      options,
      moduleResolutionHost
    );

    this.reactNativePackageName = getReactNativePackageName(this.platform);

    this.workspaces = getWorkspaces(process.cwd());

    this.extensionsTypeScript = [
      ts.Extension.Ts,
      ts.Extension.Tsx,
      ts.Extension.Dts,
    ];
    this.extensionsAll = [ts.Extension.Ts, ts.Extension.Tsx, ts.Extension.Dts];
    if (this.options.checkJs) {
      this.extensionsAll.push(ts.Extension.Js, ts.Extension.Jsx);
    }
    if (this.options.resolveJsonModule) {
      this.extensionsAll.push(ts.Extension.Json);
    }
  }

  private isFile(p: string): boolean {
    const result = isFile(p);
    if (!result) {
      this.resolverLog.log("File %s does not exist.", p);
    }
    return result;
  }

  private isDirectory(p: string): boolean {
    const result = isDirectory(p);
    if (!result) {
      this.resolverLog.log("Directory %s does not exist.", p);
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
    this.resolverLog.log("Substituting module '%s' with '%s'.", m, replaced);
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
    extensions: ts.Extension[]
  ): ts.ResolvedModuleFull | undefined {
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

    if (extension === ts.Extension.Js || extension === ts.Extension.Jsx) {
      //
      //  The module was not found, but it has a JavaScript extension.
      //  Repeat the broad search, without the extension.
      //
      const modulePathNoExt = modulePath.substring(
        0,
        modulePath.length - extension.length
      );
      for (const pext of [...this.platformExtensions, ""]) {
        for (const ext of extensions) {
          const p = path.join(searchDir, `${modulePathNoExt}${pext}${ext}`);
          if (this.isFile(p)) {
            return {
              resolvedFileName: p,
              extension: ext,
            };
          }
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
    extensions: ts.Extension[]
  ): ts.ResolvedModuleFull | undefined {
    //  A module path was given. Use that to resolve the module to a file.
    if (modulePath) {
      return this.findModuleFile(packageDir, modulePath, extensions);
    }

    let module: ts.ResolvedModuleFull | undefined;

    //  No path was given. Try resolving the module using package.json
    //  properties.
    const { types, typings, main } = readPackage(packageDir);

    //  Only consult 'types' and 'typings' properties when looking for
    //  type files (.d.ts).
    if (extensions.indexOf(ts.Extension.Dts) !== -1) {
      if (isString(types)) {
        this.resolverLog.log("Package has 'types' field '%s'.", types);
        module = this.findModuleFile(packageDir, types, extensions);
      } else if (isString(typings)) {
        this.resolverLog.log("Package has 'typings' field '%s'.", typings);
        module = this.findModuleFile(packageDir, typings, extensions);
      }
    }
    if (!module && isString(main)) {
      this.resolverLog.log("Package has 'main' field '%s'.", main);
      module = this.findModuleFile(packageDir, main, extensions);
    }

    //  Properties from package.json weren't able to resolve the module.
    //  Try resolving it to an "index" file.
    if (!module) {
      this.resolverLog.log("Searching for index file.");
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
    extensions: ts.Extension[]
  ): ts.ResolvedModuleFull | undefined {
    this.resolverLog.log(
      "Loading module from workspace package '%s'.",
      moduleRef.workspace.name
    );

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
    extensions: ts.Extension[]
  ): ts.ResolvedModuleFull | undefined {
    let module: ts.ResolvedModuleFull | undefined = undefined;

    // Resolve the module to a file within the package
    const pkgDir = findPackageDependencyDir(moduleRef, {
      startDir: searchDir,
      // TODO: stopDir ==> workspace root? security & perf
    });
    if (pkgDir) {
      this.resolverLog.log(
        "Loading module from external package '%s'.",
        pkgDir
      );

      module = this.resolveModule(pkgDir, moduleRef.path, extensions);
      if (!module && moduleRef.path) {
        // Try again, without using a path, but only look for type (.d.ts)
        // files. Hand-crafted type modules in the package don't have to
        // use the same file layout as the associated JS/TS module.
        module = this.resolveModule(pkgDir, undefined, [ts.Extension.Dts]);
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
        this.resolverLog.log(
          "Loading module from external @types package '%s'.",
          typesPkgDir
        );

        module = this.resolveModule(
          typesPkgDir,
          typesModuleRef.path,
          this.extensionsTypeScript
        );
        if (!module && typesModuleRef.path) {
          // Try again, without using a path. @types modules don't have to use
          // the same file layout as the associated JS/TS module.
          module = this.resolveModule(typesPkgDir, undefined, [
            ts.Extension.Dts,
          ]);
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
    extensions: ts.Extension[]
  ): ts.ResolvedModuleFull | undefined {
    this.resolverLog.log("Loading module from directory '%s'.", searchDir);
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

    // ignore resolver errors for code files
    const codeExts = /\.(css)$/i;
    if (path.extname(moduleName).match(codeExts)) {
      return false;
    }

    return true;
  }

  resolveModuleNames(
    moduleNames: string[],
    containingFile: string,
    _reusedNames: string[] | undefined,
    _redirectedReference?: ts.ResolvedProjectReference
  ): (ts.ResolvedModuleFull | undefined)[] {
    //
    //  If the containing file is a type file (.d.ts), it can only import
    //  other type files. Restrict module resolution accordingly.
    //
    const extensions = hasExtension(containingFile, ts.Extension.Dts)
      ? this.extensionsTypeScript
      : this.extensionsAll;

    const resolutions: (ts.ResolvedModuleFull | undefined)[] = [];

    for (let moduleName of moduleNames) {
      this.resolverLog.begin();
      this.resolverLog.log(
        "======== Resolving module '%s' from '%s' ========",
        moduleName,
        containingFile
      );

      //
      //  Replace any reference to 'react-native' with the platform-specific
      //  react-native package name.
      //
      moduleName = this.replaceReactNativePackageName(moduleName);

      let module: ts.ResolvedModuleFull | undefined = undefined;

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
      if (module) {
        this.resolverLog.log(
          "File %s exists - using it as a module resolution result.",
          module.resolvedFileName
        );
        this.resolverLog.log(
          "======== Module name '%s' was successfully resolved to '%s' ========",
          moduleName,
          module.resolvedFileName
        );
        this.resolverLog.endSuccess();
      } else {
        this.resolverLog.log(
          "Failed to resolve module %s to a file.",
          moduleName
        );
        this.resolverLog.log(
          "======== Module name '%s' failed to resolve to a file ========",
          moduleName
        );
        if (this.shouldShowResolverFailure(moduleName)) {
          this.resolverLog.endFailure();
        } else {
          this.resolverLog.reset();
        }
      }
    }

    return resolutions;
  }

  getResolvedModuleWithFailedLookupLocationsFromCache(
    moduleName: string,
    containingFile: string
  ): ts.ResolvedModuleWithFailedLookupLocations | undefined {
    this.resolverLog.begin();
    const resolution =
      this.defaultResolverHost.getResolvedModuleWithFailedLookupLocationsFromCache(
        moduleName,
        containingFile
      );
    this.resolverLog.endSuccess();
    return resolution;
  }

  resolveTypeReferenceDirectives(
    typeDirectiveNames: string[],
    containingFile: string,
    redirectedReference?: ts.ResolvedProjectReference
  ): (ts.ResolvedTypeReferenceDirective | undefined)[] {
    this.resolverLog.begin();
    const resolutions = this.defaultResolverHost.resolveTypeReferenceDirectives(
      typeDirectiveNames,
      containingFile,
      redirectedReference
    );
    this.resolverLog.endSuccess();
    return resolutions;
  }

  trace(message: string): void {
    this.resolverLog.log(message);
  }
}
