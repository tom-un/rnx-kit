import { existsSync } from "fs";
import { argv, jestTask, JestTaskOptions, logger } from "just-scripts";

export type JestPlatform = "ios" | "android" | "windows" | "macos";

function createJestTask(
  options: JestTaskOptions,
  platform: JestPlatform | undefined
) {
  const config = platform ? `jest.config.${platform}.js` : "jest.config.js";
  if (existsSync(config)) {
    return jestTask({ ...options, config: config });
  } else if (!platform) {
    //  There's no Jest config file, but there might be Jest config embedded in
    //  package.json. jestTask() will figure that out and only run when it is present.
    //
    //  If package.json config is used, it can only apply to the "default" platform.
    //
    //  Why? Jest doesn't know anything about platform-specific source files and tests.
    //  We do a lot of tricks to make it work. Those tricks can't fit into a JSON file,
    //  though -- they need to be in a .js config file. So if you want platform-specific
    //  sources and tests, you need to use jest config files.
    //
    return jestTask({ ...options });
  } else {
    logger.warn(`no ${platform} jest configuration found, skipping jest`);
    return undefined;
  }
}

function getJestOptions(): JestTaskOptions {
  const updateSnapshot =
    argv().u || argv().updateSnapshot ? { updateSnapshot: true } : undefined;
  return {
    coverage: !!argv().production,
    runInBand: true,
    passWithNoTests: true,
    ...updateSnapshot,
  };
}

export const jest = {
  default: () => {
    const options = getJestOptions();
    return createJestTask(options, undefined);
  },
  ios: () => {
    const options = getJestOptions();
    return createJestTask(options, "ios");
  },
  android: () => {
    const options = getJestOptions();
    return createJestTask(options, "android");
  },
  macos: () => {
    const options = getJestOptions();
    return createJestTask(options, "macos");
  },
  windows: () => {
    const options = getJestOptions();
    return createJestTask(options, "windows");
  },
};
