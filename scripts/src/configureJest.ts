import path from "path";
import { JestPlatform } from "./tasks/jest";

export function configureJest(platform?: JestPlatform) {
  const defaultConfig = {
    preset: "ts-jest",
    roots: ["src"],
    snapshotResolver: path.resolve(__dirname, "jest.snapshot.resolver.js"),
    testRegex: ".*\\.test\\.[jt]sx?$",
  };

  if (platform) {
    return {
      ...defaultConfig,
      haste: {
        defaultPlatform: `${platform}`,
        platforms: [`${platform}`, "native"],
      },
      globals: {
        __TEST_PLATFORM__: platform,
      },
    };
  }

  return defaultConfig;
}
