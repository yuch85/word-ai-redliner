# Technology Stack

**Analysis Date:** 2026-03-10

## Languages

**Primary:**
- JavaScript (ES6/ESM) - Main application code and build configuration
- HTML5 - UI templates for taskpane and commands

**Secondary:**
- XML - Office manifest and Word document structure

## Runtime

**Environment:**
- Node.js 18+ (based on README documentation)

**Package Manager:**
- npm (with package-lock.json present)
- Lockfile: `package-lock.json` (present)

## Frameworks

**Core:**
- Office JavaScript API - `@types/office-js@1.0.0` - Microsoft Word Office Add-in integration

**Web Runtime:**
- Webpack `5.89.0` - Module bundler and dev server
- Webpack Dev Server `4.15.1` - Development server with HTTPS, CORS, and proxy support

**Build Tools:**
- Babel `7.28.5` - JavaScript transpilation
  - `@babel/core@7.28.5`
  - `@babel/preset-env@7.28.5`
  - `babel-jest@30.2.0` - Test transpilation

**Plugins:**
- `html-webpack-plugin@5.5.3` - HTML template processing
- `copy-webpack-plugin@11.0.0` - Asset copying
- `css-loader@6.8.1` - CSS module loading
- `style-loader@3.3.3` - CSS injection

**Testing:**
- Jest `30.2.0` - Test runner
  - Config: `jest.config.cjs`
  - Test pattern: `tests/**/*.spec.js`

**Linting:**
- ESLint `8.51.0` - Code linting

## Key Dependencies

**Critical:**
- `office-word-diff` (custom package from `github:yuch85/office-word-diff`) - Core diff algorithm and Word range application
  - Provides: `applyTokenMapStrategy`, `applySentenceDiffStrategy` for word-level tracked changes
  - Required by: `src/taskpane/taskpane.js` (main UI), `src/scripts/verify-word-api.js` (verification)

**Infrastructure:**
- `diff-match-patch@1.0.5` - Underlying text diff utilities (transitive dependency)
- `dotenv@17.2.3` - Environment variable loading
- `webpack-cli@5.1.4` - Webpack CLI tools
- `@types/office-js@1.0.0` - TypeScript type definitions for Office API

## Configuration

**Environment:**
- Configured via `.env` file (see `.env.example` at project root)
- No required environment variables - all have defaults
- Key config vars:
  - `DEV_SERVER_HOST` (default: `0.0.0.0`)
  - `DEV_SERVER_PORT` (default: `3000`)
  - `OLLAMA_PROXY_PATH` (default: `/ollama`)
  - `OLLAMA_PROXY_TARGET` (default: `http://localhost:11434`)
  - `DEFAULT_OLLAMA_URL` (default: `/ollama`)
  - `DEFAULT_MODEL` (default: `gpt-oss:20b`)
  - `SSL_CERT_FILE`, `SSL_KEY_FILE` (optional, for custom HTTPS certificates)

**Build:**
- Webpack config: `webpack.config.cjs`
  - Entry points: `src/taskpane/taskpane.js`, `src/commands/commands.js`
  - Output: `dist/` directory
  - Development: hot reload, self-signed HTTPS cert (or custom cert), source maps
  - Production: minified, no source maps
  - Proxy: Ollama API requests at `/ollama` proxy to upstream Ollama server
  - Logging endpoints: `/log`, `/logs`, `/api/prompts`, `/api/test-cases`, `/api/trace-log`, `/api/fix-log`, `/api/e2e-loop/*`

**Scripts:**
- `npm start` - Webpack dev server (development mode)
- `npm build` - Production build
- `npm lint` - ESLint validation
- `npm test` - Jest test runner
- `npm run test:e2e` - E2E test runner
- `npm run trigger-next` - E2E loop control (trigger next iteration)
- `npm run check-loop` - E2E loop control (check status)

## Platform Requirements

**Development:**
- Node.js 18+ (required)
- npm (required)
- HTTPS certificate files (optional, webpack generates self-signed cert if not provided)

**Production:**
- Docker image available at `ghcr.io/yuch85/word-ai-redliner:0.1.2`
  - Multi-arch: amd64 + arm64
  - Container exposes port `3000`
- Requires HTTPS certificates mounted as Docker volumes
- Microsoft Word (Office 365 or standalone)
- HTTPS certificate authority trusted by the machine running Word

**Deployment:**
- Docker Compose configuration: `docker-compose.yml`
- Manifest file: `manifest.xml` (Office Add-in manifest)

---

*Stack analysis: 2026-03-10*
