import "jest-extended";
import { DiagnosticWriter } from "../src/diagnostics";
import { parseCommandLine } from "../src/command-line";

describe("ProjectConfigLoader > parseCommandLine", () => {
  const formatMock = jest.fn();
  const printMock = jest.fn();
  const writer: DiagnosticWriter = {
    format: formatMock,
    print: printMock,
  };

  afterEach(() => {
    jest.resetAllMocks();
  });

  test("succeeds when the command-line is valid", () => {
    const commandLine = parseCommandLine(["--outDir", "./lib"], writer);
    expect(commandLine).not.toBeNil();
    expect(printMock).not.toBeCalled();
  });

  test("fails when the command-line is invalid", () => {
    const commandLine = parseCommandLine(["--notARealParameter"], writer);
    expect(commandLine).toBeUndefined();
    expect(printMock).toBeCalledTimes(1);
  });
});
