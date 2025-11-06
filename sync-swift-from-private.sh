#!/bin/bash

# Script to sync code from private repo to open source repo
# This will copy all files from visibl-swift-private to visibl-swift directory
# excluding README.md and .git history

set -e  # Exit on error

# Configuration
PRIVATE_REPO="git@github.com:visibl-ai/visibl-swift-private.git"
BRANCH="main"
TARGET_DIR="visibl-swift"
TEMP_DIR=".temp-clone-$$"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Starting sync from private repository ===${NC}"
echo "Source: $PRIVATE_REPO ($BRANCH branch)"
echo "Target: $TARGET_DIR"
echo ""

# Check if we're in the right directory
if [ ! -d ".git" ]; then
    echo -e "${RED}Error: This script must be run from the root of the visibl-audiobooks repository${NC}"
    exit 1
fi

# Check if target directory exists, create if not
if [ ! -d "$TARGET_DIR" ]; then
    echo -e "${YELLOW}Creating target directory: $TARGET_DIR${NC}"
    mkdir -p "$TARGET_DIR"
fi

# Preserve existing README.md if it exists in target
README_PRESERVED=false
TEMP_README=".temp-readme-$$.md"
if [ -f "$TARGET_DIR/README.md" ]; then
    echo -e "${YELLOW}Preserving existing $TARGET_DIR/README.md${NC}"
    cp "$TARGET_DIR/README.md" "$TEMP_README"
    README_PRESERVED=true
fi

# Clone the private repository
echo -e "${GREEN}Cloning private repository...${NC}"
if ! git clone --branch "$BRANCH" --depth 1 "$PRIVATE_REPO" "$TEMP_DIR"; then
    echo -e "${RED}Error: Failed to clone repository. Please check:${NC}"
    echo "  - You have access to the private repository"
    echo "  - Your SSH keys are properly configured for GitHub"
    echo "  - Test SSH access with: ssh -T git@github.com"
    echo "  - The repository URL is correct"
    exit 1
fi

# Clean the target directory (except for preserved files)
echo -e "${YELLOW}Cleaning target directory: $TARGET_DIR${NC}"
if [ "$(ls -A $TARGET_DIR 2>/dev/null)" ]; then
    # Remove all files and directories in target
    find "$TARGET_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} \;
fi

# Copy files from cloned repo to target, excluding specific files
echo -e "${GREEN}Copying files to $TARGET_DIR...${NC}"
echo "Excluding: README.md, .git"

# Use rsync for efficient copying with exclusions
rsync -av \
    --exclude='.git' \
    --exclude='README.md' \
    --exclude='.gitignore' \
    "$TEMP_DIR/" "$TARGET_DIR/" | grep -v "^$" | head -20

# Count files copied
FILE_COUNT=$(find "$TARGET_DIR" -type f | wc -l | tr -d ' ')
DIR_COUNT=$(find "$TARGET_DIR" -type d -mindepth 1 | wc -l | tr -d ' ')

# Restore preserved README if it existed
if [ "$README_PRESERVED" = true ]; then
    echo -e "${YELLOW}Restoring preserved README.md${NC}"
    mv "$TEMP_README" "$TARGET_DIR/README.md"
fi

# Clean up temporary files
echo -e "${GREEN}Cleaning up temporary files...${NC}"
rm -rf "$TEMP_DIR"
[ -f "$TEMP_README" ] && rm -f "$TEMP_README"

# Summary
echo ""
echo -e "${GREEN}=== Sync completed successfully ===${NC}"
echo "Files copied: $FILE_COUNT"
echo "Directories created: $DIR_COUNT"
echo ""
echo "Next steps:"
echo "  1. Review the changes: git status"
echo "  2. Add files to git: git add $TARGET_DIR"
echo "  3. Commit the changes: git commit -m 'Sync from private repository'"
echo ""
echo -e "${YELLOW}Note: Git history from the private repo has been excluded${NC}"