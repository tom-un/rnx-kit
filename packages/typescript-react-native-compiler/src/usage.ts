import { findPackage, PackageManifest, readPackage } from "@rnx-kit/tools-node";
import os from "os";
import path from "path";
import util from "util";

interface UsageColors {
  bold(s: string): string;
  blue(s: string): string;
  blueBackground(s: string): string;
  brightWhite(s: string): string;
}

function createUsageColors(): UsageColors {
  const showColors = process.stdout.isTTY && !process.env["NO_COLOR"];
  if (!showColors) {
    const nop = (s: string): string => {
      return s;
    };
    return {
      bold: nop,
      blue: nop,
      blueBackground: nop,
      brightWhite: nop,
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

  function brightWhite(s: string): string {
    return "\u001B[97m" + s + "\u001B[39m";
  }

  return {
    bold,
    blue,
    brightWhite,
    blueBackground,
  };
}

class Usage {
  private colors: UsageColors;
  private columns: number;

  private scriptName: string;
  private scriptNameNoExt: string;

  private pkg: PackageManifest | undefined;

  constructor() {
    this.colors = createUsageColors();
    this.columns = Math.min(process.stdout.columns, 120);

    const { base, name } = path.parse(process.argv[1]);
    this.scriptName = base;
    this.scriptNameNoExt = name;

    const pkgFile = findPackage(__dirname);
    this.pkg = pkgFile ? readPackage(pkgFile) : undefined;
  }

  print(): void {
    this.preamble();

    this.section("USAGE");

    this.commandLine(
      this.scriptName,
      `[${this.scriptNameNoExt} options] [tsc options]`
    );

    this.section(`${this.scriptNameNoExt.toUpperCase()} OPTIONS`);

    this.option(
      "--platform <p>",
      "Target react-native platform. This must refer to a platform which has a react-native implementation, such as ios, android, windows or macos. When given, react-native module resolution is used. Otherwise, modules are resolved using the configured TypeScript strategy."
    );
    this.option(
      "--platformExtensions <ext-1>[,<ext-2>[...<ext-N>]]",
      "List of platform file extensions to use when resolving react-native modules. Resolution always starts with the --platform name, followed by these extensions, ordered from highest precedence (ext-1) to lowest (ext-N)."
    );
    this.exampleHeader();
    this.example(
      `${this.scriptName} --platform ios --platformExtensions mobile,native`,
      "Resolution of module 'm' searchs for m.ios.* first, then m.mobile.*, m.native.*, and finally m.* (no extension)."
    );
    this.option(
      "--disableReactNativePackageSubstitution",
      "The react-native resolver maps module references from 'react-native' to the target platform's implementation, such as 'react-native-windows' for Windows, and 'react-native-macos' MacOS. This option disables that behavior."
    );
    this.option(
      "--traceReactNativeModuleResolutionErrors",
      "When the react-native resolver is active, display a detailed report whenever it fails to map a module to a file name."
    );
    this.option(
      "--traceResolutionLog <logFile>",
      "Write all resolution trace messages to a log file, instead of to the console. Trace messages are appended to the end of the file, and it is created if it doesn't exist."
    );

    if (this.pkg?.homepage) {
      console.log(
        this.colors.brightWhite(`Full documentation: ${this.pkg.homepage}`) +
          os.EOL +
          os.EOL
      );
    }
  }

  private wrapAndIndent(spaces: number, s: string): string {
    const indentText = " ".repeat(spaces);

    const words = s.split(" ");

    let text = indentText;
    let column = indentText.length;

    // Alawys print the first word on the first line. Pulling this out
    // of the loop makes the conditions for indenting and wrapping
    // simpler.
    const firstWord = words.shift();
    text += firstWord;
    column += firstWord?.length ?? 0;

    for (const word of words) {
      // Print a separator before printing the word. Use a space if the
      // word fits on the current line. Otherwise, wrap to the next line.
      if (column + 1 + word.length < this.columns) {
        text += " ";
        column += 1;
      } else {
        text += os.EOL + indentText;
        column = indentText.length;
      }

      text += word;
      column += word.length;
    }

    return text;
  }

  preamble(): void {
    const message = util.format(
      "%s: TypeScript with react-native - Version %s",
      this.scriptNameNoExt,
      this.pkg?.version ?? "Unknown"
    );

    console.log(
      this.colors.brightWhite(message) +
        " ".repeat(this.columns - message.length - 5) +
        this.colors.blueBackground(this.colors.brightWhite(" RN  "))
    );
    console.log(
      " ".repeat(process.stdout.columns - 5) +
        this.colors.blueBackground(this.colors.brightWhite("  TS "))
    );
  }

  section(header: string): void {
    console.log(this.colors.bold(this.colors.brightWhite(header)) + os.EOL);
  }

  commandLine(script: string, params: string): void {
    console.log(
      this.wrapAndIndent(2, this.colors.blue(script + " " + params)) + os.EOL
    );
  }

  option(text: string, description: string): void {
    console.log(this.wrapAndIndent(2, this.colors.blue(text)));
    console.log(
      this.wrapAndIndent(2, this.colors.brightWhite(description)) + os.EOL
    );
  }

  exampleHeader(): void {
    console.log(this.colors.brightWhite(this.wrapAndIndent(4, "Example:")));
  }

  example(text: string, description: string): void {
    console.log(this.wrapAndIndent(6, this.colors.blue(text)));
    console.log(
      this.wrapAndIndent(6, this.colors.brightWhite(description)) + os.EOL
    );
  }
}

export function usage(): void {
  const usage = new Usage();
  usage.print();
}
