const app = document.getElementById("app");
const modalOverlay = document.getElementById("modalOverlay");
const modal = document.getElementById("modal");
const toast = document.getElementById("toast");

const USERS = {
  akash: { password: "akash", role: "akash" },
  admin: { password: "admin", role: "admin" },
};

function validateLogin(username, password) {
  const user = USERS[username.toLowerCase().trim()];
  if (!user || user.password !== password) return null;
  return user.role;
}

let currentUser = null;
let view = "login";
let adminTab = "installations";
let searchQuery = "";
let installations = [];
let maintenanceRecords = [];
let isLoadingData = false;

async function refreshAllData() {
  isLoadingData = true;
  try {
    installations = await fetchInstallations();
    maintenanceRecords = await fetchMaintenanceRecords();
  } finally {
    isLoadingData = false;
  }
}

function loadInstallations() {
  return installations;
}

function loadMaintenance() {
  return maintenanceRecords;
}

function generateId() {
  return crypto.randomUUID();
}

function escapeHtml(text) {
  const el = document.createElement("div");
  el.textContent = text ?? "";
  return el.innerHTML;
}

function formatDateTime(iso) {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function showToast(message, isError = false) {
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.remove("hidden");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => toast.classList.add("hidden"), 3000);
}

function showModal(html, onConfirm) {
  modal.innerHTML = html;
  modalOverlay.classList.remove("hidden");

  const close = () => {
    modalOverlay.classList.add("hidden");
    modal.innerHTML = "";
  };

  modal.querySelector(".modal-close")?.addEventListener("click", close);
  modalOverlay.onclick = (e) => {
    if (e.target === modalOverlay) close();
  };

  modal.querySelector(".modal-confirm")?.addEventListener("click", async () => {
    try {
      const result = await onConfirm?.();
      if (result !== false) close();
    } catch (err) {
      showToast(err.message || "Something went wrong.", true);
    }
  });

  return { modalEl: modal, close };
}

function getCurrentImei(inst) {
  const active = [...inst.imeiHistory].reverse().find((i) => i.active);
  return active?.value || inst.imeiHistory.at(-1)?.value || "";
}

function getCurrentSim(inst) {
  const active = [...inst.simHistory].reverse().find((s) => s.active);
  return active?.value || inst.simHistory.at(-1)?.value || "";
}

function findInstallationByImei(imei) {
  const q = imei.trim().toLowerCase();
  if (!q) return null;
  return loadInstallations().find((inst) =>
    inst.imeiHistory.some((i) => i.value.toLowerCase() === q)
  );
}

function historyList(items) {
  if (!items.length) return '<span class="muted">—</span>';
  return items
    .map((item) => {
      let badge = '<span class="badge badge-muted">Inactive</span>';
      if (item.active && item.pendingDeactivation) {
        badge = '<span class="badge badge-warn">Active — deactivate pending</span>';
      } else if (item.active) {
        badge = '<span class="badge badge-ok">Active</span>';
      }
      return '<div class="history-item">' + escapeHtml(item.value) + ' ' + badge + '</div>';
    })
    .join("");
}

function workLabels(record) {
  const parts = [];
  if (record.wiringConnection) parts.push("Wiring connection");
  if (record.simChange) parts.push(`SIM change → ${record.newSimNo}`);
  if (record.deviceChange) parts.push(`Device change → ${record.newImei}`);
  return parts.join(", ") || "—";
}

function getMaintenanceStatus(record) {
  const parts = [];
  if (record.simChange) {
    parts.push(
      record.simDeactivated
        ? '<span class="badge badge-ok">Old SIM deactivated</span>'
        : '<span class="badge badge-warn">Awaiting SIM deactivation</span>'
    );
  }
  if (record.deviceChange) {
    parts.push('<span class="badge badge-repair">Send for repair</span>');
  }
  return parts.length ? parts.join(" ") : "—";
}

function setView(next) {
  view = next;
  render();
}

function logout() {
  currentUser = null;
  view = "login";
  searchQuery = "";
  render();
}

function renderHeader(title, subtitle) {
  return `
    <header class="header">
      <div class="header-content">
        <div class="logo">
          <span class="logo-icon">📡</span>
          <div>
            <h1>${escapeHtml(title)}</h1>
            <p>${escapeHtml(subtitle)}</p>
          </div>
        </div>
        ${
          currentUser
            ? `<div class="header-actions">
                <span class="user-badge">${currentUser === "akash" ? "👷 Akash" : "🛡️ Admin"}</span>
                <button type="button" class="btn btn-outline btn-sm" id="logoutBtn">Logout</button>
              </div>`
            : ""
        }
      </div>
    </header>
  `;
}

function renderConfigMissing() {
  app.innerHTML = `
    ${renderHeader("GPS Maintenance Tracker", "Setup required")}
    <main class="main centered">
      <section class="card login-card">
        <h2>Supabase not configured</h2>
        <p class="login-desc">Copy <code>config.example.js</code> to <code>config.js</code> and add your Supabase URL and anon key.</p>
        <ol class="setup-steps">
          <li>Create a project at <a href="https://supabase.com" target="_blank" rel="noopener">supabase.com</a></li>
          <li>Run <code>supabase/schema.sql</code> in SQL Editor</li>
          <li>Copy API keys from Project Settings → API</li>
          <li>Paste into <code>config.js</code></li>
        </ol>
      </section>
    </main>
  `;
}

function renderLoading(message = "Loading data...") {
  app.innerHTML = `
    ${renderHeader("GPS Maintenance Tracker", message)}
    <main class="main centered">
      <section class="card login-card">
        <p class="login-desc">${escapeHtml(message)}</p>
      </section>
    </main>
  `;
}

function bindLogout() {
  document.getElementById("logoutBtn")?.addEventListener("click", logout);
}

function renderLogin() {
  app.innerHTML = `
    ${renderHeader("GPS Maintenance Tracker", "Login to continue")}
    <main class="main centered">
      <section class="card login-card">
        <h2>Login</h2>
        <p class="login-desc">Enter username and password</p>
        <form id="loginForm" class="login-form">
          <div class="field">
            <label for="loginUser">Username</label>
            <input type="text" id="loginUser" required placeholder="akash or admin" autocomplete="username" />
          </div>
          <div class="field">
            <label for="loginPass">Password</label>
            <input type="password" id="loginPass" required placeholder="Password" autocomplete="current-password" />
          </div>
          <p class="login-hint">Users: <strong>akash</strong> / <strong>admin</strong> (password same as username)</p>
          <button type="submit" class="btn btn-primary login-submit">Login</button>
        </form>
      </section>
    </main>
  `;

  document.getElementById("loginForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("loginUser").value;
    const password = document.getElementById("loginPass").value;
    const role = validateLogin(username, password);

    if (!role) {
      showToast("Invalid username or password.", true);
      document.getElementById("loginPass").classList.add("invalid");
      return;
    }

    currentUser = role;
    view = role === "akash" ? "akash-home" : "admin";
    renderLoading("Loading data from Supabase...");
    try {
      await refreshAllData();
      render();
    } catch (err) {
      showToast(err.message || "Failed to load data.", true);
      currentUser = null;
      view = "login";
      render();
    }
  });
}

function renderAkashHome() {
  app.innerHTML = `
    ${renderHeader("Akash Portal", "Select work type")}
    <main class="main centered">
      <section class="card">
        <h2>What work are you doing?</h2>
        <div class="choice-grid">
          <button type="button" class="choice-card" id="goInstall">
            <span class="choice-icon">🆕</span>
            <span class="choice-title">Installing New GPS</span>
            <span class="choice-desc">Register a new device installation</span>
          </button>
          <button type="button" class="choice-card" id="goRepair">
            <span class="choice-icon">🔧</span>
            <span class="choice-title">Repair Work</span>
            <span class="choice-desc">Maintenance on existing installation</span>
          </button>
        </div>
      </section>
    </main>
  `;

  bindLogout();
  document.getElementById("goInstall")?.addEventListener("click", () => setView("install"));
  document.getElementById("goRepair")?.addEventListener("click", () => setView("repair"));
}

function renderInstallForm() {
  app.innerHTML = `
    ${renderHeader("Installing New GPS", "All 6 fields are mandatory")}
    <main class="main">
      <section class="card">
        <div class="form-nav">
          <button type="button" class="btn btn-secondary btn-sm" id="backBtn">← Back</button>
        </div>
        <h2>New GPS Installation</h2>
        <form id="installForm" class="form-grid">
          <div class="field">
            <label for="instImei">IMEI No <span class="required">*</span></label>
            <input type="text" id="instImei" required placeholder="e.g. 867530012345678" autocomplete="off" />
          </div>
          <div class="field">
            <label for="instVehicle">Vehicle No <span class="required">*</span></label>
            <input type="text" id="instVehicle" required placeholder="e.g. MH12AB1234" autocomplete="off" />
          </div>
          <div class="field">
            <label for="instModel">GPS Model <span class="required">*</span></label>
            <input type="text" id="instModel" required placeholder="e.g. GT06N" autocomplete="off" />
          </div>
          <div class="field">
            <label for="instSim">SIM No <span class="required">*</span></label>
            <input type="text" id="instSim" required placeholder="e.g. 9876543210" autocomplete="off" />
          </div>
          <div class="field">
            <label for="instMac">MAC ID <span class="required">*</span></label>
            <input type="text" id="instMac" required placeholder="e.g. AA:BB:CC:DD:EE:FF" autocomplete="off" />
          </div>
          <div class="field">
            <label for="instSensor">Sensor No <span class="required">*</span></label>
            <input type="text" id="instSensor" required placeholder="e.g. SN-12345" autocomplete="off" />
          </div>
          <div class="form-actions full-width">
            <button type="submit" class="btn btn-primary">Submit Installation</button>
          </div>
        </form>
      </section>
    </main>
  `;

  bindLogout();
  document.getElementById("backBtn")?.addEventListener("click", () => setView("akash-home"));
  document.getElementById("installForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    handleInstallSubmit();
  });
}

function handleInstallSubmit() {
  const fields = {
    imei: document.getElementById("instImei"),
    vehicle: document.getElementById("instVehicle"),
    model: document.getElementById("instModel"),
    sim: document.getElementById("instSim"),
    mac: document.getElementById("instMac"),
    sensor: document.getElementById("instSensor"),
  };

  let valid = true;
  Object.values(fields).forEach((el) => {
    el.classList.toggle("invalid", !el.value.trim());
    if (!el.value.trim()) valid = false;
  });
  if (!valid) {
    showToast("Please fill all 6 fields.", true);
    return;
  }

  const data = Object.fromEntries(
    Object.entries(fields).map(([k, el]) => [k, el.value.trim()])
  );

  showModal(
    `
    <h3>Confirm Before Submit</h3>
    <p class="modal-desc">Both answers must be <strong>Yes</strong> to submit.</p>
    <div class="confirm-questions">
      <div class="confirm-q">
        <span>Vehicle live hai?</span>
        <div class="yes-no-group">
          <label class="yn-option">
            <input type="radio" name="vehicleLive" value="yes" />
            <span>Yes</span>
          </label>
          <label class="yn-option">
            <input type="radio" name="vehicleLive" value="no" />
            <span>No</span>
          </label>
        </div>
      </div>
      <div class="confirm-q">
        <span>MAC ID daal diya?</span>
        <div class="yes-no-group">
          <label class="yn-option">
            <input type="radio" name="macEntered" value="yes" />
            <span>Yes</span>
          </label>
          <label class="yn-option">
            <input type="radio" name="macEntered" value="no" />
            <span>No</span>
          </label>
        </div>
      </div>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn btn-secondary modal-close">Cancel</button>
      <button type="button" class="btn btn-primary modal-confirm">Submit</button>
    </div>
    `,
    async () => {
      const vehicleLive = modal.querySelector('input[name="vehicleLive"]:checked')?.value;
      const macEntered = modal.querySelector('input[name="macEntered"]:checked')?.value;

      if (vehicleLive !== "yes" || macEntered !== "yes") {
        showToast("Both answers must be Yes to submit.", true);
        return false;
      }

      const allInstalls = loadInstallations();
      if (allInstalls.some((i) => i.vehicleNo.toLowerCase() === data.vehicle.toLowerCase())) {
        showToast("Vehicle already exists in installation database.", true);
        return false;
      }
      if (
        allInstalls.some((i) =>
          i.imeiHistory.some((h) => h.value.toLowerCase() === data.imei.toLowerCase())
        )
      ) {
        showToast("IMEI already exists in installation database.", true);
        return false;
      }

      const now = new Date().toISOString();
      const newInstall = {
        id: generateId(),
        vehicleNo: data.vehicle,
        gpsModel: data.model,
        macId: data.mac,
        sensorNo: data.sensor,
        imeiHistory: [{ value: data.imei, addedAt: now, active: true }],
        simHistory: [{ value: data.sim, addedAt: now, active: true, pendingDeactivation: false }],
        createdAt: now,
        createdBy: "akash",
      };

      await insertInstallation(newInstall);
      await refreshAllData();
      showToast("Installation saved successfully!");
      setView("akash-home");
      return true;
    }
  );
}

function renderRepairForm() {
  app.innerHTML = `
    ${renderHeader("Repair Work", "Maintenance on existing GPS installation")}
    <main class="main">
      <section class="card">
        <div class="form-nav">
          <button type="button" class="btn btn-secondary btn-sm" id="backBtn">← Back</button>
        </div>
        <h2>Repair / Maintenance</h2>
        <form id="repairForm">
          <div class="form-grid">
            <div class="field">
              <label for="repairImei">IMEI No <span class="required">*</span></label>
              <input type="text" id="repairImei" required placeholder="Enter IMEI to lookup" autocomplete="off" />
              <p class="field-hint" id="imeiHint">Enter IMEI from installation database</p>
            </div>
            <div class="field">
              <label for="repairVehicle">Vehicle No</label>
              <input type="text" id="repairVehicle" readonly placeholder="Auto-filled from database" />
            </div>
          </div>

          <div class="work-section">
            <h3>What work is required?</h3>
            <label class="check-option">
              <input type="checkbox" id="workWiring" />
              <span>Wiring connection</span>
            </label>
            <label class="check-option">
              <input type="checkbox" id="workSimChange" />
              <span>SIM change</span>
            </label>
            <div class="conditional-field hidden" id="newSimBox">
              <label for="newSimNo">New SIM No <span class="required">*</span></label>
              <input type="text" id="newSimNo" placeholder="Enter new SIM number" autocomplete="off" />
            </div>
            <label class="check-option">
              <input type="checkbox" id="workDeviceChange" />
              <span>Device change</span>
            </label>
            <div class="conditional-field hidden" id="newImeiBox">
              <label for="newImeiNo">New IMEI No <span class="required">*</span></label>
              <input type="text" id="newImeiNo" placeholder="Enter new IMEI number" autocomplete="off" />
            </div>
          </div>

          <div class="form-actions">
            <button type="submit" class="btn btn-primary">Submit Repair Work</button>
          </div>
        </form>
      </section>
    </main>
  `;

  bindLogout();
  document.getElementById("backBtn")?.addEventListener("click", () => setView("akash-home"));

  const imeiInput = document.getElementById("repairImei");
  const vehicleInput = document.getElementById("repairVehicle");
  const hint = document.getElementById("imeiHint");
  const simCheck = document.getElementById("workSimChange");
  const deviceCheck = document.getElementById("workDeviceChange");
  const newSimBox = document.getElementById("newSimBox");
  const newImeiBox = document.getElementById("newImeiBox");

  imeiInput.addEventListener("input", () => {
    const inst = findInstallationByImei(imeiInput.value);
    if (inst) {
      vehicleInput.value = inst.vehicleNo;
      hint.textContent = `Found: ${inst.gpsModel} | Current SIM: ${getCurrentSim(inst)}`;
      hint.classList.add("hint-ok");
      imeiInput.classList.remove("invalid");
    } else if (imeiInput.value.trim()) {
      vehicleInput.value = "";
      hint.textContent = "IMEI not found in installation database";
      hint.classList.remove("hint-ok");
    } else {
      vehicleInput.value = "";
      hint.textContent = "Enter IMEI from installation database";
      hint.classList.remove("hint-ok");
    }
  });

  simCheck.addEventListener("change", () => {
    newSimBox.classList.toggle("hidden", !simCheck.checked);
    if (!simCheck.checked) document.getElementById("newSimNo").value = "";
  });

  deviceCheck.addEventListener("change", () => {
    newImeiBox.classList.toggle("hidden", !deviceCheck.checked);
    if (!deviceCheck.checked) document.getElementById("newImeiNo").value = "";
  });

  document.getElementById("repairForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const imei = imeiInput.value.trim();
    const inst = findInstallationByImei(imei);
    const wiring = document.getElementById("workWiring").checked;
    const simChange = simCheck.checked;
    const deviceChange = deviceCheck.checked;
    const newSim = document.getElementById("newSimNo").value.trim();
    const newImei = document.getElementById("newImeiNo").value.trim();

    if (!inst) {
      imeiInput.classList.add("invalid");
      showToast("IMEI not found in installation database.", true);
      return;
    }

    if (!wiring && !simChange && !deviceChange) {
      showToast("Select at least one work type.", true);
      return;
    }

    if (simChange && !newSim) {
      document.getElementById("newSimNo").classList.add("invalid");
      showToast("Enter new SIM number for SIM change.", true);
      return;
    }

    if (deviceChange && !newImei) {
      document.getElementById("newImeiNo").classList.add("invalid");
      showToast("Enter new IMEI for device change.", true);
      return;
    }

    const updatedInst = { ...inst };
    const now = new Date().toISOString();
    const currentSim = getCurrentSim(updatedInst);
    const currentImei = getCurrentImei(updatedInst);
    let simDeactivationPending = false;
    let oldSimNo = null;
    let oldImei = null;

    if (simChange) {
      oldSimNo = currentSim;
      updatedInst.simHistory.forEach((s) => {
        if (s.active) s.pendingDeactivation = true;
      });
      updatedInst.simHistory.push({
        value: newSim,
        addedAt: now,
        active: true,
        pendingDeactivation: false,
      });
      simDeactivationPending = true;
    }

    if (deviceChange) {
      oldImei = currentImei;
      updatedInst.imeiHistory.forEach((i) => {
        i.active = false;
      });
      updatedInst.imeiHistory.push({
        value: newImei,
        addedAt: now,
        active: true,
      });
    }

    const newRecord = {
      id: generateId(),
      installationId: inst.id,
      imei: currentImei,
      vehicleNo: inst.vehicleNo,
      wiringConnection: wiring,
      simChange,
      newSimNo: simChange ? newSim : null,
      deviceChange,
      newImei: deviceChange ? newImei : null,
      oldSimNo,
      oldImei,
      simDeactivationPending,
      simDeactivated: false,
      simDeactivatedAt: null,
      createdAt: now,
      createdBy: "akash",
    };

    try {
      await updateInstallation(updatedInst);
      await insertMaintenanceRecord(newRecord);
      await refreshAllData();
      showToast("Repair work saved successfully!");
      setView("akash-home");
    } catch (err) {
      showToast(err.message || "Failed to save repair work.", true);
    }
  });
}

function getPendingSimDeactivations() {
  return loadMaintenance().filter((m) => m.simDeactivationPending && !m.simDeactivated);
}

function renderAdmin() {
  const installations = loadInstallations();
  const maintenance = loadMaintenance();
  const pending = getPendingSimDeactivations();
  const q = searchQuery.toLowerCase().trim();

  const filteredInstalls = installations.filter((i) => {
    if (!q) return true;
    const hay = [
      i.vehicleNo,
      i.gpsModel,
      i.macId,
      i.sensorNo,
      ...i.imeiHistory.map((h) => h.value),
      ...i.simHistory.map((s) => s.value),
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });

  const filteredMaint = maintenance.filter((m) => {
    if (!q) return true;
    return [m.imei, m.vehicleNo, m.newSimNo, m.newImei, workLabels(m)]
      .join(" ")
      .toLowerCase()
      .includes(q);
  });

  app.innerHTML = `
    ${renderHeader("Admin Portal", "View all installations and repair work")}
    <main class="main">
      ${
        pending.length
          ? `<section class="card alert-card">
              <h2>⚠️ Pending SIM Deactivations (${pending.length})</h2>
              <p class="alert-desc">Old SIM must be deactivated after SIM change repair work.</p>
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Vehicle</th>
                      <th>Old SIM</th>
                      <th>New SIM</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${pending
                      .map(
                        (m) => `
                      <tr>
                        <td class="date-cell">${escapeHtml(formatDateTime(m.createdAt))}</td>
                        <td>${escapeHtml(m.vehicleNo)}</td>
                        <td>${escapeHtml(m.oldSimNo || "—")}</td>
                        <td>${escapeHtml(m.newSimNo || "—")}</td>
                        <td>
                          <button type="button" class="btn btn-primary btn-sm deactivate-btn" data-id="${m.id}">
                            Mark SIM Deactivated
                          </button>
                        </td>
                      </tr>`
                      )
                      .join("")}
                  </tbody>
                </table>
              </div>
            </section>`
          : ""
      }

      <section class="card">
        <div class="admin-tabs">
          <button type="button" class="tab-btn ${adminTab === "installations" ? "active" : ""}" data-tab="installations">
            Installations (${installations.length})
          </button>
          <button type="button" class="tab-btn ${adminTab === "maintenance" ? "active" : ""}" data-tab="maintenance">
            Repair Work (${maintenance.length})
          </button>
        </div>
        <div class="list-tools admin-search">
          <input type="search" id="adminSearch" placeholder="Search..." value="${escapeHtml(searchQuery)}" />
        </div>

        ${
          adminTab === "installations"
            ? `<div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Vehicle</th>
                      <th>GPS Model</th>
                      <th>MAC ID</th>
                      <th>Sensor</th>
                      <th>IMEI History</th>
                      <th>SIM History</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${
                      filteredInstalls.length
                        ? filteredInstalls
                            .map(
                              (i) => `
                        <tr>
                          <td class="date-cell">${escapeHtml(formatDateTime(i.createdAt))}</td>
                          <td>${escapeHtml(i.vehicleNo)}</td>
                          <td>${escapeHtml(i.gpsModel)}</td>
                          <td>${escapeHtml(i.macId)}</td>
                          <td>${escapeHtml(i.sensorNo)}</td>
                          <td class="history-cell">${historyList(i.imeiHistory)}</td>
                          <td class="history-cell">${historyList(i.simHistory)}</td>
                        </tr>`
                            )
                            .join("")
                        : `<tr class="empty-row"><td colspan="7">No installations found.</td></tr>`
                    }
                  </tbody>
                </table>
              </div>`
            : `<div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Vehicle</th>
                      <th>IMEI</th>
                      <th>Work Done</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${
                      filteredMaint.length
                        ? filteredMaint
                            .map(
                              (m) => `
                        <tr>
                          <td class="date-cell">${escapeHtml(formatDateTime(m.createdAt))}</td>
                          <td>${escapeHtml(m.vehicleNo)}</td>
                          <td>${escapeHtml(m.imei)}</td>
                          <td>${escapeHtml(workLabels(m))}</td>
                          <td class="status-cell">${getMaintenanceStatus(m)}</td>
                        </tr>`
                            )
                            .join("")
                        : `<tr class="empty-row"><td colspan="5">No repair records found.</td></tr>`
                    }
                  </tbody>
                </table>
              </div>`
        }
      </section>
    </main>
  `;

  bindLogout();

  app.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      adminTab = btn.dataset.tab;
      render();
    });
  });

  document.getElementById("adminSearch")?.addEventListener("input", (e) => {
    searchQuery = e.target.value;
    render();
  });

  app.querySelectorAll(".deactivate-btn").forEach((btn) => {
    btn.addEventListener("click", () => handleSimDeactivation(btn.dataset.id));
  });
}

function handleSimDeactivation(recordId) {
  const records = loadMaintenance();
  const record = records.find((m) => m.id === recordId);
  if (!record) return;

  if (
    !confirm(
      `Confirm old SIM ${record.oldSimNo} is deactivated for vehicle ${record.vehicleNo}?`
    )
  ) {
    return;
  }

  deactivateSim(recordId);
}

async function deactivateSim(recordId) {
  const records = loadMaintenance();
  const record = records.find((m) => m.id === recordId);
  if (!record) return;

  const now = new Date().toISOString();
  record.simDeactivated = true;
  record.simDeactivatedAt = now;
  record.simDeactivationPending = false;

  const allInstalls = loadInstallations();
  const inst = allInstalls.find((i) => i.id === record.installationId);

  if (inst && record.oldSimNo) {
    inst.simHistory.forEach((s) => {
      if (s.value === record.oldSimNo && s.pendingDeactivation) {
        s.active = false;
        s.pendingDeactivation = false;
        s.deactivatedAt = now;
      }
    });
  }

  try {
    await updateMaintenanceRecord(record);
    if (inst) await updateInstallation(inst);
    await refreshAllData();
    showToast("Old SIM marked as deactivated.");
    render();
  } catch (err) {
    showToast(err.message || "Failed to update SIM status.", true);
  }
}

function render() {
  switch (view) {
    case "login":
      renderLogin();
      break;
    case "akash-home":
      renderAkashHome();
      break;
    case "install":
      renderInstallForm();
      break;
    case "repair":
      renderRepairForm();
      break;
    case "admin":
      renderAdmin();
      break;
    default:
      renderLogin();
  }
}

async function initApp() {
  if (!isSupabaseConfigured()) {
    renderConfigMissing();
    return;
  }

  try {
    initDb();
    render();
  } catch (err) {
    app.innerHTML = `
      ${renderHeader("GPS Maintenance Tracker", "Error")}
      <main class="main centered">
        <section class="card login-card">
          <h2>Could not start app</h2>
          <p class="login-desc">${escapeHtml(err.message)}</p>
        </section>
      </main>
    `;
  }
}

initApp();
