#!/usr/bin/env node

/**
 * CLI Tool: Add Dynamic Regression Test
 * 
 * Usage:
 *   npm run add-test -- --type=feature --name="my-new-feature"
 *   npm run add-test -- --type=fix --name="fix-iframe-scaling"
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);

function getArgValue(flag) {
  const match = args.find(a => a.startsWith(`${flag}=`));
  if (match) return match.split('=')[1];
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return null;
}

const type = (getArgValue('--type') || 'feature').toLowerCase();
const name = getArgValue('--name');

if (!name) {
  console.error('Error: Please provide a test name using --name="your-test-name"');
  console.log('\nUsage:');
  console.log('  npm run add-test -- --type=feature --name="custom-table-style"');
  console.log('  npm run add-test -- --type=fix --name="fix-popup-loader"\n');
  process.exit(1);
}

if (type !== 'feature' && type !== 'fix') {
  console.error(`Error: Invalid type "${type}". Must be "feature" or "fix".`);
  process.exit(1);
}

const sanitizedName = name.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
const targetDir = path.join(__dirname, `../tests/regression/${type}s`);

if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

const testFileName = `${type}_${sanitizedName}.test.js`;
const targetFilePath = path.join(targetDir, testFileName);

if (fs.existsSync(targetFilePath)) {
  console.error(`Error: Test file already exists at ${targetFilePath}`);
  process.exit(1);
}

const testId = `REG-${type.toUpperCase()}-${Date.now().toString().slice(-6)}`;

const template = `const { registerRegressionTest } = require('../../helpers/testRegistry');

/**
 * Dynamic Regression Test for ${type.toUpperCase()}: ${name}
 * ID: ${testId}
 */

registerRegressionTest({
  id: '${testId}',
  type: '${type}',
  description: '${name.replace(/'/g, "\\'")}',
  suiteFn: () => {}
});

describe('[${type.toUpperCase()}] ${name} Regression Test', () => {
  test('verifies behavior of ${name}', () => {
    // TODO: Add test assertions for ${name}
    expect(true).toBe(true);
  });
});
`;

fs.writeFileSync(targetFilePath, template, 'utf8');

console.log(`\n Successfully generated dynamic regression test!`);
console.log(` Type:     ${type.toUpperCase()}`);
console.log(` ID:       ${testId}`);
console.log(` File:     tests/regression/${type}s/${testFileName}`);
console.log(` Run tests: npm test\n`);
