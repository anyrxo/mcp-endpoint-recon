#!/usr/bin/env node
/**
 * Ultimate DevTools Endpoint Recon
 * By Joyce 👑😈 - Uses Chrome DevTools Protocol for COMPLETE capture
 */

import { chromium } from 'playwright';
import fs from 'fs/promises';
import { URL } from 'url';

class UltimateDevToolsRecon {
  constructor(debugPort) {
    this.debugPort = debugPort;
    this.endpoints = new Map();
    this.trpcCalls = new Map();
    this.cookies = new Map();
    this.localStorage = {};
    this.sessionStorage = {};
    this.authTokens = {};
    this.networkRequests = [];
    this.consoleMessages = [];
    this.wsMessages = [];
    this.performanceMetrics = {};
    this.domain = null;
  }

  async connect() {
    console.log(`🔌 Connecting to AdsPower DevTools on port ${this.debugPort}...`);
    this.browser = await chromium.connectOverCDP(`http://127.0.0.1:${this.debugPort}`);
    this.context = this.browser.contexts()[0];
    
    // Get the first page or create one
    const pages = this.context.pages();
    this.page = pages.length > 0 ? pages[0] : await this.context.newPage();
    
    // Enable DevTools domains
    this.client = await this.page.context().newCDPSession(this.page);
    await this.setupDevToolsCapture();
  }

  async setupDevToolsCapture() {
    // Enable all DevTools domains we need
    await this.client.send('Network.enable');
    await this.client.send('Runtime.enable');
    await this.client.send('Console.enable');
    await this.client.send('Page.enable');
    await this.client.send('Security.setIgnoreCertificateErrors', { ignore: true });
    
    // Capture ALL network traffic with DevTools
    this.client.on('Network.requestWillBeSent', (params) => {
      this.captureRequest(params);
    });
    
    this.client.on('Network.responseReceived', (params) => {
      this.captureResponse(params);
    });
    
    this.client.on('Network.loadingFinished', async (params) => {
      await this.captureResponseBody(params);
    });
    
    // Capture WebSocket traffic
    this.client.on('Network.webSocketCreated', (params) => {
      console.log(`🔌 WebSocket created: ${params.url}`);
    });
    
    this.client.on('Network.webSocketFrameSent', (params) => {
      this.wsMessages.push({ type: 'sent', ...params });
    });
    
    this.client.on('Network.webSocketFrameReceived', (params) => {
      this.wsMessages.push({ type: 'received', ...params });
    });
    
    // Capture console messages
    this.client.on('Console.messageAdded', (params) => {
      this.consoleMessages.push(params.message);
    });
    
    // Intercept and modify requests if needed
    await this.client.send('Fetch.enable', {
      patterns: [{ urlPattern: '*' }]
    });
    
    this.client.on('Fetch.requestPaused', async (params) => {
      // We can modify requests here if needed
      await this.client.send('Fetch.continueRequest', {
        requestId: params.requestId
      });
    });
  }

  captureRequest(params) {
    const { request, requestId, timestamp, initiator } = params;
    const url = request.url;
    
    // Skip browser internal URLs
    if (url.startsWith('chrome-extension://') || url.startsWith('chrome://')) return;
    
    try {
      const urlObj = new URL(url);
      
      // For first request, set the domain
      if (!this.domain && !url.includes('fvcdn.com')) {
        this.domain = urlObj.hostname;
      }
      
      // Create endpoint key
      const endpointPattern = this.extractEndpointPattern(urlObj);
      const key = `${request.method} ${endpointPattern}`;
      
      if (!this.endpoints.has(key)) {
        this.endpoints.set(key, {
          pattern: endpointPattern,
          method: request.method,
          examples: [],
          category: this.categorizeEndpoint(urlObj),
          headers: request.headers,
          requestData: [],
          responses: [],
          initiators: new Set(),
          timing: { first: timestamp }
        });
      }
      
      const endpoint = this.endpoints.get(key);
      
      // Add unique example
      if (!endpoint.examples.includes(url)) {
        endpoint.examples.push(url);
      }
      
      // Track initiator
      if (initiator && initiator.type) {
        endpoint.initiators.add(initiator.type);
      }
      
      // Capture request data
      if (request.postData) {
        const parsedData = this.parsePayload(request.postData);
        endpoint.requestData.push({
          timestamp,
          requestId,
          data: parsedData,
          raw: request.postData
        });
        
        // Extract auth tokens
        this.extractAuthFromPayload(parsedData);
      }
      
      // Special handling for tRPC calls
      if (url.includes('/trpc/')) {
        this.captureTRPCCall(urlObj, request);
      }
      
      // Extract auth from headers
      this.extractAuthFromHeaders(request.headers);
      
      // Store full request for detailed analysis
      this.networkRequests.push({
        requestId,
        timestamp,
        url,
        method: request.method,
        headers: request.headers,
        postData: request.postData,
        initiator
      });
      
    } catch (e) {
      // Ignore URL parsing errors
    }
  }

  captureResponse(params) {
    const { response, requestId, timestamp } = params;
    const url = response.url;
    
    if (url.startsWith('chrome-extension://') || url.startsWith('chrome://')) return;
    
    try {
      const urlObj = new URL(url);
      const endpointPattern = this.extractEndpointPattern(urlObj);
      const key = `${response.requestMethod || 'GET'} ${endpointPattern}`;
      
      if (this.endpoints.has(key)) {
        const endpoint = this.endpoints.get(key);
        endpoint.responses.push({
          requestId,
          timestamp,
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          mimeType: response.mimeType,
          timing: response.timing
        });
      }
    } catch (e) {
      // Ignore errors
    }
  }

  async captureResponseBody(params) {
    const { requestId } = params;
    
    try {
      const response = await this.client.send('Network.getResponseBody', { requestId });
      
      if (response.base64Encoded) {
        // Handle binary data if needed
        return;
      }
      
      // Find the request
      const request = this.networkRequests.find(r => r.requestId === requestId);
      if (!request) return;
      
      const urlObj = new URL(request.url);
      const endpointPattern = this.extractEndpointPattern(urlObj);
      const key = `${request.method} ${endpointPattern}`;
      
      if (this.endpoints.has(key)) {
        const endpoint = this.endpoints.get(key);
        
        // Find matching response and add body
        const matchingResponse = endpoint.responses.find(r => r.requestId === requestId);
        if (matchingResponse) {
          try {
            matchingResponse.body = JSON.parse(response.body);
            
            // Extract auth tokens from response
            this.extractAuthFromResponse(matchingResponse.body);
            
            // Special handling for media URLs
            if (matchingResponse.body.processed_url || matchingResponse.body.blur_preview_url) {
              this.extractMediaUrls(matchingResponse.body);
            }
          } catch {
            matchingResponse.body = response.body;
          }
        }
      }
    } catch (e) {
      // Response body might not be available
    }
  }

  captureTRPCCall(urlObj, request) {
    const pathname = urlObj.pathname;
    const match = pathname.match(/\/trpc\/([^?]+)/);
    
    if (match) {
      const procedure = match[1];
      const input = urlObj.searchParams.get('input');
      
      if (!this.trpcCalls.has(procedure)) {
        this.trpcCalls.set(procedure, {
          procedure,
          examples: [],
          category: this.categorizeTRPCProcedure(procedure)
        });
      }
      
      const trpc = this.trpcCalls.get(procedure);
      
      if (input) {
        try {
          const decoded = decodeURIComponent(input);
          const parsed = JSON.parse(decoded);
          trpc.examples.push({
            input: parsed,
            url: urlObj.href,
            timestamp: new Date().toISOString()
          });
        } catch {
          trpc.examples.push({
            rawInput: input,
            url: urlObj.href,
            timestamp: new Date().toISOString()
          });
        }
      }
    }
  }

  extractEndpointPattern(urlObj) {
    let path = urlObj.pathname;
    
    // More comprehensive pattern replacements
    path = path.replace(/\/\d+/g, '/{id}');
    path = path.replace(/\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/g, '/{uuid}');
    path = path.replace(/\/[a-zA-Z0-9]{20,}/g, '/{token}');
    path = path.replace(/\/@[\w\d_.-]+/g, '/@{username}');
    path = path.replace(/\/p\/[\w\d]+/g, '/p/{postId}');
    path = path.replace(/\/[a-f0-9]{24}/g, '/{objectId}'); // MongoDB ObjectIds
    path = path.replace(/\/(tmp|temp)\/[^/]+/g, '/{temp}/{file}');
    
    return `${urlObj.protocol}//${urlObj.hostname}${path}`;
  }

  categorizeEndpoint(urlObj) {
    const path = urlObj.pathname.toLowerCase();
    const hostname = urlObj.hostname.toLowerCase();
    
    // CDN detection
    if (hostname.includes('cdn') || hostname.includes('media') || hostname.includes('static')) {
      return 'CDN/Media';
    }
    
    // tRPC
    if (path.includes('/trpc/')) return 'tRPC';
    
    // API patterns
    if (path.includes('/api/')) return 'API';
    if (path.includes('/graphql')) return 'GraphQL';
    if (path.includes('/rest/')) return 'REST';
    
    // Auth
    if (path.includes('/auth') || path.includes('/login') || path.includes('/oauth')) return 'Authentication';
    
    // User
    if (path.includes('/user') || path.includes('/profile') || path.includes('/account')) return 'User';
    
    // Content
    if (path.includes('/post') || path.includes('/media') || path.includes('/content')) return 'Content';
    if (path.includes('/feed') || path.includes('/timeline')) return 'Feed';
    
    // Engagement
    if (path.includes('/like') || path.includes('/comment') || path.includes('/share')) return 'Engagement';
    if (path.includes('/message') || path.includes('/chat') || path.includes('/conversation')) return 'Messaging';
    
    // Commerce
    if (path.includes('/payment') || path.includes('/subscription') || path.includes('/tip')) return 'Payments';
    if (path.includes('/bundle') || path.includes('/product')) return 'Commerce';
    
    // Analytics
    if (path.includes('/analytics') || path.includes('/track') || path.includes('/log')) return 'Analytics';
    
    // Static
    if (path.match(/\.(js|css|png|jpg|jpeg|gif|svg|woff|woff2|mp4|webm)$/)) return 'Static';
    
    return 'Other';
  }

  categorizeTRPCProcedure(procedure) {
    const lower = procedure.toLowerCase();
    
    if (lower.includes('user')) return 'User';
    if (lower.includes('post')) return 'Content';
    if (lower.includes('message')) return 'Messaging';
    if (lower.includes('payment') || lower.includes('subscription')) return 'Payments';
    if (lower.includes('feed')) return 'Feed';
    if (lower.includes('auth')) return 'Authentication';
    if (lower.includes('media')) return 'Media';
    if (lower.includes('bundle')) return 'Commerce';
    
    return 'Other';
  }

  parsePayload(data) {
    if (!data) return null;
    
    try {
      return JSON.parse(data);
    } catch {
      try {
        const params = new URLSearchParams(data);
        const obj = {};
        params.forEach((value, key) => {
          try {
            obj[key] = JSON.parse(value);
          } catch {
            obj[key] = value;
          }
        });
        return obj;
      } catch {
        return data;
      }
    }
  }

  extractAuthFromPayload(payload) {
    if (!payload || typeof payload !== 'object') return;
    
    const authKeys = [
      'token', 'auth', 'csrf', 'api_key', 'access_token', 'refresh_token',
      'session', 'jwt', 'bearer', 'apikey', 'x-auth-token'
    ];
    
    const searchObject = (obj, path = '') => {
      for (const [key, value] of Object.entries(obj)) {
        const currentPath = path ? `${path}.${key}` : key;
        
        if (authKeys.some(ak => key.toLowerCase().includes(ak))) {
          this.authTokens[currentPath] = value;
        }
        
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          searchObject(value, currentPath);
        }
      }
    };
    
    searchObject(payload);
  }

  extractAuthFromHeaders(headers) {
    if (!headers) return;
    
    const authHeaders = [
      'authorization', 'x-auth-token', 'x-csrf-token', 'x-api-key',
      'cookie', 'x-access-token', 'x-session-token'
    ];
    
    for (const [key, value] of Object.entries(headers)) {
      if (authHeaders.includes(key.toLowerCase())) {
        this.authTokens[`header.${key}`] = value;
        
        // Parse cookies
        if (key.toLowerCase() === 'cookie') {
          this.parseCookies(value);
        }
      }
    }
  }

  extractAuthFromResponse(data) {
    if (!data || typeof data !== 'object') return;
    
    // Direct token fields
    const tokenFields = [
      'access_token', 'refresh_token', 'token', 'jwt', 'sessionToken',
      'authToken', 'apiKey', 'csrf', 'csrfToken'
    ];
    
    for (const field of tokenFields) {
      if (data[field]) {
        this.authTokens[`response.${field}`] = data[field];
      }
    }
    
    // Nested auth objects
    if (data.auth) this.extractAuthFromPayload(data.auth);
    if (data.authentication) this.extractAuthFromPayload(data.authentication);
    if (data.credentials) this.extractAuthFromPayload(data.credentials);
  }

  extractMediaUrls(data) {
    if (data.processed_url) {
      console.log(`📹 Media URL found: ${data.processed_url.substring(0, 50)}...`);
    }
    if (data.blur_preview_url) {
      console.log(`🖼️ Preview URL found: ${data.blur_preview_url.substring(0, 50)}...`);
    }
    if (data.thumbnails && Array.isArray(data.thumbnails)) {
      console.log(`🖼️ Found ${data.thumbnails.length} thumbnails`);
    }
  }

  parseCookies(cookieString) {
    if (!cookieString) return;
    
    const cookies = cookieString.split(';').map(c => c.trim());
    for (const cookie of cookies) {
      const [name, value] = cookie.split('=');
      if (name && value) {
        this.cookies.set(name.trim(), {
          name: name.trim(),
          value: value.trim(),
          source: 'header'
        });
      }
    }
  }

  async discoverWithDevTools(startUrl, options = {}) {
    const { 
      duration = 60000, // Run for 60 seconds by default
      autoInteract = true,
      captureEverything = true 
    } = options;
    
    this.domain = new URL(startUrl).hostname;
    console.log(`\n🎯 DevTools recon on ${this.domain} for ${duration/1000} seconds...\n`);
    
    // Navigate to start URL
    await this.page.goto(startUrl, { waitUntil: 'domcontentloaded' });
    
    // Extract initial data
    await this.extractPageData();
    
    // Start performance monitoring
    await this.startPerformanceMonitoring();
    
    // Run discovery for specified duration
    const startTime = Date.now();
    let actionsPerformed = 0;
    
    while (Date.now() - startTime < duration) {
      if (autoInteract) {
        await this.performSmartActions();
        actionsPerformed++;
      }
      
      // Check console for errors
      this.checkConsoleErrors();
      
      // Wait a bit
      await this.page.waitForTimeout(3000);
      
      // Show progress
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      console.log(`⏱️ ${elapsed}s elapsed | 📡 ${this.endpoints.size} endpoints | 🔄 ${actionsPerformed} actions`);
    }
    
    // Final data extraction
    await this.extractPageData();
    console.log(`\n✅ Discovery complete! Found ${this.endpoints.size} unique endpoints`);
  }

  async extractPageData() {
    // Get cookies from DevTools
    const { cookies } = await this.client.send('Network.getCookies');
    cookies.forEach(cookie => {
      this.cookies.set(cookie.name, cookie);
    });
    
    // Extract storage using Runtime.evaluate
    const storageScript = `
      ({
        localStorage: Object.fromEntries(
          Array.from({ length: localStorage.length }, (_, i) => {
            const key = localStorage.key(i);
            return [key, localStorage.getItem(key)];
          })
        ),
        sessionStorage: Object.fromEntries(
          Array.from({ length: sessionStorage.length }, (_, i) => {
            const key = sessionStorage.key(i);
            return [key, sessionStorage.getItem(key)];
          })
        ),
        // Extract any global auth objects
        globalAuth: {
          __auth: window.__auth || null,
          __user: window.__user || null,
          __csrf: window.__csrf || null
        }
      })
    `;
    
    const { result } = await this.client.send('Runtime.evaluate', {
      expression: storageScript,
      returnByValue: true
    });
    
    if (result.value) {
      this.localStorage = result.value.localStorage;
      this.sessionStorage = result.value.sessionStorage;
      
      // Extract global auth
      if (result.value.globalAuth) {
        Object.entries(result.value.globalAuth).forEach(([key, value]) => {
          if (value) this.authTokens[`global.${key}`] = value;
        });
      }
    }
  }

  async performSmartActions() {
    // Get current URL to determine context
    const currentUrl = this.page.url();
    
    // Scroll to trigger lazy loading
    await this.page.evaluate(() => {
      window.scrollBy(0, window.innerHeight * 0.5);
    });
    
    // Smart element interaction based on what's visible
    const interactionScript = `
      (() => {
        const actions = [];
        
        // Find expandable elements
        const expandables = document.querySelectorAll(
          '[data-toggle], [aria-expanded="false"], .show-more, .load-more, ' +
          '.dropdown-toggle, .accordion-button, [role="button"]'
        );
        
        if (expandables.length > 0) {
          const el = expandables[Math.floor(Math.random() * Math.min(3, expandables.length))];
          el.click();
          actions.push('Clicked expandable element');
        }
        
        // Find tabs or navigation
        const tabs = document.querySelectorAll(
          '[role="tab"], .nav-link, .tab-button, [data-tab]'
        );
        
        if (tabs.length > 0) {
          const tab = tabs[Math.floor(Math.random() * Math.min(3, tabs.length))];
          tab.click();
          actions.push('Clicked tab');
        }
        
        // Trigger hover events
        const hoverables = document.querySelectorAll('[data-hover], [title], [data-tooltip]');
        if (hoverables.length > 0) {
          const el = hoverables[Math.floor(Math.random() * Math.min(3, hoverables.length))];
          el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
          actions.push('Triggered hover');
        }
        
        return actions;
      })()
    `;
    
    try {
      const { result } = await this.client.send('Runtime.evaluate', {
        expression: interactionScript,
        returnByValue: true
      });
      
      if (result.value && result.value.length > 0) {
        console.log(`🎯 Actions: ${result.value.join(', ')}`);
      }
    } catch (e) {
      // Ignore interaction errors
    }
  }

  async startPerformanceMonitoring() {
    // Enable performance metrics
    await this.client.send('Performance.enable');
    
    // Get metrics periodically
    setInterval(async () => {
      try {
        const { metrics } = await this.client.send('Performance.getMetrics');
        this.performanceMetrics = metrics.reduce((acc, metric) => {
          acc[metric.name] = metric.value;
          return acc;
        }, {});
      } catch {}
    }, 5000);
  }

  checkConsoleErrors() {
    const errors = this.consoleMessages.filter(msg => msg.level === 'error');
    if (errors.length > 0) {
      console.log(`⚠️ Console errors detected: ${errors.length}`);
    }
  }

  generateMarkdown() {
    const timestamp = new Date().toISOString();
    
    let md = `# 🔍 Ultimate DevTools Endpoint Reconnaissance Report\n\n`;
    md += `**Target Domain:** ${this.domain}  \n`;
    md += `**Scan Date:** ${timestamp}  \n`;
    md += `**Total Network Requests:** ${this.networkRequests.length}  \n`;
    md += `**Unique Endpoints:** ${this.endpoints.size}  \n`;
    md += `**tRPC Procedures:** ${this.trpcCalls.size}  \n`;
    md += `**WebSocket Messages:** ${this.wsMessages.length}  \n`;
    md += `**Console Messages:** ${this.consoleMessages.length}  \n\n`;
    
    // Performance Metrics
    if (Object.keys(this.performanceMetrics).length > 0) {
      md += `## ⚡ Performance Metrics\n\n`;
      md += `| Metric | Value |\n`;
      md += `|--------|-------|\n`;
      const importantMetrics = ['JSHeapUsedSize', 'LayoutCount', 'RecalcStyleCount', 'ScriptDuration'];
      importantMetrics.forEach(metric => {
        if (this.performanceMetrics[metric]) {
          md += `| ${metric} | ${this.performanceMetrics[metric]} |\n`;
        }
      });
      md += `\n`;
    }
    
    // Authentication
    md += `## 🔐 Authentication & Security\n\n`;
    if (Object.keys(this.authTokens).length > 0) {
      md += `### Discovered Tokens & Credentials\n\n`;
      Object.entries(this.authTokens).forEach(([key, value]) => {
        if (typeof value === 'string') {
          const masked = value.length > 40 
            ? value.substring(0, 15) + '...' + value.substring(value.length - 15)
            : value;
          md += `**${key}:** \`${masked}\`  \n`;
        }
      });
      md += `\n`;
    }
    
    md += `### Session Cookies\n\n`;
    const sessionCookies = Array.from(this.cookies.values())
      .filter(c => c.httpOnly || c.name.includes('session') || c.name.includes('auth') || c.name.includes('token'));
    
    if (sessionCookies.length > 0) {
      md += `| Name | Domain | HttpOnly | Secure | SameSite |\n`;
      md += `|------|--------|----------|--------|----------|\n`;
      sessionCookies.forEach(cookie => {
        md += `| ${cookie.name} | ${cookie.domain || 'N/A'} | ${cookie.httpOnly || false} | ${cookie.secure || false} | ${cookie.sameSite || 'None'} |\n`;
      });
      md += `\n`;
    }
    
    // tRPC Procedures
    if (this.trpcCalls.size > 0) {
      md += `## 🔧 tRPC Procedures\n\n`;
      const categorizedTRPC = {};
      
      this.trpcCalls.forEach((trpc, procedure) => {
        if (!categorizedTRPC[trpc.category]) categorizedTRPC[trpc.category] = [];
        categorizedTRPC[trpc.category].push({ procedure, trpc });
      });
      
      Object.entries(categorizedTRPC).forEach(([category, procedures]) => {
        md += `### ${category} Procedures\n\n`;
        procedures.forEach(({ procedure, trpc }) => {
          md += `#### \`${procedure}\`\n\n`;
          if (trpc.examples.length > 0) {
            const example = trpc.examples[0];
            if (example.input) {
              md += `**Input Structure:**\n\`\`\`json\n${JSON.stringify(example.input, null, 2)}\n\`\`\`\n\n`;
            }
            md += `**Example URL:**\n\`\`\`\n${example.url}\n\`\`\`\n\n`;
          }
        });
      });
    }
    
    // API Endpoints by Category
    md += `## 🚀 API Endpoints by Category\n\n`;
    const categorized = {};
    
    this.endpoints.forEach((endpoint, key) => {
      if (!categorized[endpoint.category]) categorized[endpoint.category] = [];
      categorized[endpoint.category].push({ key, endpoint });
    });
    
    // Show API endpoints first
    const apiCategories = ['tRPC', 'API', 'GraphQL', 'REST'];
    
    apiCategories.forEach(cat => {
      if (categorized[cat]) {
        md += `### ${cat} (${categorized[cat].length} endpoints)\n\n`;
        
        categorized[cat].forEach(({ key, endpoint }) => {
          md += `#### ${key}\n\n`;
          md += `**Pattern:** \`${endpoint.pattern}\`  \n`;
          
          if (endpoint.examples.length > 1) {
            md += `**Examples:** ${endpoint.examples.length} variations found  \n`;
          }
          
          if (endpoint.initiators.size > 0) {
            md += `**Initiated by:** ${Array.from(endpoint.initiators).join(', ')}  \n`;
          }
          
          // Show request data
          if (endpoint.requestData.length > 0) {
            const latestRequest = endpoint.requestData[endpoint.requestData.length - 1];
            md += `**Request Payload:**\n\`\`\`json\n`;
            const dataStr = JSON.stringify(latestRequest.data, null, 2);
            md += dataStr.length > 1000 ? dataStr.substring(0, 1000) + '\n...' : dataStr;
            md += `\n\`\`\`\n\n`;
          }
          
          // Show response data
          if (endpoint.responses.length > 0) {
            const latestResponse = endpoint.responses[endpoint.responses.length - 1];
            md += `**Response (${latestResponse.status}):**\n`;
            if (latestResponse.body) {
              md += `\`\`\`json\n`;
              const bodyStr = JSON.stringify(latestResponse.body, null, 2);
              md += bodyStr.length > 1000 ? bodyStr.substring(0, 1000) + '\n...' : bodyStr;
              md += `\n\`\`\`\n`;
            }
            
            // Show timing info
            if (latestResponse.timing) {
              md += `**Response Time:** ${Math.round(latestResponse.timing.receiveHeadersEnd)}ms  \n`;
            }
            md += `\n`;
          }
          
          md += `---\n\n`;
        });
      }
    });
    
    // Console Errors
    const errors = this.consoleMessages.filter(msg => msg.level === 'error');
    if (errors.length > 0) {
      md += `## ⚠️ Console Errors\n\n`;
      errors.slice(0, 10).forEach(error => {
        md += `- **${error.source}:** ${error.text}\n`;
      });
      if (errors.length > 10) {
        md += `- ... and ${errors.length - 10} more errors\n`;
      }
      md += `\n`;
    }
    
    // WebSocket Activity
    if (this.wsMessages.length > 0) {
      md += `## 🔌 WebSocket Activity\n\n`;
      md += `**Total Messages:** ${this.wsMessages.length} (${this.wsMessages.filter(m => m.type === 'sent').length} sent, ${this.wsMessages.filter(m => m.type === 'received').length} received)\n\n`;
    }
    
    // Usage Examples
    md += `## 💡 How to Use These Endpoints\n\n`;
    md += `### Python Example with Discovered Auth\n\n`;
    md += `\`\`\`python\n`;
    md += `import requests\n\n`;
    md += `# Authentication headers\n`;
    md += `headers = {\n`;
    
    // Add discovered auth headers
    const authHeaders = Object.entries(this.authTokens)
      .filter(([k, v]) => k.startsWith('header.') && typeof v === 'string')
      .slice(0, 3);
    
    authHeaders.forEach(([key, value]) => {
      const headerName = key.replace('header.', '');
      md += `    '${headerName}': 'YOUR_${headerName.toUpperCase()}',\n`;
    });
    
    md += `}\n\n`;
    
    // Show tRPC example if available
    if (this.trpcCalls.size > 0) {
      const [procedure, trpc] = Array.from(this.trpcCalls.entries())[0];
      md += `# tRPC call example\n`;
      md += `response = requests.get(\n`;
      md += `    'https://${this.domain}/trpc/${procedure}',\n`;
      md += `    params={'input': json.dumps(${JSON.stringify(trpc.examples[0]?.input || {})})},\n`;
      md += `    headers=headers\n`;
      md += `)\n`;
    }
    
    md += `\`\`\`\n\n`;
    
    // Summary of all endpoints
    md += `## 📊 Endpoint Summary\n\n`;
    Object.entries(categorized).forEach(([category, endpoints]) => {
      md += `- **${category}:** ${endpoints.length} endpoints\n`;
    });
    
    return md;
  }

  async saveReport(filename) {
    const markdown = this.generateMarkdown();
    await fs.writeFile(filename, markdown);
    console.log(`\n✅ DevTools report saved to ${filename}`);
    
    // Save raw data
    const jsonData = {
      domain: this.domain,
      endpoints: Object.fromEntries(this.endpoints),
      trpcCalls: Object.fromEntries(this.trpcCalls),
      cookies: Array.from(this.cookies.values()),
      localStorage: this.localStorage,
      sessionStorage: this.sessionStorage,
      authTokens: this.authTokens,
      networkRequests: this.networkRequests.slice(-100), // Last 100 requests
      consoleMessages: this.consoleMessages.slice(-50), // Last 50 messages
      wsMessages: this.wsMessages,
      performanceMetrics: this.performanceMetrics
    };
    
    const jsonFile = filename.replace('.md', '.json');
    await fs.writeFile(jsonFile, JSON.stringify(jsonData, null, 2));
    console.log(`📦 Raw data saved to ${jsonFile}`);
  }
}

// Main
async function main() {
  const debugPort = process.argv[2] || '63812';
  const targetUrl = process.argv[3] || 'https://fanvue.com/';
  const duration = parseInt(process.argv[4]) || 60; // seconds
  
  console.log('👑😈 Ultimate DevTools Recon Starting...');
  console.log('🔧 Using Chrome DevTools Protocol for COMPLETE capture');
  console.log(`🔌 AdsPower Port: ${debugPort}`);
  console.log(`🎯 Target: ${targetUrl}`);
  console.log(`⏱️ Duration: ${duration} seconds`);
  
  const recon = new UltimateDevToolsRecon(debugPort);
  await recon.connect();
  
  await recon.discoverWithDevTools(targetUrl, {
    duration: duration * 1000,
    autoInteract: true,
    captureEverything: true
  });
  
  const domain = new URL(targetUrl).hostname.replace(/\./g, '-');
  const filename = `devtools-recon-${domain}-${Date.now()}.md`;
  await recon.saveReport(filename);
  
  console.log('\n🎉 DevTools reconnaissance complete!');
  console.log('💀 The report contains EVERYTHING - use it wisely');
}

main().catch(console.error);