import type { Config as CLIConfig } from "@react-native-community/cli-types";

type CLIStartOptions = {
  host: string;
  port: number;
  projectRoot?: string;
  watchFolders?: string[];
  assetPlugins?: string[];
  sourceExts?: string[];
  maxWorkers?: number;
  transformer?: string;
  customLogReporterPath?: string;
  https?: boolean;
  key?: string;
  cert?: string;
  resetCache?: boolean;
  config?: string;
  interactive: boolean;
};

export async function rnxStart(
  _argv: Array<string>,
  _cliConfig: CLIConfig,
  _cliStartOptions: CLIStartOptions
): Promise<void> {
  //  unpack command-line overrides
  // const {
  //   host,
  //   port,
  //   projectRoot,
  //   watchFolders,
  //   assetPlugins,
  //   sourceExts,
  //   maxWorkers,
  //   transformer,
  //   customLogReporterPath,
  //   https,
  //   key,
  //   cert,
  //   resetCache,
  //   config,
  //   noInteractive,
  // } = cliStartOptions;

  // TODO: apply kit config
  // TODO: apply cmdline overrides
  // TODO: configure TS server/project and hook
  // TODO: once your pr goes through, it will be easier to get at runServer

  return Promise.resolve();
}
