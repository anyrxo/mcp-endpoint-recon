# Basic Capture Example

This example shows how to use the MCP Endpoint Recon server to capture API endpoints.

## Step 1: Start AdsPower with Debug Port

1. Open AdsPower
2. Launch your profile with debug port enabled (e.g., 63812)
3. Navigate to your target website and log in

## Step 2: Use Basic Capture

In Claude, use the MCP tool:

```
endpoint-recon: adspower_capture_everything
- adspowerPort: "63812"
- targetUrl: "https://example.com"
- duration: 30
```

## Step 3: Review Output

The tool will generate:
- `endpoints-example-com.md` - Human-readable documentation
- `endpoints-example-com.json` - Machine-readable data

## Example Output Structure

```markdown
# 📡 API Endpoints Documentation

**Domain:** example.com
**Total Endpoints:** 23

## 🔐 Authentication Tokens
Authorization=Bearer eyJhbGc...
X-CSRF-Token=abc123...

## 📋 API Endpoints

### POST /api/v1/login
**Headers:**
{
  "Content-Type": "application/json"
}
**Payload:**
{
  "email": "user@example.com",
  "password": "..."
}
```