# Env tool

Fills `.env.local` without going through the admin login — the login itself needs these keys.

```
pnpm run env:tool
```

That is the whole command; it serves the page on `127.0.0.1:8788` and opens it. Close the
terminal (Ctrl+C) to stop. `ENV_TOOL_PORT` and `ENV_TOOL_TARGET` override the port and the file.

`start-env-tool.bat` does the same thing by double-click, for environments that allow it.

Reads `.env.local` (only the keys listed in `server.mjs`), `.git/config` and `.git/HEAD`.
The only outbound request is a read-only probe to `api.github.com`, sent when you ask for the
installation id.
