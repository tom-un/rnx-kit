describe("@rnx-kit/metro-config", () => {
  const fs = require("fs");
  const path = require("path");
  const {
    UNIQUE_PACKAGES,
    defaultRoots,
    defaultWatchFolders,
    defaultWatchFoldersInRepo,
    excludeExtraCopiesOf,
    exclusionList,
    makeMetroConfig,
  } = require("../src/index");

  const metroConfigKeys = [
    "cacheStores",
    "resolver",
    "serializer",
    "server",
    "symbolicator",
    "transformer",
    "watchFolders",
  ];

  const currentWorkingDir = process.cwd();

  /**
   * Returns path to specified test fixture.
   */
  function fixturePath(name: string): string {
    return path.join(currentWorkingDir, "test", "__fixtures__", name);
  }

  /**
   * Sets current working directory to specified test fixture.
   */
  function setFixture(name: string): void {
    process.chdir(fixturePath(name));
  }

  afterEach(() => process.chdir(currentWorkingDir));

  test("defaultRoots() returns empty an empty list outside a monorepo", () => {
    const root = process.platform === "win32" ? "C:\\" : "/";
    expect(defaultRoots(root).length).toBe(0);
  });

  test("defaultWatchFolders() returns an empty list outside a monorepo", () => {
    const root = process.platform === "win32" ? "C:\\" : "/";
    expect(defaultWatchFolders(root).length).toBe(0);
  });

  test("defaultWatchFoldersInRepo() returns an empty list outside a monorepo", () => {
    const root = process.platform === "win32" ? "C:\\" : "/";
    expect(defaultWatchFoldersInRepo(root).length).toBe(0);
  });

  function validatePackageRoots(
    getRootFolders: (cwd: string) => string[],
    expectExternalPackages: boolean
  ) {
    setFixture("awesome-repo/packages/t-800");

    const repoRoot = path.dirname(path.dirname(process.cwd()));
    const folders = getRootFolders(process.cwd());

    const packages = ["conan", "dutch", "john", "quaid", "t-800"].map((p) =>
      path.join(repoRoot, "packages", p)
    );
    const expectedFolders = expectExternalPackages
      ? [path.join(repoRoot, "node_modules"), ...packages]
      : [...packages];
    expect(folders.sort()).toEqual(expectedFolders.sort());
  }

  test("defaultRoots() returns internal and external packages in a monorepo", () => {
    validatePackageRoots(defaultRoots, true);
  });

  test("defaultWatchFolders() returns internal and external packages in a monorepo", () => {
    validatePackageRoots(defaultWatchFolders, true);
  });

  test("defaultWatchFoldersInRepo() returns only internal packages in a monorepo", () => {
    validatePackageRoots(defaultWatchFoldersInRepo, false);
  });

  test("excludeExtraCopiesOf() ignores symlinks", () => {
    const repo = fixturePath("awesome-repo");
    const packageCopy = path.join(
      repo,
      "packages",
      "t-800",
      "node_modules",
      "react-native",
      "package.json"
    );
    const projectCopy = path.join(
      repo,
      "node_modules",
      "react-native",
      "package.json"
    );

    setFixture("awesome-repo/packages/t-800");

    expect(
      fs.lstatSync("node_modules/react-native").isSymbolicLink()
    ).toBeTruthy();

    const exclude = excludeExtraCopiesOf("react-native");
    expect(exclude.test(packageCopy)).toBeTruthy();
    expect(exclude.test(projectCopy)).toBeFalsy();
  });

  test("excludeExtraCopiesOf() handles nested dependencies", () => {
    const repo = fixturePath("awesome-repo");
    const packageRnCopy = path.join(
      repo,
      "packages",
      "john",
      "node_modules",
      "react-native",
      "package.json"
    );
    const projectRnCopy = path.join(
      repo,
      "node_modules",
      "react-native",
      "package.json"
    );

    const packageMatrixCopy = path.join(
      repo,
      "packages",
      "john",
      "node_modules",
      "@commando",
      "matrix",
      "package.json"
    );
    const projectMatrixCopy = path.join(
      repo,
      "node_modules",
      "@commando",
      "matrix",
      "package.json"
    );

    setFixture("awesome-repo/packages/john");

    const excludeReactNative = excludeExtraCopiesOf("react-native");
    expect(excludeReactNative.test(packageRnCopy)).toBeFalsy();
    expect(excludeReactNative.test(projectRnCopy)).toBeTruthy();

    const excludeMatrix = excludeExtraCopiesOf("@commando/matrix");
    expect(excludeMatrix.test(packageMatrixCopy)).toBeFalsy();
    expect(excludeMatrix.test(projectMatrixCopy)).toBeTruthy();
  });

  test("excludeExtraCopiesOf() throws if a package is not found", () => {
    expect(excludeExtraCopiesOf("jest", process.cwd())).toBeDefined();

    const packageName = "this-package-does-not-exist";
    expect(() => excludeExtraCopiesOf(packageName, process.cwd())).toThrowError(
      `Failed to find '${packageName}'`
    );
  });

  test("exclusionList() ignores extra copies of react and react-native", () => {
    const repo = fixturePath("awesome-repo");
    const reactCopy = path.join(repo, "node_modules", "react", "package.json");
    const packageCopy = path.join(
      repo,
      "packages",
      "john",
      "node_modules",
      "react-native",
      "package.json"
    );
    const projectCopy = path.join(
      repo,
      "node_modules",
      "react-native",
      "package.json"
    );

    // Conan does not have a local copy of react-native. It should
    // exclude all but the repo's copy.
    setFixture("awesome-repo/packages/conan");
    const conanExclude = exclusionList();
    expect(conanExclude.test(reactCopy)).toBeFalsy();
    expect(conanExclude.test(packageCopy)).toBeTruthy();
    expect(conanExclude.test(projectCopy)).toBeFalsy();
    expect(
      conanExclude.test(
        path.join("conan", "windows", ".vs", "conan", "v16", "Browse.VC.db")
      )
    ).toBeTruthy();
    expect(conanExclude.test("Test.ProjectImports.zip")).toBeTruthy();

    // John has a local copy of react-native and should ignore all other copies.
    setFixture("awesome-repo/packages/john");
    const johnExclude = exclusionList();
    expect(johnExclude.test(reactCopy)).toBeFalsy();
    expect(johnExclude.test(packageCopy)).toBeFalsy();
    expect(johnExclude.test(projectCopy)).toBeTruthy();
    expect(
      johnExclude.test(
        path.join("john", "windows", ".vs", "conan", "v16", "Browse.VC.db")
      )
    ).toBeTruthy();
    expect(johnExclude.test("Test.ProjectImports.zip")).toBeTruthy();
  });

  test("exclusionList() returns additional exclusions", () => {
    const repo = fixturePath("awesome-repo");
    const reactCopy = path.join(repo, "node_modules", "react", "package.json");
    const packageCopy = path.join(
      repo,
      "packages",
      "john",
      "node_modules",
      "react-native",
      "package.json"
    );
    const projectCopy = path.join(
      repo,
      "node_modules",
      "react-native",
      "package.json"
    );

    setFixture("awesome-repo/packages/conan");
    const conanExclude = exclusionList([/.*[\/\\]__fixtures__[\/\\].*/]);
    expect(conanExclude.test(reactCopy)).toBeTruthy();
    expect(conanExclude.test(packageCopy)).toBeTruthy();
    expect(conanExclude.test(projectCopy)).toBeTruthy();
    expect(
      conanExclude.test(
        path.join("conan", "windows", ".vs", "conan", "v16", "Browse.VC.db")
      )
    ).toBeTruthy();
    expect(conanExclude.test("Test.ProjectImports.zip")).toBeTruthy();
  });

  test("makeMetroConfig() returns a default Metro config", async () => {
    const config = makeMetroConfig();
    expect(Object.keys(config).sort()).toEqual(metroConfigKeys);

    if (!config.resolver) {
      fail("Expected `config.resolver` to be defined");
    } else if (!config.resolver.extraNodeModules) {
      fail("Expected `config.resolver.extraNodeModules` to be defined");
    } else if (!(config.resolver.blacklistRE instanceof RegExp)) {
      fail("Expected `config.resolver.blacklistRE` to be a RegExp");
    } else if (!(config.resolver.blockList instanceof RegExp)) {
      fail("Expected `config.resolver.blockList` to be a RegExp");
    } else if (!config.transformer) {
      fail("Expected `config.transformer` to be defined");
    } else if (!config.transformer.getTransformOptions) {
      fail("Expected `config.transformer.getTransformOptions` to be defined");
    } else if (!Array.isArray(config.watchFolders)) {
      fail("Expected `config.watchFolders` to be an array");
    }

    expect(Object.keys(config.resolver.extraNodeModules)).toEqual(
      UNIQUE_PACKAGES
    );

    const blockList = exclusionList().source;
    expect(config.resolver.blacklistRE.source).toBe(blockList);
    expect(config.resolver.blockList.source).toBe(blockList);

    const opts = { dev: false, hot: false };
    const transformerOptions = await config.transformer.getTransformOptions(
      [],
      opts,
      () => Promise.resolve([])
    );
    expect(transformerOptions?.transform).toEqual({
      experimentalImportSupport: false,
      inlineRequires: false,
    });

    expect(config.watchFolders.length).toBeGreaterThan(0);
  });

  test("makeMetroConfig() merges Metro configs", async () => {
    const config = makeMetroConfig({
      projectRoot: __dirname,
      resetCache: true,
    });

    expect(Object.keys(config).sort()).toEqual(
      metroConfigKeys.concat(["projectRoot", "resetCache"]).sort()
    );

    expect(config.projectRoot).toBe(__dirname);
    expect(config.resetCache).toBeTruthy();

    if (!config.resolver) {
      fail("Expected `config.resolver` to be defined");
    } else if (!config.resolver.extraNodeModules) {
      fail("Expected `config.resolver.extraNodeModules` to be defined");
    } else if (!(config.resolver.blacklistRE instanceof RegExp)) {
      fail("Expected `config.resolver.blacklistRE` to be a RegExp");
    } else if (!(config.resolver.blockList instanceof RegExp)) {
      fail("Expected `config.resolver.blockList` to be a RegExp");
    } else if (!config.transformer) {
      fail("Expected `config.transformer` to be defined");
    } else if (!config.transformer.getTransformOptions) {
      fail("Expected `config.transformer.getTransformOptions` to be defined");
    } else if (!Array.isArray(config.watchFolders)) {
      fail("Expected `config.watchFolders` to be an array");
    }

    expect(Object.keys(config.resolver.extraNodeModules)).toEqual(
      UNIQUE_PACKAGES
    );

    const blockList = exclusionList().source;
    expect(config.resolver.blacklistRE.source).toBe(blockList);
    expect(config.resolver.blockList.source).toBe(blockList);

    const opts = { dev: false, hot: false };
    const transformerOptions = await config.transformer.getTransformOptions(
      [],
      opts,
      () => Promise.resolve([])
    );
    expect(transformerOptions?.transform).toEqual({
      experimentalImportSupport: false,
      inlineRequires: false,
    });

    expect(config.watchFolders.length).toBeGreaterThan(0);
  });

  test("makeMetroConfig() merges `extraNodeModules`", async () => {
    const config = makeMetroConfig({
      projectRoot: __dirname,
      resolver: {
        extraNodeModules: {
          "my-awesome-package": "/skynet",
          "react-native": "/skynet",
        },
      },
    });

    const extraNodeModules =
      config.resolver && config.resolver.extraNodeModules;
    if (!extraNodeModules) {
      fail("Expected config.resolver.extraNodeModules to be set");
    }

    expect(Object.keys(extraNodeModules).sort()).toEqual([
      "my-awesome-package",
      "react",
      "react-native",
    ]);

    expect(extraNodeModules["my-awesome-package"]).toBe("/skynet");
    expect(extraNodeModules["react-native"]).toBe("/skynet");
  });
});