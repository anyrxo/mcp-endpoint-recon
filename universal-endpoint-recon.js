#!/usr/bin/env node
/**
 * Universal Endpoint Recon for AdsPower
 * By Joyce 👑😈 - Works on ANY site with ANY profile
 */

import { chromium } from 'playwright';
import fs from 'fs/promises';
import { URL } from 'url';

class UniversalEndpointRecon {
  constructor(debugPort) {
    this.debugPort = debugPort;
    this.endpoints = new Map();
    this.domain = null;
    this.visitedUrls = new Set();
    this.cookies = new Map();
    this.localStorage = {};
    this.sessionStorage = {};
    this.forms = [];
    this.apiPatterns = new Map();
    this.authTokens = {};
    this.uniqueEndpointPaths = new Set();
  }

  async connect() {
    console.log(`🔌 Connecting to AdsPower on port ${this.debugPort}...`);
    this.browser = await chromium.connectOverCDP(`http://127.0.0.1:${this.debugPort}`);
    this.context = this.browser.contexts()[0];
    this.setupNetworkInterception();
  }

  setupNetworkInterception() {
    this.context.on('request', request => {
      const url = request.url();
      const method = request.method();
      
      // Skip chrome extensions and browser internal URLs
      if (url.startsWith('chrome-extension://') || url.startsWith('chrome://')) return;
      
      try {
        const urlObj = new URL(url);
        
        // Only track URLs from the target domain or its subdomains
        if (this.domain && !this.isTargetDomain(urlObj.hostname)) return;
        
        // Create unique endpoint key based on path pattern, not full URL
        const endpointPattern = this.extractEndpointPattern(urlObj);
        const key = `${method} ${endpointPattern}`;
        
        if (!this.uniqueEndpointPaths.has(key)) {
          this.uniqueEndpointPaths.add(key);
          
          this.endpoints.set(key, {
            pattern: endpointPattern,
            method,
            examples: [url],
            category: this.categorizeEndpoint(urlObj),
            headers: request.headers(),
            payloads: [],
            responses: [],
            parameters: this.extractParameters(urlObj),
            isAPI: this.isAPIEndpoint(urlObj)
          });
        } else {
          // Add as example if different
          const endpoint = this.endpoints.get(key);
          if (!endpoint.examples.includes(url)) {
            endpoint.examples.push(url);
          }
        }
        
        // Capture payload
        if (request.postData()) {
          const payload = this.parsePayload(request.postData());
          this.endpoints.get(key).payloads.push({
            timestamp: new Date().toISOString(),
            data: payload,
            raw: request.postData()
          });
          
          // Extract auth tokens from payload
          this.extractAuthFromPayload(payload);
        }
        
        // Extract auth from headers
        this.extractAuthFromHeaders(request.headers());
        
      } catch (e) {
        // Ignore URL parsing errors
      }
    });

    this.context.on('response', async response => {
      const url = response.url();
      if (url.startsWith('chrome-extension://') || url.startsWith('chrome://')) return;
      
      try {
        const urlObj = new URL(url);
        if (this.domain && !this.isTargetDomain(urlObj.hostname)) return;
        
        const method = response.request().method();
        const endpointPattern = this.extractEndpointPattern(urlObj);
        const key = `${method} ${endpointPattern}`;
        
        if (this.endpoints.has(key)) {
          let responseData = null;
          try {
            const contentType = response.headers()['content-type'] || '';
            if (contentType.includes('json')) {
              responseData = await response.json();
              this.extractAuthFromResponse(responseData);
            }
          } catch {}
          
          this.endpoints.get(key).responses.push({
            status: response.status(),
            statusText: response.statusText(),
            headers: response.headers(),
            data: responseData,
            timestamp: new Date().toISOString()
          });
        }
      } catch {}
    });
  }

  isTargetDomain(hostname) {
    return hostname === this.domain || 
           hostname.endsWith(`.${this.domain}`) ||
           this.domain.endsWith(`.${hostname}`);
  }

  extractEndpointPattern(urlObj) {
    let path = urlObj.pathname;
    
    // Replace common dynamic segments with placeholders
    path = path.replace(/\/\d+/g, '/{id}'); // numeric IDs
    path = path.replace(/\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/g, '/{uuid}'); // UUIDs
    path = path.replace(/\/[a-zA-Z0-9]{20,}/g, '/{token}'); // long tokens
    path = path.replace(/\/@[\w\d_]+/g, '/@{username}'); // usernames
    path = path.replace(/\/p\/[\w\d]+/g, '/p/{postId}'); // post IDs
    
    return `${urlObj.protocol}//${urlObj.hostname}${path}`;
  }

  categorizeEndpoint(urlObj) {
    const path = urlObj.pathname.toLowerCase();
    
    // API patterns
    if (path.includes('/api/')) return 'API';
    if (path.includes('/graphql')) return 'GraphQL';
    if (path.includes('/ajax/')) return 'AJAX';
    if (path.includes('/rest/')) return 'REST API';
    
    // Content patterns
    if (path.includes('/feed')) return 'Feed';
    if (path.includes('/posts') || path.includes('/media')) return 'Content';
    if (path.includes('/stories')) return 'Stories';
    if (path.includes('/reels')) return 'Reels';
    
    // User patterns
    if (path.includes('/users') || path.includes('/profile')) return 'Users';
    if (path.includes('/follow')) return 'Social';
    
    // Engagement
    if (path.includes('/like') || path.includes('/comment')) return 'Engagement';
    if (path.includes('/message') || path.includes('/chat')) return 'Messaging';
    
    // Commerce
    if (path.includes('/payment') || path.includes('/subscription')) return 'Payments';
    if (path.includes('/shop') || path.includes('/product')) return 'Commerce';
    
    // Analytics
    if (path.includes('/analytics') || path.includes('/insights')) return 'Analytics';
    if (path.includes('/log') || path.includes('/track')) return 'Tracking';
    
    // Auth
    if (path.includes('/auth') || path.includes('/login')) return 'Authentication';
    if (path.includes('/oauth') || path.includes('/token')) return 'OAuth';
    
    // Static
    if (path.match(/\.(js|css|png|jpg|jpeg|gif|svg|woff|woff2)$/)) return 'Static';
    
    return 'Other';
  }

  extractParameters(urlObj) {
    const params = {};
    urlObj.searchParams.forEach((value, key) => {
      params[key] = value;
    });
    return params;
  }

  isAPIEndpoint(urlObj) {
    const apiIndicators = [
      '/api/', '/v1/', '/v2/', '/graphql', '/ajax/', '/rest/',
      '.json', '/data/', '/fetch/', '/query'
    ];
    return apiIndicators.some(indicator => urlObj.pathname.includes(indicator));
  }

  parsePayload(data) {
    try {
      return JSON.parse(data);
    } catch {
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
    }
  }

  extractAuthFromPayload(payload) {
    if (!payload) return;
    
    const authKeys = ['token', 'auth', 'csrf', 'api_key', 'access_token', 'refresh_token', 'session'];
    
    for (const key of authKeys) {
      if (payload[key]) {
        this.authTokens[key] = payload[key];
      }
    }
  }

  extractAuthFromHeaders(headers) {
    if (headers['authorization']) {
      this.authTokens.authorization = headers['authorization'];
    }
    if (headers['x-csrf-token']) {
      this.authTokens.csrf = headers['x-csrf-token'];
    }
    if (headers['x-api-key']) {
      this.authTokens.apiKey = headers['x-api-key'];
    }
  }

  extractAuthFromResponse(data) {
    if (!data) return;
    
    if (data.access_token) this.authTokens.access = data.access_token;
    if (data.refresh_token) this.authTokens.refresh = data.refresh_token;
    if (data.token) this.authTokens.token = data.token;
    if (data.csrf) this.authTokens.csrf = data.csrf;
  }

  async discoverEndpoints(startUrl, options = {}) {
    const { maxPages = 20, smartCrawl = true } = options;
    
    this.domain = new URL(startUrl).hostname;
    console.log(`🌐 Discovering endpoints on ${this.domain}...`);
    
    const page = await this.context.newPage();
    const pagesToVisit = [{ url: startUrl, depth: 0 }];
    const visitedTypes = new Set();
    let pagesVisited = 0;

    while (pagesToVisit.length > 0 && pagesVisited < maxPages) {
      const { url, depth } = pagesToVisit.shift();
      
      // Smart crawling - skip similar pages
      if (smartCrawl) {
        const urlType = this.getUrlType(url);
        if (visitedTypes.has(urlType) && depth > 0) {
          console.log(`⏭️ Skipping similar: ${url}`);
          continue;
        }
        visitedTypes.add(urlType);
      }
      
      if (this.visitedUrls.has(url)) continue;
      
      this.visitedUrls.add(url);
      pagesVisited++;
      
      console.log(`📄 [${pagesVisited}/${maxPages}] ${url}`);
      
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        
        // Extract page data
        await this.extractPageData(page);
        
        // Smart interaction based on page type
        await this.smartPageInteraction(page);
        
        // Find unique links to explore
        if (depth < 2) {
          const links = await this.findUniqueLinks(page);
          links.forEach(link => {
            if (!this.visitedUrls.has(link)) {
              pagesToVisit.push({ url: link, depth: depth + 1 });
            }
          });
        }
        
        await page.waitForTimeout(2000);
        
      } catch (error) {
        console.log(`⚠️ Error: ${error.message}`);
      }
    }
    
    await page.close();
  }

  getUrlType(url) {
    const urlObj = new URL(url);
    const path = urlObj.pathname;
    
    // Common patterns that indicate same type of page
    if (path.match(/\/\d+$/)) return 'numeric-id';
    if (path.match(/\/@[\w\d_]+$/)) return 'user-profile';
    if (path.match(/\/p\/[\w\d]+$/)) return 'post';
    if (path.includes('/explore')) return 'explore';
    if (path.includes('/search')) return 'search';
    if (path.includes('/messages')) return 'messages';
    
    return path;
  }

  async extractPageData(page) {
    // Extract cookies
    const cookies = await this.context.cookies();
    cookies.forEach(cookie => {
      this.cookies.set(cookie.name, cookie);
    });
    
    // Extract storage and forms
    const pageData = await page.evaluate(() => {
      const data = {
        localStorage: {},
        sessionStorage: {},
        forms: []
      };
      
      // Storage
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        data.localStorage[key] = localStorage.getItem(key);
      }
      
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        data.sessionStorage[key] = sessionStorage.getItem(key);
      }
      
      // Forms
      document.querySelectorAll('form').forEach(form => {
        data.forms.push({
          action: form.action,
          method: form.method,
          fields: Array.from(form.querySelectorAll('input, select, textarea')).map(field => ({
            name: field.name,
            type: field.type || field.tagName.toLowerCase(),
            required: field.required
          }))
        });
      });
      
      return data;
    });
    
    Object.assign(this.localStorage, pageData.localStorage);
    Object.assign(this.sessionStorage, pageData.sessionStorage);
    this.forms.push(...pageData.forms);
  }

  async smartPageInteraction(page) {
    // Scroll to trigger lazy loading
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight / 2);
    });
    await page.waitForTimeout(1000);
    
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(1000);
    
    // Click on interactive elements that might reveal APIs
    const interactiveSelectors = [
      'button[data-action]',
      '[role="button"]',
      '.load-more',
      '.show-more',
      '[data-toggle]',
      '.tab',
      '[role="tab"]'
    ];
    
    for (const selector of interactiveSelectors) {
      const elements = await page.$$(selector);
      for (let i = 0; i < Math.min(2, elements.length); i++) {
        try {
          await elements[i].click({ timeout: 1000 });
          await page.waitForTimeout(1500);
        } catch {}
      }
    }
  }

  async findUniqueLinks(page) {
    return await page.evaluate((domain) => {
      const links = new Set();
      const seenPatterns = new Set();
      
      document.querySelectorAll('a[href]').forEach(a => {
        const href = a.href;
        if (!href.startsWith('http')) return;
        
        try {
          const url = new URL(href);
          if (url.hostname !== domain && !url.hostname.endsWith(`.${domain}`)) return;
          
          // Create pattern to avoid similar URLs
          let pattern = url.pathname;
          pattern = pattern.replace(/\/\d+/g, '/{id}');
          pattern = pattern.replace(/\/@[\w\d_]+/g, '/@{user}');
          pattern = pattern.replace(/\/p\/[\w\d]+/g, '/p/{post}');
          
          if (!seenPatterns.has(pattern)) {
            seenPatterns.add(pattern);
            links.add(href);
          }
        } catch {}
      });
      
      return Array.from(links).slice(0, 10); // Limit to 10 unique patterns
    }, this.domain);
  }

  generateMarkdown() {
    const timestamp = new Date().toISOString();
    
    let md = `# 🔍 Universal Endpoint Reconnaissance Report\n\n`;
    md += `**Target Domain:** ${this.domain}  \n`;
    md += `**Scan Date:** ${timestamp}  \n`;
    md += `**Pages Visited:** ${this.visitedUrls.size}  \n`;
    md += `**Unique Endpoints:** ${this.uniqueEndpointPaths.size}  \n\n`;
    
    // Summary by Category
    md += `## 📊 Endpoints by Category\n\n`;
    const categoryCounts = {};
    this.endpoints.forEach(endpoint => {
      categoryCounts[endpoint.category] = (categoryCounts[endpoint.category] || 0) + 1;
    });
    
    md += `| Category | Count |\n`;
    md += `|----------|-------|\n`;
    Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]).forEach(([cat, count]) => {
      md += `| ${cat} | ${count} |\n`;
    });
    md += `\n`;
    
    // Authentication
    md += `## 🔐 Authentication & Tokens\n\n`;
    if (Object.keys(this.authTokens).length > 0) {
      md += `### Discovered Tokens\n\n`;
      Object.entries(this.authTokens).forEach(([type, token]) => {
        const masked = typeof token === 'string' && token.length > 20 
          ? token.substring(0, 10) + '...' + token.substring(token.length - 10) 
          : token;
        md += `**${type}:** \`${masked}\`  \n`;
      });
      md += `\n`;
    }
    
    md += `### Important Cookies\n\n`;
    const sessionCookies = Array.from(this.cookies.values())
      .filter(c => c.httpOnly || c.name.includes('session') || c.name.includes('auth'));
    
    if (sessionCookies.length > 0) {
      md += `| Name | Domain | HttpOnly | Secure |\n`;
      md += `|------|--------|----------|--------|\n`;
      sessionCookies.forEach(cookie => {
        md += `| ${cookie.name} | ${cookie.domain} | ${cookie.httpOnly} | ${cookie.secure} |\n`;
      });
      md += `\n`;
    }
    
    // API Endpoints
    md += `## 🚀 API Endpoints\n\n`;
    const apiEndpoints = Array.from(this.endpoints.entries())
      .filter(([_, endpoint]) => endpoint.isAPI)
      .sort((a, b) => a[0].localeCompare(b[0]));
    
    apiEndpoints.forEach(([key, endpoint]) => {
      md += `### ${key}\n\n`;
      md += `**Pattern:** \`${endpoint.pattern}\`  \n`;
      md += `**Category:** ${endpoint.category}  \n`;
      
      if (endpoint.examples.length > 1) {
        md += `**Example URLs:**\n`;
        endpoint.examples.slice(0, 3).forEach(ex => {
          md += `- \`${ex}\`\n`;
        });
        md += `\n`;
      }
      
      if (Object.keys(endpoint.parameters).length > 0) {
        md += `**Parameters:**\n`;
        Object.entries(endpoint.parameters).forEach(([param, value]) => {
          md += `- \`${param}\`: ${value}\n`;
        });
        md += `\n`;
      }
      
      if (endpoint.payloads.length > 0) {
        md += `**Request Payload:**\n\`\`\`json\n`;
        md += JSON.stringify(endpoint.payloads[0].data, null, 2);
        md += `\n\`\`\`\n\n`;
      }
      
      if (endpoint.responses.length > 0 && endpoint.responses[0].data) {
        md += `**Response (${endpoint.responses[0].status}):**\n\`\`\`json\n`;
        const resp = JSON.stringify(endpoint.responses[0].data, null, 2);
        md += resp.length > 800 ? resp.substring(0, 800) + '\n...' : resp;
        md += `\n\`\`\`\n\n`;
      }
      
      md += `---\n\n`;
    });
    
    // Forms
    if (this.forms.length > 0) {
      md += `## 📝 Forms Discovered\n\n`;
      this.forms.forEach((form, idx) => {
        md += `### Form ${idx + 1}\n`;
        md += `**Action:** ${form.action}  \n`;
        md += `**Method:** ${form.method}  \n`;
        if (form.fields.length > 0) {
          md += `**Fields:** ${form.fields.map(f => f.name).join(', ')}\n`;
        }
        md += `\n`;
      });
    }
    
    // Usage Examples
    md += `## 💡 Usage Examples\n\n`;
    md += `### Python Example\n\`\`\`python\n`;
    md += `import requests\n\n`;
    md += `# Use discovered cookies\n`;
    md += `cookies = {\n`;
    const exampleCookies = Array.from(this.cookies.values()).slice(0, 3);
    exampleCookies.forEach(c => {
      md += `    '${c.name}': 'YOUR_${c.name.toUpperCase()}',\n`;
    });
    md += `}\n\n`;
    md += `# Make API request\n`;
    if (apiEndpoints.length > 0) {
      const [_, endpoint] = apiEndpoints[0];
      md += `response = requests.${endpoint.method.toLowerCase()}(\n`;
      md += `    '${endpoint.examples[0]}',\n`;
      md += `    cookies=cookies\n`;
      md += `)\n`;
    }
    md += `\`\`\`\n\n`;
    
    // All Endpoints
    md += `## 📡 All Discovered Endpoints\n\n`;
    const byCategory = {};
    this.endpoints.forEach((endpoint, key) => {
      if (!byCategory[endpoint.category]) byCategory[endpoint.category] = [];
      byCategory[endpoint.category].push({ key, endpoint });
    });
    
    Object.entries(byCategory).forEach(([category, endpoints]) => {
      md += `### ${category}\n\n`;
      endpoints.forEach(({ key, endpoint }) => {
        md += `- **${key}**\n`;
        if (endpoint.examples.length > 1) {
          md += `  - Examples: ${endpoint.examples.length}\n`;
        }
      });
      md += `\n`;
    });
    
    return md;
  }

  async saveReport(filename) {
    const markdown = this.generateMarkdown();
    await fs.writeFile(filename, markdown);
    console.log(`\n✅ Report saved to ${filename}`);
    
    // Save raw JSON
    const jsonData = {
      domain: this.domain,
      endpoints: Object.fromEntries(this.endpoints),
      cookies: Array.from(this.cookies.values()),
      localStorage: this.localStorage,
      sessionStorage: this.sessionStorage,
      authTokens: this.authTokens,
      forms: this.forms,
      visitedUrls: Array.from(this.visitedUrls)
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
  const maxPages = parseInt(process.argv[4]) || 20;
  
  console.log('👑😈 Universal Endpoint Recon Starting...');
  console.log(`🔌 AdsPower Port: ${debugPort}`);
  console.log(`🎯 Target: ${targetUrl}`);
  console.log(`📄 Max Pages: ${maxPages}`);
  console.log('🧠 Smart crawling enabled - skips similar pages\n');
  
  const recon = new UniversalEndpointRecon(debugPort);
  await recon.connect();
  
  await recon.discoverEndpoints(targetUrl, { maxPages, smartCrawl: true });
  
  const domain = new URL(targetUrl).hostname.replace(/\./g, '-');
  const filename = `endpoints-${domain}-${Date.now()}.md`;
  await recon.saveReport(filename);
  
  console.log('\n🎉 Endpoint discovery complete!');
  console.log('💀 Use the report for automation and testing');
}

main().catch(console.error);