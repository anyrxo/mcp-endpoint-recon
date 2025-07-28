# MCP Endpoint Recon 🎯

A powerful MCP (Model Context Protocol) server for comprehensive API endpoint discovery and documentation. Captures EVERYTHING - headers, cookies, tokens, payloads, and response data from any website through AdsPower browser profiles.

## Features

### 🚀 Two Powerful Tools

#### 1. `adspower_capture_everything`
- Captures ONLY Fetch/XHR requests (filters out static assets)
- Extracts complete headers, cookies, tokens, payloads, and preview data
- Generates clean `endpoints.md` file with organized documentation
- Includes Python/JavaScript usage examples
- Perfect for API-focused reconnaissance

#### 2. `adspower_comprehensive_commander` (Advanced)
Everything from tool #1 PLUS:
- **Automatic Navigation**: Clicks all buttons, dropdowns, and interactive elements
- **Page Discovery**: Analyzes API responses to find new pages/URLs
- **Endpoint → Page Mapping**: Shows which endpoints reveal which pages
- **Smart Clicking**: Tracks what's been clicked to avoid repeats
- **Longer Duration**: Default 60 seconds for thorough exploration

### ✅ What Gets Captured

- **Headers**: All request/response headers including authentication
- **Cookies**: Session cookies and auth cookies with proper formatting
- **Tokens**: Authorization, CSRF, API keys auto-extracted from headers/payloads
- **Payloads**: Complete request payloads (JSON parsed when possible)
- **Preview Data**: Smart extraction of key response data fields
- **FETCH/XHR Only**: Filters out images, CSS, and other static resources
- **Clean Documentation**: Beautiful endpoints.md with usage examples

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/mcp-endpoint-recon.git
cd mcp-endpoint-recon

# Install dependencies
npm install

# Add to Claude Desktop config
```

Add to your Claude Desktop configuration (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "endpoint-recon": {
      "command": "node",
      "args": ["/path/to/mcp-endpoint-recon/src/index.js"]
    }
  }
}
```

## Usage

### Basic Capture (30 seconds)
```bash
# Through MCP in Claude
endpoint-recon: adspower_capture_everything
- adspowerPort: "63812"
- targetUrl: "https://example.com"
```

### Advanced with Auto-Navigation (60 seconds)
```bash
# Through MCP in Claude
endpoint-recon: adspower_comprehensive_commander
- adspowerPort: "63812"
- targetUrl: "https://example.com"
- duration: 90  # Optional: extend to 90 seconds
```

## Output Files

Both tools generate:
- `endpoints-{domain}.md` - Clean, organized documentation with:
  - Authentication tokens and cookies
  - All discovered API endpoints
  - Request/response examples
  - Python & JavaScript code snippets
  - Discovered pages and mappings
- `endpoints-{domain}.json` - Raw data for programmatic use

## Example Output

```markdown
# 📡 API Endpoints Documentation

**Domain:** example.com
**Total Endpoints:** 47
**Discovered Pages:** 12

## 🔐 Authentication Tokens

```
Authorization=Bearer eyJhbGciOiJIUzI1NiIs...
X-CSRF-Token=a8f93jf93jf93jf93j...
```

## 📋 API Endpoints

### /api/v1

#### GET /api/v1/user/profile
**Headers:**
```json
{
  "Authorization": "Bearer ...",
  "Content-Type": "application/json"
}
```
...
```

## Requirements

- Node.js 16+
- AdsPower browser with debug port enabled
- Active browser profile logged into target site

## How It Works

1. Connects to AdsPower browser via Chrome DevTools Protocol
2. Intercepts all Fetch/XHR network requests
3. Extracts authentication data, headers, and payloads
4. (Advanced mode) Automatically clicks through the UI to discover more endpoints
5. Analyzes API responses to find hidden pages and endpoints
6. Generates comprehensive documentation

## Contributing

Feel free to submit issues and enhancement requests!

## License

MIT