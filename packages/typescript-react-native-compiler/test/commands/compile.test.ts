import "jest-extended";

import { createDiagnosticWriter } from "@rnx-kit/typescript-service";

import type { CommandLine } from "../../src/command-line";
import { compile } from "../../src/commands";
import { createProgram } from "../../src/program";
import ts from "typescript";

jest.mock("../../src/program");
jest.mock("@rnx-kit/typescript-service");

describe("Commands > compile", () => {
  const mockGetCompilerOptions = jest.fn();
  const mockGetConfigFileParsingDiagnostics = jest.fn();
  const mockGetSyntacticDiagnostics = jest.fn();
  const mockGetOptionsDiagnostics = jest.fn();
  const mockGetGlobalDiagnostics = jest.fn();
  const mockGetSemanticDiagnostics = jest.fn();
  const mockEmit = jest.fn();

  const mockPrint = jest.fn();

  beforeEach(() => {
    mockGetCompilerOptions.mockReturnValue({});
    mockGetConfigFileParsingDiagnostics.mockReturnValue([]);
    mockGetSyntacticDiagnostics.mockReturnValue([]);
    mockGetOptionsDiagnostics.mockReturnValue([]);
    mockGetGlobalDiagnostics.mockReturnValue([]);
    mockGetSemanticDiagnostics.mockReturnValue([]);
    mockEmit.mockReturnValue({
      emitSkipped: false,
      diagnostics: [],
    });

    (createProgram as jest.Mock).mockReturnValue({
      getCompilerOptions: mockGetCompilerOptions,
      getConfigFileParsingDiagnostics: mockGetConfigFileParsingDiagnostics,
      getSyntacticDiagnostics: mockGetSyntacticDiagnostics,
      getOptionsDiagnostics: mockGetOptionsDiagnostics,
      getGlobalDiagnostics: mockGetGlobalDiagnostics,
      getSemanticDiagnostics: mockGetSemanticDiagnostics,
      emit: mockEmit,
    });

    (createDiagnosticWriter as jest.Mock).mockReturnValue({
      print: mockPrint,
    });
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  test("emits files", () => {
    compile({} as CommandLine);
    expect(mockEmit).toBeCalledTimes(1);
  });

  test("collects diagnostics from all sources", () => {
    compile({} as CommandLine);
    expect(mockGetConfigFileParsingDiagnostics).toBeCalledTimes(1);
    expect(mockGetSyntacticDiagnostics).toBeCalledTimes(1);
    expect(mockGetOptionsDiagnostics).toBeCalledTimes(1);
    expect(mockGetGlobalDiagnostics).toBeCalledTimes(1);
    expect(mockGetSemanticDiagnostics).toBeCalledTimes(1);
  });

  function makeDiagnostic(code: number, message: string): ts.Diagnostic {
    return {
      category: ts.DiagnosticCategory.Error,
      code,
      file: undefined,
      start: undefined,
      length: undefined,
      messageText: message,
    };
  }

  test("reports diagnostics", () => {
    mockGetSyntacticDiagnostics.mockReturnValue([
      makeDiagnostic(1, "your code is messed up"),
      makeDiagnostic(
        100,
        "expect to find working code, but all i got was this mess"
      ),
      makeDiagnostic(55, "seriously? you wrote this? its bad."),
    ]);

    const oldLog = console.log;
    const mockLog = jest.fn();
    console.log = mockLog;

    try {
      compile({} as CommandLine);
      expect(createDiagnosticWriter).toBeCalledTimes(1);
      expect(mockPrint).toBeCalledTimes(3);
      expect(mockLog).toBeCalledWith(expect.stringContaining("3 errors"));
    } finally {
      console.log = oldLog;
    }
  });
});
