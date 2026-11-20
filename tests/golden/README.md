# Golden (characterization) tests

Freeze *observable end-to-end behavior* before refactoring: the two trading
planes (stock + futures) duplicate core/store/service/RPC/tool layers and are
being consolidated, so every refactor step must keep these goldens byte-identical.

## What runs

`tests/golden.test.mjs` drives the **real plugin** through `apply()` → the real
HTTP route (`/api/ft-paper-trading`) → services → real JSONL ledger files, plus
the registered agent tools. Only the host boundary and the market-data upstream
are faked:

- frozen clock (`ApplyOptions.now`) shared by registry, both services and ports
- deterministic stock/futures data ports (`ApplyOptions.marketData`)
- scratch `$DSH_HOME` per scenario, removed afterwards

Each scenario records every normalized response plus the final on-disk store
(registry, every `events.jsonl`, file tree) into `tests/golden/<scenario>.json`.

Scenarios: stock over two trading days, multi-account registry/lock/notes,
futures over one settlement day, agent tool surface.

## Updating

```bash
pnpm run golden:update      # GOLDEN_UPDATE=1 node --test tests/golden.test.mjs
```

Then review the diff: every changed line must be explained by a **deliberate**
behavior change (and the change itself should be tested); an unexplained diff is
a refactor regression.

## Not covered here

- The browser panel: `tests/e2e/ui-panel.mjs` (real React bundle + fake backend).
- The FTShare adapters: `tests/*adapter*.test.mjs`.
- The installed profile: `tests/e2e/cdp.mjs`.
