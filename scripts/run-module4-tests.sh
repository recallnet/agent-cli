#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=====================================${NC}"
echo -e "${BLUE}Running Module 4 Tests${NC}"
echo -e "${BLUE}=====================================${NC}"

# Run vitest directly with the test file
npx vitest run ./tests/module-4.test.ts

EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
  echo -e "\n${GREEN}✅ All tests passed!${NC}"
else
  echo -e "\n${RED}❌ Tests failed!${NC}"
fi

echo -e "${BLUE}=====================================${NC}"
echo -e "${BLUE}Test run completed${NC}"
echo -e "${BLUE}=====================================${NC}"

exit $EXIT_CODE 