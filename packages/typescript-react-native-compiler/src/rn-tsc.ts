#!/usr/bin/env node

import { createResolverHost } from "@rnx-kit/typescript-react-native-resolver";
import { Service } from "@rnx-kit/typescript-service";
import yargs, { Arguments } from "yargs";

type CliArgs = {
  platform: string;
  project: string;
};

type Args = Arguments<CliArgs>;

function cli(args: Args): void {
  const service = new Service();

  console.log("Loading project: %o", args.project);
  const config = service.getProjectConfigLoader().load(args.project);

  const compilerOptions: Record<string, unknown> = { ...args };
  delete compilerOptions.platform;
  delete compilerOptions.project;
  delete compilerOptions["_"];
  delete compilerOptions["$0"];

  console.log(args);
  console.log(compilerOptions);

  console.log(config);
  Object.assign(config.options, compilerOptions);
  console.log(config);

  // Create a resolver host for the project
  const resolverHost = createResolverHost(config);

  // Open the project
  const project = service.openProject(config, resolverHost);

  const projectEmitted = project.emit();
  if (!projectEmitted) {
    throw new Error("Failed to compile");
  }
}

if (require.main === module) {
  const args = yargs
    .usage("Usage: $0 [options]")
    .options({
      platform: {
        demandOption: true,
        describe: "Target platform",
        type: "string",
      },
      project: {
        demandOption: true,
        describe: "TypeScript project file",
        type: "string",
      },
    })
    //.example
    //.epilog
    .help().argv;

  try {
    cli(args);
  } catch (_) {
    process.exit(1);
  }
  process.exit(0);
}
