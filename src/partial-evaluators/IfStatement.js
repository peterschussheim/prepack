/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

/* @flow */

import type { BabelNodeIfStatement, BabelNodeStatement } from "babel-types";
import type { LexicalEnvironment } from "../environment.js";
import type { Realm } from "../realm.js";

import { AbruptCompletion, Completion, NormalCompletion } from "../completions.js";
import { Reference } from "../environment.js";
import { joinEffects, UpdateEmpty } from "../methods/index.js";
import { AbstractValue, Value } from "../values/index.js";
import { construct_empty_effects } from "../realm.js";

import * as t from "babel-types";
import invariant from "../invariant.js";

export default function (
  ast: BabelNodeIfStatement, strictCode: boolean, env: LexicalEnvironment, realm: Realm
): [Completion | Value, BabelNodeStatement, Array<BabelNodeStatement>] {
  let [exprValue, exprAst, exprIO] = env.partiallyEvaluateCompletionDeref(ast.test, strictCode);
  if (exprValue instanceof AbruptCompletion)
    return [exprValue, t.expressionStatement((exprAst: any)), exprIO];
  let completion;
  if (exprValue instanceof NormalCompletion) {
    completion = exprValue;
    exprValue = completion.value;
  }
  invariant(exprValue instanceof Value);

  if (!exprValue.mightNotBeTrue()) {
    // 3.a. Let stmtCompletion be the result of evaluating the first Statement
    let [stmtCompletion, stmtAst, stmtIO] = env.partiallyEvaluateCompletionDeref(ast.consequent, strictCode);

    // 5. Return Completion(UpdateEmpty(stmtCompletion, undefined)
    stmtCompletion = UpdateEmpty(realm, stmtCompletion, realm.intrinsics.undefined);
    return [stmtCompletion, (stmtAst: any), exprIO.concat(stmtIO)];
  } else if (!exprValue.mightNotBeFalse()) {
    let stmtCompletion, stmtAst, stmtIO;
    if (ast.alternate)
      // 4.a. Let stmtCompletion be the result of evaluating the second Statement
      [stmtCompletion, stmtAst, stmtIO] = env.partiallyEvaluateCompletionDeref(ast.alternate, strictCode);
    else {
      // 3 (of the if only statement). Return NormalCompletion(undefined)
      stmtCompletion = realm.intrinsics.undefined;
      stmtAst = t.emptyStatement();
      stmtIO = [];
    }
    // 5. Return Completion(UpdateEmpty(stmtCompletion, undefined)
    stmtCompletion = UpdateEmpty(realm, stmtCompletion, realm.intrinsics.undefined);
    return [stmtCompletion, (stmtAst: any), exprIO.concat(stmtIO)];
  }
  invariant(exprValue instanceof AbstractValue);

  // Evaluate consequent and alternate in sandboxes and get their effects.
  realm.captureEffects();
  let [conCompl, conAst, conIO] =
    env.partiallyEvaluateCompletionDeref(ast.consequent, strictCode);
  let consequentEffects = realm.getCapturedEffects();
  invariant(consequentEffects !== undefined);
  let [compl1, gen1, bindings1, properties1, createdObj1] = consequentEffects;
  compl1;
  realm.stopEffectCaptureAndUndoEffects();
  let consequentAst = (conAst: any);
  if (conIO.length > 0)
    consequentAst = t.blockStatement(conIO.concat(consequentAst));

  let altCompl, altAst, altIO;
  let alternateEffects;
  if (ast.alternate) {
    realm.captureEffects();
    invariant(ast.alternate);
    [altCompl, altAst, altIO] = env.partiallyEvaluateCompletionDeref(ast.alternate, strictCode);
    alternateEffects = realm.getCapturedEffects();
    realm.stopEffectCaptureAndUndoEffects();
  } else {
    alternateEffects = construct_empty_effects(realm);
    [altCompl, altAst, altIO] = [alternateEffects[0], undefined, []];
  }
  let alternateAst = (altAst: any);
  if (altIO.length > 0)
    alternateAst = t.blockStatement(altIO.concat(alternateAst));
  invariant(alternateEffects !== undefined);
  let [compl2, gen2, bindings2, properties2, createdObj2] = alternateEffects;
  compl2;

  // Join the effects, creating an abstract view of what happened, regardless
  // of the actual value of exprValue.
  let joinedEffects =
    joinEffects(realm, exprValue,
      [conCompl, gen1, bindings1, properties1, createdObj1],
      [altCompl, gen2, bindings2, properties2, createdObj2]);
  completion = joinedEffects[0];
  if (completion instanceof NormalCompletion) {
    // in this case one of the branches may complete abruptly, which means that
    // not all control flow branches join into one flow at this point.
    // Consequently we have to continue tracking changes until the point where
    // all the branches come together into one.
    realm.captureEffects();
  }
  // Note that the effects of (non joining) abrupt branches are not included
  // in joinedEffects, but are tracked separately inside completion.
  realm.applyEffects(joinedEffects);

  let resultAst = t.ifStatement((exprAst: any), (consequentAst: any), (alternateAst: any));
  invariant(!(completion instanceof Reference));
  return [completion, resultAst, exprIO];
}
