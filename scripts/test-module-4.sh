#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=====================================${NC}"
echo -e "${BLUE}Testing Module 4: Agent Initialization${NC}"
echo -e "${BLUE}=====================================${NC}"

# Ensure dependencies are installed
echo -e "${BLUE}Installing dependencies...${NC}"
npm install --save-dev @types/semver @types/uuid vitest

# Run linter on Module 4 files
echo -e "${BLUE}Running linter on Module 4 files...${NC}"
npx eslint src/lib/agent/prerequisites.ts src/lib/agent/environment-analyzer.ts src/lib/agent/plugin-compatibility.ts

# Run tests for Module 4
echo -e "${BLUE}Running Module 4 tests...${NC}"
npx vitest run tests/module-4-tests.ts

# Manual test for setup command
echo -e "${BLUE}Manual test instructions for setup command:${NC}"
echo -e "1. Run the following command to test the setup process:"
echo -e "   ${GREEN}./bin/recall-cli setup --directory test-agent${NC}"
echo -e "2. Follow the interactive prompts to set up a test agent"
echo -e "3. Check if all steps complete successfully"

echo -e "${BLUE}=====================================${NC}"
echo -e "${BLUE}Module 4 testing completed${NC}"
echo -e "${BLUE}=====================================${NC}" 