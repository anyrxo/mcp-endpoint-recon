#!/usr/bin/env node
/**
 * AdsPower Deep Recon with MD Output
 * By Joyce 👑😈 - Comprehensive endpoint discovery with organized markdown output
 */

import { chromium } from 'playwright';
import fs from 'fs/promises';
import crypto from 'crypto';

class DeepEndpointRecon {
  constructor(debugPort) {
    this.debugPort = debugPort;
    this.endpoints = new Map();
    this.visitedUrls = new Set();
    this.cookies = new Map();
    this.localStorage = {};
    this.sessionStorage = {};
    this.forms = [];
    this.apiEndpoints = new Set();
  }

  async connect() {
    this.browser = await chromium.connectOverCDP(`http://127.0.0.1:${this.debugPort}`);
    this.context = this.browser.contexts()[0];
    this.setupNetworkInterception();
  }

  setupNetworkInterception() {
    // Capture all requests
    this.context.on('request', request => {
      const url = request.url();
      const method = request.method();
      const key = `${method} ${url}`;
      
      if (!this.endpoints.has(key)) {
        this.endpoints.set(key, {
          url,
          method,
          headers: request.headers(),
          postData: request.postData() || null,
          responses: [],
          timing: request.timing(),
          resourceType: request.resourceType(),
          isAPI: this.isAPIEndpoint(url),
          cookies: [],
          payloads: []
        });
      }
      
      // Capture payloads
      if (request.postData()) {
        try {
          const payload = JSON.parse(request.postData());
          this.endpoints.get(key).payloads.push({
            timestamp: new Date().toISOString(),
            data: payload,
            raw: request.postData()
          });
        } catch {
          this.endpoints.get(key).payloads.push({
            timestamp: new Date().toISOString(),
            raw: request.postData()
          });
        }
      }
    });

    // Capture responses
    this.context.on('response', async response => {
      const url = response.url();
      const method = response.request().method();
      const key = `${method} ${url}`;
      
      if (this.endpoints.has(key)) {
        let responseBody = null;
        try {
          if (response.headers()['content-type']?.includes('json')) {
            responseBody = await response.json();
          } else if (response.headers()['content-type']?.includes('text')) {
            responseBody = await response.text();
          }
        } catch (e) {
          // Ignore body parsing errors
        }
        
        this.endpoints.get(key).responses.push({
          status: response.status(),
          statusText: response.statusText(),
          headers: response.headers(),
          body: responseBody,
          timestamp: new Date().toISOString()
        });
      }
    });
  }

  isAPIEndpoint(url) {
    const apiPatterns = [
      /\/api\//i,
      /\/graphql/i,
      /\/rest\//i,
      /\/v\d+\//i,
      /\.json$/i,
      /\/ajax\//i
    ];
    return apiPatterns.some(pattern => pattern.test(url));
  }

  async crawlSite(startUrl, options = {}) {
    const { maxDepth = 3, maxPages = 50 } = options;
    const domain = new URL(startUrl).hostname;
    
    console.log(`🌐 Starting deep crawl of ${domain}...`);
    
    const page = await this.context.newPage();
    const pagesToVisit = [{ url: startUrl, depth: 0 }];
    let pagesVisited = 0;

    while (pagesToVisit.length > 0 && pagesVisited < maxPages) {
      const { url, depth } = pagesToVisit.shift();
      
      if (this.visitedUrls.has(url) || depth > maxDepth) continue;
      
      this.visitedUrls.add(url);
      pagesVisited++;
      
      console.log(`📄 Visiting [${pagesVisited}/${maxPages}]: ${url}`);
      
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        
        // Extract page data
        await this.extractPageData(page, url);
        
        // Find more links to visit
        if (depth < maxDepth) {
          const links = await this.extractLinks(page, domain);
          links.forEach(link => {
            if (!this.visitedUrls.has(link)) {
              pagesToVisit.push({ url: link, depth: depth + 1 });
            }
          });
        }
        
        // Interact with page elements
        await this.interactWithPage(page);
        
        // Wait for any async requests
        await page.waitForTimeout(2000);
        
      } catch (error) {
        console.log(`⚠️ Error visiting ${url}: ${error.message}`);
      }
    }
    
    await page.close();
  }

  async extractPageData(page, url) {
    // Extract cookies
    const cookies = await this.context.cookies(url);
    cookies.forEach(cookie => {
      this.cookies.set(cookie.name, cookie);
    });
    
    // Extract storage
    const storageData = await page.evaluate(() => {
      const local = {};
      const session = {};
      
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        local[key] = localStorage.getItem(key);
      }
      
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        session[key] = sessionStorage.getItem(key);
      }
      
      return { local, session };
    });
    
    Object.assign(this.localStorage, storageData.local);
    Object.assign(this.sessionStorage, storageData.session);
    
    // Extract forms
    const forms = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('form')).map(form => ({
        action: form.action,
        method: form.method,
        fields: Array.from(form.querySelectorAll('input, select, textarea')).map(field => ({
          name: field.name,
          type: field.type || field.tagName.toLowerCase(),
          required: field.required,
          value: field.value
        }))
      }));
    });
    
    this.forms.push(...forms.map(form => ({ ...form, pageUrl: url })));
  }

  async extractLinks(page, domain) {
    return await page.evaluate((domain) => {
      const links = Array.from(document.querySelectorAll('a[href]'))
        .map(a => a.href)
        .filter(href => {
          try {
            const url = new URL(href);
            return url.hostname === domain || url.hostname.endsWith(`.${domain}`);
          } catch {
            return false;
          }
        });
      return [...new Set(links)];
    }, domain);
  }

  async interactWithPage(page) {
    // Scroll to trigger lazy loading
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight / 2);
    });
    await page.waitForTimeout(1000);
    
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(1000);
    
    // Click expandable elements
    const expandables = await page.$$('[data-toggle], [aria-expanded="false"], .accordion, .dropdown-toggle');
    for (let i = 0; i < Math.min(expandables.length, 5); i++) {
      try {
        await expandables[i].click({ timeout: 1000 });
        await page.waitForTimeout(500);
      } catch {
        // Ignore click errors
      }
    }
    
    // Hover over elements to trigger tooltips/dropdowns
    const hoverables = await page.$$('nav a, .menu-item, [data-tooltip]');
    for (let i = 0; i < Math.min(hoverables.length, 5); i++) {
      try {
        await hoverables[i].hover({ timeout: 1000 });
        await page.waitForTimeout(300);
      } catch {
        // Ignore hover errors
      }
    }
  }

  generateMarkdown() {
    const timestamp = new Date().toISOString();
    const domain = this.visitedUrls.size > 0 ? new URL(Array.from(this.visitedUrls)[0]).hostname : 'unknown';
    
    let md = `# 🔍 Endpoint Reconnaissance Report\n\n`;
    md += `**Target Domain:** ${domain}  \n`;
    md += `**Scan Date:** ${timestamp}  \n`;
    md += `**Pages Visited:** ${this.visitedUrls.size}  \n`;
    md += `**Total Endpoints:** ${this.endpoints.size}  \n\n`;
    
    // Table of Contents
    md += `## 📑 Table of Contents\n\n`;
    md += `1. [Summary Statistics](#summary-statistics)\n`;
    md += `2. [API Endpoints](#api-endpoints)\n`;
    md += `3. [Forms Discovered](#forms-discovered)\n`;
    md += `4. [Cookies](#cookies)\n`;
    md += `5. [Storage Data](#storage-data)\n`;
    md += `6. [All Endpoints](#all-endpoints)\n\n`;
    
    // Summary Statistics
    md += `## 📊 Summary Statistics\n\n`;
    const stats = this.calculateStats();
    md += `| Metric | Count |\n`;
    md += `|--------|-------|\n`;
    md += `| GET Requests | ${stats.get} |\n`;
    md += `| POST Requests | ${stats.post} |\n`;
    md += `| PUT Requests | ${stats.put} |\n`;
    md += `| DELETE Requests | ${stats.delete} |\n`;
    md += `| API Endpoints | ${stats.api} |\n`;
    md += `| Endpoints with Payloads | ${stats.withPayloads} |\n`;
    md += `| Unique Cookies | ${this.cookies.size} |\n`;
    md += `| Forms Found | ${this.forms.length} |\n\n`;
    
    // API Endpoints
    md += `## 🚀 API Endpoints\n\n`;
    const apiEndpoints = Array.from(this.endpoints.entries())
      .filter(([_, data]) => data.isAPI)
      .sort((a, b) => a[0].localeCompare(b[0]));
    
    if (apiEndpoints.length > 0) {
      apiEndpoints.forEach(([key, data]) => {
        md += `### ${data.method} ${data.url}\n\n`;
        
        if (data.postData) {
          md += `**Request Payload:**\n\`\`\`json\n${this.formatJson(data.postData)}\n\`\`\`\n\n`;
        }
        
        if (data.responses.length > 0) {
          const response = data.responses[0];
          md += `**Response Status:** ${response.status} ${response.statusText}  \n`;
          if (response.body) {
            md += `**Response Body:**\n\`\`\`json\n${this.formatJson(response.body)}\n\`\`\`\n\n`;
          }
        }
        
        md += `---\n\n`;
      });
    } else {
      md += `*No API endpoints discovered*\n\n`;
    }
    
    // Forms
    md += `## 📝 Forms Discovered\n\n`;
    if (this.forms.length > 0) {
      this.forms.forEach((form, idx) => {
        md += `### Form ${idx + 1} (${form.pageUrl})\n\n`;
        md += `**Action:** ${form.action}  \n`;
        md += `**Method:** ${form.method}  \n`;
        md += `**Fields:**\n`;
        form.fields.forEach(field => {
          md += `- **${field.name}** (${field.type})${field.required ? ' *required*' : ''}\n`;
        });
        md += `\n`;
      });
    } else {
      md += `*No forms discovered*\n\n`;
    }
    
    // Cookies
    md += `## 🍪 Cookies\n\n`;
    if (this.cookies.size > 0) {
      md += `| Name | Value | Domain | HttpOnly | Secure | SameSite |\n`;
      md += `|------|-------|--------|----------|--------|----------|\n`;
      this.cookies.forEach(cookie => {
        const value = cookie.value.length > 20 ? cookie.value.substring(0, 20) + '...' : cookie.value;
        md += `| ${cookie.name} | ${value} | ${cookie.domain} | ${cookie.httpOnly} | ${cookie.secure} | ${cookie.sameSite || 'None'} |\n`;
      });
      md += `\n`;
    } else {
      md += `*No cookies found*\n\n`;
    }
    
    // Storage
    md += `## 💾 Storage Data\n\n`;
    md += `### Local Storage\n\n`;
    if (Object.keys(this.localStorage).length > 0) {
      md += `\`\`\`json\n${JSON.stringify(this.localStorage, null, 2)}\n\`\`\`\n\n`;
    } else {
      md += `*No local storage data*\n\n`;
    }
    
    md += `### Session Storage\n\n`;
    if (Object.keys(this.sessionStorage).length > 0) {
      md += `\`\`\`json\n${JSON.stringify(this.sessionStorage, null, 2)}\n\`\`\`\n\n`;
    } else {
      md += `*No session storage data*\n\n`;
    }
    
    // All Endpoints
    md += `## 📡 All Endpoints\n\n`;
    const groupedEndpoints = this.groupEndpointsByType();
    
    Object.entries(groupedEndpoints).forEach(([type, endpoints]) => {
      md += `### ${type}\n\n`;
      endpoints.forEach(([key, data]) => {
        const truncatedUrl = data.url.length > 80 ? data.url.substring(0, 80) + '...' : data.url;
        md += `- **${data.method}** ${truncatedUrl}\n`;
        if (data.responses.length > 0) {
          md += `  - Status: ${data.responses[0].status}\n`;
        }
        if (data.payloads.length > 0) {
          md += `  - Payloads: ${data.payloads.length}\n`;
        }
      });
      md += `\n`;
    });
    
    return md;
  }

  calculateStats() {
    const stats = {
      get: 0,
      post: 0,
      put: 0,
      delete: 0,
      api: 0,
      withPayloads: 0
    };
    
    this.endpoints.forEach(data => {
      stats[data.method.toLowerCase()]++;
      if (data.isAPI) stats.api++;
      if (data.payloads.length > 0) stats.withPayloads++;
    });
    
    return stats;
  }

  groupEndpointsByType() {
    const groups = {
      'API Endpoints': [],
      'Page Resources': [],
      'Static Assets': [],
      'External Resources': []
    };
    
    this.endpoints.forEach((data, key) => {
      if (data.isAPI) {
        groups['API Endpoints'].push([key, data]);
      } else if (data.resourceType === 'document') {
        groups['Page Resources'].push([key, data]);
      } else if (['stylesheet', 'script', 'image', 'font'].includes(data.resourceType)) {
        groups['Static Assets'].push([key, data]);
      } else {
        groups['External Resources'].push([key, data]);
      }
    });
    
    return groups;
  }

  formatJson(obj) {
    if (typeof obj === 'string') {
      try {
        obj = JSON.parse(obj);
      } catch {
        return obj;
      }
    }
    return JSON.stringify(obj, null, 2);
  }

  async saveResults(filename) {
    const markdown = this.generateMarkdown();
    await fs.writeFile(filename, markdown);
    console.log(`\n✅ Report saved to ${filename}`);
    
    // Also save raw JSON data
    const jsonFilename = filename.replace('.md', '.json');
    const jsonData = {
      endpoints: Array.from(this.endpoints.entries()),
      cookies: Array.from(this.cookies.values()),
      localStorage: this.localStorage,
      sessionStorage: this.sessionStorage,
      forms: this.forms,
      visitedUrls: Array.from(this.visitedUrls)
    };
    await fs.writeFile(jsonFilename, JSON.stringify(jsonData, null, 2));
    console.log(`📦 Raw data saved to ${jsonFilename}`);
  }
}

// Main execution
async function main() {
  const debugPort = 56329;
  const targetUrl = process.argv[2] || 'https://httpbin.org/';
  const maxPages = parseInt(process.argv[3]) || 20;
  
  console.log('👑😈 AdsPower Deep Recon Starting...');
  console.log(`🎯 Target: ${targetUrl}`);
  console.log(`📄 Max Pages: ${maxPages}`);
  
  const recon = new DeepEndpointRecon(debugPort);
  await recon.connect();
  
  await recon.crawlSite(targetUrl, { maxPages, maxDepth: 3 });
  
  const domain = new URL(targetUrl).hostname.replace(/\./g, '-');
  const filename = `endpoints-${domain}-${Date.now()}.md`;
  await recon.saveResults(filename);
  
  console.log('\n🎉 Deep reconnaissance complete!');
}

main().catch(console.error);