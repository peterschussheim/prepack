/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

/* @flow */

import type { CompilerDiagnostics, ErrorHandlerResult } from "../lib/errors.js";
import { prepack } from "../lib/prepack-node.js";
import invariant from "../lib/invariant.js";

let chalk = require("chalk");
let path  = require("path");
let fs    = require("fs");

function search(dir, relative) {
  let tests = [];

  if (fs.existsSync(dir)) {
    for (let name of fs.readdirSync(dir)) {
      let loc = path.join(dir, name);
      let stat = fs.statSync(loc);

      if (stat.isFile()) {
        tests.push({
          file: fs.readFileSync(loc, "utf8"),
          name: path.join(relative, name)
        });
      } else if (stat.isDirectory()) {
        tests = tests.concat(search(loc, path.join(relative, name)));
      }
    }
  }

  return tests;
}

let tests = search(`${__dirname}/../test/error-handler`, "test/error-handler");

function errorHandler(retval: ErrorHandlerResult, errors: Array<CompilerDiagnostics>, error: CompilerDiagnostics): ErrorHandlerResult {
  errors.push(error);
  return retval;
}

function runTest(name: string, code: string): boolean {
  console.log(chalk.inverse(name));

  let recover = code.includes("// recover-from-errors");

  let expectedErrors = code.match(/\/\/\s*expected errors:\s*(.*)/);
  invariant(expectedErrors);
  invariant(expectedErrors.length > 1);
  expectedErrors = expectedErrors[1];
  expectedErrors = eval(expectedErrors); // eslint-disable-line no-eval
  invariant(expectedErrors.constructor === Array);

  let errors = [];
  try {
    prepack(code, {
      filename: name,
      internalDebug: true,
      compatibility: "jsc-600-1-4-17",
      mathRandomSeed: "0",
      serialize: true,
      speculate: true,
    },
    errorHandler.bind(null, recover ? 'RecoverIfPossible' : 'Fail', errors));
    console.log(chalk.red("Serialization succeeded though it should have failed"));
    return false;
  } catch (e) {
    // We expect serialization to fail, so catch the error and continue
  }
  if (errors.length !== expectedErrors.length) {
    console.log(chalk.red(`Expected ${expectedErrors.length} errors, but found ${errors.length}`));
    return false;
  }

  for (let i = 0; i < expectedErrors.length; ++i) {
    for (let prop in expectedErrors[i]) {
      if (expectedErrors[i][prop] !== errors[i][prop]) {
        console.log(chalk.red(`Error ${i}: Expected ${expectedErrors[i][prop]} errors, but found ${errors[i][prop]}`));
        return false;
      }
    }
  }

  return true;
}

function run() {
  let failed = 0;
  let passed = 0;
  let total  = 0;

  for (let test of tests) {
    // filter hidden files
    if (path.basename(test.name)[0] === ".") continue;
    if (test.name.endsWith("~")) continue;

    total++;
    if (runTest(test.name, test.file))
      passed++;
    else
      failed++;
  }

  console.log("Passed:", `${passed}/${total}`, (Math.round((passed / total) * 100) || 0) + "%");
  return failed === 0;
}

if (!run())
  process.exit(1);
