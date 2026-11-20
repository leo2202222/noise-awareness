(function () {
  class ThingsBoardAdapter {
    constructor(config) {
      this.config = config;
      this.controller = null;
    }

    async request(path, options = {}) {
      const response = await fetch(`${this.config.baseUrl}${path}`, {
        ...options,
        headers: { "Content-Type": "application/json", ...(options.headers || {}) },
        credentials: "same-origin",
        signal: AbortSignal.timeout(20000)
      });
      if (!response.ok) { const error=new Error(`Data request failed (${response.status})`); error.status=response.status; throw error; }
      if (response.status === 204) return null;
      return response.json();
    }

    getSnapshot(deviceId) {
      return this.request("/snapshot"+(deviceId?"?deviceId="+encodeURIComponent(deviceId)+"&historyMode="+(window.HISTORY_MODE||"samples"):"?historyMode="+(window.HISTORY_MODE||"samples")));
    }

    saveSettings(settings) {
      return this.request("/settings", { method: "PUT", body: JSON.stringify(settings) });
    }

    addDevice(device) {
      return this.request("/devices", { method: "POST", body: JSON.stringify(device) });
    }

    updateDevice(deviceId, changes) {
      return this.request(`/devices/${encodeURIComponent(deviceId)}`, {
        method: "PATCH",
        body: JSON.stringify(changes)
      });
    }

    deleteDevice(deviceId) {
      return this.request(`/devices/${encodeURIComponent(deviceId)}`, {
        method: "DELETE"
      });
    }
  }

  window.ThingsBoardAdapter = ThingsBoardAdapter;
})();
