#!/usr/bin/env node
/**
 * Derive the GitHub Actions matrix from the checked-in package matrix
 * (`packages/<name>/prebuilds.json`). Single source: adding a platform
 * package extends CI without editing a workflow.
 *
 *   node scripts/github-matrix.mjs ci  → one leg per distinct platform
 */

import path from 'node:path';
import { platformDirs, readJson, root } from './repo.mjs';

/** GitHub runner per prebuilds.json `platform` value — native builders only, no cross toolchain. */
const RUNNERS = {
  'linux-x64': 'ubuntu-24.04',
  'linux-arm64': 'ubuntu-24.04-arm',
  'darwin-x64': 'macos-15-intel',
  'darwin-arm64': 'macos-latest',
};

function runnerFor(platform) {
  const runner = RUNNERS[platform];
  if (!runner) {
    throw new Error(`missing GitHub runner for platform: ${platform}`);
  }
  return runner;
}

function ciMatrix() {
  const platforms = [...new Set(platformDirs().map((dir) => readJson(path.join(root, dir, 'prebuilds.json')).platform))].sort();
  return {
    include: platforms.map((platform) => ({ platform, runner: runnerFor(platform) })),
  };
}

const target = process.argv[2];
const matrices = {
  ci: ciMatrix,
};

if (!target || !matrices[target]) {
  console.error(`Usage: node scripts/github-matrix.mjs <${Object.keys(matrices).join('|')}>`);
  process.exit(1);
}

process.stdout.write(JSON.stringify(matrices[target]()));
