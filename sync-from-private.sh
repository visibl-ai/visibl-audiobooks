#!/bin/bash

# Script to sync code from private repositories to open source repo
# Usage: ./sync-from-private.sh [swift|server]
#
# This will copy all files from the private repository to the target directory,
# excluding README.md, .git history, and any files specified in ignore files.

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to show usage
show_usage() {
    echo -e "${BLUE}Usage: $0 [swift|server]${NC}"
    echo ""
    echo "Sync code from private repositories to public directories:"
    echo "  swift  - Sync Swift iOS client code"
    echo "  server - Sync server/pipeline code"
    echo ""
    echo "Examples:"
    echo "  $0 swift   # Sync visibl-swift from private repo"
    echo "  $0 server  # Sync visibl-server from private repo"
    exit 1
}

# Check if parameter is provided
if [ $# -eq 0 ]; then
    echo -e "${RED}Error: Missing required parameter${NC}"
    echo ""
    show_usage
fi

SYNC_TYPE="$1"

# Configure based on sync type
case "$SYNC_TYPE" in
    swift)
        PRIVATE_REPO="git@github.com:visibl-ai/visibl-swift-private.git"
        TARGET_DIR="visibl-swift"
        IGNORE_FILE=""  # Swift doesn't use a separate ignore file
        ;;
    server)
        PRIVATE_REPO="git@github.com:visibl-ai/visibl-server.git"
        TARGET_DIR="visibl-server"
        IGNORE_FILE=".serverignore"
        ;;
    *)
        echo -e "${RED}Error: Invalid sync type '$SYNC_TYPE'${NC}"
        echo ""
        show_usage
        ;;
esac

BRANCH="main"
TEMP_DIR=".temp-clone-$$"

echo -e "${GREEN}=== Starting sync from private repository ===${NC}"
echo "Type: $SYNC_TYPE"
echo "Source: $PRIVATE_REPO ($BRANCH branch)"
echo "Target: $TARGET_DIR"
echo ""

# Check if we're in the right directory
if [ ! -d ".git" ]; then
    echo -e "${RED}Error: This script must be run from the root of the visibl-audiobooks repository${NC}"
    exit 1
fi

# For server sync, check if .serverignore exists
if [ "$SYNC_TYPE" = "server" ] && [ ! -f "$IGNORE_FILE" ]; then
    echo -e "${RED}Error: $IGNORE_FILE not found${NC}"
    echo "Create a $IGNORE_FILE file with paths to exclude (one per line)"
    echo "Example:"
    echo "  config/secrets.yml"
    echo "  .env.production"
    echo "  internal/credentials/"
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
    echo "  - The repository URL is correct: $PRIVATE_REPO"
    exit 1
fi

# Clean the target directory (except for preserved files)
echo -e "${YELLOW}Cleaning target directory: $TARGET_DIR${NC}"
if [ "$(ls -A $TARGET_DIR 2>/dev/null)" ]; then
    # Remove all files and directories in target
    find "$TARGET_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} \;
fi

# Build rsync exclusion list
echo -e "${GREEN}Copying files to $TARGET_DIR...${NC}"
RSYNC_EXCLUDES=(
    --exclude='.git'
    --exclude='README.md'
    --exclude='.gitignore'
)

# Add custom exclusions from ignore file if it exists
if [ -n "$IGNORE_FILE" ] && [ -f "$IGNORE_FILE" ]; then
    echo "Loading exclusions from $IGNORE_FILE..."
    EXCLUDE_COUNT=0
    while IFS= read -r line || [ -n "$line" ]; do
        # Skip empty lines and comments
        if [[ -n "$line" ]] && [[ ! "$line" =~ ^[[:space:]]*# ]]; then
            RSYNC_EXCLUDES+=(--exclude="$line")
            EXCLUDE_COUNT=$((EXCLUDE_COUNT + 1))
        fi
    done < "$IGNORE_FILE"
    echo "Added $EXCLUDE_COUNT custom exclusions from $IGNORE_FILE"
fi

echo "Standard exclusions: .git, README.md, .gitignore"

# Use rsync for efficient copying with exclusions
rsync -av "${RSYNC_EXCLUDES[@]}" "$TEMP_DIR/" "$TARGET_DIR/" | grep -v "^$" | head -20

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
echo "Sync type: $SYNC_TYPE"
echo "Files copied: $FILE_COUNT"
echo "Directories created: $DIR_COUNT"
echo ""
echo "Next steps:"
echo "  1. Review the changes: git status"
echo "  2. Add files to git: git add $TARGET_DIR"
echo "  3. Commit the changes: git commit -m 'Sync $SYNC_TYPE from private repository'"
echo ""
echo -e "${YELLOW}Note: Git history from the private repo has been excluded${NC}"
