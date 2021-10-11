import type { IO } from "./io";
import type { ResolverLog } from "./log";

/**
 * Invariant context information used for resolving a module to a file.
 */
export type ResolverContext = {
  /**
   * Interface for querying the file system.
   */
  readonly io: IO;

  /**
   * Log for tracking module resolution activity
   */
  readonly log: ResolverLog;

  /**
   * List of react-native platform extensions, such as ".native".
   * Ordered from highest precedence (index 0) to lowest.
   */
  readonly platformExtensions: string[];
};
