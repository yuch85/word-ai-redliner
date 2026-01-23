# Word AI Redliner

AI-powered Microsoft Word add-in that applies word-level tracked changes using
a structure-aware diff strategy.

**Project history**: This library was extracted from a private codebase and open-sourced as a standalone project in Jan 2026.

## Features

- Word-level diffs with tracked changes
- Token map strategy with sentence fallback
- Prompt management for custom review templates

## Setup

### Prerequisites

- Node.js 18+
- Docker (optional, for Ollama)

### Local HTTPS Certificates (PEM files)

The dev server runs over HTTPS. For Word to load the add-in, the certificate
must be trusted on the machine running Word.

Place your cert files in the project root:

- `server.pem` (certificate)
- `server-key.pem` (private key)

If those files are not found, webpack will fall back to a self-signed cert,
which will be blocked by Word unless explicitly trusted.

You can also set environment variables to use custom filenames:

```bash
SSL_CERT_FILE=my-cert.pem SSL_KEY_FILE=my-key.pem npm start
```

#### Option A: mkcert (recommended for dev)

1. Install [mkcert](https://github.com/FiloSottile/mkcert) on the server machine.
2. Create a local CA and generate a cert for your host:

```bash
mkcert -install

# For localhost (same machine):
mkcert localhost

# For a remote server (use your actual IP or hostname):
mkcert <your-server-ip-or-hostname>
```

This creates two files (e.g., `localhost.pem` and `localhost-key.pem`).

Rename them to what webpack expects:

```bash
cp localhost.pem server.pem
cp localhost-key.pem server-key.pem
```

#### Option B: OpenSSL (manual)

```bash
# Replace <YOUR_HOST> with localhost or your server IP/hostname
openssl req -x509 -nodes -days 365 \
  -newkey rsa:2048 \
  -keyout server-key.pem \
  -out server.pem \
  -subj "/CN=<YOUR_HOST>"
```

This generates a self-signed cert. You must install the cert on the Windows
client for Word to trust it.

### Trust the Certificate on Windows

On the Windows PC running Word:

1. Copy the `.pem` cert file to the Windows PC.
2. Convert PEM to CRT (if needed):

```powershell
openssl x509 -in server.pem -out server.crt
```

3. Open **certmgr.msc** (run as Administrator).
4. Navigate to **Trusted Root Certification Authorities** → **Certificates**.
5. Right-click → **All Tasks** → **Import...**
6. Select the `.crt` file and finish the wizard.

If you used mkcert, you can also install the mkcert root CA on Windows instead
of the leaf cert:

- Copy the mkcert root CA from the server machine (find it via `mkcert -CAROOT`)
- Import it into **Trusted Root Certification Authorities**

### Configure Environment

Create a `.env` file based on `.env.example`:

```bash
cp .env.example .env
```

#### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HOST` | `localhost` | Hostname for manifest URLs |
| `PORT` | `3000` | Port for manifest URLs |
| `PROTOCOL` | `https` | Protocol for manifest URLs |
| `DEV_SERVER_HOST` | `0.0.0.0` | Host to bind webpack dev server |
| `DEV_SERVER_PORT` | `3000` | Port for webpack dev server |
| `SSL_CERT_FILE` | `server.pem` | Path to SSL certificate |
| `SSL_KEY_FILE` | `server-key.pem` | Path to SSL private key |
| `OLLAMA_PROXY_PATH` | `/ollama` | Local proxy path for LLM requests |
| `OLLAMA_PROXY_TARGET` | `http://localhost:11434` | Upstream Ollama server URL |
| `DEFAULT_OLLAMA_URL` | `/ollama` | Default Ollama URL shown in UI |
| `DEFAULT_MODEL` | `gpt-oss:20b` | Default model shown in UI |

Example `.env` for a remote Ollama server:

```env
HOST=192.168.1.100
PORT=3000
PROTOCOL=https
OLLAMA_PROXY_TARGET=http://192.168.1.50:11434
DEFAULT_MODEL=llama3:8b
```

Users can override `DEFAULT_OLLAMA_URL` and `DEFAULT_MODEL` via the add-in
settings UI; those overrides persist in localStorage.

The manifest is generated from `manifest.template.xml` using
`scripts/generate-manifest.js` when webpack runs.

### Install and Run

```bash
npm install
npm start
```

### Sideload the Add-in (Word on Windows)

1. Build or start the dev server:
   - Dev: `npm start`
   - Prod: `npm run build`

2. Ensure the manifest points to the correct host (see scenarios below).

3. Open Word and go to **Insert** → **Get Add-ins** → **My Add-ins**.
4. Click **Add a custom add-in** → **Add from file...**.
5. Select the `manifest.xml` file and confirm.

If Word shows a "blocked because it isn't signed" error, the client does not
trust your HTTPS cert. Follow the certificate trust steps above.

### Sideload the Add-in (Word on Mac)

1. Start the dev server: `npm start`
2. Open Word → **Insert** → **Add-ins** → **My Add-ins**.
3. Click **Add a custom add-in** → **Add from file...** and select `manifest.xml`.
4. Trust the certificate in Keychain if prompted.

### Scenarios: Same Machine vs Remote Machine

**Scenario A: Word and the dev server are on the same machine**

- Use `https://localhost:3000/...` in the manifest.
- Generate a cert for `localhost`.
- Trust the cert on that same machine.

**Scenario B: Word is on a different machine (e.g., Windows PC accessing a Linux server)**

- Use `https://<server-ip-or-hostname>:3000/...` in the manifest.
- Generate a cert for your server's IP or hostname.
- Copy the cert to the **Word client machine** and trust it there.
- Ensure the server firewall allows inbound TCP 3000.

### Notes

- The manifest is generated from `manifest.template.xml` and output as
  `manifest.xml` in the project root. Use the generated file for sideloading.
- If the Word client cannot reach the server URL, verify network routing and
  firewall rules allow inbound TCP 3000 on the server.
- PEM files (`server.pem`, `server-key.pem`) are gitignored by default. Do not
  commit private keys to the repo.

## Project Structure

See `ARCHITECTURE.md` for details.

## Licensing

This project is dual-licensed:

- **MIT License** applies to the Word add-in codebase.
- **AGPLv3 License** applies to the `office-word-diff` library (used as a dependency).

See `LICENSE` and `LICENSE-AGPL` for details.

## Testing

The previous test suite referenced modules that are not present in the current
minimal codebase. The test directory is left empty and ready for new tests once
refactoring is complete.
