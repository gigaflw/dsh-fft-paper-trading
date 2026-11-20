/**
 * Backwards-compatible barrel for the paper-trading contract.
 *
 * The shapes live under `src/contract/`, split by domain (common stock terms,
 * accounts, domain views, ledger recovery, market data, the RPC envelope and
 * the error codes). Keeping this file as a re-export means the browser bundle,
 * the host half and every test keep importing the same path.
 * @module @dsh-ft/dsh-fft-paper-trading/contract
 */

export * from './contract/index.js'
