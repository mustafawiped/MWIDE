import assert from 'node:assert/strict'
import test from 'node:test'
import { parseCodeFile } from '../src/main/codegraph-parser.ts'

test('AST parser extracts exact declarations and ignores comments, strings, and type signatures', () => {
  const parsed = parseCodeFile(
    'src/example.ts',
    `// phantom(); function fake() {}
export interface Shape { run(): void }
export type Identifier = string
export class First {
  run() { return 'notACall()' }
  static create() { return new First() }
}
export const arrow = () => First.create()
const text = "function invented() {}"
`,
  )
  assert.equal(parsed.language, 'typescript')
  assert.deepEqual(parsed.diagnostics, [])
  assert.deepEqual(
    parsed.symbols.map(({ qualifiedName, kind }) => [qualifiedName, kind]),
    [
      ['<module>', 'module'],
      ['Shape', 'interface'],
      ['Identifier', 'type'],
      ['First', 'class'],
      ['First.run', 'method'],
      ['First.create', 'method'],
      ['arrow', 'function'],
      ['text', 'variable'],
    ],
  )
  assert.deepEqual(
    parsed.calls.map(({ callee, construct }) => [callee, construct]),
    [
      ['First', true],
      ['First.create', false],
    ],
  )
  assert.deepEqual(parsed.symbols.find((item) => item.name === 'run')?.startLine, 5)
  assert.deepEqual(parsed.symbols.find((item) => item.name === 'First')?.endLine, 7)
  assert.equal(parsed.symbols.find((item) => item.name === 'create')?.static, true)
})

test('AST parser tracks default, renamed, namespace, side-effect, and type imports and export barrels', () => {
  const parsed = parseCodeFile(
    'src/imports.ts',
    `import main, { run as renamed, type Model } from './work.js'
import * as library from './library'
import type { Context } from './types'
import './setup'
export { renamed as execute }
export { run as again } from './work.js'
export type { Model } from './work.js'
export * from './library'
export * as nested from './library'
export default main
`,
  )
  assert.deepEqual(
    parsed.imports.map((item) => [item.local, item.imported, item.namespace, item.typeOnly]),
    [
      ['main', 'default', false, false],
      ['renamed', 'run', false, false],
      ['Model', 'Model', false, true],
      ['library', '*', true, false],
      ['Context', 'Context', false, true],
      ['', '', false, false],
    ],
  )
  assert.deepEqual(
    parsed.reExports.map((item) => [item.source, item.imported, item.exported, !!item.typeOnly]),
    [
      ['', 'renamed', 'execute', false],
      ['./work.js', 'run', 'again', false],
      ['./work.js', 'Model', 'Model', true],
      ['./library', '*', '*', false],
      ['./library', '*', 'nested', false],
      ['', 'main', 'default', false],
    ],
  )
})

test('AST parser keeps duplicate class members, nested functions, and file symbols distinct and deterministic', () => {
  const source = `class A { run() { function inner() {} return inner() } }
class B { run() {} }
function outer() { const inner = () => {}; return inner() }
`
  const first = parseCodeFile('one.ts', source)
  assert.deepEqual(first, parseCodeFile('one.ts', source))
  const second = parseCodeFile('two.ts', source)
  assert.equal(new Set(first.symbols.map((item) => item.id)).size, first.symbols.length)
  assert.ok(first.symbols.every((item) => !second.symbols.some((other) => item.id === other.id)))
  assert.deepEqual(
    first.symbols.filter((item) => item.name === 'run').map((item) => item.qualifiedName),
    ['A.run', 'B.run'],
  )
  const before = parseCodeFile('one.ts', `function added() {}\n${source}`)
  assert.equal(
    before.symbols.find((item) => item.qualifiedName === 'A.run')?.id,
    first.symbols.find((item) => item.qualifiedName === 'A.run')?.id,
  )
})

test('AST parser returns bounded diagnostics for malformed, unsupported, and oversized sources', () => {
  assert.equal(parseCodeFile('project.py', 'def f(): pass').language, 'unsupported')
  assert.deepEqual(parseCodeFile('project.py', 'def f(): pass').symbols, [])
  assert.ok(parseCodeFile('broken.ts', 'function broken( {').diagnostics.length > 0)
  const oversized = parseCodeFile('huge.ts', ' '.repeat(1_048_577))
  assert.equal(oversized.symbols.length, 0)
  assert.match(oversized.diagnostics[0].message, /size limit/)
  const many = parseCodeFile(
    'compact.ts',
    Array.from({ length: 7000 }, (_, index) => `const f${index}=()=>{};`).join(''),
  )
  assert.ok(many.symbols.length < 7001)
  assert.match(many.diagnostics.at(-1)!.message, /entry limit/)
})

test('AST parser gives top-level calls an explicit module owner and function expressions their own owner', () => {
  const parsed = parseCodeFile(
    'work.mjs',
    `function helper() {}
helper()
const run = function named() { helper(); named() }
const object = { method() { helper() } }
`,
  )
  const module = parsed.symbols.find((item) => item.kind === 'module')!
  const run = parsed.symbols.find((item) => item.name === 'run')!
  assert.equal(parsed.calls[0].from, module.id)
  assert.equal(parsed.calls[1].from, run.id)
  assert.equal(parsed.calls[2].from, run.id)
  assert.notEqual(parsed.calls[3].from, module.id)
  assert.equal(parsed.language, 'javascript')
})
