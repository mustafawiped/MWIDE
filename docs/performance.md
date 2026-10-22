# Performance experiments

The first optimization pass compares identical deterministic workloads with the frozen `v1.1.0` baseline. It measures application work, not competitive superiority or general model quality.

## Recorded results — 2026-10-22

| Workload / measurement                                         |       v1.1.0 |    Optimized |
| -------------------------------------------------------------- | -----------: | -----------: |
| 12 short chats: summary requests                               |           11 |            0 |
| 12 short chats: total encoded model input                      | 46,326 bytes | 33,379 bytes |
| 24 archived chats under a 12,000-byte budget: summary requests |           24 |           18 |
| Same archive workload: total encoded model input               | 64,700 bytes | 55,716 bytes |
| Desktop with 2,000 saved messages: initially mounted rows      |        2,000 |           60 |
| Same desktop: initial chat descendant elements                 |       27,000 |          811 |
| Desktop burst of 5,000 provider chunks: renderer delta events  |        5,000 |            3 |
| Pure transport burst of 10,000 chunks: delivered delta events  |       10,000 |            4 |

All source text, final streamed text, saved histories, and canonical project fields remain intact in these fixtures. Short handoffs reduce total encoded input by 27.9%; the archive-pressure scenario reduces it by 13.9%. The counts are deterministic for these inputs; encoded bytes are not billed tokens or a monetary savings estimate.

Three desktop trials per build, using the same updated fixture, measured median startup from loading the application entry to visible history at 509 ms before and 238 ms after; median stream completion was 376 ms before and 76 ms after. Median per-run frame-gap p95 was 146 ms before and 7 ms after. These are local observations affected by caching, scheduling, display refresh rate, and hardware, rather than portable timing thresholds. The regression assertions target complete output, retained history, bounded mounted rows/events, stable scroll position, retained drafts, conversation-switch resets, and rejection of late output from an older reply.

## Run again

```sh
pnpm build
pnpm benchmark
```

`benchmark:core` extracts only the domain sources from the local `v1.1.0` Git tag into a temporary directory and runs the same scenarios against both implementations. The fixture provider enforces its declared byte budget and checks protected fields and decision/failure markers. It does not call a cloud account or download a model.

`benchmark:desktop` runs three real Electron trials by default, each with an isolated temporary workspace containing a 2,000-message active chat and a small archived chat. It streams 5,000 chunks through real HTTP, workspace storage, IPC and preload, then verifies exact output, full saved history, earlier-message loading, scroll-anchor preservation, retained drafts, late-reply rejection, cancellation, and absence of document scrolling. Reports, per-run aggregates, and screenshots are written under ignored `.mwide/benchmarks/`; no user project is modified. Pass `--repeat=1` for a quick single trial or up to `--repeat=10` for a longer run.

To repeat the desktop baseline, separately build `v1.1.0`, then run the current harness against that build:

```sh
node tests/benchmark-desktop.mjs --baseline --app="C:/path/to/baseline/out/main/index.cjs"
```

The main bundle must retain its matching preload and renderer files. Baseline mode checks the original 2,000-row behavior; candidate mode checks the bounded view. New desktop reports include the main bundle's SHA-256. Do not label a newly optimized build as the old baseline.

## Quality and comparison boundaries

- Domain tests retain canonical fields, project isolation, recent active pairs, interrupted/failed statuses, and complete history when compaction succeeds, fails, or is cancelled.
- Worker tests exercise real thread reuse, fresh additions/deletions, exclusions, cancellation, errors, bounded responses, and main-loop responsiveness.
- Stream tests cover immediate first text, queued final text, cancellation, hidden-window fallback, and late events from previous responses.
- Fixture decision/failure markers are integrity checks, not a semantic-quality score for a model-generated summary.
- A separate real local `qwen2.5:7b` smoke check retrieved the expected declaration path, retained a verification word verbatim across a new-chat handoff without a summary request, and found a newly added declaration through the production folder worker. This narrow check is not a general recall benchmark.
- A fair competitor comparison still needs identical projects, prompts, provider/model/effort, warm-up conditions and repeated runs. Record first-text latency, completion latency, billed tokens where available, retained facts, false completion claims, memory use and failure recovery. No competitor results are claimed here.
