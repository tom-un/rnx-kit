import "jest-extended";

import fs from "fs";
import path from "path";
import tempDir from "temp-dir";

import { CommandLine, parseCommandLine } from "../src/command-line";
import { createProgram } from "../src/program";

describe("Program > createProgram", () => {
  const fixturePath = path.join(process.cwd(), "test", "__fixtures__");

  let testTempDir: string;

  beforeEach(() => {
    testTempDir = fs.mkdtempSync(
      path.join(
        tempDir,
        "rnx-kit-typescript-react-native-compiler-createProgram-test-"
      )
    );
  });

  afterEach(() => {
    fs.rmdirSync(testTempDir, { maxRetries: 5, recursive: true });
  });

  function getCommandLine(useRnPackage?: boolean): CommandLine {
    const cmdLine = parseCommandLine([
      "node",
      "rn-tsc.js",
      ...(useRnPackage ? ["--platform", "ios"] : []),
      ...(useRnPackage ? ["--platformExtensions", "native"] : []),
      ...(useRnPackage
        ? [path.join(fixturePath, "rn", "index.ios.ts")]
        : [path.join(fixturePath, "ts", "index.ts")]),
      "--outDir",
      testTempDir,
      "--declaration",
      "--strict",
    ]);
    return cmdLine;
  }

  test("creates a program with the given set of root files", () => {
    const program = createProgram(getCommandLine());
    expect(program.getRootFileNames()).toIncludeSameMembers([
      path.join(fixturePath, "ts", "index.ts"),
    ]);
  });

  test("creates a program with the given options", () => {
    const program = createProgram(getCommandLine());
    expect(program.getCompilerOptions().outDir).toEqual(testTempDir);
    expect(program.getCompilerOptions().declaration).toBeTrue();
    expect(program.getCompilerOptions().strict).toBeTrue();
  });

  test("creates a program with the given set of project references", () => {
    const cmdLine = getCommandLine();
    cmdLine.ts.projectReferences = [{ path: "/foo/bar.ts" }];
    const program = createProgram(cmdLine);
    expect(program.getProjectReferences()).toIncludeSameMembers([
      { path: "/foo/bar.ts" },
    ]);
  });

  test("creates a program with the react-native resolver when a platform is specified", () => {
    const oldLog = console.log;
    const mockLog = jest.fn();
    console.log = mockLog;

    try {
      const cmdLine = getCommandLine(true);
      cmdLine.rnts.traceReactNativeModuleResolutionErrors = true;

      const program = createProgram(cmdLine);
      const emitResult = program.emit();
      expect(emitResult.emitSkipped).toBeFalse();
      expect(emitResult.diagnostics).toBeArrayOfSize(0);

      expect(fs.existsSync(path.join(testTempDir, "index.ios.js"))).toBeTrue();
      expect(fs.existsSync(path.join(testTempDir, "f.ios.js"))).toBeTrue();
      expect(fs.existsSync(path.join(testTempDir, "f.native.js"))).toBeFalse();

      expect(mockLog).toHaveBeenCalledTimes(0);
    } finally {
      console.log = oldLog;
    }
  });

  test("creates a program with the typescript resolver when no platform is specified", () => {
    const cmdLine = getCommandLine();

    const program = createProgram(cmdLine);
    const emitResult = program.emit();
    expect(emitResult.emitSkipped).toBeFalse();
    expect(emitResult.diagnostics).toBeArrayOfSize(0);

    expect(fs.existsSync(path.join(testTempDir, "index.js"))).toBeTrue();
    expect(fs.existsSync(path.join(testTempDir, "f.js"))).toBeTrue();
    expect(fs.existsSync(path.join(testTempDir, "f.native.js"))).toBeFalse();
  });
});
