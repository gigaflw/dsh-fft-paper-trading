import test from 'node:test'
import assert from 'node:assert/strict'
import { PaperScheduler } from '../lib/service/scheduler.js'

/** Deterministic timer: the test fires the scheduled callback by hand. */
function makeTimer() {
  const registered = []
  return {
    registered,
    cleared: 0,
    every(intervalMs, run) {
      const entry = { intervalMs, run }
      registered.push(entry)
      return () => { this.cleared += 1 }
    },
  }
}

const flush = () => new Promise(resolve => setImmediate(resolve))

test('scheduler: ticks on the injected timer, not on the panel', async () => {
  const timer = makeTimer()
  let calls = 0
  const scheduler = new PaperScheduler({ tick: async () => { calls += 1 }, intervalMs: 1_000, timer })
  scheduler.start()
  assert.equal(timer.registered.length, 1)
  assert.equal(timer.registered[0].intervalMs, 1_000)

  timer.registered[0].run()
  await flush()
  assert.equal(calls, 1)

  timer.registered[0].run()
  await flush()
  timer.registered[0].run()
  await flush()
  assert.equal(calls, 3, 'each timer beat drives one tick')

  scheduler.start()
  assert.equal(timer.registered.length, 1, 'start is idempotent')

  scheduler.stop()
  assert.equal(timer.cleared, 1)
  scheduler.stop()
  assert.equal(timer.cleared, 1, 'stop is idempotent')
})

test('scheduler: a slow tick is never overlapped and failures are contained', async () => {
  const timer = makeTimer()
  const warnings = []
  let release
  let calls = 0
  const scheduler = new PaperScheduler({
    intervalMs: 50,
    timer,
    logger: { warn: message => warnings.push(message) },
    tick: () => {
      calls += 1
      return new Promise(resolve => { release = resolve })
    },
  })
  scheduler.start()
  timer.registered[0].run()
  timer.registered[0].run()
  await flush()
  assert.equal(calls, 1, 'a pending tick blocks the next beat')
  release()
  await flush()
  assert.equal(calls, 1)
  assert.deepEqual(warnings, [])
  scheduler.stop()

  // Once the slow tick settled, the next beat runs again.
  timer.registered[0].run()
  await flush()
  assert.equal(calls, 2)
})

test('scheduler: failures from tick become warnings instead of unhandled rejections', async () => {
  const timer = makeTimer()
  const warnings = []
  const scheduler = new PaperScheduler({
    intervalMs: 10,
    timer,
    logger: { warn: message => warnings.push(message) },
    tick: async () => { throw new Error('boom') },
  })
  scheduler.start()
  timer.registered[0].run()
  await flush()
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /boom/)
})
