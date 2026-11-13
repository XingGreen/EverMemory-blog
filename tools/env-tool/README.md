# Env tool

Fills `.env.local` without going through the admin login — the login itself needs these keys.

Double-click `start-env-tool.bat`. It serves one page on `127.0.0.1:8788` and opens it;
close the window to stop. `ENV_TOOL_PORT` and `ENV_TOOL_TARGET` override the port and the file.

Reads `.env.local` (only the keys listed in `server.mjs`), `.git/config` and `.git/HEAD`.
The only outbound request is a read-only probe to `api.github.com`, sent when you ask for the
installation id.
