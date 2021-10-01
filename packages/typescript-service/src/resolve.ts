import ts from "typescript";

export { Extension } from "typescript";
export type ResolvedModuleFull = ts.ResolvedModuleFull;
export type ResolvedProjectReference = ts.ResolvedProjectReference;
export type ResolvedModuleWithFailedLookupLocations =
  ts.ResolvedModuleWithFailedLookupLocations;
export type ResolvedTypeReferenceDirective = ts.ResolvedTypeReferenceDirective;

/**
 * Host interface which allows TypeScript to ask for module and type-reference resolution.
 */
export type ResolverHost = {
  /**
   * Resolve a set of modules to their TypeScript source files or declaration (`.d.ts`) files.
   *
   * @param moduleNames List of module names to resolve
   * @param containingFile File which is importing/requiring each module
   * @returns Array of resolved module info or `undefined` if there is no resolution. Must contains one entry per module name.
   */
  resolveModuleNames: (
    moduleNames: string[],
    containingFile: string,
    reusedNames: string[] | undefined,
    redirectedReference?: ResolvedProjectReference
  ) => (ResolvedModuleFull | undefined)[];

  /**
   * Query the host's module resolution cache for information about a specific module.
   *
   * @param moduleName Module name
   * @param containingFile File which is importing/requiring the module
   * @returns Resolved module information, or `undefined` if there is no resolution.
   */
  getResolvedModuleWithFailedLookupLocationsFromCache: (
    moduleName: string,
    containingFile: string
  ) => ResolvedModuleWithFailedLookupLocations | undefined;

  /**
   * Resolve a set of "type" reference directives to their TypeScript declaration (`.d.ts`) files.
   * This specifically resolves triple-slash type references:
   *
   *   `/// <reference type="name">`
   *
   * @param typeDirectiveNames List of type names to resolve
   * @param containingFile File which contains each triple-slash type reference
   * @returns Array of resolved type info or `undefined` if thre is no resolution. Must contain one entry per type name.
   */
  resolveTypeReferenceDirectives: (
    typeDirectiveNames: string[],
    containingFile: string,
    redirectedReference?: ResolvedProjectReference
  ) => (ResolvedTypeReferenceDirective | undefined)[];
};

/**
 * Create a default resolver host which follows TypeScript's resolution rules.
 *
 * @param options TypeScript compiler options
 * @param trace Optional function to use for reporting resolver trace messages. Only called when the compiler option `traceResolution` is enabled.
 * @returns Default resolver host implementation
 */
export function createDefaultResolverHost(
  options: ts.CompilerOptions,
  trace?: (message: string) => void
): ResolverHost {
  const moduleResolutionHost: ts.ModuleResolutionHost = {
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    trace: trace ?? ts.sys.write,
    directoryExists: ts.sys.directoryExists,
    realpath: ts.sys.realpath,
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    getDirectories: ts.sys.getDirectories,
  };

  return {
    resolveModuleNames: (
      moduleNames: string[],
      containingFile: string,
      _reusedNames: string[] | undefined,
      redirectedReference?: ts.ResolvedProjectReference
    ): (ts.ResolvedModuleFull | undefined)[] => {
      return moduleNames.map((name) => {
        const result = ts.resolveModuleName(
          name,
          containingFile,
          options,
          moduleResolutionHost,
          undefined, // cache
          redirectedReference
        );
        return result.resolvedModule;
      });
    },

    getResolvedModuleWithFailedLookupLocationsFromCache: (
      _moduleName: string,
      _containingFile: string
    ): ts.ResolvedModuleWithFailedLookupLocations | undefined => {
      throw new Error("Not implemented");
    },

    resolveTypeReferenceDirectives: (
      typeDirectiveNames: string[],
      containingFile: string,
      redirectedReference?: ts.ResolvedProjectReference
    ): (ts.ResolvedTypeReferenceDirective | undefined)[] => {
      return typeDirectiveNames.map((name) => {
        const result = ts.resolveTypeReferenceDirective(
          name,
          containingFile,
          options,
          moduleResolutionHost,
          redirectedReference
        );
        return result.resolvedTypeReferenceDirective;
      });
    },
  };
}
