export interface UsageColors {
  bold(s: string): string;

  blue(s: string): string;
  brightWhite(s: string): string;

  blueBackground(s: string): string;
}

export function createUsageColors(): UsageColors {
  const showColors = process.stdout.isTTY && !process.env["NO_COLOR"];
  if (!showColors) {
    const nop = (s: string): string => {
      return s;
    };
    return {
      bold: nop,
      blue: nop,
      brightWhite: nop,
      blueBackground: nop,
    };
  }

  function bold(s: string): string {
    return "\u001B[1m" + s + "\u001B[22m";
  }

  const isWindows =
    process.env["OS"] &&
    process.env["OS"].toLowerCase().indexOf("windows") !== -1;
  const isWindowsTerminal = process.env["WT_SESSION"];
  const isVSCode =
    process.env["TERM_PROGRAM"] && process.env["TERM_PROGRAM"] === "vscode";

  function blue(s: string): string {
    if (isWindows && !isWindowsTerminal && !isVSCode) {
      return brightWhite(s);
    }

    return "\u001B[94m" + s + "\u001B[39m";
  }

  function brightWhite(s: string): string {
    return "\u001B[97m" + s + "\u001B[39m";
  }

  const supportsRicherColors =
    process.env["COLORTERM"] === "truecolor" ||
    process.env["TERM"] === "xterm-256color";

  function blueBackground(s: string): string {
    if (supportsRicherColors) {
      return "\u001B[48;5;68m" + s + "\u001B[39;49m";
    } else {
      return "\u001B[44m" + s + "\u001B[39;49m";
    }
  }

  return {
    bold,
    blue,
    brightWhite,
    blueBackground,
  };
}
