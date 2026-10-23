import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { EventStore } from '../lib/store/event-store.js'
import { eventsPath } from '../lib/store/paths.js'
import { ShortlistStore } from '../lib/store/shortlist.js'

function makeHome(name) {
  return join(process.cwd(), 'tmp', 'paper-trading-test', `${name}-${process.pid}-${Date.now()}`)
}

test('store: appends JSONL and ignores a malformed tail line', async () => {
  const home = makeHome('store')
  const file = eventsPath(home, 'default')
  const store = new EventStore(file)
  try {
    await store.append([{ seq: 1, id: 'evt-1', ts: '2026-10-19T02:00:00.000Z', type: 'account.opened', payload: {} }])
    await store.append([{ seq: 2, id: 'evt-2', ts: '2026-10-19T02:01:00.000Z', type: 'ledger.violation', payload: {} }])
    await writeFile(file, 'this is not json\n', { flag: 'a' })
    const { events, skipped } = await store.readAll()
    assert.equal(skipped, 1)
    assert.equal(events.length, 2)
    assert.equal(events[1].seq, 2)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('store: shortlist migrates the previous file name on first read', async () => {
  const home = makeHome('shortlist')
  const directory = join(home, 'paper-trading')
  const previous = join(directory, 'watchlist.json')
  const current = join(directory, 'shortlist.json')
  try {
    await mkdir(directory, { recursive: true })
    await writeFile(previous, JSON.stringify({ symbols: ['600519.SH', 7, null] }))
    const store = new ShortlistStore(home)
    // Old entries survive, non-strings are dropped, and the file moves rather
    // than being copied so the two names cannot hold different lists.
    assert.deepEqual(await store.read(), ['600519.SH'])
    assert.equal(existsSync(previous), false)
    assert.equal(existsSync(current), true)

    assert.deepEqual(await store.write(['600519.SH', '600519.SH', ' 000001.SZ ']), ['600519.SH', '000001.SZ'])
    assert.deepEqual(await store.read(), ['600519.SH', '000001.SZ'])
    assert.equal((await stat(current)).mode & 0o777, 0o600)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
