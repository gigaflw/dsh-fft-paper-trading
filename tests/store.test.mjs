import test from 'node:test'
import assert from 'node:assert/strict'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { EventStore } from '../lib/store/event-store.js'
import { eventsPath } from '../lib/store/paths.js'

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
