/**
 * ThunderPost API Client - Frontend Application Logic
 */

// --- APPLICATION STATE STORES ---
let state = {
  collections: [],
  environments: [],
  activeEnvId: 'none',
  history: [],
  currentRequest: {
    id: null,
    name: 'Untitled Request',
    method: 'GET',
    url: '{{BASE_URL}}/api/mock',
    params: [{ key: 'page', value: '1', enabled: true }, { key: '', value: '', enabled: true }],
    headers: [
      { key: 'Accept', value: 'application/json', enabled: true },
      { key: 'X-Developer', value: 'ThunderPost User', enabled: true },
      { key: '', value: '', enabled: true }
    ],
    bodyType: 'none',
    bodyText: '{\n  "message": "Hello from ThunderPost!"\n}',
    bodyKV: [{ key: '', value: '', enabled: true }],
    auth: {
      type: 'none',
      bearer: '',
      basicUsername: '',
      basicPassword: '',
      apiKeyKey: '',
      apiKeyValue: '',
      apiKeyLocation: 'header'
    }
  },
  response: null,
  activeSidebarTab: 'collections',
  activeRequestTab: 'params',
  activeResponseTab: 'res-body',
  snippetLang: 'curl',
  // Tracking if current request has unsaved changes relative to its stored state
  isDirty: false,
  abortController: null,
  isSending: false
};

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
  loadFromLocalStorage();
  initializeUI();
  
  // Theme load-out
  const savedTheme = localStorage.getItem('thunderpost_theme') || 'dark';
  if (savedTheme === 'light') {
    document.body.classList.add('light-theme');
  }
  renderThemeIcons();
  
  // Set default initial URL to match our default environment
  syncUrlInputs();
  renderAll();
});

// --- PERSISTENCE (LOCAL STORAGE) ---
function loadFromLocalStorage() {
  try {
    const storedCollections = localStorage.getItem('thunderpost_collections');
    if (storedCollections) {
      state.collections = JSON.parse(storedCollections);
    } else {
      // Load default template collections for first-time use
      state.collections = [
        {
          id: 'coll_default_mock',
          name: 'ThunderPost Examples',
          requests: [
            {
              id: 'req_mock_get',
              name: 'GET Mock Echo',
              method: 'GET',
              url: '{{BASE_URL}}/api/mock?platform=web&version=1.0',
              params: [
                { key: 'platform', value: 'web', enabled: true },
                { key: 'version', value: '1.0', enabled: true },
                { key: '', value: '', enabled: true }
              ],
              headers: [
                { key: 'Accept', value: 'application/json', enabled: true },
                { key: 'Authorization', value: 'Bearer {{API_KEY}}', enabled: true },
                { key: '', value: '', enabled: true }
              ],
              bodyType: 'none',
              bodyText: '',
              bodyKV: [{ key: '', value: '', enabled: true }],
              auth: { type: 'none', bearer: '', basicUsername: '', basicPassword: '', apiKeyKey: '', apiKeyValue: '', apiKeyLocation: 'header' }
            },
            {
              id: 'req_mock_post',
              name: 'POST JSON Echo',
              method: 'POST',
              url: '{{BASE_URL}}/api/mock',
              params: [{ key: '', value: '', enabled: true }],
              headers: [
                { key: 'Content-Type', value: 'application/json', enabled: true },
                { key: '', value: '', enabled: true }
              ],
              bodyType: 'json',
              bodyText: '{\n  "name": "Jane Doe",\n  "role": "Lead Engineer",\n  "skills": ["JavaScript", "Node.js", "Express"]\n}',
              bodyKV: [{ key: '', value: '', enabled: true }],
              auth: { type: 'none', bearer: '', basicUsername: '', basicPassword: '', apiKeyKey: '', apiKeyValue: '', apiKeyLocation: 'header' }
            },
            {
              id: 'req_mock_query',
              name: 'HTTP QUERY Method Demo',
              method: 'QUERY',
              url: '{{BASE_URL}}/api/mock/search',
              params: [{ key: '', value: '', enabled: true }],
              headers: [
                { key: 'Content-Type', value: 'application/json', enabled: true },
                { key: '', value: '', enabled: true }
              ],
              bodyType: 'json',
              bodyText: '{\n  "query": "SELECT id, name FROM users WHERE role = \'admin\' LIMIT 5"\n}',
              bodyKV: [{ key: '', value: '', enabled: true }],
              auth: { type: 'none', bearer: '', basicUsername: '', basicPassword: '', apiKeyKey: '', apiKeyValue: '', apiKeyLocation: 'header' }
            }
          ]
        }
      ];
      saveCollections();
    }

    const storedEnvironments = localStorage.getItem('thunderpost_environments');
    if (storedEnvironments) {
      state.environments = JSON.parse(storedEnvironments);
    } else {
      // Pre-load default Environment variables
      state.environments = [
        {
          id: 'env_localhost',
          name: 'Local Server',
          variables: [
            { key: 'BASE_URL', value: 'http://localhost:3000' },
            { key: 'API_KEY', value: 'thunderpost-token-999' }
          ]
        },
        {
          id: 'env_httpbin',
          name: 'HttpBin Endpoint',
          variables: [
            { key: 'BASE_URL', value: 'https://httpbin.org' }
          ]
        }
      ];
      saveEnvironments();
    }

    state.activeEnvId = localStorage.getItem('thunderpost_active_env_id') || 'env_localhost';

    const storedHistory = localStorage.getItem('thunderpost_history');
    if (storedHistory) {
      state.history = JSON.parse(storedHistory);
    }
  } catch (error) {
    console.error('Error loading local storage state', error);
  }
}

function saveCollections() {
  localStorage.setItem('thunderpost_collections', JSON.stringify(state.collections));
}

function saveEnvironments() {
  localStorage.setItem('thunderpost_environments', JSON.stringify(state.environments));
}

function saveHistory() {
  localStorage.setItem('thunderpost_history', JSON.stringify(state.history));
}

// --- VARIABLE RESOLUTION ---
/**
 * Interpolates environment variables formatted like {{VARIABLE_NAME}} in the target text.
 */
function resolveVariables(text) {
  if (!text || typeof text !== 'string') return text;
  
  const activeEnv = state.environments.find(e => e.id === state.activeEnvId);
  if (!activeEnv) return text;
  
  return text.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const trimKey = key.trim();
    const variable = activeEnv.variables.find(v => v.key === trimKey);
    return variable ? variable.value : match;
  });
}

// --- PARSE AND SYNC URL QUERY PARAMETERS ---
/**
 * Splits url input value and extracts query parameters, syncing them with State and params grid UI.
 */
function syncUrlToParamsState() {
  const urlVal = document.getElementById('request-url').value;
  try {
    // Strip URL fragment hash first
    const urlWithoutHash = urlVal.split('#')[0];
    const urlParts = urlWithoutHash.split('?');
    if (urlParts.length > 1) {
      const queryString = urlParts[1];
      const searchParams = new URLSearchParams(queryString);
      
      const newParams = [];
      for (const [key, value] of searchParams.entries()) {
        newParams.push({ key, value, enabled: true });
      }
      
      newParams.push({ key: '', value: '', enabled: true });
      state.currentRequest.params = newParams;
    } else {
      state.currentRequest.params = [{ key: '', value: '', enabled: true }];
    }
    renderParamsGrid();
  } catch (err) {
    console.error('Error parsing URL query params:', err);
  }
}

/**
 * Builds a query string from enabled key-value param rows and appends it to the base URL input.
 * Decodes already-encoded values to prevent URLSearchParams from double-encoding them.
 */
function syncParamsStateToUrlInput() {
  const urlInput = document.getElementById('request-url');
  const urlVal = urlInput.value;
  
  // Extract base path, stripping query and hash
  const urlWithoutHash = urlVal.split('#')[0];
  const basePath = urlWithoutHash.split('?')[0];
  
  // Keep track of hash to re-append it at the end
  const hashParts = urlVal.split('#');
  const hash = hashParts.length > 1 ? '#' + hashParts[1] : '';

  const activeParams = state.currentRequest.params.filter(p => p.enabled && p.key);
  
  function safeDecode(val) {
    try {
      if (/%[0-9a-fA-F]{2}/.test(val)) {
        return decodeURIComponent(val);
      }
    } catch (e) {}
    return val;
  }

  if (activeParams.length > 0) {
    const searchParams = new URLSearchParams();
    activeParams.forEach(p => searchParams.append(safeDecode(p.key), safeDecode(p.value)));
    urlInput.value = basePath + '?' + searchParams.toString() + hash;
  } else {
    urlInput.value = basePath + hash;
  }
}

function syncUrlInputs() {
  const urlInput = document.getElementById('request-url');
  urlInput.value = state.currentRequest.url;
  
  const methodSelect = document.getElementById('request-method');
  methodSelect.value = state.currentRequest.method;
}

// --- DOM BINDINGS & UI CONTROLLERS ---
function initializeUI() {
  // Sidebar navigation tabs
  document.querySelectorAll('[data-sidebar-tab]').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('[data-sidebar-tab]').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.sidebar-content .tab-panel').forEach(p => p.classList.remove('active'));
      
      tab.classList.add('active');
      const targetPanel = document.getElementById(`panel-${tab.dataset.sidebarTab}`);
      targetPanel.classList.add('active');
      state.activeSidebarTab = tab.dataset.sidebarTab;
    });
  });

  // Main Builder Tabs switcher
  document.querySelectorAll('.request-builder [data-tab]').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.request-builder [data-tab]').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.request-builder .w-tab-panel').forEach(p => p.classList.remove('active'));
      
      tab.classList.add('active');
      const targetPanel = document.getElementById(`w-panel-${tab.dataset.tab}`);
      targetPanel.classList.add('active');
      state.activeRequestTab = tab.dataset.tab;
    });
  });

  // Response Tabs switcher
  document.querySelectorAll('.response-viewer [data-tab]').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.response-viewer [data-tab]').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.response-viewer .w-tab-panel').forEach(p => p.classList.remove('active'));
      
      tab.classList.add('active');
      const targetPanel = document.getElementById(`w-panel-${tab.dataset.tab}`);
      targetPanel.classList.add('active');
      state.activeResponseTab = tab.dataset.tab;
    });
  });

  // URL input keypress sync
  const urlInput = document.getElementById('request-url');
  urlInput.addEventListener('input', () => {
    state.currentRequest.url = urlInput.value;
    state.isDirty = true;
    syncUrlToParamsState();
    updateCodeSnippet();
  });

  // Method select change
  const methodSelect = document.getElementById('request-method');
  methodSelect.addEventListener('change', () => {
    state.currentRequest.method = methodSelect.value;
    state.isDirty = true;
    updateCodeSnippet();
  });

  // Body format radio buttons
  document.querySelectorAll('input[name="body-type"]').forEach(radio => {
    radio.addEventListener('change', () => {
      state.currentRequest.bodyType = radio.value;
      state.isDirty = true;
      renderBodyConfigurator();
      updateCodeSnippet();
    });
  });

  // Raw body text editor input
  const bodyTextEditor = document.getElementById('body-text-editor');
  bodyTextEditor.addEventListener('input', () => {
    state.currentRequest.bodyText = bodyTextEditor.value;
    state.isDirty = true;
    validateJsonInput();
    updateCodeSnippet();
  });

  // Auth type select
  const authTypeSelect = document.getElementById('auth-type-select');
  authTypeSelect.addEventListener('change', () => {
    state.currentRequest.auth.type = authTypeSelect.value;
    state.isDirty = true;
    renderAuthConfigurator();
    updateCodeSnippet();
  });

  // Auth credential fields
  document.getElementById('auth-bearer-token').addEventListener('input', (e) => {
    state.currentRequest.auth.bearer = e.target.value;
    state.isDirty = true;
    updateCodeSnippet();
  });
  document.getElementById('auth-basic-username').addEventListener('input', (e) => {
    state.currentRequest.auth.basicUsername = e.target.value;
    state.isDirty = true;
    updateCodeSnippet();
  });
  document.getElementById('auth-basic-password').addEventListener('input', (e) => {
    state.currentRequest.auth.basicPassword = e.target.value;
    state.isDirty = true;
    updateCodeSnippet();
  });
  document.getElementById('auth-apikey-key').addEventListener('input', (e) => {
    state.currentRequest.auth.apiKeyKey = e.target.value;
    state.isDirty = true;
    updateCodeSnippet();
  });
  document.getElementById('auth-apikey-value').addEventListener('input', (e) => {
    state.currentRequest.auth.apiKeyValue = e.target.value;
    state.isDirty = true;
    updateCodeSnippet();
  });
  document.getElementById('auth-apikey-location').addEventListener('change', (e) => {
    state.currentRequest.auth.apiKeyLocation = e.target.value;
    state.isDirty = true;
    updateCodeSnippet();
  });

  // Request Name change
  const requestNameEl = document.getElementById('request-name');
  requestNameEl.addEventListener('blur', () => {
    const value = requestNameEl.innerText.trim();
    state.currentRequest.name = value || 'Untitled Request';
    state.isDirty = true;
  });
  requestNameEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      requestNameEl.blur();
    }
  });

  // Environment Selector change
  const envSelect = document.getElementById('active-env-select');
  envSelect.addEventListener('change', () => {
    state.activeEnvId = envSelect.value;
    localStorage.setItem('thunderpost_active_env_id', state.activeEnvId);
    renderEnvironmentsTab();
    updateCodeSnippet();
  });

  // Send request execution button
  document.getElementById('btn-send-request').addEventListener('click', sendRequest);

  // Collections action buttons
  document.getElementById('btn-new-collection').addEventListener('click', () => showModal('create-collection-modal'));
  document.getElementById('btn-import-collection').addEventListener('click', triggerImportCollection);
  document.getElementById('btn-save-request').addEventListener('click', handleSaveRequest);
  document.getElementById('btn-save-request-as').addEventListener('click', () => handleSaveRequest(true));

  // Environment actions
  document.getElementById('btn-new-environment').addEventListener('click', createEnvironment);
  document.getElementById('btn-add-env-var').addEventListener('click', () => {
    const activeEnv = state.environments.find(e => e.id === state.activeEnvId);
    if (activeEnv) {
      activeEnv.variables.push({ key: '', value: '' });
      renderActiveEnvEditor();
      saveEnvironments();
    }
  });
  document.getElementById('btn-close-env-editor').addEventListener('click', () => {
    document.getElementById('env-vars-editor').style.display = 'none';
  });

  // History action buttons
  document.getElementById('btn-clear-history').addEventListener('click', () => {
    state.history = [];
    saveHistory();
    renderHistoryTab();
  });

  // Response quick actions
  document.getElementById('btn-copy-response').addEventListener('click', copyResponseToClipboard);
  document.getElementById('btn-download-response').addEventListener('click', downloadResponseBody);

  // Snippets language selection
  document.getElementById('snippet-lang-select').addEventListener('change', (e) => {
    state.snippetLang = e.target.value;
    updateCodeSnippet();
  });
  document.getElementById('btn-copy-snippet').addEventListener('click', copySnippetToClipboard);

  // Key-value additions
  document.getElementById('btn-add-param').addEventListener('click', () => {
    state.currentRequest.params.push({ key: '', value: '', enabled: true });
    renderParamsGrid();
  });
  document.getElementById('btn-add-header').addEventListener('click', () => {
    state.currentRequest.headers.push({ key: '', value: '', enabled: true });
    renderHeadersGrid();
  });
  document.getElementById('btn-add-body-kv').addEventListener('click', () => {
    state.currentRequest.bodyKV.push({ key: '', value: '', enabled: true });
    renderBodyKVGrid();
  });

  // Modal Cancel handlers
  document.querySelectorAll('.modal-close-btn, #btn-modal-cancel, #btn-coll-modal-cancel').forEach(btn => {
    btn.addEventListener('click', hideModals);
  });

  document.getElementById('btn-coll-modal-create').addEventListener('click', handleCreateCollection);
  document.getElementById('btn-modal-save').addEventListener('click', handleSaveRequestSubmit);
  document.getElementById('btn-theme-toggle').addEventListener('click', toggleTheme);

  // Response search bar toggles
  document.getElementById('btn-search-response').addEventListener('click', toggleResponseSearch);
  document.getElementById('btn-close-search').addEventListener('click', closeResponseSearch);
  document.getElementById('response-search-input').addEventListener('input', debounce(executeResponseSearch, 200));

  // Global Keyboard Shortcuts
  document.addEventListener('keydown', (e) => {
    // Ctrl+Enter or Cmd+Enter to send request
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      sendRequest();
    }
    // Ctrl+S or Cmd+S to save request
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      handleSaveRequest();
    }
    // Ctrl+F or Cmd+F to search response body
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      if (state.response) {
        e.preventDefault();
        toggleResponseSearch();
      }
    }
    // Escape to close search
    if (e.key === 'Escape') {
      closeResponseSearch();
    }
  });
}

// --- RENDER FUNCTIONS ---
function renderAll() {
  renderActiveRequest();
  renderCollectionsTab();
  renderEnvironmentsTab();
  renderHistoryTab();
  updateCodeSnippet();
}

function renderActiveRequest() {
  document.getElementById('request-name').innerText = state.currentRequest.name;
  syncUrlInputs();
  
  // Set headers count badge
  const activeHeadersCount = state.currentRequest.headers.filter(h => h.key && h.enabled).length;
  document.getElementById('badge-headers-count').innerText = activeHeadersCount;
  
  // Select active body type radio button
  const bodyRadio = document.querySelector(`input[name="body-type"][value="${state.currentRequest.bodyType}"]`);
  if (bodyRadio) bodyRadio.checked = true;
  
  // Select active auth type select option
  const authSelect = document.getElementById('auth-type-select');
  authSelect.value = state.currentRequest.auth.type;
  
  // Populate auth values
  document.getElementById('auth-bearer-token').value = state.currentRequest.auth.bearer;
  document.getElementById('auth-basic-username').value = state.currentRequest.auth.basicUsername;
  document.getElementById('auth-basic-password').value = state.currentRequest.auth.basicPassword;
  document.getElementById('auth-apikey-key').value = state.currentRequest.auth.apiKeyKey;
  document.getElementById('auth-apikey-value').value = state.currentRequest.auth.apiKeyValue;
  document.getElementById('auth-apikey-location').value = state.currentRequest.auth.apiKeyLocation;

  renderParamsGrid();
  renderHeadersGrid();
  renderBodyConfigurator();
  renderAuthConfigurator();
  renderResponsePane();
}

// Params key-value editor
function renderParamsGrid() {
  const container = document.getElementById('params-rows-container');
  container.innerHTML = '';
  
  state.currentRequest.params.forEach((param, index) => {
    const row = document.createElement('div');
    row.className = 'kv-row';
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = param.enabled;
    checkbox.addEventListener('change', () => {
      param.enabled = checkbox.checked;
      state.isDirty = true;
      syncParamsStateToUrlInput();
      updateCodeSnippet();
    });
    
    const keyInput = document.createElement('input');
    keyInput.type = 'text';
    keyInput.placeholder = 'Key';
    keyInput.value = param.key;
    keyInput.addEventListener('input', () => {
      param.key = keyInput.value;
      state.isDirty = true;
      
      // Auto-append another row if typing in the last one
      if (index === state.currentRequest.params.length - 1 && param.key !== '') {
        state.currentRequest.params.push({ key: '', value: '', enabled: true });
        renderParamsGrid();
      }
      
      syncParamsStateToUrlInput();
      updateCodeSnippet();
    });
    
    const valInput = document.createElement('input');
    valInput.type = 'text';
    valInput.placeholder = 'Value';
    valInput.value = param.value;
    valInput.addEventListener('input', () => {
      param.value = valInput.value;
      state.isDirty = true;
      
      if (index === state.currentRequest.params.length - 1 && param.value !== '') {
        state.currentRequest.params.push({ key: '', value: '', enabled: true });
        renderParamsGrid();
      }
      
      syncParamsStateToUrlInput();
      updateCodeSnippet();
    });
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-icon-only';
    deleteBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
    deleteBtn.addEventListener('click', () => {
      // Don't delete if it's the only row left
      if (state.currentRequest.params.length === 1) {
        state.currentRequest.params = [{ key: '', value: '', enabled: true }];
      } else {
        state.currentRequest.params.splice(index, 1);
      }
      state.isDirty = true;
      renderParamsGrid();
      syncParamsStateToUrlInput();
      updateCodeSnippet();
    });
    
    row.appendChild(checkbox);
    row.appendChild(keyInput);
    row.appendChild(valInput);
    row.appendChild(deleteBtn);
    container.appendChild(row);
  });
}

// Headers key-value editor
function renderHeadersGrid() {
  const container = document.getElementById('headers-rows-container');
  container.innerHTML = '';
  
  state.currentRequest.headers.forEach((header, index) => {
    const row = document.createElement('div');
    row.className = 'kv-row';
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = header.enabled;
    checkbox.addEventListener('change', () => {
      header.enabled = checkbox.checked;
      state.isDirty = true;
      
      // Update badge count
      const activeHeadersCount = state.currentRequest.headers.filter(h => h.key && h.enabled).length;
      document.getElementById('badge-headers-count').innerText = activeHeadersCount;
      updateCodeSnippet();
    });
    
    const keyInput = document.createElement('input');
    keyInput.type = 'text';
    keyInput.placeholder = 'Header';
    keyInput.value = header.key;
    keyInput.setAttribute('list', 'headers-autocomplete');
    keyInput.addEventListener('input', () => {
      header.key = keyInput.value;
      state.isDirty = true;
      
      if (index === state.currentRequest.headers.length - 1 && header.key !== '') {
        state.currentRequest.headers.push({ key: '', value: '', enabled: true });
        renderHeadersGrid();
      }
      
      // Update badge count
      const activeHeadersCount = state.currentRequest.headers.filter(h => h.key && h.enabled).length;
      document.getElementById('badge-headers-count').innerText = activeHeadersCount;
      updateCodeSnippet();
    });
    
    const valInput = document.createElement('input');
    valInput.type = 'text';
    valInput.placeholder = 'Value';
    valInput.value = header.value;
    
    // Auto suggest content-types if key is Content-Type
    keyInput.addEventListener('change', () => {
      if (keyInput.value.toLowerCase() === 'content-type') {
        valInput.setAttribute('list', 'content-types-autocomplete');
      } else {
        valInput.removeAttribute('list');
      }
    });
    
    valInput.addEventListener('input', () => {
      header.value = valInput.value;
      state.isDirty = true;
      
      if (index === state.currentRequest.headers.length - 1 && header.value !== '') {
        state.currentRequest.headers.push({ key: '', value: '', enabled: true });
        renderHeadersGrid();
      }
      updateCodeSnippet();
    });
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-icon-only';
    deleteBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
    deleteBtn.addEventListener('click', () => {
      if (state.currentRequest.headers.length === 1) {
        state.currentRequest.headers = [{ key: '', value: '', enabled: true }];
      } else {
        state.currentRequest.headers.splice(index, 1);
      }
      state.isDirty = true;
      renderHeadersGrid();
      
      const activeHeadersCount = state.currentRequest.headers.filter(h => h.key && h.enabled).length;
      document.getElementById('badge-headers-count').innerText = activeHeadersCount;
      updateCodeSnippet();
    });
    
    row.appendChild(checkbox);
    row.appendChild(keyInput);
    row.appendChild(valInput);
    row.appendChild(deleteBtn);
    container.appendChild(row);
  });
}

// Body tab toggles
function renderBodyConfigurator() {
  const textEditor = document.getElementById('body-text-editor-container');
  const kvEditor = document.getElementById('body-kv-editor-container');
  const emptyMsg = document.getElementById('body-empty-message');
  
  textEditor.style.display = 'none';
  kvEditor.style.display = 'none';
  emptyMsg.style.display = 'none';
  
  const type = state.currentRequest.bodyType;
  if (type === 'none') {
    emptyMsg.style.display = 'flex';
  } else if (type === 'json' || type === 'text') {
    textEditor.style.display = 'flex';
    document.getElementById('body-text-editor').value = state.currentRequest.bodyText;
    validateJsonInput();
  } else if (type === 'form-data' || type === 'urlencoded') {
    kvEditor.style.display = 'flex';
    renderBodyKVGrid();
  }
}

// Body Key-Value fields editor (for multipart and urlencoded)
function renderBodyKVGrid() {
  const container = document.getElementById('body-kv-rows-container');
  container.innerHTML = '';
  
  state.currentRequest.bodyKV.forEach((field, index) => {
    const row = document.createElement('div');
    row.className = 'kv-row';
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = field.enabled;
    checkbox.addEventListener('change', () => {
      field.enabled = checkbox.checked;
      state.isDirty = true;
      updateCodeSnippet();
    });
    
    const keyInput = document.createElement('input');
    keyInput.type = 'text';
    keyInput.placeholder = 'Key';
    keyInput.value = field.key;
    keyInput.addEventListener('input', () => {
      field.key = keyInput.value;
      state.isDirty = true;
      
      if (index === state.currentRequest.bodyKV.length - 1 && field.key !== '') {
        state.currentRequest.bodyKV.push({ key: '', value: '', enabled: true });
        renderBodyKVGrid();
      }
      updateCodeSnippet();
    });
    
    const valInput = document.createElement('input');
    valInput.type = 'text';
    valInput.placeholder = 'Value';
    valInput.value = field.value;
    valInput.addEventListener('input', () => {
      field.value = valInput.value;
      state.isDirty = true;
      
      if (index === state.currentRequest.bodyKV.length - 1 && field.value !== '') {
        state.currentRequest.bodyKV.push({ key: '', value: '', enabled: true });
        renderBodyKVGrid();
      }
      updateCodeSnippet();
    });
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-icon-only';
    deleteBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
    deleteBtn.addEventListener('click', () => {
      if (state.currentRequest.bodyKV.length === 1) {
        state.currentRequest.bodyKV = [{ key: '', value: '', enabled: true }];
      } else {
        state.currentRequest.bodyKV.splice(index, 1);
      }
      state.isDirty = true;
      renderBodyKVGrid();
      updateCodeSnippet();
    });
    
    row.appendChild(checkbox);
    row.appendChild(keyInput);
    row.appendChild(valInput);
    row.appendChild(deleteBtn);
    container.appendChild(row);
  });
}

function validateJsonInput() {
  const feedback = document.getElementById('json-validation-msg');
  if (state.currentRequest.bodyType !== 'json') {
    feedback.innerText = '';
    return;
  }
  
  const text = state.currentRequest.bodyText;
  if (!text.trim()) {
    feedback.innerText = 'Empty body';
    feedback.className = 'json-validation-info';
    return;
  }
  
  try {
    JSON.parse(text);
    feedback.innerText = '✓ Valid JSON';
    feedback.className = 'json-validation-info json-valid';
  } catch (err) {
    feedback.innerText = `✗ Invalid JSON: ${err.message}`;
    feedback.className = 'json-validation-info json-invalid';
  }
}

// Auth UI panel switches
function renderAuthConfigurator() {
  // Hide all sub-panels
  document.getElementById('auth-panel-bearer').style.display = 'none';
  document.getElementById('auth-panel-basic').style.display = 'none';
  document.getElementById('auth-panel-apikey').style.display = 'none';
  
  const selectedType = state.currentRequest.auth.type;
  if (selectedType === 'bearer') {
    document.getElementById('auth-panel-bearer').style.display = 'flex';
  } else if (selectedType === 'basic') {
    document.getElementById('auth-panel-basic').style.display = 'flex';
  } else if (selectedType === 'apikey') {
    document.getElementById('auth-panel-apikey').style.display = 'flex';
  }
}

// --- SIDEBAR TABS RENDERING ---

// Collections Panel
function renderCollectionsTab() {
  const container = document.getElementById('collections-tree');
  container.innerHTML = '';
  
  if (state.collections.length === 0) {
    container.innerHTML = '<div class="empty-state">No collections created yet.</div>';
    return;
  }
  
  // Filter query
  const query = document.getElementById('collection-search').value.toLowerCase();
  
  state.collections.forEach(collection => {
    const filteredRequests = collection.requests.filter(r => 
      r.name.toLowerCase().includes(query) || 
      r.url.toLowerCase().includes(query) ||
      collection.name.toLowerCase().includes(query)
    );
    
    // Skip rendering this collection if search query hides it completely
    if (query && filteredRequests.length === 0 && !collection.name.toLowerCase().includes(query)) {
      return;
    }
    
    const node = document.createElement('div');
    node.className = 'tree-node-collapsible';
    
    const header = document.createElement('div');
    header.className = 'collection-header-row';
    
    // Save expanded states in a global temporary object or standard dataset
    const isExpanded = collection.id === 'coll_default_mock' || collection.isExpanded === true;
    
    header.innerHTML = `
      <div class="coll-title-area">
        <svg class="chevron-icon ${isExpanded ? 'expanded' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
        <svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
        <span class="req-name-text">${escapeHtml(collection.name)}</span>
      </div>
      <div class="coll-actions">
        <button class="btn-icon-only btn-rename-coll" title="Rename Collection">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4z"></path></svg>
        </button>
        <button class="btn-icon-only btn-export-coll" title="Export Collection">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
        </button>
        <button class="btn-icon-only btn-add-req" title="Add request to collection">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        </button>
        <button class="btn-icon-only btn-delete-coll" title="Delete Collection">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </div>
    `;
    
    // Toggle Collapse
    header.querySelector('.coll-title-area').addEventListener('click', (e) => {
      collection.isExpanded = !isExpanded;
      renderCollectionsTab();
    });
    
    // Rename Collection
    header.querySelector('.btn-rename-coll').addEventListener('click', (e) => {
      e.stopPropagation();
      const newName = prompt('Enter new collection name:', collection.name);
      if (newName && newName.trim()) {
        collection.name = newName.trim();
        saveCollections();
        renderCollectionsTab();
      }
    });

    // Export Collection
    header.querySelector('.btn-export-coll').addEventListener('click', (e) => {
      e.stopPropagation();
      exportCollection(collection.id);
    });

    // Add Request to collection
    header.querySelector('.btn-add-req').addEventListener('click', (e) => {
      e.stopPropagation();
      const newReq = {
        id: 'req_' + Date.now(),
        name: 'New Request',
        method: 'GET',
        url: 'http://localhost:3000/api/mock',
        params: [{ key: '', value: '', enabled: true }],
        headers: [{ key: '', value: '', enabled: true }],
        bodyType: 'none',
        bodyText: '',
        bodyKV: [{ key: '', value: '', enabled: true }],
        auth: { type: 'none', bearer: '', basicUsername: '', basicPassword: '', apiKeyKey: '', apiKeyValue: '', apiKeyLocation: 'header' }
      };
      collection.requests.push(newReq);
      collection.isExpanded = true;
      saveCollections();
      loadRequestIntoBuilder(newReq.id);
      renderCollectionsTab();
    });
    
    // Delete Collection
    header.querySelector('.btn-delete-coll').addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`Are you sure you want to delete collection "${collection.name}"?`)) {
        state.collections = state.collections.filter(c => c.id !== collection.id);
        saveCollections();
        renderCollectionsTab();
      }
    });

    node.appendChild(header);

    // Requests list
    if (isExpanded) {
      const list = document.createElement('div');
      list.className = 'collection-requests-list';
      
      const reqSource = query ? filteredRequests : collection.requests;
      
      if (reqSource.length === 0) {
        list.innerHTML = `<div class="empty-state" style="height: 40px; padding: 4px;">Empty Collection</div>`;
      } else {
        reqSource.forEach(req => {
          const item = document.createElement('div');
          item.className = `collection-req-item ${state.currentRequest.id === req.id ? 'active' : ''}`;
          
          item.innerHTML = `
            <div class="req-badge-name">
              <span class="method-badge method-${req.method.toLowerCase()}">${req.method}</span>
              <span class="req-name-text">${escapeHtml(req.name)}</span>
            </div>
            <div class="req-item-actions">
              <button class="btn-icon-only btn-rename-req" title="Rename request">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4z"></path></svg>
              </button>
              <button class="btn-icon-only btn-delete-req" title="Delete request">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              </button>
            </div>
          `;
          
          // Click request to load
          item.addEventListener('click', () => {
            loadRequestIntoBuilder(req.id);
          });
          
          // Rename request
          item.querySelector('.btn-rename-req').addEventListener('click', (e) => {
            e.stopPropagation();
            const newName = prompt('Enter new request name:', req.name);
            if (newName && newName.trim()) {
              req.name = newName.trim();
              saveCollections();
              if (state.currentRequest.id === req.id) {
                state.currentRequest.name = req.name;
                document.getElementById('request-name').innerText = req.name;
              }
              renderCollectionsTab();
            }
          });

          // Delete request
          item.querySelector('.btn-delete-req').addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm(`Delete request "${req.name}"?`)) {
              collection.requests = collection.requests.filter(r => r.id !== req.id);
              saveCollections();
              if (state.currentRequest.id === req.id) {
                state.currentRequest.id = null;
              }
              renderCollectionsTab();
              renderActiveRequest();
            }
          });
          
          list.appendChild(item);
        });
      }
      node.appendChild(list);
    }
    
    container.appendChild(node);
  });
  
  // Search keyup list refresh
  const searchInput = document.getElementById('collection-search');
  if (!searchInput.dataset.bound) {
    searchInput.addEventListener('input', () => {
      renderCollectionsTab();
    });
    searchInput.dataset.bound = true;
  }
}

function exportCollection(collectionId) {
  const collection = state.collections.find(c => c.id === collectionId);
  if (!collection) return;
  
  try {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(collection, null, 2));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href",     dataStr     );
    dlAnchorElem.setAttribute("download", `${collection.name.toLowerCase().replace(/\s+/g, '_')}_collection.json`);
    dlAnchorElem.click();
  } catch (err) {
    alert('Failed to export collection: ' + err.message);
  }
}

// Environments panel
function renderEnvironmentsTab() {
  const listContainer = document.getElementById('environments-list');
  listContainer.innerHTML = '';
  
  // Populate select dropdown in main header
  const envSelect = document.getElementById('active-env-select');
  envSelect.innerHTML = '<option value="none">No Environment</option>';
  
  state.environments.forEach(env => {
    // 1. Sidebar list item
    const item = document.createElement('div');
    item.className = `env-item ${state.activeEnvId === env.id ? 'active' : ''}`;
    
    item.innerHTML = `
      <span>${escapeHtml(env.name)}</span>
      <div class="coll-actions">
        <button class="btn-icon-only btn-rename-env" title="Rename environment">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4z"></path></svg>
        </button>
        <button class="btn-icon-only btn-delete-env" title="Delete environment">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </div>
    `;
    
    // Select env
    item.addEventListener('click', () => {
      state.activeEnvId = env.id;
      localStorage.setItem('thunderpost_active_env_id', state.activeEnvId);
      envSelect.value = env.id;
      renderEnvironmentsTab();
      renderActiveEnvEditor();
      updateCodeSnippet();
    });
    
    // Rename env
    item.querySelector('.btn-rename-env').addEventListener('click', (e) => {
      e.stopPropagation();
      const newName = prompt('Enter new environment name:', env.name);
      if (newName && newName.trim()) {
        env.name = newName.trim();
        saveEnvironments();
        renderEnvironmentsTab();
      }
    });

    // Delete env
    item.querySelector('.btn-delete-env').addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`Delete environment "${env.name}"?`)) {
        state.environments = state.environments.filter(ev => ev.id !== env.id);
        if (state.activeEnvId === env.id) {
          state.activeEnvId = 'none';
        }
        saveEnvironments();
        renderEnvironmentsTab();
        document.getElementById('env-vars-editor').style.display = 'none';
      }
    });
    
    listContainer.appendChild(item);
    
    // 2. Main Header dropdown option
    const option = document.createElement('option');
    option.value = env.id;
    option.innerText = env.name;
    option.selected = (state.activeEnvId === env.id);
    envSelect.appendChild(option);
  });
  
  renderActiveEnvEditor();
}

function renderActiveEnvEditor() {
  const editor = document.getElementById('env-vars-editor');
  const title = document.getElementById('editing-env-name');
  
  const activeEnv = state.environments.find(e => e.id === state.activeEnvId);
  if (!activeEnv) {
    editor.style.display = 'none';
    return;
  }
  
  editor.style.display = 'flex';
  title.innerText = activeEnv.name;
  
  const grid = document.getElementById('env-vars-grid');
  grid.innerHTML = '';
  
  // Ensure we always have at least one blank row at the end
  if (activeEnv.variables.length === 0 || activeEnv.variables[activeEnv.variables.length - 1].key !== '') {
    activeEnv.variables.push({ key: '', value: '' });
  }

  activeEnv.variables.forEach((variable, index) => {
    const row = document.createElement('div');
    row.className = 'env-kv-row';
    
    const keyIn = document.createElement('input');
    keyIn.type = 'text';
    keyIn.placeholder = 'VARIABLE';
    keyIn.value = variable.key;
    keyIn.addEventListener('input', () => {
      variable.key = keyIn.value;
      if (index === activeEnv.variables.length - 1 && variable.key !== '') {
        activeEnv.variables.push({ key: '', value: '' });
        renderActiveEnvEditor();
      }
      saveEnvironments();
      updateCodeSnippet();
    });
    
    const valIn = document.createElement('input');
    valIn.type = 'text';
    valIn.placeholder = 'value';
    valIn.value = variable.value;
    valIn.addEventListener('input', () => {
      variable.value = valIn.value;
      if (index === activeEnv.variables.length - 1 && variable.value !== '') {
        activeEnv.variables.push({ key: '', value: '' });
        renderActiveEnvEditor();
      }
      saveEnvironments();
      updateCodeSnippet();
    });
    
    const delBtn = document.createElement('button');
    delBtn.className = 'btn-icon-only';
    delBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    `;
    delBtn.addEventListener('click', () => {
      if (activeEnv.variables.length === 1) {
        activeEnv.variables = [{ key: '', value: '' }];
      } else {
        activeEnv.variables.splice(index, 1);
      }
      saveEnvironments();
      renderActiveEnvEditor();
      updateCodeSnippet();
    });
    
    row.appendChild(keyIn);
    row.appendChild(valIn);
    row.appendChild(delBtn);
    grid.appendChild(row);
  });
}

function createEnvironment() {
  const name = prompt('Enter environment name:');
  if (name && name.trim()) {
    const newEnv = {
      id: 'env_' + Date.now(),
      name: name.trim(),
      variables: [{ key: '', value: '' }]
    };
    state.environments.push(newEnv);
    state.activeEnvId = newEnv.id;
    saveEnvironments();
    renderEnvironmentsTab();
  }
}

// History Panel
function renderHistoryTab() {
  const container = document.getElementById('history-container');
  container.innerHTML = '';
  
  if (state.history.length === 0) {
    container.innerHTML = '<div class="empty-state">No request history yet.</div>';
    return;
  }
  
  state.history.forEach(item => {
    const el = document.createElement('div');
    el.className = 'history-item';
    
    const isOk = item.status >= 200 && item.status < 400;
    const statusClass = isOk ? 'history-status-ok' : 'history-status-err';
    
    el.innerHTML = `
      <div class="history-row-top">
        <span class="method-badge method-${item.method.toLowerCase()}">${item.method}</span>
        <span class="history-meta ${statusClass}">${item.status || 'Err'}</span>
      </div>
      <div class="history-url">${escapeHtml(item.url)}</div>
      <div class="history-row-top" style="margin-top: 4px;">
        <span class="history-meta">${item.time} ms</span>
        <span class="history-meta" style="font-size: 0.65rem;">${formatTime(item.timestamp)}</span>
      </div>
    `;
    
    // Load config from history
    el.addEventListener('click', () => {
      // Restore the request configurations into the active builder
      state.currentRequest = JSON.parse(JSON.stringify(item.requestConfig));
      // Reset id since it's from history (user has to save it explicitly)
      state.currentRequest.id = null;
      state.currentRequest.name = item.name || 'Restored Request';
      state.isDirty = true;
      renderActiveRequest();
    });
    
    container.appendChild(el);
  });
}

// --- SAVING AND LOADING REQUESTS ---

function loadRequestIntoBuilder(requestId) {
  let found = null;
  state.collections.forEach(coll => {
    coll.requests.forEach(req => {
      if (req.id === requestId) {
        found = req;
      }
    });
  });
  
  if (found) {
    // Deep clone to separate builder edits from stored collection request
    state.currentRequest = JSON.parse(JSON.stringify(found));
    state.isDirty = false;
    renderActiveRequest();
    renderCollectionsTab();
  }
}

function handleSaveRequest(forceSaveAs = false) {
  // If the request doesn't have an ID or "Save As..." is clicked, we trigger prompt/modal setup
  if (state.currentRequest.id === null || forceSaveAs === true) {
    const modalNameInput = document.getElementById('modal-request-name');
    modalNameInput.value = state.currentRequest.name;
    
    const select = document.getElementById('modal-request-collection');
    select.innerHTML = '';
    
    if (state.collections.length === 0) {
      alert('Please create a Collection first in the sidebar before saving a request.');
      return;
    }
    
    state.collections.forEach(coll => {
      const opt = document.createElement('option');
      opt.value = coll.id;
      opt.innerText = coll.name;
      select.appendChild(opt);
    });
    
    showModal('save-request-modal');
  } else {
    // Overwrite the existing request in collections
    let updated = false;
    state.collections.forEach(coll => {
      coll.requests = coll.requests.map(req => {
        if (req.id === state.currentRequest.id) {
          updated = true;
          // Keep the ID and apply new edits
          return {
            ...JSON.parse(JSON.stringify(state.currentRequest)),
            id: req.id // safeguard ID
          };
        }
        return req;
      });
    });
    
    if (updated) {
      saveCollections();
      state.isDirty = false;
      alert('Request saved successfully.');
      renderCollectionsTab();
    }
  }
}

function handleSaveRequestSubmit() {
  const name = document.getElementById('modal-request-name').value.trim();
  const collId = document.getElementById('modal-request-collection').value;
  
  if (!name) {
    alert('Please enter a request name.');
    return;
  }
  
  const collection = state.collections.find(c => c.id === collId);
  if (!collection) {
    alert('Invalid collection target.');
    return;
  }
  
  const isSaveAs = (state.currentRequest.id === null);
  const targetId = isSaveAs ? 'req_' + Date.now() : state.currentRequest.id;
  
  const savedRequestPayload = {
    ...JSON.parse(JSON.stringify(state.currentRequest)),
    id: targetId,
    name: name
  };
  
  if (isSaveAs) {
    collection.requests.push(savedRequestPayload);
  } else {
    // Delete from old collections if collection target changed
    state.collections.forEach(c => {
      c.requests = c.requests.filter(r => r.id !== targetId);
    });
    // Add to selected collection
    collection.requests.push(savedRequestPayload);
  }
  
  saveCollections();
  
  // Set current request as the saved request
  state.currentRequest = savedRequestPayload;
  state.isDirty = false;
  
  hideModals();
  renderCollectionsTab();
  renderActiveRequest();
}

function handleCreateCollection() {
  const name = document.getElementById('modal-collection-name').value.trim();
  if (!name) {
    alert('Enter a valid name');
    return;
  }
  
  const newColl = {
    id: 'coll_' + Date.now(),
    name: name,
    requests: [],
    isExpanded: true
  };
  
  state.collections.push(newColl);
  saveCollections();
  hideModals();
  renderCollectionsTab();
}

// --- SENDING HTTP REQUESTS ---
async function sendRequest() {
  const sendBtn = document.getElementById('btn-send-request');
  const btnText = document.getElementById('btn-send-text');
  const btnSpinner = document.getElementById('btn-send-spinner');
  
  // Prevent race condition and handle cancellation cleanly using isSending flag
  if (state.isSending) {
    if (state.abortController) {
      state.abortController.abort();
      state.abortController = null;
    }
    state.isSending = false;
    resetSendButton();
    return;
  }
  
  // Set active sending status
  state.isSending = true;
  
  // Set Loading visual states (Keep disabled = false so Cancel is clickable)
  sendBtn.classList.add('btn-cancel-active');
  btnText.style.display = 'none';
  btnSpinner.style.display = 'block';
  
  // Prepare payload parameters
  const targetUrl = resolveVariables(state.currentRequest.url.trim());
  const method = state.currentRequest.method;
  
  if (!targetUrl) {
    alert('Please enter a valid request URL.');
    resetSendButton();
    state.isSending = false;
    return;
  }

  // Detect unresolved environment variables
  if (targetUrl.includes('{{')) {
    alert('Unresolved environment variables detected in the URL path. Please verify that you have chosen the correct environment context in the header, or defined this variable.');
    resetSendButton();
    state.isSending = false;
    return;
  }

  // Client-side URL Validation
  try {
    const urlObj = new URL(targetUrl);
    if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
      throw new Error('Only HTTP and HTTPS URL protocols are supported.');
    }
  } catch (err) {
    alert('Please enter a valid request URL (e.g. http://example.com). Details: ' + err.message);
    resetSendButton();
    state.isSending = false;
    return;
  }
  
  // Compile HTTP headers
  const reqHeaders = {};
  state.currentRequest.headers.forEach(h => {
    if (h.enabled && h.key) {
      reqHeaders[h.key] = resolveVariables(h.value);
    }
  });
  
  // Compile Auth credentials
  const auth = state.currentRequest.auth;
  let finalUrl = targetUrl;
  
  if (auth.type === 'bearer' && auth.bearer) {
    reqHeaders['Authorization'] = `Bearer ${resolveVariables(auth.bearer)}`;
  } else if (auth.type === 'basic' && auth.basicUsername) {
    const username = resolveVariables(auth.basicUsername);
    const password = resolveVariables(auth.basicPassword);
    const credentialsBase64 = btoa(`${username}:${password}`);
    reqHeaders['Authorization'] = `Basic ${credentialsBase64}`;
  } else if (auth.type === 'apikey' && auth.apiKeyKey && auth.apiKeyValue) {
    const key = resolveVariables(auth.apiKeyKey);
    const val = resolveVariables(auth.apiKeyValue);
    if (auth.apiKeyLocation === 'header') {
      reqHeaders[key] = val;
    } else {
      // Append key as query parameter
      const connector = finalUrl.includes('?') ? '&' : '?';
      finalUrl += `${connector}${encodeURIComponent(key)}=${encodeURIComponent(val)}`;
    }
  }

  // Compile request body
  let bodyData = null;
  const bodyType = state.currentRequest.bodyType;
  
  if (method !== 'GET') {
    if (bodyType === 'json' || bodyType === 'text') {
      bodyData = resolveVariables(state.currentRequest.bodyText);
    } else if (bodyType === 'urlencoded' || bodyType === 'form-data') {
      bodyData = state.currentRequest.bodyKV
        .filter(field => field.enabled && field.key)
        .map(field => ({
          key: resolveVariables(field.key),
          value: resolveVariables(field.value)
        }));
    }
  }

  // Clear previous response views and set visual loading indicator in the response pane
  const statusEl = document.getElementById('res-status');
  statusEl.innerText = 'Sending...';
  statusEl.className = 'status-badge';
  document.getElementById('res-time').innerText = '-';
  document.getElementById('res-size').innerText = '-';

  document.getElementById('res-body-formatted').innerHTML = '<div class="empty-state" style="flex-direction: row; gap: 12px;"><div class="spinner"></div>Sending request...</div>';
  document.getElementById('res-body-image').style.display = 'none';
  document.getElementById('res-body-formatted').style.display = 'block';

  // Instantiate abort controller for cancel bindings
  state.abortController = new AbortController();

  try {
    const response = await fetch('/api/proxy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: finalUrl,
        method: method,
        headers: reqHeaders,
        body: bodyData,
        bodyType: bodyType,
        timeout: parseInt(document.getElementById('request-timeout').value, 10) || 30
      }),
      signal: state.abortController.signal
    });
    
    if (!response.ok) {
      throw new Error(`Proxy error status: ${response.status}`);
    }
    
    const result = await response.json();
    state.response = result;
    
    // Add to history
    const historyItem = {
      id: 'hist_' + Date.now(),
      name: state.currentRequest.name,
      method: method,
      url: finalUrl,
      status: result.status,
      statusText: result.statusText,
      time: result.time,
      size: result.size,
      timestamp: Date.now(),
      requestConfig: JSON.parse(JSON.stringify(state.currentRequest))
    };
    state.history.unshift(historyItem);
    // Limit history log length to 40 items
    if (state.history.length > 40) {
      state.history.pop();
    }
    saveHistory();
    renderHistoryTab();

    // Render response elements
    renderResponsePane();
    
  } catch (err) {
    if (err.name === 'AbortError') {
      document.getElementById('res-body-formatted').innerHTML = `
        <div class="empty-state" style="color: var(--color-warning); flex-direction: column; gap: 8px;">
          <strong>Request Cancelled</strong>
          <span>The API request execution was aborted by the user.</span>
        </div>
      `;
    } else {
      console.error('Request dispatch failed:', err);
      document.getElementById('res-body-formatted').innerHTML = `
        <div class="empty-state" style="color: var(--color-error); flex-direction: column; gap: 8px;">
          <strong>Network Error / Proxy Failure</strong>
          <span>Could not forward request. Verify your node proxy is active or logs.</span>
          <code style="font-size: 0.75rem; background: var(--bg-input); padding: 4px 8px; border-radius: 4px;">${err.message}</code>
        </div>
      `;
    }
  } finally {
    state.isSending = false;
    state.abortController = null;
    resetSendButton();
  }
}

function resetSendButton() {
  const sendBtn = document.getElementById('btn-send-request');
  const btnText = document.getElementById('btn-send-text');
  const btnSpinner = document.getElementById('btn-send-spinner');
  
  sendBtn.classList.remove('btn-cancel-active');
  sendBtn.disabled = false;
  btnText.style.display = 'block';
  btnSpinner.style.display = 'none';
}

// --- RESPONSE RENDERING CONTROLLER ---
function renderResponsePane() {
  const res = state.response;
  if (!res) return;
  
  // Status Badge
  const statusEl = document.getElementById('res-status');
  statusEl.innerText = `${res.status} ${res.statusText}`;
  statusEl.className = 'status-badge';
  
  if (res.status >= 200 && res.status < 300) {
    statusEl.classList.add('status-ok');
  } else if (res.status >= 300 && res.status < 400) {
    statusEl.classList.add('status-warn');
  } else {
    statusEl.classList.add('status-error');
  }
  
  // Time and Size
  document.getElementById('res-time').innerText = `${res.time} ms`;
  document.getElementById('res-size').innerText = formatBytes(res.size);
  
  // Toggle response actions
  document.getElementById('response-actions-bar').style.display = res.status !== 0 ? 'flex' : 'none';

  // Render sparkline from history
  renderSparkline();

  // Clear visual outputs
  const bodyTextContainer = document.getElementById('res-body-formatted');
  const imagePreview = document.getElementById('res-body-image');
  bodyTextContainer.style.display = 'block';
  imagePreview.style.display = 'none';

  // Large response guard — warn if body > 2MB to prevent browser freeze during syntax highlighting
  const LARGE_RESPONSE_THRESHOLD = 2 * 1024 * 1024; // 2MB

  // Check content formats
  if (res.isBinary) {
    // If base64 binary image
    if (res.contentType && res.contentType.includes('image/')) {
      bodyTextContainer.style.display = 'none';
      imagePreview.style.display = 'block';
      imagePreview.src = `data:${res.contentType};base64,${res.body}`;
    } else {
      bodyTextContainer.innerHTML = `<div class="empty-state">Binary Response (${escapeHtml(res.contentType)})<br>Size: ${formatBytes(res.size)}</div>`;
    }
  } else if (res.body && res.body.length > LARGE_RESPONSE_THRESHOLD) {
    // Large response — offer choice between raw view and formatted view
    bodyTextContainer.innerHTML = `
      <div class="large-response-warning">
        <p>⚠️ <strong>Large Response (${formatBytes(res.body.length)})</strong> — Syntax highlighting may freeze the browser.</p>
        <button class="btn btn-secondary btn-sm" id="btn-show-raw">Show Raw</button>
        <button class="btn btn-primary btn-sm" id="btn-show-formatted">Format Anyway</button>
      </div>
    `;
    document.getElementById('btn-show-raw').addEventListener('click', () => {
      bodyTextContainer.innerHTML = `<pre><code>${escapeHtml(res.body)}</code></pre>`;
    });
    document.getElementById('btn-show-formatted').addEventListener('click', () => {
      if (res.contentType && res.contentType.includes('application/json')) {
        bodyTextContainer.innerHTML = syntaxHighlightJson(res.body);
      } else {
        bodyTextContainer.innerHTML = `<pre><code>${escapeHtml(res.body)}</code></pre>`;
      }
    });
  } else {
    // Render text formats
    if (res.contentType && res.contentType.includes('application/json')) {
      bodyTextContainer.innerHTML = syntaxHighlightJson(res.body);
    } else {
      // Text or html
      bodyTextContainer.innerHTML = `<pre><code>${escapeHtml(res.body)}</code></pre>`;
    }
  }

  // Response Headers
  const headersTbody = document.getElementById('res-headers-tbody');
  headersTbody.innerHTML = '';
  
  const headerKeys = Object.keys(res.headers);
  document.getElementById('badge-res-headers-count').innerText = headerKeys.length;
  
  if (headerKeys.length === 0) {
    headersTbody.innerHTML = '<tr><td colspan="2" class="empty-table-cell">No headers returned.</td></tr>';
  } else {
    headerKeys.sort().forEach(key => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td><strong>${escapeHtml(key)}</strong></td>
        <td>${escapeHtml(res.headers[key])}</td>
      `;
      headersTbody.appendChild(row);
    });
  }

  // Response Cookies parser
  renderCookiesTable(res.headers);

  // Live Visualizer HTML sandbox Iframe
  const iframe = document.getElementById('visualizer-iframe');
  if (res.contentType && res.contentType.includes('text/html')) {
    iframe.srcdoc = res.body;
  } else {
    iframe.srcdoc = `<body style="background: #111; color: #777; font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 90vh;">
      <div>No HTML content preview available (Response Content-Type: ${res.contentType || 'unknown'})</div>
    </body>`;
  }
}

// Simple cookie parser from response set-cookie header keys
function renderCookiesTable(headers) {
  const tbody = document.getElementById('res-cookies-tbody');
  tbody.innerHTML = '';
  
  // Find set-cookie headers (case insensitive)
  const setCookieKey = Object.keys(headers).find(k => k.toLowerCase() === 'set-cookie');
  
  if (!setCookieKey || !headers[setCookieKey]) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-table-cell">No cookies returned in the response headers.</td></tr>';
    return;
  }
  
  // set-cookie can be a string or array in response headers
  let cookieHeader = headers[setCookieKey];
  const cookies = Array.isArray(cookieHeader) ? cookieHeader : [cookieHeader];
  
  cookies.forEach(cookieStr => {
    const parts = cookieStr.split(';').map(p => p.trim());
    if (parts.length === 0) return;
    
    // First part is Name=Value
    const [nameVal, ...attrs] = parts;
    const eqIdx = nameVal.indexOf('=');
    const name = eqIdx > -1 ? nameVal.substring(0, eqIdx) : nameVal;
    const value = eqIdx > -1 ? nameVal.substring(eqIdx + 1) : '';
    
    // Attributes
    let path = '/';
    let domain = '-';
    let expires = '-';
    
    attrs.forEach(attr => {
      const [k, v] = attr.split('=').map(item => item.trim());
      const lowerK = k.toLowerCase();
      if (lowerK === 'path') path = v || '/';
      else if (lowerK === 'domain') domain = v || '-';
      else if (lowerK === 'expires') expires = v || '-';
    });
    
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><strong>${escapeHtml(name)}</strong></td>
      <td>${escapeHtml(value)}</td>
      <td>${escapeHtml(path)}</td>
      <td>${escapeHtml(domain)}</td>
      <td>${escapeHtml(expires)}</td>
    `;
    tbody.appendChild(row);
  });
}

// JSON syntax coloring formatter
function syntaxHighlightJson(jsonString) {
  if (!jsonString || typeof jsonString !== 'string' || !jsonString.trim()) {
    return '<div class="empty-state">No response body content returned.</div>';
  }
  let json = jsonString;
  if (typeof json !== 'string') {
    json = JSON.stringify(json, null, 2);
  } else {
    try {
      const obj = JSON.parse(json);
      json = JSON.stringify(obj, null, 2);
    } catch (e) {
      // In case json body is invalid, just display as raw string
      return `<pre><code>${escapeHtml(json)}</code></pre>`;
    }
  }
  
  // Escape html
  json = escapeHtml(json);
  
  // Highlight regex
  const highlighted = json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g, function (match) {
    let cls = 'json-number';
    if (/^"/.test(match)) {
      if (/:$/.test(match)) {
        cls = 'json-key';
      } else {
        cls = 'json-string';
      }
    } else if (/true|false/.test(match)) {
      cls = 'json-boolean';
    } else if (/null/.test(match)) {
      cls = 'json-null';
    }
    return `<span class="${cls}">${match}</span>`;
  });
  
  return `<pre><code>${highlighted}</code></pre>`;
}

// --- CLIENT CODE SNIPPETS GENERATOR ---
function updateCodeSnippet() {
  const req = state.currentRequest;
  const lang = state.snippetLang;
  const codeBox = document.getElementById('snippet-code-box');
  
  const targetUrl = resolveVariables(req.url);
  const method = req.method;
  
  // Headers Compile
  const headers = {};
  req.headers.forEach(h => {
    if (h.enabled && h.key) {
      headers[h.key] = resolveVariables(h.value);
    }
  });
  
  // Auth compile
  if (req.auth.type === 'bearer' && req.auth.bearer) {
    headers['Authorization'] = `Bearer ${resolveVariables(req.auth.bearer)}`;
  } else if (req.auth.type === 'basic' && req.auth.basicUsername) {
    const creds = btoa(`${resolveVariables(req.auth.basicUsername)}:${resolveVariables(req.auth.basicPassword)}`);
    headers['Authorization'] = `Basic ${creds}`;
  } else if (req.auth.type === 'apikey' && req.auth.apiKeyKey && req.auth.apiKeyValue) {
    const k = resolveVariables(req.auth.apiKeyKey);
    const v = resolveVariables(req.auth.apiKeyValue);
    if (req.auth.apiKeyLocation === 'header') {
      headers[k] = v;
    }
  }

  // Body compile
  let rawBody = '';
  if (method !== 'GET') {
    if (req.bodyType === 'json' || req.bodyType === 'text') {
      rawBody = resolveVariables(req.bodyText);
    } else if (req.bodyType === 'urlencoded') {
      const params = new URLSearchParams();
      req.bodyKV.filter(f => f.enabled && f.key).forEach(f => params.append(resolveVariables(f.key), resolveVariables(f.value)));
      rawBody = params.toString();
    } else if (req.bodyType === 'form-data') {
      // Multipart simple presentation
      const list = req.bodyKV.filter(f => f.enabled && f.key).map(f => `${resolveVariables(f.key)}=${resolveVariables(f.value)}`);
      rawBody = list.join('; ');
    }
  }

  let codeStr = '';
  
  if (lang === 'curl') {
    codeStr = `curl -X ${method} "${targetUrl}"`;
    Object.keys(headers).forEach(k => {
      codeStr += ` \\\n  -H "${k}: ${headers[k]}"`;
    });
    if (rawBody) {
      const cleanBody = rawBody.replace(/"/g, '\\"').replace(/\n/g, '');
      codeStr += ` \\\n  -d "${cleanBody}"`;
    }
  } else if (lang === 'fetch') {
    const options = {
      method: method,
      headers: headers
    };
    if (method !== 'GET' && rawBody) {
      options.body = rawBody;
    }
    codeStr = `fetch("${targetUrl}", ${JSON.stringify(options, null, 2)});`;
  } else if (lang === 'axios') {
    const config = {
      method: method,
      url: targetUrl,
      headers: headers
    };
    if (method !== 'GET' && rawBody) {
      if (req.bodyType === 'json') {
        try { config.data = JSON.parse(rawBody); } catch (e) { config.data = rawBody; }
      } else {
        config.data = rawBody;
      }
    }
    codeStr = `axios(${JSON.stringify(config, null, 2)});`;
  } else if (lang === 'python') {
    codeStr = `import requests\n\nurl = "${targetUrl}"\n`;
    if (Object.keys(headers).length > 0) {
      codeStr += `headers = ${JSON.stringify(headers, null, 4)}\n`;
    } else {
      codeStr += `headers = {}\n`;
    }
    
    if (method !== 'GET' && rawBody) {
      if (req.bodyType === 'json') {
        codeStr += `data = ${rawBody}\n`;
        codeStr += `response = requests.request("${method}", url, headers=headers, json=data)\n`;
      } else {
        codeStr += `data = "${rawBody.replace(/\n/g, '\\n')}"\n`;
        codeStr += `response = requests.request("${method}", url, headers=headers, data=data)\n`;
      }
    } else {
      codeStr += `response = requests.request("${method}", url, headers=headers)\n`;
    }
    codeStr += `print(response.status_code)\nprint(response.text)`;
  }

  codeBox.innerText = codeStr;
}

// --- HELPER UTILITIES ---

function showModal(modalId) {
  document.getElementById(modalId).style.display = 'flex';
}

function hideModals() {
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.style.display = 'none';
  });
  const reqNameInput = document.getElementById('modal-request-name');
  const collNameInput = document.getElementById('modal-collection-name');
  if (reqNameInput) reqNameInput.value = '';
  if (collNameInput) collNameInput.value = '';
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toTimeString().split(' ')[0];
}

function copyResponseToClipboard() {
  if (!state.response || !state.response.body) return;
  try {
    const bodyText = state.response.isBinary ? atob(state.response.body) : state.response.body;
    navigator.clipboard.writeText(bodyText)
      .then(() => alert('Response body copied to clipboard.'))
      .catch(err => console.error('Failed to copy text', err));
  } catch (err) {
    alert('Failed to decode binary response to text: ' + err.message);
  }
}

function downloadResponseBody() {
  if (!state.response || !state.response.body) return;
  
  const contentType = state.response.contentType || 'text/plain';
  let blob;
  
  try {
    if (state.response.isBinary) {
      const rawBinary = atob(state.response.body);
      const rawLength = rawBinary.length;
      const array = new Uint8Array(new ArrayBuffer(rawLength));
      for (let i = 0; i < rawLength; i++) {
        array[i] = rawBinary.charCodeAt(i);
      }
      blob = new Blob([array], { type: contentType });
    } else {
      blob = new Blob([state.response.body], { type: contentType });
    }
  } catch (err) {
    alert('Failed to process binary data download: ' + err.message);
    return;
  }
  
  // Set file extension based on contentType
  let extension = 'txt';
  if (contentType.includes('json')) extension = 'json';
  else if (contentType.includes('html')) extension = 'html';
  else if (contentType.includes('xml')) extension = 'xml';
  else if (contentType.includes('image/png')) extension = 'png';
  else if (contentType.includes('image/jpeg')) extension = 'jpg';
  
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `response_${Date.now()}.${extension}`;
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  }, 100);
}

function copySnippetToClipboard() {
  const code = document.getElementById('snippet-code-box').innerText;
  navigator.clipboard.writeText(code)
    .then(() => alert('Code snippet copied to clipboard.'))
    .catch(err => console.error('Failed to copy', err));
}

function triggerImportCollection() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        
        // Validation check for Collection structure
        if (data.name && typeof data.name === 'string' && data.name.trim() && Array.isArray(data.requests)) {
          const cleanName = data.name.trim();
          let targetName = cleanName;
          let counter = 1;
          
          // Prevent name collisions during import by appending index suffix
          while (state.collections.some(c => c.name === targetName)) {
            targetName = `${cleanName} (${counter++})`;
          }
          
          const newColl = {
            id: 'coll_' + Date.now(),
            name: targetName,
            requests: data.requests.map(req => ({
              id: 'req_' + Math.random().toString(36).substr(2, 9),
              name: (req.name && typeof req.name === 'string' && req.name.trim()) ? req.name.trim() : 'Imported Request',
              method: req.method || 'GET',
              url: req.url || 'http://localhost:3000',
              params: req.params || [{ key: '', value: '', enabled: true }],
              headers: req.headers || [{ key: '', value: '', enabled: true }],
              bodyType: req.bodyType || 'none',
              bodyText: req.bodyText || '',
              bodyKV: req.bodyKV || [{ key: '', value: '', enabled: true }],
              auth: req.auth || { type: 'none', bearer: '', basicUsername: '', basicPassword: '', apiKeyKey: '', apiKeyValue: '', apiKeyLocation: 'header' }
            })),
            isExpanded: true
          };
          
          state.collections.push(newColl);
          saveCollections();
          renderCollectionsTab();
          alert(`Successfully imported collection "${newColl.name}"!`);
        } else {
          alert('Invalid file format. The JSON file must have a non-empty "name" property and a "requests" array.');
        }
      } catch (err) {
        alert('Failed to parse JSON file: ' + err.message);
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

function toggleTheme() {
  const isLight = document.body.classList.toggle('light-theme');
  localStorage.setItem('thunderpost_theme', isLight ? 'light' : 'dark');
  renderThemeIcons();
}

function renderThemeIcons() {
  const isLight = document.body.classList.contains('light-theme');
  const sunSvg = document.querySelector('.theme-sun');
  const moonSvg = document.querySelector('.theme-moon');
  if (sunSvg && moonSvg) {
    sunSvg.style.display = isLight ? 'block' : 'none';
    moonSvg.style.display = isLight ? 'none' : 'block';
  }
}

// --- RESPONSE BODY SEARCH ---

let _searchOriginalHTML = null; // cached pre-search HTML for restoration

function toggleResponseSearch() {
  const bar = document.getElementById('response-search-bar');
  if (bar.style.display === 'none' || !bar.style.display) {
    bar.style.display = 'flex';
    document.getElementById('response-search-input').focus();
  } else {
    closeResponseSearch();
  }
}

function closeResponseSearch() {
  const bar = document.getElementById('response-search-bar');
  bar.style.display = 'none';
  document.getElementById('response-search-input').value = '';
  document.getElementById('search-match-count').innerText = '';
  
  // Restore original HTML to remove highlights
  if (_searchOriginalHTML !== null) {
    document.getElementById('res-body-formatted').innerHTML = _searchOriginalHTML;
    _searchOriginalHTML = null;
  }
}

function executeResponseSearch() {
  const query = document.getElementById('response-search-input').value;
  const container = document.getElementById('res-body-formatted');
  const countEl = document.getElementById('search-match-count');
  
  // Cache original HTML on first search execution
  if (_searchOriginalHTML === null) {
    _searchOriginalHTML = container.innerHTML;
  } else {
    // Restore original HTML before applying new search
    container.innerHTML = _searchOriginalHTML;
  }
  
  if (!query || query.length < 2) {
    countEl.innerText = '';
    return;
  }
  
  // Walk all text nodes and wrap matches in <mark>
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedQuery})`, 'gi');
  
  let matchCount = 0;
  
  function walkAndHighlight(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent;
      if (regex.test(text)) {
        regex.lastIndex = 0; // reset regex state
        const frag = document.createDocumentFragment();
        let lastIndex = 0;
        let match;
        while ((match = regex.exec(text)) !== null) {
          matchCount++;
          // Add text before match
          if (match.index > lastIndex) {
            frag.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
          }
          // Add highlighted match
          const mark = document.createElement('mark');
          mark.className = 'search-highlight';
          mark.textContent = match[0];
          frag.appendChild(mark);
          lastIndex = regex.lastIndex;
        }
        // Add remaining text
        if (lastIndex < text.length) {
          frag.appendChild(document.createTextNode(text.substring(lastIndex)));
        }
        node.parentNode.replaceChild(frag, node);
      }
    } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName !== 'MARK') {
      // Process child nodes (copy to array first since we modify DOM in-place)
      Array.from(node.childNodes).forEach(child => walkAndHighlight(child));
    }
  }
  
  walkAndHighlight(container);
  
  countEl.innerText = matchCount > 0 ? `${matchCount} match${matchCount !== 1 ? 'es' : ''}` : 'No matches';
  
  // Scroll first match into view
  const firstMatch = container.querySelector('mark.search-highlight');
  if (firstMatch) {
    firstMatch.classList.add('search-highlight-active');
    firstMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// --- SPARKLINE CHART ---

function renderSparkline() {
  const svg = document.getElementById('sparkline-chart');
  if (!svg) return;
  
  // Get last 10 response times from history
  const recentTimes = state.history
    .slice(0, 10)
    .map(h => h.time)
    .filter(t => typeof t === 'number' && t > 0)
    .reverse(); // oldest first
  
  svg.innerHTML = '';
  
  if (recentTimes.length < 2) return;
  
  const width = 80;
  const height = 24;
  const padding = 3;
  const maxTime = Math.max(...recentTimes);
  const minTime = Math.min(...recentTimes);
  const range = maxTime - minTime || 1;
  
  const points = recentTimes.map((t, i) => {
    const x = padding + (i / (recentTimes.length - 1)) * (width - padding * 2);
    const y = padding + (1 - (t - minTime) / range) * (height - padding * 2);
    return { x, y };
  });
  
  // Draw polyline
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  polyline.setAttribute('d', pathD);
  polyline.setAttribute('class', 'sparkline-line');
  svg.appendChild(polyline);
  
  // Draw dots
  points.forEach((p, i) => {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', p.x.toFixed(1));
    circle.setAttribute('cy', p.y.toFixed(1));
    circle.setAttribute('r', i === points.length - 1 ? '2.5' : '1.5');
    circle.setAttribute('class', i === points.length - 1 ? 'sparkline-dot-last' : 'sparkline-dot');
    svg.appendChild(circle);
  });
}

// --- UTILITY: DEBOUNCE ---

function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

