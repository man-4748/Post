const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const dns = require('dns').promises;

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for all routes (to allow local development tools if needed)
app.use(cors());

// Parse JSON/text/urlencoded payloads for our proxy and mock endpoints (reduced to 5MB for DoS mitigation)
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ limit: '5mb', extended: true }));
app.use(express.text({ limit: '5mb' }));

// Serve static files from the public folder
app.use(express.static(path.join(__dirname, 'public')));

// --- RATE LIMITING MIDDLEWARE ---
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute window
const RATE_LIMIT_MAX = 100; // max 100 proxy requests per minute per IP

// Periodically clean up rate limit cache map to prevent memory leaks over time
setInterval(() => {
  rateLimitMap.clear();
}, 5 * 60 * 1000); // Clear cache map every 5 minutes

function rateLimiter(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  
  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, []);
  }
  
  const timestamps = rateLimitMap.get(ip);
  const activeTimestamps = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW);
  
  if (activeTimestamps.length >= RATE_LIMIT_MAX) {
    return res.status(429).json({
      error: 'Too many requests',
      details: 'Rate limit exceeded for proxy requests. Please wait a minute and try again.'
    });
  }
  
  activeTimestamps.push(now);
  rateLimitMap.set(ip, activeTimestamps);
  next();
}

// --- SSRF SECURITY VALIDATION HANDLERS ---

function isPrivateIp(ip) {
  const ipv4Parts = ip.split('.');
  if (ipv4Parts.length === 4) {
    const first = parseInt(ipv4Parts[0], 10);
    const second = parseInt(ipv4Parts[1], 10);
    
    if (first === 127) return true; // Loopback
    if (first === 10) return true;  // Private Class A
    if (first === 172 && (second >= 16 && second <= 31)) return true; // Private Class B
    if (first === 192 && second === 168) return true; // Private Class C
    if (first === 169 && second === 254) return true; // Link-local (Cloud metadata)
    if (first === 0) return true;
  }
  
  const normalizedIpv6 = ip.toLowerCase().trim();
  if (
    normalizedIpv6 === '::1' || 
    normalizedIpv6 === '0:0:0:0:0:0:0:1' || 
    normalizedIpv6.startsWith('fe80:') || 
    normalizedIpv6.startsWith('fc00:') || 
    normalizedIpv6.startsWith('fd00:')
  ) {
    return true;
  }
  
  return false;
}

async function validateUrl(urlString) {
  const allowLocal = process.env.ALLOW_LOCAL_REQUESTS !== 'false';
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch (e) {
    throw new Error('Invalid or malformed URL syntax.');
  }
  
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS URL protocols are permitted.');
  }
  
  const hostname = parsed.hostname;
  
  // Directly allow local addresses only if developer local requests mode is enabled
  if (allowLocal && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1')) {
    return true;
  }
  
  let ip;
  try {
    const lookup = await dns.lookup(hostname);
    ip = lookup.address;
  } catch (e) {
    throw new Error(`Host DNS resolution failed: ${hostname}`);
  }
  
  if (isPrivateIp(ip)) {
    if (!allowLocal) {
      throw new Error(`SSRF Block: Access to private or local network IP space is forbidden: ${ip}`);
    }
  }
  
  return true;
}

/**
 * Endpoint: /api/proxy
 * Proxies HTTP requests from the browser client to arbitrary target APIs to bypass CORS.
 * Now protected with URL protocols verification, private IP checks, and rate-limiting.
 */
app.post('/api/proxy', rateLimiter, async (req, res) => {
  const { url, method, headers = {}, body, bodyType } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  // SSRF Validation check
  try {
    await validateUrl(url.trim());
  } catch (urlErr) {
    return res.status(400).json({ error: urlErr.message });
  }

  // Format request method and sanitize headers
  const upperMethod = (method || 'GET').toUpperCase();
  const requestHeaders = { ...headers };

  // Remove headers that might interfere with proxying or host resolution
  delete requestHeaders['host'];
  delete requestHeaders['content-length'];

  // Prepare the request data payload based on bodyType
  let requestData = null;

  if (upperMethod !== 'GET') {
    if (bodyType === 'json') {
      requestHeaders['content-type'] = requestHeaders['content-type'] || 'application/json';
      requestData = typeof body === 'string' ? body : JSON.stringify(body);
    } else if (bodyType === 'text') {
      requestHeaders['content-type'] = requestHeaders['content-type'] || 'text/plain';
      requestData = body;
    } else if (bodyType === 'urlencoded') {
      requestHeaders['content-type'] = 'application/x-www-form-urlencoded';
      if (Array.isArray(body)) {
        const params = new URLSearchParams();
        body.forEach(item => {
          if (item.key) params.append(item.key, item.value || '');
        });
        requestData = params.toString();
      } else {
        requestData = body;
      }
    } else if (bodyType === 'form-data') {
      // Manual multi-part form data formatting for text fields
      const boundary = '----ThunderPostFormBoundary' + Math.random().toString(36).substring(2);
      requestHeaders['content-type'] = `multipart/form-data; boundary=${boundary}`;
      
      let multipartBody = '';
      if (Array.isArray(body)) {
        body.forEach(item => {
          if (item.key) {
            multipartBody += `--${boundary}\r\n`;
            multipartBody += `Content-Disposition: form-data; name="${item.key}"\r\n\r\n`;
            multipartBody += `${item.value || ''}\r\n`;
          }
        });
        multipartBody += `--${boundary}--\r\n`;
        requestData = multipartBody;
      } else {
        requestData = body;
      }
    }
  }

  // Start execution timer
  const startTime = Date.now();

  try {
    const axiosConfig = {
      method: upperMethod,
      url: url,
      headers: requestHeaders,
      data: requestData,
      responseType: 'arraybuffer', // Retrieve response as binary buffer to handle both text & media
      validateStatus: () => true,  // Prevent throwing on 4xx/5xx responses
      timeout: 30000 // 30s timeout
    };

    const response = await axios(axiosConfig);
    const duration = Date.now() - startTime;

    const contentType = response.headers['content-type'] || '';
    let responseBody = '';
    let isBinary = false;

    // Check if the response is an image, PDF or other binary stream
    if (
      contentType.includes('image/') || 
      contentType.includes('pdf') || 
      contentType.includes('octet-stream') || 
      contentType.includes('zip')
    ) {
      isBinary = true;
      responseBody = Buffer.from(response.data).toString('base64');
    } else {
      responseBody = Buffer.from(response.data).toString('utf8');
    }

    // Measure approximate response size
    const size = response.data ? response.data.length : 0;

    res.json({
      status: response.status,
      statusText: response.statusText || '',
      headers: response.headers,
      body: responseBody,
      isBinary: isBinary,
      contentType: contentType,
      time: duration,
      size: size
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error('Proxy Request Error:', error.message);
    res.status(200).json({
      status: 0,
      statusText: 'Request Error',
      headers: {},
      body: JSON.stringify({
        error: 'Could not send request',
        details: error.message,
        hint: 'Please check the URL formatting, server connectivity, or proxy logs.'
      }, null, 2),
      isBinary: false,
      contentType: 'application/json',
      time: duration,
      size: 0
    });
  }
});

/**
 * Endpoint: /api/mock
 * A Mock endpoint that echoes back details of the request it received.
 */
const mockEchoHandler = (req, res) => {
  let parsedBody = req.body;
  if (req.headers['content-type'] && req.headers['content-type'].includes('multipart/form-data')) {
    parsedBody = "[Multipart Form Data]";
  }

  res.json({
    message: "ThunderPost Mock Echo Service",
    timestamp: new Date().toISOString(),
    request: {
      method: req.method,
      url: req.originalUrl,
      path: req.path,
      query: req.query,
      headers: req.headers,
      body: parsedBody
    }
  });
};

app.all('/api/mock', mockEchoHandler);
app.all('/api/mock/*', mockEchoHandler);

// Handle unmatched API routes strictly with a JSON 404 instead of index.html
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: 'API route not found' });
});

// Handle frontend SPA routing by sending index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start listening only if file is run directly
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`ThunderPost server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
