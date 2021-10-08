import os from "os";

import { usage } from "../../src/usage";

describe("Usage > usage", () => {
  test("prints usage information", () => {
    const oldLog = console.log;
    let logData = "";
    console.log = (message: string): void => {
      logData += message + os.EOL;
    };

    try {
      usage();
    } finally {
      console.log = oldLog;
    }

    expect(logData).toMatchSnapshot();
  });
});
