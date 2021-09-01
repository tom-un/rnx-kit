import {
  createDefaultResolverHost,
  ProjectConfig,
  ResolverHost,
} from "@rnx-kit/typescript-service";
import { findPackage } from "@rnx-kit/tools-node";

findPackage;

export function createResolverHost(config: ProjectConfig): ResolverHost {
  return createDefaultResolverHost(config.options);
}
