#!/bin/bash
# Pre-build & Package Script for AI Chat PDF Exporter Chrome Extension

set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

echo "Running Pre-Build Verification and Package Pipeline..."
npm run build
