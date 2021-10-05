#!/usr/bin/env node

import chalk from "chalk";
import os from "os";
import { cli } from "./cli";

try {
  cli();
  process.exit(0);
} catch (e) {
  if (typeof e === "object" && e !== null) {
    console.error(
      chalk.redBright("ERROR: ") + chalk.red(e.toString()) + os.EOL
    );
  }
  process.exit(1);
}
