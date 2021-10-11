import {
  isFileModuleRef,
  isPackageModuleRef,
  parseModuleRef,
} from "@rnx-kit/tools-node";
import path from "path";
import { WorkspaceInfo } from "workspace-tools";

/**
 * Module reference relative to a workspace (in-repo package).
 */
export type WorkspaceModuleRef = {
  workspace: WorkspaceInfo[number];
  path?: string;
};

/**
 * Find out if this module is part of a workspace (in-repo package), or an
 * external dependency.
 *
 * @param moduleName Module
 * @param containingFile File which imported/required the module
 * @returns Workspace reference, if the module is part of an in-repo package. Otherwise, `undefined`.
 */
export function queryWorkspaceModuleRef(
  workspaces: WorkspaceInfo,
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
    workspace = workspaces.find((w) => w.name === n);
    workspaceModulePath = workspace ? ref.path : undefined;
  } else if (isFileModuleRef(ref)) {
    //
    //  This module is a file-system path. Resolve it using the
    //  containing file path. Then see if the resolved path lands
    //  under one of our workspace (in-repo) packages.
    //
    const p = path.resolve(path.dirname(containingFile), ref.path);
    workspace = workspaces.find((w) => {
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
