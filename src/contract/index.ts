/**
 * The paper-trading contract, split by domain.
 *
 * Consumers keep importing `../contract.js` (a barrel); a module that only
 * needs one area can import it directly from here.
 * @module @dsh-ft/dsh-fft-paper-trading/contract
 */

export * from './common.js'
export * from './accounts.js'
export * from './domain.js'
export * from './ledger.js'
export * from './market.js'
export * from './rpc.js'
export * from './errors.js'
