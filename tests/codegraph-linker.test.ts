import assert from 'node:assert/strict'
import test from 'node:test'
import { parseCodeFile } from '../src/main/codegraph-parser.ts'
import { linkCodeGraph } from '../src/main/codegraph-linker.ts'

function graph(sources: Record<string, string>) {
  const files = Object.entries(sources).map(([path, source]) => parseCodeFile(path, source))
  const linked = linkCodeGraph(files)
  const symbols = files.flatMap((file) => file.symbols)
  const calls = linked.edges
    .filter((edge) => edge.type === 'CALLS')
    .map((edge) => ({
      from: symbols.find((item) => item.id === edge.from)?.qualifiedName,
      to: symbols.find((item) => item.id === edge.to)?.qualifiedName,
      file: symbols.find((item) => item.id === edge.to)?.file,
      line: edge.line,
    }))
  return { files, linked, calls }
}

test('static linker resolves local functions, recursion, arrows and module calls without merging duplicate names', () => {
  const { calls, linked } = graph({
    'work.ts': `function helper() {}
function first() { function helper() {} helper() }
function second() { helper(); second() }
const arrow = () => helper()
first(); arrow()
`,
  })
  assert.deepEqual(
    calls.map(({ from, to }) => [from, to]),
    [
      ['first', 'first.helper'],
      ['second', 'helper'],
      ['second', 'second'],
      ['arrow', 'helper'],
      ['<module>', 'first'],
      ['<module>', 'arrow'],
    ],
  )
  assert.equal(linked.unresolvedCalls, 0)
})

test('static linker honors parameters, destructuring, catch bindings, block let, and function var shadowing', () => {
  const { calls, linked } = graph({
    'scope.ts': `function target() {}
function parameter(target) { target() }
function destructured({target}) { target() }
function local() { target(); { let target; target() } target() }
function hoisted() { target(); if (true) { var target } }
function caught() { try {} catch (target) { target() } target() }
for (let target of []) { target() }
target()
`,
  })
  assert.deepEqual(
    calls.map(({ from, to }) => [from, to]),
    [
      ['local', 'target'],
      ['caught', 'target'],
      ['<module>', 'target'],
    ],
  )
  assert.equal(linked.unresolvedCalls, 6)
})

test('parameter initializers see outer bindings rather than body var declarations', () => {
  const { calls, linked } = graph({
    'parameters.ts': `function dependency() {}
function owner(value = dependency()) { var dependency; dependency() }
`,
  })
  assert.deepEqual(
    calls.map(({ from, to }) => [from, to]),
    [['owner', 'dependency']],
  )
  assert.equal(linked.unresolvedCalls, 1)
})

test('static linker resolves aliases, defaults, namespace members, index modules and js to ts substitution', () => {
  const { calls, linked } = graph({
    'src/work.ts': 'export default function main() {}\nexport function run() {}',
    'src/lib/index.ts': 'export function nested() {}',
    'src/use.ts': `import start, { run as execute } from './work.js'
import * as library from './lib'
start(); execute(); library.nested()
`,
  })
  assert.deepEqual(
    calls.map(({ to, file }) => [to, file]),
    [
      ['main', 'src/work.ts'],
      ['run', 'src/work.ts'],
      ['nested', 'src/lib/index.ts'],
    ],
  )
  assert.equal(linked.edges.filter((edge) => edge.type === 'IMPORTS').length, 3)
  assert.equal(linked.unresolvedImports, 0)
  assert.equal(linked.unresolvedCalls, 0)
})

test('static linker follows named and star export barrels, namespace exports and bounded cycles', () => {
  const { calls, linked } = graph({
    'base.ts':
      'export function run() {}\nfunction local() {}\nexport {local as alias}\nexport default run',
    'a.ts':
      "export * from './b'; export { default as start } from './base'; export * as group from './base'",
    'b.ts': "export * from './a'; export {run as execute, alias} from './base'",
    'use.ts':
      "import { execute, alias, start, group } from './a'; execute(); alias(); start(); group.run()",
  })
  assert.deepEqual(
    calls.map(({ to }) => to),
    ['run', 'local'],
  )
  assert.equal(linked.unresolvedImports, 0)
  assert.equal(linked.unresolvedCalls, 0)
})

test('ambiguous and unknown star exports remain unresolved and explicit aliases override stars', () => {
  const { calls, linked } = graph({
    'left.ts': 'export function same() {}',
    'right.ts': 'export function same() {}',
    'ambiguous.ts': "export * from './left'; export * from './right'",
    'nested.ts': "export * from './ambiguous'; export * from './left'",
    'unknown.ts': "export * from 'unavailable-package'; export * from './left'",
    'explicit.ts': "export * from './right'; export {same} from './left'",
    'use.ts':
      "import {same as a} from './nested'; import {same as b} from './unknown'; import {same as c} from './explicit'; a(); b(); c()",
  })
  assert.deepEqual(
    calls.map(({ to, file }) => [to, file]),
    [['same', 'left.ts']],
  )
  assert.equal(linked.unresolvedCalls, 2)
  assert.equal(linked.unresolvedImports, 3)
})

test('type-only imports and reexports never manufacture runtime calls', () => {
  const { calls, linked } = graph({
    'work.ts': 'export function run() {}\nexport interface Model {}',
    'types.ts': "export type {run, Model} from './work'",
    'use.ts':
      "import type {run} from './work'; import {run as alias} from './types'; import {Model} from './work'; run(); alias(); Model()",
  })
  assert.equal(calls.length, 0)
  assert.equal(linked.unresolvedCalls, 3)
  assert.equal(linked.unresolvedImports, 0)
})

test('static linker resolves only safe class and this receivers, including lexical arrows', () => {
  const { calls, linked } = graph({
    'classes.ts': `function method() {}
class A {
  method() {}
  caller() { this.method(); const arrow = () => this.method(); function normal() { this.method() }; method() }
  static make() { this.create(); this.method(); A.method() }
  static create() {}
}
class B { method() {} caller() { this.method() } }
A.create(); new A(); const unknown = {}; unknown.method(); A.method();
`,
  })
  assert.deepEqual(
    calls.map(({ from, to }) => [from, to]),
    [
      ['A.caller', 'A.method'],
      ['A.caller.arrow', 'A.method'],
      ['A.caller', 'method'],
      ['A.make', 'A.create'],
      ['B.caller', 'B.method'],
      ['<module>', 'A.create'],
      ['<module>', 'A'],
    ],
  )
  assert.equal(linked.unresolvedCalls, 5)
})

test('class field arrows preserve this while ordinary function fields have dynamic this', () => {
  const { calls, linked } = graph({
    'fields.ts': `class Work {
  run() {}
  arrow = () => this.run()
  dynamic = function () { this.run() }
  static build() {}
  static arrow = () => this.build()
  static { this.build() }
}`,
  })
  assert.deepEqual(
    calls.map(({ from, to }) => [from, to]),
    [
      ['Work.arrow', 'Work.run'],
      ['Work.arrow', 'Work.build'],
      ['Work', 'Work.build'],
    ],
  )
  assert.equal(linked.unresolvedCalls, 1)
})

test('unknown object receivers, factory results, super methods, and external modules stay unresolved', () => {
  const { calls, linked } = graph({
    'use.ts': `import {external} from 'package'; import './missing'; export {other} from 'other-package'; export * from 'barrel'
function helper() {}
const object = {helper}
object.helper(); create().helper(); external(); globalThis.helper(); super.helper()
`,
  })
  assert.equal(calls.length, 0)
  assert.equal(linked.unresolvedCalls, 6)
  assert.equal(linked.unresolvedImports, 4)
})

test('reassigned lexical function bindings are not reported as precise calls', () => {
  const { calls, linked } = graph({
    'mutations.ts': `let target = () => {}
function change() { target = anything }
target()
let other = () => {}; ({ other } = unknown); other()
`,
  })
  assert.equal(calls.length, 0)
  assert.equal(linked.unresolvedCalls, 2)
})

test('calls through a parameter shadowing an imported namespace never resolve to the import', () => {
  const { calls, linked } = graph({
    'library.ts': 'export function run() {}',
    'use.ts': `import * as ns from './library'
function owner(ns) { ns.run() }
{ let ns; ns.run() }
ns.run()
`,
  })
  assert.deepEqual(
    calls.map(({ from, to }) => [from, to]),
    [['<module>', 'run']],
  )
  assert.equal(linked.unresolvedCalls, 2)
})

test('cyclic export ambiguity is independent of import request order', () => {
  for (const imported of [
    "import {same as a} from './a'; import {same as b} from './b';",
    "import {same as b} from './b'; import {same as a} from './a';",
  ]) {
    const { calls, linked } = graph({
      'a.ts': "export * from './b'; export * from './left'",
      'b.ts': "export * from './a'; export * from './right'",
      'left.ts': 'export function same() {}',
      'right.ts': 'export function same() {}',
      'use.ts': `${imported} a(); b()`,
    })
    assert.equal(calls.length, 0)
    assert.equal(linked.unresolvedCalls, 2)
  }
})

test('class member mutations across files invalidate precise calls while preserving safe constructors', () => {
  const { calls, linked } = graph({
    'class.ts': `export class A {
  run() {}
  caller() { this.run() }
  change() { this.run = unknown }
  static build() {}
  static safe() {}
}`,
    'mutate.ts': "import {A} from './class'; A.build = unknown",
    'use.ts': "import {A} from './class'; export function use() { new A(); A.build(); A.safe() }",
  })
  assert.deepEqual(
    calls.map(({ from, to }) => [from, to]),
    [
      ['use', 'A'],
      ['use', 'A.safe'],
    ],
  )
  assert.equal(linked.unresolvedCalls, 2)
})

test('unknown computed mutations and prototype deletions conservatively invalidate affected members', () => {
  const { calls, linked } = graph({
    'class.ts': `class A {
  run() {}
  caller() { this.run() }
  static build() {}
}
A[key] = unknown
delete A.prototype.run
A.build()
`,
  })
  assert.deepEqual(calls, [])
  assert.equal(linked.unresolvedCalls, 2)
})
