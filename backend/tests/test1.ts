import test from 'node:test'
import assert from 'assert/strict'

test('synchronous passing test', (t) => {
    // This test passes because it does not throw an exception.
    console.log('text I want to show')
    assert.strictEqual(1, 1);
})