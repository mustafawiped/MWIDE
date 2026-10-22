import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  isTrustedRendererUrl,
  isTrustedSignInUrl,
  requireId,
  requireRecord,
} from '../src/main/ipc-policy.ts'

test('only the exact renderer document may call workspace operations; hashes are allowed', () => {
  const expected = 'file:///C:/MWIDE/out/renderer/index.html'
  assert.ok(isTrustedRendererUrl(`${expected}#projects`, expected))
  for (const actual of [
    'file:///C:/MWIDE/out/renderer/other.html',
    `${expected}?injected=1`,
    'https://example.com/index.html',
    'not a URL',
  ])
    assert.equal(isTrustedRendererUrl(actual, expected), false)
  const development = 'http://localhost:5173/'
  assert.ok(isTrustedRendererUrl(`${development}#chat`, development))
  assert.equal(isTrustedRendererUrl('http://localhost:5173/foreign', development), false)
  assert.equal(isTrustedRendererUrl('http://localhost:5174/', development), false)
  assert.equal(isTrustedRendererUrl('http://127.0.0.1:5173/', development), false)
})

test('sign-in opens only the supported HTTPS authentication hosts', () => {
  assert.ok(isTrustedSignInUrl('https://auth.openai.com/authorize?client=example'))
  assert.ok(isTrustedSignInUrl('https://chatgpt.com/auth/login'))
  for (const value of [
    'http://auth.openai.com/authorize',
    'https://auth.openai.com.attacker.example/authorize',
    'https://attacker.example/?next=https://auth.openai.com',
    'https://user:secret@auth.openai.com/authorize',
    'https://chatgpt.com:8080/auth',
    'file:///tmp/sign-in.html',
    'not a URL',
  ])
    assert.equal(isTrustedSignInUrl(value), false)
})

test('IPC identifiers and object inputs reject malformed renderer requests', () => {
  assert.equal(requireId('project-1'), 'project-1')
  assert.equal(requireId('a'.repeat(200)).length, 200)
  for (const value of [null, undefined, {}, [], 1, '', ' ', 'a'.repeat(201)]) {
    assert.throws(() => requireId(value), /valid identifier/)
  }
  for (const value of [null, undefined, [], 'project', 1]) {
    assert.throws(() => requireRecord(value), /requires an object/)
  }
  assert.deepEqual(requireRecord({ id: 'project-1' }), { id: 'project-1' })
})
