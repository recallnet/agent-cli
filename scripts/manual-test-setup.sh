#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

TEST_DIR="./test-agent"
CLI_PATH="node dist/index.js"

echo -e "${BLUE}=====================================${NC}"
echo -e "${BLUE}Manual Test: Setup Command${NC}"
echo -e "${BLUE}=====================================${NC}"

# Check if test directory exists and offer to remove it
if [ -d "$TEST_DIR" ]; then
  echo -e "${RED}Test directory already exists.${NC}"
  read -p "Do you want to remove it? (y/n): " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "Removing existing test directory..."
    rm -rf "$TEST_DIR"
  else
    echo -e "Please rename or remove the existing test directory and try again."
    exit 1
  fi
fi

# Create test directory
echo -e "Creating test directory: ${GREEN}$TEST_DIR${NC}"
mkdir -p "$TEST_DIR"

# Run the setup command
echo -e "${BLUE}Running setup command...${NC}"
echo -e "Command: ${GREEN}$CLI_PATH setup --directory $TEST_DIR${NC}"
echo

$CLI_PATH setup --directory "$TEST_DIR"

# Check the result
if [ $? -eq 0 ]; then
  echo -e "\n${GREEN}Setup command completed successfully!${NC}"
  
  # List created files
  echo -e "\n${BLUE}Files created in $TEST_DIR:${NC}"
  find "$TEST_DIR" -type f | sort
else
  echo -e "\n${RED}Setup command failed!${NC}"
fi

echo -e "\n${BLUE}=====================================${NC}"
echo -e "${BLUE}Manual test completed${NC}"
echo -e "${BLUE}=====================================${NC}" 