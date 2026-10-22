# Code graph benchmark

Measured 2026-10-22T21:42:19.811Z. Reproduce with `node --experimental-strip-types tests/benchmark-codegraph.mjs`. Set `MWIDE_REFERENCE_BINARY` to the reference executable, or put `codebase-memory-mcp` on PATH. Raw 5-sample data, source hashes and the complete methodology are in [codegraph-benchmark.json](codegraph-benchmark.json).

Machine: win32 10.0.26200, 13th Gen Intel(R) Core(TM) i5-13420H, 12 logical CPUs, Node v24.11.1. Reference: codebase-memory-mcp 0.11.0, fast indexing mode.

Fixture: 133 files, 21662 UTF-8 bytes, 267 expected unique call relationships; SHA-256 `9adb71f6977fb22e8b9249ab7bef040f8dbeae4e0afc1c4655eb9fc45961c5a4`. Includes local calls, recursion, arrows, renamed imports, relative JavaScript extension substitution, class/static/this calls, export barrels/cycles, parameter/block/var shadowing, erased type imports, strings/comments, and unknown receivers.

| Phase           | MWIDE internal refresh median (ms) | MWIDE child incl. full query median (ms) | Reference index + full query median (ms) |
| --------------- | ---------------------------------: | ---------------------------------------: | ---------------------------------------: |
| cold / cold     |                            355.117 |                                 1434.906 |                                16098.787 |
| restart / warm  |                             56.298 |                                  892.751 |                                13308.793 |
| edit / edit     |                             89.705 |                                 1295.851 |                                  9842.22 |
| delete / delete |                             49.405 |                                  538.825 |                                  7056.74 |

MWIDE resident warm refresh median: **26.485 ms**. This excludes process startup and is not directly compared with the reference CLI.

| Engine / phase     | Median end-to-end (ms) |  p95 (ms) |  Max (ms) |
| ------------------ | ---------------------: | --------: | --------: |
| MWIDE / cold       |               1434.906 |   4133.08 |   4133.08 |
| Reference / cold   |              16098.787 | 23160.364 | 23160.364 |
| MWIDE / restart    |                892.751 |  1213.966 |  1213.966 |
| Reference / warm   |              13308.793 | 17092.156 | 17092.156 |
| MWIDE / edit       |               1295.851 |  1537.516 |  1537.516 |
| Reference / edit   |                9842.22 |  17541.73 |  17541.73 |
| MWIDE / delete     |                538.825 |  1286.739 |  1286.739 |
| Reference / delete |                7056.74 |  21421.21 |  21421.21 |

Nearest-rank p95 equals max with only five samples.

| Engine / phase     | Correct / expected calls | False positive calls |      Precision |         Recall |
| ------------------ | -----------------------: | -------------------: | -------------: | -------------: |
| mwide / cold       |        267–267 / 267–267 |                  0–0 |       100–100% |       100–100% |
| mwide / edit       |        267–267 / 267–267 |                  0–0 |       100–100% |       100–100% |
| mwide / delete     |        265–265 / 265–265 |                  0–0 |       100–100% |       100–100% |
| reference / cold   |        135–135 / 267–267 |                  9–9 |   93.75–93.75% | 50.562–50.562% |
| reference / edit   |        135–135 / 267–267 |                  9–9 |   93.75–93.75% | 50.562–50.562% |
| reference / delete |        134–134 / 265–265 |                  9–9 | 93.706–93.706% | 50.566–50.566% |

- Identical deterministic TypeScript/JavaScript sources and explicit positive/negative static-call ground truth; no fixture source executed.
- Five new project roots by default. Cold engine order alternates to reduce OS filesystem cache bias. Warm filesystem caches are not flushed.
- MWIDE cold/restart/edit/delete wall time includes fresh Node process, module loading, refresh, complete public graph search/trace retrieval, and process shutdown. Internal refresh/query durations are listed separately.
- Reference wall time includes a fresh installed CLI process and index_repository. Complete CALLS retrieval is timed as a separate fresh CLI query. This includes CLI/RPC admission overhead; it is not an isolated parser throughput comparison.
- MWIDE residentWarm primes a persisted index and measures another refresh in the same process; only its internal refresh duration is comparable to the running desktop service, not reference CLI wall time.
- After one import-target edit and one terminal file deletion, both engines reindex and all returned CALLS edges are rescored. Source coordinates disambiguate duplicate names.
- Only benchmark-owned reference project indexes are deleted. Existing indexes, sessions and reference cache configuration are untouched.
- This is a small TS/JS static-resolution workload. It does not establish superiority across languages, semantic/type inference, MCP tool breadth, large repositories, memory use, or real AI answer quality.
- Reference total wall time is index CLI wall plus complete CALLS query CLI wall, matching the work included in MWIDE child wall time. Engine-specific transport/startup designs differ.
- Statistics use nearest-rank p95; with five samples p95 equals max. This small sample does not establish a latency distribution or confidence interval.
- Source and reference binary SHA-256 hashes are captured when the report is finalized; OS and CPU metadata describe this machine. The installed reference cache/server may be shared and CLI admission overhead is included.
- Ground truth covers unambiguous static declaration relationships, not every possible runtime dispatch. Dynamic receivers are expected unresolved. Type-only invocation and missing static-method cases are intentional invalid-program negatives; the fixture is parsed, never typechecked or executed.
