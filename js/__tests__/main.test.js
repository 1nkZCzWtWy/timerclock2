const { describe, it } = require('node:test');
const assert = require('node:assert');

describe('sample test', () => {
  it('adds numbers correctly', () => {
    assert.strictEqual(1 + 1, 2);
  });
});

