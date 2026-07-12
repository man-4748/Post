const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for all routes (to allow local development tools if needed)
app.use(cors());

// Parse JSON payload for our proxy and mock endpoints
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.text({ limit: '50mb' }));

// Serve static files from the public folder
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Endpoint: /api/proxy
 * Proxies HTTP requests from the browser client to arbitrary target APIs to bypass CORS.
 */
app.post('/api/proxy', async (req, res) => {
  const { url, method, headers = {}, body, bodyType } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
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
      statusText: response.statusText,
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
 * Great for testing Headers, Auth, Query parameters, and request body structures.
 */
const mockEchoHandler = (req, res) => {
  // Capture request body based on Content-Type
  let parsedBody = req.body;
  if (req.headers['content-type'] && req.headers['content-type'].includes('multipart/form-data')) {
    // If it's multipart form-data, we can show a placeholder or string representation
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

// Handle frontend routing by sending index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`ThunderPost server running on http://localhost:${PORT}`);
});
