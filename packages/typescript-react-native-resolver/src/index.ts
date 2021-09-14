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
} from "@rnx-kit/tools-node";
import fs from "fs";
import isString from "lodash/isString";
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
 * Given a platform, get the list of platform override extensions to use when
 * resolving a module to a file. The extensions are sorted from highest
 * precedence (index 0) to lowest.
 *
 * @param platform Platform
 * @returns Sorted array of platform override extensions
 */
export function getPlatformOverrideExtensions(platform: string): string[] {
  const exts = ["." + platform];
  if (platform === "win32" || platform === "windows") {
    exts.push(".win");
  }
  exts.push(".native");
  return exts;
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

type ModuleFile = {
  path: string;
  extension: ResolvedModuleFull["extension"];
};

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

  constructor(
    platform: string,
    disableReactNativePackageSubstitution: boolean,
    options: ProjectConfig["options"]
  ) {
    this.platform = platform.toLowerCase();
    this.disableReactNativePackageSubstitution =
      disableReactNativePackageSubstitution;
    this.options = options;
    this.platformExtensions = getPlatformOverrideExtensions(this.platform);
    this.reactNativePackageName = getReactNativePackageName(this.platform);
    this.workspaces = getWorkspaces(process.cwd());
    this.defaultResolverHost = createDefaultResolverHost(options);
  }

  private isFile(p: string): boolean {
    const result = isFile(p);
    if (!result && this.options.traceResolution) {
      console.log(`File ${p} does not exist.`);
    }
    return result;
  }

  private isDirectory(p: string): boolean {
    const result = isDirectory(p);
    if (!result && this.options.traceResolution) {
      console.log(`Directory ${p} does not exist.`);
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
    if (this.options.traceResolution) {
      console.log(`Substituting module '${m}' with '${replaced}'.`);
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
      workspace = this.workspaces.find((w) =>
        p.startsWith(path.normalize(w.path))
      );
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
   * Now perform a more broad search. Combine each platform override with
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
  ): ModuleFile | undefined {
    // TODO: security: if join(searchDir, modulePath) takes you outside of searchDir, return undefined without touching the disk

    //
    //  See if the module has an extension that is in the list. If so, return
    //  the module path if it exists, or `undefined`.
    //
    const extension = getExtensionFromPath(modulePath);
    if (extension && extensions.indexOf(extension) !== -1) {
      const p = path.join(searchDir, modulePath);
      return this.isFile(p) ? { path: p, extension } : undefined;
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
            path: p,
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

  //
  //  ResolverHost API
  //

  resolveModuleNames(
    moduleNames: string[],
    containingFile: string,
    _reusedNames: string[] | undefined,
    _redirectedReference?: ResolvedProjectReference
  ): (ResolvedModuleFull | undefined)[] {
    const ExtensionsDtsOnly = [Extension.Dts];
    const ExtensionsSourceOnly = [Extension.Ts, Extension.Tsx];
    const ExtensionsAll = [Extension.Ts, Extension.Tsx, Extension.Dts];
    if (this.options.checkJs) {
      ExtensionsSourceOnly.push(Extension.Js, Extension.Jsx);
      ExtensionsAll.push(Extension.Js, Extension.Jsx);
    }
    if (this.options.resolveJsonModule) {
      ExtensionsSourceOnly.push(Extension.Json);
      ExtensionsAll.push(Extension.Json);
    }

    //
    //  If the containing file is a type file (.d.ts), it can only import
    //  other type files. Restrict module resolution accordingly.
    //
    const containingFileIsDts = hasExtension(containingFile, Extension.Dts);

    const resolutions: (ResolvedModuleFull | undefined)[] = [];

    for (let moduleName of moduleNames) {
      if (this.options.traceResolution) {
        console.log(
          `======= Resolving module '${moduleName}' from '${containingFile}' =======`
        );
      }

      //
      //  Replace any reference to 'react-native' with the platform-specific
      //  react-native package name.
      //
      moduleName = this.replaceReactNativePackageName(moduleName);

      const workspaceRef = this.queryWorkspaceModuleRef(
        moduleName,
        containingFile
      );
      if (workspaceRef) {
        if (this.options.traceResolution) {
          console.log(
            `Loading module '${moduleName}' from package '${workspaceRef.workspace.name}'.`
          );
        }

        let moduleFile: ModuleFile | undefined;
        //
        //  This module is part of a workspace (in-repo package).
        //  Search for it within that package. Only look for source files
        //  (ts[x], js[x], json). Don't look for type files (.d.ts).
        //
        //    NOTE: For modules which don't include a path (e.g. just
        //          the package name), search for "index", then use
        //          the "main" package prop.
        //
        const extensions = containingFileIsDts
          ? ExtensionsDtsOnly
          : ExtensionsSourceOnly;
        if (workspaceRef.path) {
          moduleFile = this.findModuleFile(
            workspaceRef.workspace.path,
            workspaceRef.path,
            extensions
          );
        }
        if (!moduleFile) {
          const { types, typings, main } = workspaceRef.workspace.packageJson;
          if (isString(types)) {
            if (this.options.traceResolution) {
              console.log(`Package has 'types' field '${types}'.`);
            }
            moduleFile = this.findModuleFile(
              workspaceRef.workspace.path,
              types,
              extensions
            );
          } else if (isString(typings)) {
            if (this.options.traceResolution) {
              console.log(`Package has 'typings' field '${typings}'.`);
            }
            moduleFile = this.findModuleFile(
              workspaceRef.workspace.path,
              typings,
              extensions
            );
          } else if (isString(main)) {
            if (this.options.traceResolution) {
              console.log(`Package has 'main' field '${main}'.`);
            }
            moduleFile = this.findModuleFile(
              workspaceRef.workspace.path,
              main,
              extensions
            );
          }
        }
        if (!moduleFile) {
          if (this.options.traceResolution) {
            console.log(`Searching for index file.`);
          }
          moduleFile = this.findModuleFile(
            workspaceRef.workspace.path,
            "index",
            extensions
          );
        }

        if (moduleFile) {
          resolutions.push({
            resolvedFileName: moduleFile.path,
            extension: moduleFile.extension,
          });
          if (this.options.traceResolution) {
            console.log(
              `File ${moduleFile.path} exists - using it as a module resolution result.`
            );
            console.log(
              `======= Module name '${moduleName}' was successfully resolved to '${moduleFile.path}' =======`
            );
          }
        } else {
          resolutions.push(undefined);
          if (this.options.traceResolution) {
            console.log(`Failed to resolve module ${moduleName} to a file.`);
            console.log(
              `======= Module name '${moduleName}' failed to resolve to a file' =======`
            );
          }
        }
        continue;
      }

      //
      //  This module is part of an external package.
      //
      const moduleRef = parseModuleRef(moduleName);
      if (isPackageModuleRef(moduleRef)) {
        let moduleFile: ModuleFile | undefined;

        //
        //  The module refers to a specific package. Search for the
        //  package under node_modules, starting from the containing
        //  file's directory, and moving up through each parent.
        //
        const pkgDir = findPackageDependencyDir(moduleRef, {
          startDir: path.dirname(containingFile),
          // TODO: stopDir ==> workspace root? security & perf
        });
        if (pkgDir) {
          //
          //  The package was found.
          //
          //  Search for the module, preferring typescript source (ts[x]) and
          //  type files (.d.ts) over javascript source (js[x], json).
          //
          //    NOTE: For modules which don't include a path (e.g. just
          //          the package name), search for "index", then use
          //          the "types", "typings", or "main" package props.
          //
          if (this.options.traceResolution) {
            console.log(
              `Loading module '${moduleName}' from '${pkgDir}' folder.`
            );
          }

          const extensions = containingFileIsDts
            ? ExtensionsDtsOnly
            : ExtensionsAll;
          if (moduleRef.path) {
            moduleFile = this.findModuleFile(
              pkgDir,
              moduleRef.path,
              extensions
            );
          }
          if (!moduleFile) {
            const { types, typings, main } = readPackage(pkgDir);
            if (isString(types)) {
              if (this.options.traceResolution) {
                console.log(`Package has 'types' field '${types}'.`);
              }
              moduleFile = this.findModuleFile(pkgDir, types, extensions);
            } else if (isString(typings)) {
              if (this.options.traceResolution) {
                console.log(`Package has 'typings' field '${typings}'.`);
              }
              moduleFile = this.findModuleFile(pkgDir, typings, extensions);
            } else if (isString(main)) {
              if (this.options.traceResolution) {
                console.log(`Package has 'main' field '${main}'.`);
              }
              moduleFile = this.findModuleFile(pkgDir, main, extensions);
            }
          }
          if (!moduleFile) {
            if (this.options.traceResolution) {
              console.log(`Searching for index file.`);
            }
            moduleFile = this.findModuleFile(pkgDir, "index", extensions);
          }
        }
        if (!moduleFile) {
          //
          //  The module still hasn't been resolved.
          //
          //  Search for a corresponding @types package under node_modules.
          //  Start from the containing file's directory, and move up through
          //  each parent.
          //
          const typesModuleRef: PackageModuleRef = {
            scope: "@types",
            name: getMangledPackageName(moduleRef),
            path: moduleRef.path,
          };
          const typesPkgDir = findPackageDependencyDir(typesModuleRef, {
            startDir: path.dirname(containingFile),
            // TODO: stopDir ==> workspace root? security & perf
          });
          if (typesPkgDir) {
            //
            //  The @types package was found.
            //
            //  Search for the module's type file (.d.ts).
            //
            //    NOTE: For modules which don't include a path (e.g. just
            //          the package name), search for "index", then use
            //          the "types", "typings", or "main" package props.
            //
            if (this.options.traceResolution) {
              console.log(
                `Loading module '${moduleName}' from '${typesPkgDir}' folder.`
              );
            }

            if (typesModuleRef.path) {
              moduleFile = this.findModuleFile(
                typesPkgDir,
                typesModuleRef.path,
                ExtensionsDtsOnly
              );
            }
            if (!moduleFile) {
              const { types, typings, main } = readPackage(typesPkgDir);
              if (isString(types)) {
                if (this.options.traceResolution) {
                  console.log(`Package has 'types' field '${types}'.`);
                }
                moduleFile = this.findModuleFile(
                  typesPkgDir,
                  types,
                  ExtensionsDtsOnly
                );
              } else if (isString(typings)) {
                if (this.options.traceResolution) {
                  console.log(`Package has 'typings' field '${typings}'.`);
                }
                moduleFile = this.findModuleFile(
                  typesPkgDir,
                  typings,
                  ExtensionsDtsOnly
                );
              } else if (isString(main)) {
                if (this.options.traceResolution) {
                  console.log(`Package has 'main' field '${main}'.`);
                }
                moduleFile = this.findModuleFile(
                  typesPkgDir,
                  main,
                  ExtensionsDtsOnly
                );
              }
            }
            if (!moduleFile) {
              if (this.options.traceResolution) {
                console.log(`Searching for index file.`);
              }
              moduleFile = this.findModuleFile(
                typesPkgDir,
                "index",
                ExtensionsDtsOnly
              );
            }
          }
        }

        if (moduleFile) {
          resolutions.push({
            resolvedFileName: moduleFile.path,
            extension: moduleFile.extension,
          });
          if (this.options.traceResolution) {
            console.log(
              `File ${moduleFile.path} exists - using it as a module resolution result.`
            );
            console.log(
              `======= Module name '${moduleName}' was successfully resolved to '${moduleFile.path}' =======`
            );
          }
        } else {
          resolutions.push(undefined);
          if (this.options.traceResolution) {
            console.log(`Failed to resolve module ${moduleName} to a file.`);
            console.log(
              `======= Module name '${moduleName}' failed to resolve to a file' =======`
            );
          }
        }

        continue;
      }

      if (isFileModuleRef(moduleRef)) {
        //
        //  This module refers to a file in the containing package.
        //
        //  Search for it, preferring typescript source (ts[x]) and type files
        //  (.d.ts) over javascript source (js[x], json).
        //
        //  If a matching module file was found in the contet of the
        //  containing file, return it. Otherwise, stop searching and
        //  return `undefined`.
        //
        const extensions = containingFileIsDts
          ? ExtensionsDtsOnly
          : ExtensionsAll;
        const searchDir = path.dirname(containingFile);
        if (this.options.traceResolution) {
          console.log(
            `Loading module '${moduleName}' from '${searchDir}' folder.`
          );
        }
        const moduleFile = this.findModuleFile(
          searchDir,
          moduleRef.path,
          extensions
        );

        if (moduleFile) {
          resolutions.push({
            resolvedFileName: moduleFile.path,
            extension: moduleFile.extension,
          });
          if (this.options.traceResolution) {
            console.log(
              `File ${moduleFile.path} exists - using it as a module resolution result.`
            );
            console.log(
              `======= Module name '${moduleName}' was successfully resolved to '${moduleFile.path}' =======`
            );
          }
        } else {
          resolutions.push(undefined);
          if (this.options.traceResolution) {
            console.log(`Failed to resolve module ${moduleName} to a file.`);
            console.log(
              `======= Module name '${moduleName}' failed to resolve to a file' =======`
            );
          }
        }
        continue;
      }

      //
      //  If the search is finished, and the module was not resolved,
      //  there are a few possible reasons why:
      //
      //    - the module's package is missing
      //    - the module file doesn't exist
      //      - module refers to a flow type file
      //      - module only exists for a different platform
      //      - module is just missing from the package
      //    - the module is an "internal" node module
      //
      //  Whatever the reason, we will return `undefined` to indicate
      //  that module resolution failed. TypeScript will proceed with
      //  the information it has, and may very well succeed without
      //  the module file.
      //
      resolutions.push(undefined);
      if (this.options.traceResolution) {
        console.log(`Failed to resolve module ${moduleName} to a file.`);
        console.log(
          `======= Module name '${moduleName}' failed to resolve to a file' =======`
        );
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
  disableReactNativePackageSubstitution: boolean
): ResolverHost {
  const host = new ReactNativeResolverHost(
    platform,
    disableReactNativePackageSubstitution,
    config.options
  );
  return host;
}
