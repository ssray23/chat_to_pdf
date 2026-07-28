#!/usr/bin/env node

/**
 * Extension Pre-Build Enforcement & Bundler
 * 
 * 1. Runs all regression tests. Halts immediately on failure.
 * 2. Validates manifest.json integrity.
 * 3. Packages extension into dist/ package.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const projectRoot = path.join(__dirname, '..');

console.log('----------------------------------------------------');
console.log('  AI CHAT PDF EXPORTER - EXTENSION PRE-BUILD STEP   ');
console.log('----------------------------------------------------');
console.log('[1/3] Executing dynamic regression test suite...\n');

try {
  // Run regression tests
  execSync('npm test', { cwd: projectRoot, stdio: 'inherit' });
  console.log('\n Dynamic regression test suite PASSED successfully!');
} catch (err) {
  console.error('\n BUILD FAILED: Regression test suite failed. Build aborted.');
  process.exit(1);
}

console.log('\n[2/3] Validating Manifest V3 integrity & extension assets...');

const manifestPath = path.join(projectRoot, 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error(' BUILD FAILED: manifest.json is missing.');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const requiredFiles = [
  'manifest.json',
  'content.js',
  'print.html',
  'print.js',
  'print.css',
  'clean-compact.css',
  'popup/popup.html',
  'popup/popup.js',
  'popup/popup.css'
];

let missing = false;
requiredFiles.forEach(file => {
  const full = path.join(projectRoot, file);
  if (!fs.existsSync(full)) {
    console.error(` Missing required file: ${file}`);
    missing = true;
  }
});

if (missing) {
  console.error('\n BUILD FAILED: Required extension assets are missing.');
  process.exit(1);
}

console.log(' All required extension assets present and verified.');

console.log('\n[3/3] Packaging Chrome Extension into dist/ directory...');

const distDir = path.join(projectRoot, 'dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

const unpackedDir = path.join(distDir, `ai-chat-pdf-exporter-v${manifest.version}`);
if (fs.existsSync(unpackedDir)) {
  fs.rmSync(unpackedDir, { recursive: true, force: true });
}
fs.mkdirSync(unpackedDir, { recursive: true });

// Copy essential files to unpacked directory safely
function copyRecursive(src, dest) {
  const stats = fs.statSync(src);
  if (stats.isDirectory()) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach(child => {
      copyRecursive(path.join(src, child), path.join(dest, child));
    });
  } else {
    const parentDir = path.dirname(dest);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.copyFileSync(src, dest);
  }
}

requiredFiles.forEach(rel => {
  copyRecursive(path.join(projectRoot, rel), path.join(unpackedDir, rel));
});

// Copy icons directory
if (fs.existsSync(path.join(projectRoot, 'icons'))) {
  copyRecursive(path.join(projectRoot, 'icons'), path.join(unpackedDir, 'icons'));
}

console.log(` Unpacked extension copied to: dist/ai-chat-pdf-exporter-v${manifest.version}`);

// Use zip command if available
try {
  const zipName = `ai-chat-pdf-exporter-v${manifest.version}.zip`;
  const zipPath = path.join(distDir, zipName);
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  
  execSync(`zip -r "${zipName}" "ai-chat-pdf-exporter-v${manifest.version}"`, {
    cwd: distDir,
    stdio: 'ignore'
  });
  console.log(` Created distribution archive: dist/${zipName}`);
} catch (e) {
  console.log(' (Note: zip command unavailable, unpacked bundle ready in dist/)');
}

console.log('\n----------------------------------------------------');
console.log(' BUILD SUCCESSFUL: Extension bundle is ready!');
console.log('----------------------------------------------------\n');
