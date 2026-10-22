import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import electron from 'electron'

const arguments_ = process.argv.slice(2)
const repeat = Number(arguments_.find((value) => value.startsWith('--repeat='))?.slice(9) ?? 3)
if (!Number.isInteger(repeat) || repeat < 1 || repeat > 10)
  throw new Error('Repeat must be between 1 and 10.')
const forwarded = arguments_.filter((value) => !value.startsWith('--repeat='))
const label = forwarded.includes('--baseline') ? 'baseline' : 'candidate'
const runs = []
for (let index = 0; index < repeat; index++) {
  execFileSync(electron, [resolve('tests/desktop-performance.cjs'), ...forwarded], {
    windowsHide: true,
    timeout: 95000,
    stdio: 'pipe',
  })
  runs.push(JSON.parse(await readFile(resolve(`.mwide/benchmarks/desktop-${label}.json`), 'utf8')))
  console.log(`Desktop ${label}: run ${index + 1}/${repeat} passed.`)
}
const median = (key) => {
  const sorted = runs.map((run) => run[key]).sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}
const report = {
  label,
  runs,
  median: {
    startupMs: median('startupMs'),
    streamMs: median('streamMs'),
    frameP95Ms: median('frameP95Ms'),
  },
  note: 'Local fixture trials. Counts are workload-specific; timings depend on hardware and caching. No competitor or general model-quality comparison.',
}
await writeFile(
  resolve(`.mwide/benchmarks/desktop-${label}-runs.json`),
  JSON.stringify(report, null, 2),
)
console.log(JSON.stringify({ label, repeats: repeat, median: report.median }, null, 2))
