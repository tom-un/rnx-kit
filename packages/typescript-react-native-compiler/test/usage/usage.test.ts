import os from "os";

import { Usage } from "../../src/usage/usage";

describe("Usage > usage", () => {
  test("prints usage information", () => {
    const oldLog = console.log;
    let logData = "";
    console.log = (message: string): void => {
      logData += message + os.EOL;
    };

    try {
      const usage = new Usage("rn-tsc.js", 80, "\n");
      usage.show();
    } finally {
      console.log = oldLog;
    }

    expect(logData).toMatchSnapshot();
  });
});
