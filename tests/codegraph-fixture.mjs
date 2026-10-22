// Deterministic, human-auditable call graph ground truth; no fixture source is executed.
export function codegraphFixture(units = 128) {
  const sources = {}
  const expected = []
  const identity = (file, line) => `${file}:${line}`
  const expect = (fromFile, fromLine, toFile, toLine) =>
    expected.push([identity(fromFile, fromLine), identity(toFile, toLine)])
  for (let index = 0; index < units; index++) {
    const number = String(index).padStart(3, '0')
    const previous = String(index - 1).padStart(3, '0')
    const file = `units/unit${number}.ts`
    sources[file] =
      index === 0
        ? `export function helper${number}() { return ${index} }\nexport function caller${number}() { helper${number}() }\n`
        : `import {helper${previous} as dependency${number}} from './unit${previous}.js'\nexport function helper${number}() { return ${index} }\nexport function caller${number}() { helper${number}(); dependency${number}() }\n`
    expect(file, index === 0 ? 2 : 3, file, index === 0 ? 1 : 2)
    if (index > 0) expect(file, 3, `units/unit${previous}.ts`, index === 1 ? 1 : 2)
  }
  sources['quality.ts'] = [
    'export function leaf() {}',
    'export function simple() { leaf() }',
    'export function recursive() { recursive() }',
    'export const arrow = () => leaf()',
    'export function parameter(leaf: () => void) { leaf() }',
    'export function blocked() {',
    '  { const leaf = () => {}',
    '    leaf() }',
    '  leaf()',
    '}',
    'export function hoisted() { leaf(); if (true) { var leaf: unknown } }',
    'export function dynamic(value: any) { value.leaf() }',
    'export function literal() { return "leaf(); function imaginary() {}" }',
    '// leaf(); imaginary()',
    'export class One {',
    '  same() {}',
    '  caller() { this.same() }',
    '  static build() {}',
    '  static callerStatic() { this.build(); One.build() }',
    '}',
    'export class Two {',
    '  same() {}',
    '  caller() { this.same() }',
    '}',
    'export function unsafeClassCall() { One.same() }',
    'export function factory() { return new One() }',
    'export function parameterNamespace(ns: any) { ns.leaf() }',
    '',
  ].join('\n')
  for (const [from, to] of [
    [2, 1],
    [3, 3],
    [4, 1],
    [6, 7],
    [6, 1],
    [17, 16],
    [19, 18],
    [23, 22],
    [26, 15],
  ]) {
    expect('quality.ts', from, 'quality.ts', to)
  }
  sources['barrel-a.ts'] =
    "export * from './barrel-b'\nexport {leaf as renamed} from './quality'\nexport * as group from './quality'\n"
  sources['barrel-b.ts'] = "export * from './barrel-a'\nexport {simple} from './quality'\n"
  sources['consumer.ts'] = [
    "import {renamed, simple, group} from './barrel-a'",
    "import * as ns from './quality'",
    "import type {leaf as typeOnly} from './quality'",
    'export function aliases() { renamed(); simple(); group.leaf(); ns.leaf() }',
    'export function shadow(ns: any) { ns.leaf() }',
    'export function erased() { typeOnly() }',
    '',
  ].join('\n')
  expect('consumer.ts', 4, 'quality.ts', 1)
  expect('consumer.ts', 4, 'quality.ts', 2)
  sources['plain.js'] = 'export function jsHelper() {}\nexport function jsCaller() { jsHelper() }\n'
  expect('plain.js', 2, 'plain.js', 1)
  return { sources, expected }
}

export function editedFixture(fixture) {
  const file = 'units/unit010.ts'
  return {
    sources: {
      ...fixture.sources,
      [file]: fixture.sources[file]
        .replace("from './unit009.js'", "from './unit008.js'")
        .replace('helper009 as dependency010', 'helper008 as dependency010'),
    },
    expected: fixture.expected.map(([from, to]) => [
      from,
      from === `${file}:3` && to === 'units/unit009.ts:2' ? 'units/unit008.ts:2' : to,
    ]),
  }
}

export function deletedFixture(fixture) {
  const file = 'units/unit127.ts'
  const sources = { ...fixture.sources }
  delete sources[file]
  return {
    sources,
    expected: fixture.expected.filter(
      ([from, to]) => !from.startsWith(`${file}:`) && !to.startsWith(`${file}:`),
    ),
  }
}

export function scoreEdges(actual, expected) {
  const truth = new Set(expected.map((pair) => pair.join(' -> ')))
  const found = new Set(actual.map((pair) => pair.join(' -> ')))
  const correct = [...found].filter((edge) => truth.has(edge)).length
  const falsePositives = [...found].filter((edge) => !truth.has(edge))
  const missing = [...truth].filter((edge) => !found.has(edge))
  return {
    expected: truth.size,
    reported: found.size,
    truePositives: correct,
    falsePositives: falsePositives.length,
    falseNegatives: missing.length,
    precision: found.size ? correct / found.size : 0,
    recall: truth.size ? correct / truth.size : 1,
    unexpectedEdges: falsePositives,
    missingEdges: missing,
  }
}
