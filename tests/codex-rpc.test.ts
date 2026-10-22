import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { CodexRpc } from '../src/providers/codex-rpc.ts'

function fixture(t: TestContext, response: string, timeout = 5_000): CodexRpc {
  const child = spawn(
    process.execPath,
    [
      '-e',
      `const readline = require('node:readline'); readline.createInterface({input:process.stdin}).on('line',line=>{const request=JSON.parse(line);${response}});`,
    ],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false },
  )
  const rpc = new CodexRpc(child, timeout)
  t.after(async () => {
    rpc.dispose()
    if (child.exitCode === null && child.signalCode === null)
      await new Promise<void>((resolve) => child.once('exit', () => resolve()))
  })
  return rpc
}

test('Codex RPC closes all pending requests after timeout', async (t) => {
  const rpc = fixture(t, '', 80)
  await Promise.all([
    assert.rejects(rpc.request('stalled'), /stalled timed out/),
    assert.rejects(rpc.request('also-stalled'), /stalled timed out/),
  ])
  await assert.rejects(rpc.request('later'), /timed out/)
})

test('Codex RPC caps pending requests and rejects oversized output', async (t) => {
  const rpc = fixture(t, "process.stdout.write('x'.repeat(1024*1024+1)+'\\n')")
  await assert.rejects(rpc.request('oversized'), /oversized protocol message/)
  const stalled = fixture(t, '', 80)
  const pending = Array.from({ length: 32 }, () =>
    assert.rejects(stalled.request('wait'), /timed out/),
  )
  await assert.rejects(stalled.request('overflow'), /Too many pending/)
  await Promise.all(pending)
})

test('Codex RPC rejects invalid response envelopes and errors without leaking unbounded messages', async (t) => {
  for (const [response, error] of [
    ["process.stdout.write('[]\\n')", /invalid protocol message/],
    ["process.stdout.write(JSON.stringify({id:request.id})+'\\n')", /without a result/],
    [
      "process.stdout.write(JSON.stringify({id:request.id,error:{message:'x'.repeat(5000)}})+'\\n')",
      /^Error: Codex: x{500}$/,
    ],
  ] as const) {
    await t.test(String(error), async (subtest) => {
      const rpc = fixture(subtest, response)
      await assert.rejects(rpc.request('test'), error)
    })
  }
})

test('Codex RPC refuses server tool calls and isolates failed notification listeners', async (t) => {
  const tools = fixture(t, "process.stdout.write(JSON.stringify({id:99,method:'tool/call'})+'\\n')")
  await assert.rejects(tools.request('test'), /unavailable tool/)
  const notifications = fixture(t, "process.stdout.write(JSON.stringify({method:'test'})+'\\n')")
  notifications.subscribe(() => {
    throw new Error('listener failed')
  })
  await assert.rejects(notifications.request('test'), /response handling failed/)
})
