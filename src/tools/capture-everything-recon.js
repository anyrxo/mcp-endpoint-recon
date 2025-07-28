#!/usr/bin/env node
/**
 * Capture Everything Endpoint Recon - COMPLETE DATA CAPTURE
 * Captures headers, cookies, tokens, payloads, preview data - EVERYTHING
 * Outputs to clean endpoints.md file for code consumption
 */

import { chromium } from 'playwright';
import fs from 'fs/promises';
import { URL } from 'url';

class CaptureEverythingRecon {
  constructor(debugPort) {
    this.debugPort = debugPort;
    this.endpoints = new Map();
    this.domain = null;
    this.cdpClient = null;
    this.authTokens = new Map();
    this.cookies = new Map();
  }

  async connect() {
    console.log(`🎯 Connecting to AdsPower on port ${this.debugPort}...`);
    this.browser = await chromium.connectOverCDP(`http://127.0.0.1:${this.debugPort}`);
    this.context = this.browser.contexts()[0];
    
    const pages = this.context.pages();
    this.page = pages.length > 0 ? pages[0] : await this.context.newPage();
    
    // Setup Chrome DevTools Protocol
    this.cdpClient = await this.page.context().newCDPSession(this.page);
    await this.setupCapture();
  }

  async setupCapture() {
    await this.cdpClient.send('Network.enable');
    await this.cdpClient.send('Page.enable');
    await this.cdpClient.send('Runtime.enable');
    
    // Enable request/response interception for COMPLETE capture
    await this.cdpClient.send('Fetch.enable', {
      patterns: [{ urlPattern: '*' }]
    });
    
    // Capture network events
    this.cdpClient.on('Network.requestWillBeSentExtraInfo', (params) => {
      this.captureRequestHeaders(params);
    });
    
    this.cdpClient.on('Network.responseReceivedExtraInfo', (params) => {
      this.captureResponseHeaders(params);
    });
    
    this.cdpClient.on('Network.requestWillBeSent', (params) => {
      this.captureRequest(params);
    });
    
    this.cdpClient.on('Network.responseReceived', (params) => {
      this.captureResponse(params);
    });
    
    this.cdpClient.on('Network.loadingFinished', async (params) => {
      await this.captureResponseBody(params);
    });
    
    // Continue all requests
    this.cdpClient.on('Fetch.requestPaused', async (params) => {
      await this.cdpClient.send('Fetch.continueRequest', {
        requestId: params.requestId
      });
    });
  }

  captureRequest(params) {
    const { request, requestId, type, initiator } = params;
    const url = request.url;
    
    // Filter only Fetch/XHR requests
    if (type !== 'Fetch' && type !== 'XHR') return;
    
    // Skip non-HTTP URLs
    if (!url.startsWith('http')) return;
    
    try {
      const urlObj = new URL(url);
      
      // Set domain on first API request
      if (!this.domain && (url.includes('/api/') || url.includes('/trpc/'))) {
        this.domain = urlObj.hostname;
        console.log(`🌐 Target domain: ${this.domain}`);
      }
      
      // Create unique key
      const key = `${request.method} ${urlObj.pathname}${urlObj.search}`;
      
      if (!this.endpoints.has(key)) {
        this.endpoints.set(key, {
          method: request.method,
          url: url,
          path: urlObj.pathname,
          query: Object.fromEntries(urlObj.searchParams),
          requests: [],
          responses: [],
          headers: {},
          cookies: [],
          tokens: new Set(),
          payloads: [],
          previewData: [],
          timing: []
        });
      }
      
      const endpoint = this.endpoints.get(key);
      
      // Capture request details
      const requestData = {
        requestId,
        timestamp: new Date().toISOString(),
        headers: request.headers,
        postData: request.postData,
        hasUserGesture: request.hasUserGesture,
        initiator: initiator?.type || 'unknown'
      };
      
      endpoint.requests.push(requestData);
      
      // Extract tokens from headers
      this.extractTokensFromHeaders(request.headers, endpoint);
      
      // Capture POST data
      if (request.postData) {
        try {
          const parsed = JSON.parse(request.postData);
          endpoint.payloads.push({
            timestamp: requestData.timestamp,
            data: parsed
          });
          this.extractTokensFromPayload(parsed, endpoint);
        } catch {
          endpoint.payloads.push({
            timestamp: requestData.timestamp,
            raw: request.postData
          });
        }
      }
      
    } catch (e) {
      console.error('Error capturing request:', e);
    }
  }

  captureRequestHeaders(params) {
    const { requestId, headers, associatedCookies } = params;
    
    // Store headers for request
    if (headers) {
      for (const [_, endpoint] of this.endpoints) {
        const request = endpoint.requests.find(r => r.requestId === requestId);
        if (request) {
          // Merge with extra headers
          Object.assign(request.headers, headers);
          
          // Capture cookies sent
          if (associatedCookies && associatedCookies.length > 0) {
            endpoint.cookies = associatedCookies.map(c => ({
              name: c.cookie.name,
              value: c.cookie.value.substring(0, 50) + '...',
              domain: c.cookie.domain,
              path: c.cookie.path
            }));
          }
          break;
        }
      }
    }
  }

  captureResponse(params) {
    const { response, requestId, type } = params;
    
    if (type !== 'Fetch' && type !== 'XHR') return;
    
    // Find matching endpoint
    for (const [_, endpoint] of this.endpoints) {
      const request = endpoint.requests.find(r => r.requestId === requestId);
      if (request) {
        endpoint.responses.push({
          requestId,
          timestamp: new Date().toISOString(),
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          mimeType: response.mimeType,
          fromCache: response.fromCache
        });
        break;
      }
    }
  }

  captureResponseHeaders(params) {
    const { requestId, headers, statusCode } = params;
    
    // Update response with extra headers
    for (const [_, endpoint] of this.endpoints) {
      const response = endpoint.responses.find(r => r.requestId === requestId);
      if (response) {
        response.extraHeaders = headers;
        response.statusCode = statusCode;
        
        // Extract tokens from response headers
        this.extractTokensFromHeaders(headers, endpoint);
        break;
      }
    }
  }

  async captureResponseBody(params) {
    const { requestId } = params;
    
    try {
      const response = await this.cdpClient.send('Network.getResponseBody', { requestId });
      
      // Find matching endpoint
      for (const [_, endpoint] of this.endpoints) {
        const resp = endpoint.responses.find(r => r.requestId === requestId);
        if (resp) {
          if (!response.base64Encoded) {
            try {
              const parsed = JSON.parse(response.body);
              resp.body = parsed;
              
              // Extract preview data (first 200 chars or key fields)
              const preview = this.extractPreviewData(parsed);
              endpoint.previewData.push({
                timestamp: resp.timestamp,
                preview,
                fullDataAvailable: true
              });
              
              // Extract tokens from response
              this.extractTokensFromPayload(parsed, endpoint);
              
            } catch {
              resp.bodyText = response.body.substring(0, 500);
              endpoint.previewData.push({
                timestamp: resp.timestamp,
                preview: resp.bodyText.substring(0, 200) + '...',
                fullDataAvailable: false
              });
            }
          }
          break;
        }
      }
    } catch (e) {
      // Body might not be available
    }
  }

  extractTokensFromHeaders(headers, endpoint) {
    if (!headers) return;
    
    const tokenHeaders = [
      'authorization', 'x-auth-token', 'x-csrf-token', 'x-api-key',
      'x-access-token', 'x-session-token', 'cookie'
    ];
    
    for (const [key, value] of Object.entries(headers)) {
      const lowerKey = key.toLowerCase();
      if (tokenHeaders.includes(lowerKey)) {
        if (lowerKey === 'cookie') {
          // Parse cookies
          const cookies = value.split(';').map(c => c.trim());
          cookies.forEach(cookie => {
            const [name, val] = cookie.split('=');
            if (name && val) {
              endpoint.tokens.add(`cookie.${name}=${val.substring(0, 30)}...`);
            }
          });
        } else {
          endpoint.tokens.add(`${key}=${value.substring(0, 50)}...`);
        }
      }
    }
  }

  extractTokensFromPayload(payload, endpoint) {
    if (!payload || typeof payload !== 'object') return;
    
    const tokenKeys = ['token', 'access_token', 'refresh_token', 'api_key', 'session_id', 'auth'];
    
    const searchObject = (obj, path = '') => {
      for (const [key, value] of Object.entries(obj)) {
        if (tokenKeys.some(tk => key.toLowerCase().includes(tk)) && typeof value === 'string') {
          endpoint.tokens.add(`payload.${path}${key}=${value.substring(0, 30)}...`);
        }
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          searchObject(value, `${path}${key}.`);
        }
      }
    };
    
    searchObject(payload);
  }

  extractPreviewData(data) {
    if (!data || typeof data !== 'object') return JSON.stringify(data).substring(0, 200);
    
    // Smart preview extraction
    const preview = {};
    const importantKeys = ['id', 'name', 'title', 'message', 'data', 'results', 'items', 'status', 'error'];
    
    for (const key of importantKeys) {
      if (data[key] !== undefined) {
        if (typeof data[key] === 'string') {
          preview[key] = data[key].substring(0, 100);
        } else if (Array.isArray(data[key])) {
          preview[key] = `Array(${data[key].length})`;
          if (data[key].length > 0) {
            preview[`${key}[0]`] = typeof data[key][0] === 'object' 
              ? '{...}' 
              : String(data[key][0]).substring(0, 50);
          }
        } else if (typeof data[key] === 'object') {
          preview[key] = '{...}';
        } else {
          preview[key] = data[key];
        }
      }
    }
    
    // If no important keys found, just show first few keys
    if (Object.keys(preview).length === 0) {
      Object.entries(data).slice(0, 5).forEach(([key, value]) => {
        preview[key] = typeof value === 'object' ? '{...}' : String(value).substring(0, 50);
      });
    }
    
    return preview;
  }

  async performCapture(targetUrl, duration = 30000) {
    console.log(`\n🚀 Starting comprehensive capture on ${targetUrl}...\n`);
    
    this.domain = new URL(targetUrl).hostname;
    
    // Navigate to target
    await this.page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    
    // Get initial cookies
    const cookies = await this.page.context().cookies();
    cookies.forEach(cookie => {
      this.cookies.set(cookie.name, cookie);
    });
    
    const startTime = Date.now();
    let actionsPerformed = 0;
    
    while (Date.now() - startTime < duration) {
      // Interact with the page to trigger API calls
      await this.interactWithPage();
      actionsPerformed++;
      
      await this.page.waitForTimeout(2000);
      
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      console.log(`⏱️ ${elapsed}s | 📡 ${this.endpoints.size} endpoints | 🎯 ${actionsPerformed} actions`);
    }
    
    console.log(`\n✅ Capture complete! Found ${this.endpoints.size} API endpoints\n`);
  }

  async interactWithPage() {
    try {
      // Scroll to trigger lazy loading
      await this.page.evaluate(() => {
        window.scrollBy(0, window.innerHeight * 0.5);
      });
      
      // Click interactive elements
      await this.page.evaluate(() => {
        // Click buttons
        const buttons = document.querySelectorAll('button:not([disabled])');
        if (buttons.length > 0) {
          const randomButton = buttons[Math.floor(Math.random() * Math.min(3, buttons.length))];
          try { randomButton.click(); } catch {}
        }
        
        // Expand dropdowns
        const dropdowns = document.querySelectorAll('[aria-expanded="false"], .dropdown-toggle');
        dropdowns.forEach(dropdown => {
          try { dropdown.click(); } catch {}
        });
        
        // Hover over elements
        const hoverables = document.querySelectorAll('[data-hover], [title]');
        if (hoverables.length > 0) {
          const el = hoverables[Math.floor(Math.random() * Math.min(3, hoverables.length))];
          el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        }
      });
    } catch {}
  }

  generateMarkdown() {
    const timestamp = new Date().toISOString();
    const filename = `endpoints-${this.domain.replace(/\./g, '-')}.md`;
    
    let md = `# 📡 API Endpoints Documentation\n\n`;
    md += `**Domain:** ${this.domain}  \n`;
    md += `**Captured:** ${timestamp}  \n`;
    md += `**Total Endpoints:** ${this.endpoints.size}  \n\n`;
    
    // Global auth tokens
    const allTokens = new Set();
    this.endpoints.forEach(ep => {
      ep.tokens.forEach(token => allTokens.add(token));
    });
    
    if (allTokens.size > 0) {
      md += `## 🔐 Authentication Tokens\n\n`;
      md += `\`\`\`\n`;
      Array.from(allTokens).forEach(token => {
        md += `${token}\n`;
      });
      md += `\`\`\`\n\n`;
    }
    
    // Session cookies
    if (this.cookies.size > 0) {
      md += `## 🍪 Important Cookies\n\n`;
      md += `| Name | Domain | Value (truncated) |\n`;
      md += `|------|--------|------------------|\n`;
      
      Array.from(this.cookies.values())
        .filter(c => c.httpOnly || c.name.includes('session') || c.name.includes('auth'))
        .slice(0, 10)
        .forEach(cookie => {
          const value = cookie.value ? cookie.value.substring(0, 30) + '...' : 'N/A';
          md += `| ${cookie.name} | ${cookie.domain} | ${value} |\n`;
        });
      md += `\n`;
    }
    
    // Endpoints grouped by path pattern
    md += `## 📋 API Endpoints\n\n`;
    
    // Group by base path
    const grouped = new Map();
    this.endpoints.forEach((endpoint, key) => {
      const basePath = endpoint.path.split('/').slice(0, 3).join('/');
      if (!grouped.has(basePath)) {
        grouped.set(basePath, []);
      }
      grouped.get(basePath).push({ key, endpoint });
    });
    
    // Sort groups by importance (tRPC, API, etc)
    const sortedGroups = Array.from(grouped.entries()).sort(([a], [b]) => {
      if (a.includes('trpc')) return -1;
      if (b.includes('trpc')) return 1;
      if (a.includes('api')) return -1;
      if (b.includes('api')) return 1;
      return a.localeCompare(b);
    });
    
    sortedGroups.forEach(([basePath, endpoints]) => {
      md += `### ${basePath}\n\n`;
      
      endpoints.forEach(({ key, endpoint }) => {
        md += `#### ${endpoint.method} ${endpoint.path}\n\n`;
        
        // Query parameters
        if (Object.keys(endpoint.query).length > 0) {
          md += `**Query Parameters:**\n\`\`\`json\n${JSON.stringify(endpoint.query, null, 2)}\n\`\`\`\n\n`;
        }
        
        // Request headers (important ones)
        const importantHeaders = {};
        const headerKeys = ['content-type', 'authorization', 'x-csrf-token', 'x-api-key'];
        
        if (endpoint.requests.length > 0) {
          const headers = endpoint.requests[0].headers;
          headerKeys.forEach(key => {
            if (headers[key]) {
              importantHeaders[key] = headers[key];
            }
          });
          
          if (Object.keys(importantHeaders).length > 0) {
            md += `**Headers:**\n\`\`\`json\n${JSON.stringify(importantHeaders, null, 2)}\n\`\`\`\n\n`;
          }
        }
        
        // Request payload
        if (endpoint.payloads.length > 0) {
          md += `**Request Payload:**\n\`\`\`json\n`;
          const payload = endpoint.payloads[0].data || endpoint.payloads[0].raw;
          const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
          md += payloadStr.length > 1000 ? payloadStr.substring(0, 1000) + '\n...' : payloadStr;
          md += `\n\`\`\`\n\n`;
        }
        
        // Response preview
        if (endpoint.previewData.length > 0) {
          md += `**Response Preview:**\n\`\`\`json\n`;
          const preview = endpoint.previewData[0].preview;
          const previewStr = typeof preview === 'string' ? preview : JSON.stringify(preview, null, 2);
          md += previewStr;
          md += `\n\`\`\`\n\n`;
        }
        
        // Response status
        if (endpoint.responses.length > 0) {
          const resp = endpoint.responses[0];
          md += `**Status:** ${resp.status} ${resp.statusText}\n\n`;
        }
        
        // Full example URL
        md += `**Full URL Example:**\n\`\`\`\n${endpoint.url}\n\`\`\`\n\n`;
        
        md += `---\n\n`;
      });
    });
    
    // Usage examples
    md += `## 💻 Usage Examples\n\n`;
    md += `### Python Request Example\n\n`;
    md += `\`\`\`python\nimport requests\nimport json\n\n`;
    md += `# Headers with authentication\nheaders = {\n`;
    
    // Add discovered auth headers
    let hasAuth = false;
    this.endpoints.forEach(endpoint => {
      if (endpoint.requests.length > 0) {
        const headers = endpoint.requests[0].headers;
        if (headers.authorization) {
          md += `    'Authorization': '${headers.authorization}',\n`;
          hasAuth = true;
        }
        if (headers['x-csrf-token']) {
          md += `    'X-CSRF-Token': '${headers['x-csrf-token']}',\n`;
          hasAuth = true;
        }
      }
    });
    
    md += `    'Content-Type': 'application/json',\n`;
    md += `    'Accept': 'application/json'\n`;
    md += `}\n\n`;
    
    // Example API call
    const firstEndpoint = Array.from(this.endpoints.values())[0];
    if (firstEndpoint) {
      md += `# Example API call\n`;
      md += `response = requests.${firstEndpoint.method.toLowerCase()}(\n`;
      md += `    '${firstEndpoint.url}',\n`;
      md += `    headers=headers`;
      if (firstEndpoint.payloads.length > 0) {
        md += `,\n    json=${JSON.stringify(firstEndpoint.payloads[0].data || {})}`;
      }
      md += `\n)\n\n`;
      md += `print(response.json())\n`;
    }
    
    md += `\`\`\`\n\n`;
    
    // JavaScript/Fetch example
    md += `### JavaScript/Fetch Example\n\n`;
    md += `\`\`\`javascript\n`;
    md += `const headers = {\n`;
    if (hasAuth) {
      this.endpoints.forEach(endpoint => {
        if (endpoint.requests.length > 0) {
          const headers = endpoint.requests[0].headers;
          if (headers.authorization) {
            md += `  'Authorization': '${headers.authorization}',\n`;
            return;
          }
        }
      });
    }
    md += `  'Content-Type': 'application/json',\n`;
    md += `  'Accept': 'application/json'\n`;
    md += `};\n\n`;
    
    if (firstEndpoint) {
      md += `// Example API call\n`;
      md += `fetch('${firstEndpoint.url}', {\n`;
      md += `  method: '${firstEndpoint.method}',\n`;
      md += `  headers: headers`;
      if (firstEndpoint.payloads.length > 0) {
        md += `,\n  body: JSON.stringify(${JSON.stringify(firstEndpoint.payloads[0].data || {})})`;
      }
      md += `\n})\n`;
      md += `.then(response => response.json())\n`;
      md += `.then(data => console.log(data));\n`;
    }
    
    md += `\`\`\`\n\n`;
    
    md += `---\n\n`;
    md += `*Generated by Capture Everything Recon*\n`;
    
    return { markdown: md, filename };
  }

  async saveReport() {
    const { markdown, filename } = this.generateMarkdown();
    
    await fs.writeFile(filename, markdown);
    console.log(`\n📄 Report saved to ${filename}`);
    
    // Also save raw JSON for programmatic use
    const jsonData = {
      domain: this.domain,
      capturedAt: new Date().toISOString(),
      endpoints: Object.fromEntries(
        Array.from(this.endpoints.entries()).map(([key, endpoint]) => [
          key,
          {
            ...endpoint,
            tokens: Array.from(endpoint.tokens),
            requests: endpoint.requests.slice(-3), // Last 3 requests
            responses: endpoint.responses.slice(-3) // Last 3 responses
          }
        ])
      ),
      cookies: Object.fromEntries(this.cookies),
      authTokens: Array.from(this.authTokens)
    };
    
    const jsonFile = filename.replace('.md', '.json');
    await fs.writeFile(jsonFile, JSON.stringify(jsonData, null, 2));
    console.log(`📦 Raw data saved to ${jsonFile}`);
  }
}

// Main execution
async function main() {
  const debugPort = process.argv[2] || '63812';
  const targetUrl = process.argv[3] || 'https://fanvue.com/';
  const duration = parseInt(process.argv[4]) || 30; // seconds
  
  console.log('🎯 Capture Everything Endpoint Recon');
  console.log('📡 Captures headers, cookies, tokens, payloads, and preview data');
  console.log(`🔌 AdsPower Port: ${debugPort}`);
  console.log(`🌐 Target: ${targetUrl}`);
  console.log(`⏱️ Duration: ${duration} seconds`);
  
  const recon = new CaptureEverythingRecon(debugPort);
  await recon.connect();
  
  await recon.performCapture(targetUrl, duration * 1000);
  await recon.saveReport();
  
  console.log('\n✨ Capture complete! Check the endpoints.md file for organized documentation.');
}

main().catch(console.error);