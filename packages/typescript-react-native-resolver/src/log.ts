import fs from "fs";
import os from "os";
import util from "util";

export const enum ResolverLogMode {
  Never,
  Always,
  OnFailure,
}

export class ResolverLog {
  private mode: ResolverLogMode;
  private buffering: boolean;
  private messages: string[];
  private logFile: string | undefined;

  constructor(mode: ResolverLogMode, logFile?: string) {
    this.mode = mode;
    this.buffering = false;
    this.messages = [];
    this.logFile = logFile;
  }

  getMode(): ResolverLogMode {
    return this.mode;
  }

  begin(): void {
    this.buffering = true;
  }

  log(format: string, ...args: string[]): void {
    if (this.mode !== ResolverLogMode.Never) {
      this.messages.push(util.format(format, ...args));
      if (!this.buffering) {
        this.endSuccess();
      }
    }
  }

  endSuccess(): void {
    if (this.mode === ResolverLogMode.Always) {
      this.flush();
    }
    this.reset();
  }

  endFailure(): void {
    if (
      this.mode === ResolverLogMode.OnFailure ||
      this.mode === ResolverLogMode.Always
    ) {
      this.flush();
    }
    this.reset();
  }

  reset(): void {
    if (this.mode !== ResolverLogMode.Never) {
      this.messages = [];
    }
    this.buffering = false;
  }

  private flush(): void {
    const messages = this.messages.join(os.EOL);
    if (this.logFile) {
      fs.writeFileSync(this.logFile, messages + os.EOL, {
        encoding: "utf-8",
        flag: "a",
      });
    } else {
      console.log(messages);
    }
  }
}
