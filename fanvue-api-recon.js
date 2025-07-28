#!/usr/bin/env node
/**
 * Fanvue API Deep Recon
 * By Joyce 👑😈 - Specialized Fanvue endpoint discovery
 */

import { chromium } from 'playwright';
import fs from 'fs/promises';

class FanvueAPIRecon {
  constructor(debugPort) {
    this.debugPort = debugPort;
    this.endpoints = new Map();
    this.apiCalls = new Map();
    this.cookies = new Map();
    this.localStorage = {};
    this.sessionStorage = {};
    this.authTokens = {};
    this.mediaUrls = new Set();
    this.userProfiles = new Set();
  }

  async connect() {
    this.browser = await chromium.connectOverCDP(`http://127.0.0.1:${this.debugPort}`);
    this.context = this.browser.contexts()[0];
    this.setupNetworkInterception();
  }

  setupNetworkInterception() {
    this.context.on('request', request => {
      const url = request.url();
      const method = request.method();
      
      // Capture Fanvue-specific endpoints
      if (url.includes('fanvue.com') || url.includes('fvcdn.com')) {
        const endpoint = this.categorizeEndpoint(url);
        
        if (endpoint.type !== 'static' && endpoint.type !== 'media') {
          const key = `${method} ${endpoint.path}`;
          
          if (!this.endpoints.has(key)) {
            this.endpoints.set(key, {
              url,
              method,
              type: endpoint.type,
              category: endpoint.category,
              headers: request.headers(),
              payloads: [],
              responses: [],
              examples: []
            });
          }
          
          // Capture request payload
          if (request.postData()) {
            const payload = this.parsePayload(request.postData());
            this.endpoints.get(key).payloads.push({
              timestamp: new Date().toISOString(),
              data: payload,
              raw: request.postData()
            });
            
            // Extract auth tokens
            const authHeader = request.headers()['authorization'];
            if (authHeader) {
              this.authTokens.bearer = authHeader.replace('Bearer ', '');
            }
          }
          
          // Track example URL with params
          this.endpoints.get(key).examples.push(url);
        } else if (endpoint.type === 'media') {
          this.mediaUrls.add(url);
        }
      }
    });

    this.context.on('response', async response => {
      const url = response.url();
      const method = response.request().method();
      
      if (url.includes('fanvue.com') || url.includes('fvcdn.com')) {
        const endpoint = this.categorizeEndpoint(url);
        
        if (endpoint.type !== 'static' && endpoint.type !== 'media') {
          const key = `${method} ${endpoint.path}`;
          
          if (this.endpoints.has(key)) {
            let responseData = null;
            try {
              const contentType = response.headers()['content-type'] || '';
              if (contentType.includes('json')) {
                responseData = await response.json();
                
                // Extract user profiles
                if (responseData.data?.users) {
                  responseData.data.users.forEach(user => {
                    this.userProfiles.add(user.username);
                  });
                }
                
                // Extract tokens from response
                if (responseData.access_token) {
                  this.authTokens.access = responseData.access_token;
                }
                if (responseData.refresh_token) {
                  this.authTokens.refresh = responseData.refresh_token;
                }
              }
            } catch (e) {
              // Ignore parse errors
            }
            
            this.endpoints.get(key).responses.push({
              status: response.status(),
              statusText: response.statusText(),
              headers: response.headers(),
              data: responseData,
              timestamp: new Date().toISOString()
            });
          }
        }
      }
    });
  }

  categorizeEndpoint(url) {
    const urlObj = new URL(url);
    const path = urlObj.pathname;
    
    // API endpoints
    if (path.includes('/api/')) {
      // User endpoints
      if (path.includes('/users')) return { type: 'api', category: 'users', path };
      if (path.includes('/profile')) return { type: 'api', category: 'profile', path };
      
      // Content endpoints
      if (path.includes('/posts')) return { type: 'api', category: 'posts', path };
      if (path.includes('/media')) return { type: 'api', category: 'media-api', path };
      if (path.includes('/stories')) return { type: 'api', category: 'stories', path };
      if (path.includes('/bundles')) return { type: 'api', category: 'bundles', path };
      
      // Engagement endpoints
      if (path.includes('/likes')) return { type: 'api', category: 'engagement', path };
      if (path.includes('/comments')) return { type: 'api', category: 'comments', path };
      if (path.includes('/tips')) return { type: 'api', category: 'tips', path };
      
      // Messaging
      if (path.includes('/messages')) return { type: 'api', category: 'messages', path };
      if (path.includes('/conversations')) return { type: 'api', category: 'conversations', path };
      
      // Subscriptions & Payments
      if (path.includes('/subscriptions')) return { type: 'api', category: 'subscriptions', path };
      if (path.includes('/payments')) return { type: 'api', category: 'payments', path };
      if (path.includes('/wallet')) return { type: 'api', category: 'wallet', path };
      
      // Discovery
      if (path.includes('/explore')) return { type: 'api', category: 'explore', path };
      if (path.includes('/search')) return { type: 'api', category: 'search', path };
      if (path.includes('/trending')) return { type: 'api', category: 'trending', path };
      
      // Analytics
      if (path.includes('/analytics')) return { type: 'api', category: 'analytics', path };
      if (path.includes('/insights')) return { type: 'api', category: 'insights', path };
      
      return { type: 'api', category: 'other', path };
    }
    
    // Media CDN
    if (url.includes('fvcdn.com') || path.includes('/media/')) {
      return { type: 'media', category: 'cdn', path };
    }
    
    // Static resources
    if (path.includes('/static/') || path.endsWith('.js') || path.endsWith('.css')) {
      return { type: 'static', category: 'resources', path };
    }
    
    // Webhooks
    if (path.includes('/webhook')) {
      return { type: 'webhook', category: 'integration', path };
    }
    
    return { type: 'other', category: 'unknown', path };
  }

  parsePayload(data) {
    try {
      return JSON.parse(data);
    } catch {
      const params = new URLSearchParams(data);
      const obj = {};
      for (const [key, value] of params) {
        try {
          obj[key] = JSON.parse(value);
        } catch {
          obj[key] = value;
        }
      }
      return obj;
    }
  }

  async exploreUniqueFanvueEndpoints() {
    const page = await this.context.newPage();
    
    console.log('💰 Exploring Fanvue unique endpoints...');
    
    // Different areas to explore for unique endpoints
    const areasToExplore = [
      { action: 'homepage', url: 'https://fanvue.com/', description: 'Main feed & discover' },
      { action: 'explore', url: 'https://fanvue.com/explore', description: 'Trending & categories' },
      { action: 'messages', url: 'https://fanvue.com/messages', description: 'DM system' },
      { action: 'wallet', url: 'https://fanvue.com/wallet', description: 'Payment & earnings' },
      { action: 'analytics', url: 'https://fanvue.com/analytics', description: 'Creator analytics' },
      { action: 'settings', url: 'https://fanvue.com/settings', description: 'Account settings' },
      { action: 'notifications', url: 'https://fanvue.com/notifications', description: 'Activity feed' }
    ];
    
    for (const area of areasToExplore) {
      try {
        console.log(`\n🔍 Exploring ${area.description}...`);
        await page.goto(area.url, { waitUntil: 'networkidle', timeout: 30000 });
        
        // Extract page data
        await this.extractFanvueData(page);
        
        // Perform unique actions based on area
        await this.performAreaActions(page, area.action);
        
        // Wait for API calls
        await page.waitForTimeout(3000);
        
      } catch (e) {
        console.log(`⚠️ Could not explore ${area.action}: ${e.message}`);
      }
    }
    
    // Try to find a profile to explore content endpoints
    if (this.userProfiles.size > 0) {
      const username = Array.from(this.userProfiles)[0];
      console.log(`\n👤 Exploring profile: ${username}`);
      try {
        await page.goto(`https://fanvue.com/${username}`, { waitUntil: 'networkidle', timeout: 30000 });
        await this.exploreProfileContent(page);
      } catch (e) {
        console.log(`⚠️ Could not explore profile: ${e.message}`);
      }
    }
    
    await page.close();
  }

  async extractFanvueData(page) {
    // Extract cookies
    const cookies = await this.context.cookies();
    cookies.forEach(cookie => {
      this.cookies.set(cookie.name, cookie);
    });
    
    // Extract storage and tokens
    const pageData = await page.evaluate(() => {
      const data = {
        localStorage: {},
        sessionStorage: {},
        tokens: {}
      };
      
      // Extract storage
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        data.localStorage[key] = localStorage.getItem(key);
        
        // Look for tokens
        if (key.includes('token') || key.includes('auth')) {
          data.tokens[key] = localStorage.getItem(key);
        }
      }
      
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        data.sessionStorage[key] = sessionStorage.getItem(key);
      }
      
      // Check for global auth objects
      if (window.__auth) data.tokens.windowAuth = window.__auth;
      if (window.localStorage.getItem('access_token')) {
        data.tokens.access = window.localStorage.getItem('access_token');
      }
      
      return data;
    });
    
    Object.assign(this.localStorage, pageData.localStorage);
    Object.assign(this.sessionStorage, pageData.sessionStorage);
    Object.assign(this.authTokens, pageData.tokens);
  }

  async performAreaActions(page, action) {
    switch (action) {
      case 'homepage':
        // Scroll to load more content
        for (let i = 0; i < 3; i++) {
          await page.evaluate(() => window.scrollBy(0, window.innerHeight));
          await page.waitForTimeout(2000);
        }
        break;
        
      case 'explore':
        // Click on category filters
        const categories = await page.$$('[data-category], .category-filter, .tag-filter');
        for (let i = 0; i < Math.min(3, categories.length); i++) {
          try {
            await categories[i].click();
            await page.waitForTimeout(2000);
          } catch {}
        }
        break;
        
      case 'messages':
        // Try to open a conversation
        const convos = await page.$$('.conversation-item, [data-conversation-id]');
        if (convos.length > 0) {
          await convos[0].click();
          await page.waitForTimeout(2000);
        }
        break;
        
      case 'wallet':
        // Click on transaction tabs
        const tabs = await page.$$('.tab-button, [role="tab"]');
        for (const tab of tabs) {
          try {
            await tab.click();
            await page.waitForTimeout(1500);
          } catch {}
        }
        break;
        
      case 'analytics':
        // Change date ranges
        const dateFilters = await page.$$('.date-filter, [data-period]');
        for (let i = 0; i < Math.min(2, dateFilters.length); i++) {
          try {
            await dateFilters[i].click();
            await page.waitForTimeout(2000);
          } catch {}
        }
        break;
    }
  }

  async exploreProfileContent(page) {
    // Click on tabs (posts, bundles, etc)
    const tabs = await page.$$('.profile-tab, [data-tab]');
    for (const tab of tabs) {
      try {
        await tab.click();
        await page.waitForTimeout(2000);
      } catch {}
    }
    
    // Try to open a post
    const posts = await page.$$('.post-item, [data-post-id]');
    if (posts.length > 0) {
      await posts[0].click();
      await page.waitForTimeout(3000);
      
      // Try to interact with the post
      const likeBtn = await page.$('.like-button, [data-action="like"]');
      if (likeBtn) {
        await likeBtn.click();
        await page.waitForTimeout(1000);
      }
    }
  }

  generateMarkdown() {
    const timestamp = new Date().toISOString();
    
    let md = `# 🔍 Fanvue API Reconnaissance Report\n\n`;
    md += `**Scan Date:** ${timestamp}  \n`;
    md += `**Total Unique Endpoints:** ${this.endpoints.size}  \n`;
    md += `**Media URLs Discovered:** ${this.mediaUrls.size}  \n`;
    md += `**User Profiles Found:** ${this.userProfiles.size}  \n\n`;
    
    // Authentication
    md += `## 🔐 Authentication & Tokens\n\n`;
    
    if (Object.keys(this.authTokens).length > 0) {
      md += `### Discovered Tokens\n\n`;
      Object.entries(this.authTokens).forEach(([type, token]) => {
        if (token && typeof token === 'string') {
          const masked = token.length > 20 ? token.substring(0, 10) + '...' + token.substring(token.length - 10) : token;
          md += `**${type}:** \`${masked}\`  \n`;
        }
      });
      md += `\n`;
    }
    
    md += `### Important Cookies\n\n`;
    const importantCookies = ['session', 'auth_token', 'csrf_token', 'user_id'];
    md += `| Cookie | Value | Domain | Secure |\n`;
    md += `|--------|-------|--------|--------|\n`;
    
    this.cookies.forEach((cookie, name) => {
      if (importantCookies.some(ic => name.includes(ic)) || cookie.httpOnly) {
        const value = cookie.value.length > 30 ? cookie.value.substring(0, 20) + '...' : cookie.value;
        md += `| ${name} | ${value} | ${cookie.domain} | ${cookie.secure} |\n`;
      }
    });
    md += `\n`;
    
    // API Endpoints by Category
    md += `## 🚀 API Endpoints by Category\n\n`;
    
    const categorized = this.categorizeEndpoints();
    Object.entries(categorized).forEach(([category, endpoints]) => {
      if (endpoints.length > 0) {
        md += `### ${category} (${endpoints.length} endpoints)\n\n`;
        
        endpoints.forEach(([key, data]) => {
          md += `#### ${data.method} ${data.url}\n\n`;
          
          // Show URL parameters from examples
          if (data.examples.length > 1) {
            const urlObj = new URL(data.examples[0]);
            if (urlObj.search) {
              md += `**Query Parameters:**\n`;
              urlObj.searchParams.forEach((value, key) => {
                md += `- \`${key}\`: ${value}\n`;
              });
              md += `\n`;
            }
          }
          
          // Show request payload
          if (data.payloads.length > 0) {
            md += `**Request Payload Example:**\n\`\`\`json\n`;
            md += JSON.stringify(data.payloads[0].data, null, 2);
            md += `\n\`\`\`\n\n`;
          }
          
          // Show response
          if (data.responses.length > 0 && data.responses[0].data) {
            md += `**Response (Status ${data.responses[0].status}):**\n\`\`\`json\n`;
            const responseStr = JSON.stringify(data.responses[0].data, null, 2);
            md += responseStr.length > 1000 ? responseStr.substring(0, 1000) + '\n...' : responseStr;
            md += `\n\`\`\`\n\n`;
          }
          
          md += `---\n\n`;
        });
      }
    });
    
    // How to Use
    md += `## 💡 How to Use These Endpoints\n\n`;
    md += `### Required Headers\n\n`;
    md += `\`\`\`json\n{\n`;
    md += `  "Authorization": "Bearer YOUR_ACCESS_TOKEN",\n`;
    md += `  "Content-Type": "application/json",\n`;
    md += `  "X-Requested-With": "XMLHttpRequest"\n`;
    md += `}\n\`\`\`\n\n`;
    
    md += `### Example: Get User Feed\n\n`;
    md += `\`\`\`python\n`;
    md += `import requests\n\n`;
    md += `headers = {\n`;
    md += `    'Authorization': f'Bearer {access_token}',\n`;
    md += `    'Content-Type': 'application/json'\n`;
    md += `}\n\n`;
    md += `response = requests.get(\n`;
    md += `    'https://fanvue.com/api/v1/posts/feed',\n`;
    md += `    headers=headers,\n`;
    md += `    params={'page': 1, 'limit': 20}\n`;
    md += `)\n`;
    md += `\`\`\`\n\n`;
    
    // Media URLs
    if (this.mediaUrls.size > 0) {
      md += `## 🖼️ Media CDN Patterns\n\n`;
      md += `Discovered ${this.mediaUrls.size} media URLs. Common patterns:\n\n`;
      
      const patterns = new Set();
      this.mediaUrls.forEach(url => {
        const match = url.match(/https:\/\/[^\/]+\/[^\/]+\//);
        if (match) patterns.add(match[0] + '...');
      });
      
      patterns.forEach(pattern => {
        md += `- \`${pattern}\`\n`;
      });
      md += `\n`;
    }
    
    return md;
  }

  categorizeEndpoints() {
    const categories = {
      'User & Profile APIs': [],
      'Content APIs': [],
      'Messaging APIs': [],
      'Payment & Subscription APIs': [],
      'Discovery APIs': [],
      'Analytics APIs': [],
      'Other APIs': []
    };
    
    this.endpoints.forEach((data, key) => {
      switch (data.category) {
        case 'users':
        case 'profile':
          categories['User & Profile APIs'].push([key, data]);
          break;
        case 'posts':
        case 'media-api':
        case 'stories':
        case 'bundles':
        case 'comments':
        case 'engagement':
          categories['Content APIs'].push([key, data]);
          break;
        case 'messages':
        case 'conversations':
          categories['Messaging APIs'].push([key, data]);
          break;
        case 'subscriptions':
        case 'payments':
        case 'wallet':
        case 'tips':
          categories['Payment & Subscription APIs'].push([key, data]);
          break;
        case 'explore':
        case 'search':
        case 'trending':
          categories['Discovery APIs'].push([key, data]);
          break;
        case 'analytics':
        case 'insights':
          categories['Analytics APIs'].push([key, data]);
          break;
        default:
          categories['Other APIs'].push([key, data]);
      }
    });
    
    return categories;
  }

  async saveReport(filename) {
    const markdown = this.generateMarkdown();
    await fs.writeFile(filename, markdown);
    console.log(`\n✅ Fanvue API report saved to ${filename}`);
    
    // Save raw data
    const jsonData = {
      endpoints: Array.from(this.endpoints.entries()),
      cookies: Array.from(this.cookies.values()),
      localStorage: this.localStorage,
      sessionStorage: this.sessionStorage,
      authTokens: this.authTokens,
      mediaUrls: Array.from(this.mediaUrls),
      userProfiles: Array.from(this.userProfiles)
    };
    
    const jsonFilename = filename.replace('.md', '.json');
    await fs.writeFile(jsonFilename, JSON.stringify(jsonData, null, 2));
    console.log(`📦 Raw data saved to ${jsonFilename}`);
  }
}

// Main
async function main() {
  const debugPort = 63812; // Fanvue profile port
  
  console.log('👑😈 Fanvue API Deep Recon Starting...');
  console.log('💰 This will discover UNIQUE endpoints across different areas');
  console.log('🔐 Capturing authentication tokens, API patterns, and media URLs');
  
  const recon = new FanvueAPIRecon(debugPort);
  await recon.connect();
  
  await recon.exploreUniqueFanvueEndpoints();
  
  const filename = `fanvue-api-recon-${Date.now()}.md`;
  await recon.saveReport(filename);
  
  console.log('\n🎉 Fanvue API reconnaissance complete!');
  console.log('💀 Use the discovered endpoints for automation');
}

main().catch(console.error);