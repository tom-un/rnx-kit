import path from "path";

function debug(s: string): string {
  console.log(s);
  return s;
}

function getTestPlatform() {
  return (global as any).__TEST_PLATFORM__ || "";
}

export function resolveSnapshotPath(
  testPath: string,
  snapshotExtension: string
): string {
  const platform = getTestPlatform();

  const testDirectory = path.dirname(testPath);
  const testFile = path.basename(testPath);

  const snapshotDirectory = path.join(testDirectory, "__snapshots__", platform);
  const snapshotFile = testFile + snapshotExtension;

  return debug(path.join(snapshotDirectory, snapshotFile));
}

export function resolveTestPath(
  snapshotPath: string,
  snapshotExtension: string
): string {
  const platform = getTestPlatform();

  const snapshotDirectory = path.dirname(snapshotPath);
  const snapshotFile = path.basename(snapshotPath);

  let testDirectory = path.dirname(snapshotDirectory);
  if (platform) {
    testDirectory = path.dirname(testDirectory);
  }
  const testFile = snapshotFile.slice(0, -snapshotExtension.length);

  return debug(path.join(testDirectory, testFile));
}

export const testPathForConsistencyCheck: string =
  "some/__tests__/example.test.js";
