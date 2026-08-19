#!/usr/bin/env bash
# Double-click wrapper for dev.sh, the macOS counterpart of start.bat. The .command
# extension is what makes Finder open the file in Terminal instead of an editor.
cd "$(dirname "$0")"
./dev.sh
echo
echo "[ChungusHub] Server stopped."
read -rsn 1 -p "Press any key to close."
echo
