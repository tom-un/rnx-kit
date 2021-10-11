import {
  isFileModuleRef,
  isPackageModuleRef,
  parseModuleRef,
} from "@rnx-kit/tools-node";
import {
  createDefaultResolverHost,
  ResolverHost,
} from "@rnx-kit/typescript-service";
import { builtinModules } from "module";
import path from "path";
import ts from "typescript";
import { getWorkspaces, WorkspaceInfo } from "workspace-tools";

import { hasExtension, ExtensionsTypeScript } from "./extension";
import { createLoggedIO } from "./io";
import { ResolverLog, ResolverLogMode } from "./log";
import { createReactNativePackageNameReplacer } from "./react-native-package-name";
import {
  resolveWorkspaceModule,
  resolvePackageModule,
  resolveFileModule,
} from "./resolve";
import type { ResolverContext } from "./types";
import { queryWorkspaceModuleRef } from "./workspace";

/**
 * Implementation of ResolverHost for use with react-native applications.
 */
export class ReactNativeResolverHost {
  private options: ts.ParsedCommandLine["options"];
  private platform: string;
  private disableReactNativePackageSubstitution: boolean;

  private resolverLog: ResolverLog;
  private defaultResolverHost: ResolverHost;

  private replaceReactNativePackageName: (m: string) => string;

  private context: ResolverContext;

  private workspaces: WorkspaceInfo;

  private allowedExtensions: ts.Extension[];

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

    //
    //  React-native package name replacement is currently controlled by a
    //  command-line option because the windows and mac platforms
    //  (react-native-windows, react-native-macos) don't yet support it.
    //
    //  react-native-windows doesn't export a complete set of react-native
    //  types, leading to errors about missing names like 'AppRegistry'
    //  and 'View':
    //
    //       https://github.com/microsoft/react-native-windows/issues/8627
    //
    //  react-native-macos doesn't export types, instead relying on the
    //  in-tree types for ios.
    //
    this.replaceReactNativePackageName = createReactNativePackageNameReplacer(
      this.platform,
      !this.disableReactNativePackageSubstitution,
      this.resolverLog
    );

    this.context = {
      io: createLoggedIO(this.resolverLog),
      log: this.resolverLog,
      platformExtensions: [this.platform, ...(platformExtensions || [])].map(
        (e) => `.${e}` // prepend a '.' to each platform extension
      ),
    };

    this.workspaces = getWorkspaces(process.cwd());

    this.allowedExtensions = [...ExtensionsTypeScript];
    if (this.options.checkJs) {
      this.allowedExtensions.push(ts.Extension.Js, ts.Extension.Jsx);
    }
    if (this.options.resolveJsonModule) {
      this.allowedExtensions.push(ts.Extension.Json);
    }
  }

  resolveModuleNames(
    moduleNames: string[],
    containingFile: string,
    _reusedNames: string[] | undefined,
    _redirectedReference?: ts.ResolvedProjectReference
  ): (ts.ResolvedModuleFull | undefined)[] {
    //
    //  If the containing file is a type file (.d.ts), it can only import
    //  other type files. Search for both .d.ts and .ts files, as some
    //  modules import as "foo.d" with the intent to resolve to "foo.d.ts".
    //
    const extensions = hasExtension(containingFile, ts.Extension.Dts)
      ? [ts.Extension.Dts, ts.Extension.Ts]
      : this.allowedExtensions;

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

      const workspaceRef = queryWorkspaceModuleRef(
        this.workspaces,
        moduleName,
        containingFile
      );
      if (workspaceRef) {
        module = resolveWorkspaceModule(this.context, workspaceRef, extensions);
      } else {
        const moduleRef = parseModuleRef(moduleName);
        if (isPackageModuleRef(moduleRef)) {
          module = resolvePackageModule(
            this.context,
            moduleRef,
            path.dirname(containingFile),
            extensions
          );
        } else if (isFileModuleRef(moduleRef)) {
          module = resolveFileModule(
            this.context,
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
        if (
          this.resolverLog.getMode() !== ResolverLogMode.Never &&
          shouldShowResolverFailure(moduleName)
        ) {
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

/**
 * Decide whether or not to show failure information for the named module.
 *
 * @param moduleName Module
 */
export function shouldShowResolverFailure(moduleName: string): boolean {
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
