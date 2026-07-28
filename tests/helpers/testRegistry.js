/**
 * Dynamic Regression Test Registry Engine
 * 
 * Allows new features and bug fixes to register regression test suites dynamically.
 * Automatically scans and executes registered feature and fix suites during test runs.
 */

const registeredTests = new Map();

/**
 * Register a regression test suite for a feature or fix.
 * @param {Object} spec - { id, type: 'feature'|'fix', description, suiteFn }
 */
function registerRegressionTest(spec) {
  if (!spec || !spec.id) {
    throw new Error('Registration requires an id field');
  }
  const type = spec.type || 'feature';
  const entry = {
    id: spec.id,
    type,
    description: spec.description || spec.id,
    suiteFn: spec.suiteFn,
    registeredAt: new Date().toISOString()
  };
  registeredTests.set(spec.id, entry);
  return entry;
}

/**
 * Get all registered regression test suites.
 */
function getRegisteredTests() {
  return Array.from(registeredTests.values());
}

/**
 * Helper to run all registered dynamic tests inside Jest describe blocks.
 */
function runDynamicRegressionSuite() {
  const tests = getRegisteredTests();
  if (tests.length === 0) {
    describe('Dynamic Regression Suite', () => {
      test('Placeholder for dynamic tests', () => {
        expect(true).toBe(true);
      });
    });
    return;
  }

  tests.forEach(testSpec => {
    describe(`[Dynamic Regression] [${testSpec.type.toUpperCase()}] ${testSpec.id}: ${testSpec.description}`, () => {
      if (typeof testSpec.suiteFn === 'function') {
        testSpec.suiteFn();
      } else {
        test('Suite registered', () => {
          expect(testSpec).toBeDefined();
        });
      }
    });
  });
}

module.exports = {
  registerRegressionTest,
  getRegisteredTests,
  runDynamicRegressionSuite
};
