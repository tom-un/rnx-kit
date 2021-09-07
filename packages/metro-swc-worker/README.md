# @rnx-kit/metro-swc-worker

[![Build](https://github.com/microsoft/rnx-kit/actions/workflows/build.yml/badge.svg)](https://github.com/microsoft/rnx-kit/actions/workflows/build.yml)
[![npm version](https://img.shields.io/npm/v/@rnx-kit/metro-swc-worker)](https://www.npmjs.com/package/@rnx-kit/metro-swc-worker)

## Usage

```js
const { makeMetroConfig } = require("@rnx-kit/metro-config");

module.exports = makeMetroConfig({
  projectRoot: __dirname,
  transformerPath: require.resolve("@rnx-kit/metro-swc-worker"),
});
```
