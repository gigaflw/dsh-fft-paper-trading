/**
 * Brand tokens are a local fallback contract.
 *
 * The browser half reads `var(--ft-accent-warm*, light-dark(...))`: the shared
 * brand layer may be absent (standalone install, or a host without the theme
 * service), so each read must carry the canonical value itself. The bundle
 * repository guards every consumer against `brand.ts`; this repository owns its
 * own copy of the four trading tokens and fails on drift here.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const CLIENT = join(ROOT, 'src', 'client', 'index.js')

/** Must equal `FT_BRAND_TOKENS` in the settings package of dsh-fft-bundle. */
const FT_BRAND_TOKENS = {
  '--ft-accent-warm': { light: '#cf5623', dark: '#ff8352' },
  '--ft-accent-warm-hover': { light: '#b8481b', dark: '#ff9a72' },
  '--ft-accent-warm-ink': { light: '#ffffff', dark: '#1a120e' },
  '--ft-accent-warm-soft': { light: '#fbeee8', dark: '#2b1d16' },
}

/** `var(--token, light-dark(#light, #dark))` reads, one entry per occurrence. */
const READ = /var\((--ft-[\w-]+),\s*light-dark\(\s*(#[0-9a-f]{6})\s*,\s*(#[0-9a-f]{6})\s*\)\)/giu

describe('brand fallbacks', () => {
  it('carry the canonical value for every token they read', () => {
    const source = readFileSync(CLIENT, 'utf8')
    const seen = new Set()
    for (const [, name, light, dark] of source.matchAll(READ)) {
      const canonical = FT_BRAND_TOKENS[name]
      assert.ok(canonical !== undefined, `client reads undeclared ${name}`)
      assert.equal(light.toLowerCase(), canonical.light, `${name} light fallback drifted`)
      assert.equal(dark.toLowerCase(), canonical.dark, `${name} dark fallback drifted`)
      seen.add(name)
    }
    // A scan that finds nothing must fail: the panel uses the trading accent for
    // every primary control, so a missing read means the guard went blind.
    for (const name of Object.keys(FT_BRAND_TOKENS)) {
      assert.ok(seen.has(name), `${name} is no longer read by the client; update the guard if intended`)
    }
  })
})
