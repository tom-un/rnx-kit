import { transform as swcTransform } from "@swc/core";
import {
  JsTransformerConfig,
  JsTransformOptions,
  transform as metroTransform,
} from "metro-transform-worker";
import DependencyCollector from "./DependencyCollector";

export { getCacheKey } from "metro-transform-worker";

const countLines = (() => {
  const reLine = /^/gm;
  return (str: string): number => str.match(reLine)?.length ?? 0;
})();

function isAsset(filename: string, options: JsTransformOptions): boolean {
  return filename.endsWith(".json") || options.type === "asset";
}

function isFlow(filename: string, data: Buffer): boolean {
  if (filename.includes("/react-native/")) {
    // `react-native` doesn't mark all files with `@flow`. Just assume
    // everything is written in Flow.
    return true;
  }

  return data.includes("@flow") || data.includes("@noflow");
}

function isUsingEsbuild(config: JsTransformerConfig): boolean {
  return config.minifierPath.startsWith("@rnx-kit/metro-serializer-esbuild");
}

export const transform: typeof metroTransform = async (
  config,
  projectRoot,
  filename,
  data,
  options
) => {
  if (
    !isUsingEsbuild(config) ||
    isAsset(filename, options) ||
    isFlow(filename, data)
  ) {
    return metroTransform(config, projectRoot, filename, data, options);
  }

  const dependencyCollector = new DependencyCollector();
  const { code } = await swcTransform(data.toString("utf-8"), {
    filename,
    swcrc: false,
    jsc: {
      parser:
        filename.endsWith(".ts") || filename.endsWith(".tsx")
          ? {
              syntax: "typescript",
              tsx: filename.endsWith(".tsx"),
            }
          : {
              syntax: "ecmascript",
              jsx: true,
            },
      target: "es2021",
      transform: {
        optimizer: {
          globals: {
            vars: {
              __DEV__: JSON.stringify(Boolean(options.dev)),
              __METRO_GLOBAL_PREFIX__: "''",
            },
          },
        },
      },
    },
    minify: options.minify,
    sourceMaps: true,
    plugin: (m) => dependencyCollector.visitProgram(m),
    isModule: options.type !== "script",
  });

  return {
    dependencies: dependencyCollector.dependencies,
    output: [
      {
        data: {
          code,
          lineCount: countLines(code),
          map: [],
          functionMap: null,
        },
        type: options.type === "script" ? "js/script" : "js/module",
      },
    ],
  };
};
