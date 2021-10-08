import "jest-extended";
import os from "os";

import { createUsageColors, UsageColors } from "../../src/usage/colors";

describe("Usage > Colors > createUsageColors", () => {
  beforeAll(() => {
    expect(process.stdout.isTTY).toBeTrue();
  });

  test("creates a colorless implementation when NO_COLOR is set", () => {
    process.env["NO_COLOR"] = "1";
    const colors = createUsageColors();
    expect(colors.bold("test")).toEqual("test");
    expect(colors.blue("test")).toEqual("test");
    expect(colors.blueBackground("test")).toEqual("test");
    expect(colors.brightWhite("test")).toEqual("test");
  });

  test("creates a colorful implementation when NO_COLOR is not set", () => {
    delete process.env["NO_COLOR"];
    const colors = createUsageColors();
    expect(colors.bold("test")).not.toEqual("test");
    expect(colors.bold("test")).toEqual(expect.stringContaining("test"));
    expect(colors.blue("test")).not.toEqual("test");
    expect(colors.blue("test")).toEqual(expect.stringContaining("test"));
    expect(colors.blueBackground("test")).not.toEqual("test");
    expect(colors.blueBackground("test")).toEqual(
      expect.stringContaining("test")
    );
    expect(colors.brightWhite("test")).not.toEqual("test");
    expect(colors.brightWhite("test")).toEqual(expect.stringContaining("test"));
  });
});
