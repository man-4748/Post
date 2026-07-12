const http = require('http');

console.log('Starting integration tests for ThunderPost server...');

// Configure custom port for testing in-process
const TEST_PORT = 3001;
process.env.PORT = TEST_PORT;

// Require the app from server.js (does not start automatically because it's not run directly)
const app = require('./server.js');

// Start the server synchronously on the test port
const serverInstance = app.listen(TEST_PORT, () => {
  console.log(`Test server successfully listening on port ${TEST_PORT}`);
  runTests();
});

// Helper to make HTTP requests
function makeRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

async function runTests() {
  let testsPassed = 0;
  let testsFailed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`[PASS] ${message}`);
      testsPassed++;
    } else {
      console.error(`[FAIL] ${message}`);
      testsFailed++;
    }
  }

  try {
    // TEST 1: Check Mock Echo API directly
    console.log('\nRunning Test 1: GET /api/mock direct check...');
    const res1 = await makeRequest({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/mock?test=true',
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'X-Test-Header': 'ThunderTest'
      }
    });

    assert(res1.statusCode === 200, 'Mock Echo returns status 200');
    
    const body1 = JSON.parse(res1.body);
    assert(body1.message === 'ThunderPost Mock Echo Service', 'Mock Echo message matches');
    assert(body1.request.method === 'GET', 'Mock Echo method is GET');
    assert(body1.request.query.test === 'true', 'Mock query parameters are echoed');
    assert(body1.request.headers['x-test-header'] === 'ThunderTest', 'Mock headers are echoed');

    // TEST 2: Check Proxy API by routing a POST request to Mock Echo API
    console.log('\nRunning Test 2: POST /api/proxy -> POST /api/mock proxy check...');
    const proxyPayload = {
      url: `http://localhost:${TEST_PORT}/api/mock`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Proxied': 'Yes'
      },
      body: {
        hero: 'Thor',
        weapon: 'Mjolnir'
      },
      bodyType: 'json'
    };

    const res2 = await makeRequest({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/proxy',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, proxyPayload);

    assert(res2.statusCode === 200, 'Proxy returns status 200');
    
    const proxyResult = JSON.parse(res2.body);
    assert(proxyResult.status === 200, 'Proxied response returns target status 200');
    assert(proxyResult.time > 0, 'Proxy calculates response time');
    assert(proxyResult.size > 0, 'Proxy calculates response body size');
    
    const proxiedBody = JSON.parse(proxyResult.body);
    assert(proxiedBody.request.method === 'POST', 'Proxy forwarded POST method');
    assert(proxiedBody.request.headers['x-proxied'] === 'Yes', 'Proxy forwarded X-Proxied header');
    assert(proxiedBody.request.body.hero === 'Thor', 'Proxy forwarded JSON request body');

    // TEST 3: Check Proxy handles custom HTTP QUERY method
    console.log('\nRunning Test 3: POST /api/proxy -> QUERY /api/mock proxy check...');
    const queryPayload = {
      url: `http://localhost:${TEST_PORT}/api/mock`,
      method: 'QUERY',
      headers: {
        'Content-Type': 'application/json'
      },
      body: {
        select: 'username',
        from: 'users'
      },
      bodyType: 'json'
    };

    const res3 = await makeRequest({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/proxy',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, queryPayload);

    assert(res3.statusCode === 200, 'Proxy accepts QUERY request');
    const queryResult = JSON.parse(res3.body);
    assert(queryResult.status === 200, 'Target returns 200 for QUERY method');
    
    const queryBodyResult = JSON.parse(queryResult.body);
    assert(queryBodyResult.request.method === 'QUERY', 'Proxy forwarded QUERY method');
    assert(queryBodyResult.request.body.select === 'username', 'Proxy forwarded QUERY body payload');

    // TEST 4: Check Proxy SSRF rejection (when ALLOW_LOCAL_REQUESTS is false)
    console.log('\nRunning Test 4: SSRF block check (127.0.0.1 blocked)...');
    // Temporarily override ALLOW_LOCAL_REQUESTS mode to test proxy SSRF block
    process.env.ALLOW_LOCAL_REQUESTS = 'false';
    
    // We need to re-require server/app to pick up new env or test with internal check.
    // Wait, since validateUrl checks process.env.ALLOW_LOCAL_REQUESTS at runtime, setting it here affects it!
    const ssrfPayload = {
      url: `http://127.0.0.1:${TEST_PORT}/api/mock`,
      method: 'GET'
    };

    const res4 = await makeRequest({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/proxy',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, ssrfPayload);

    // Proxy returns 400 Bad Request for SSRF violations
    assert(res4.statusCode === 400, 'Proxy rejects private URL with status 400');
    const ssrfResult = JSON.parse(res4.body);
    assert(ssrfResult.error.includes('SSRF Block'), 'Proxy returns correct SSRF block error message');

    // Restore ALLOW_LOCAL_REQUESTS for developer local usage
    process.env.ALLOW_LOCAL_REQUESTS = 'true';

  } catch (err) {
    console.error('Integration test encountered an exception:', err);
    testsFailed++;
  } finally {
    console.log('\nClosing test server...');
    serverInstance.close(() => {
      console.log('Test server shut down successfully.');
      console.log('\n=======================================');
      console.log(`Tests finished. PASSED: ${testsPassed}, FAILED: ${testsFailed}`);
      console.log('=======================================');
      process.exit(testsFailed > 0 ? 1 : 0);
    });
  }
}
