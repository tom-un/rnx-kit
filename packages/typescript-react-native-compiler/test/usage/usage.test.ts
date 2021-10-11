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
      const usage = new Usage(80);
      usage.show();
    } finally {
      console.log = oldLog;
    }

    expect(logData).toMatchSnapshot();
  });
});
