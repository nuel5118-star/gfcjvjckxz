const BASE = '/api';
async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, { method, headers: {'Content-Type':'application/json'}, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) { const err = await res.json().catch(() => ({error: res.statusText})); throw new Error(err.error || 'Request failed'); }
  return res.json();
}
export const api = {
  getCampaigns: () => req('GET', '/campaigns'),
  getCampaign: (id) => req('GET', `/campaigns/${id}`),
  createCampaign: (data) => req('POST', '/campaigns', data),
  updateCampaign: (id, data) => req('PUT', `/campaigns/${id}`, data),
  deleteCampaign: (id) => req('DELETE', `/campaigns/${id}`),
  launchCampaign: (id) => req('POST', `/campaigns/${id}/launch`),
  pauseCampaign: (id) => req('POST', `/campaigns/${id}/pause`),
  resumeCampaign: (id) => req('POST', `/campaigns/${id}/resume`),
  getCampaignAnalytics: (id) => req('GET', `/campaigns/${id}/analytics`),
  parseCSV: (csv) => req('POST', '/csv/parse', { csv }),
  getContacts: (cid, params={}) => { const qs = new URLSearchParams(params).toString(); return req('GET', `/campaigns/${cid}/contacts?${qs}`); },
  getAllContacts: (params={}) => { const qs = new URLSearchParams(params).toString(); return req('GET', `/contacts?${qs}`); },
  importContacts: (cid, csv, mapping) => req('POST', `/campaigns/${cid}/contacts/import`, { csv, mapping }),
  removeContact: (cid, id) => req('DELETE', `/campaigns/${cid}/contacts/${id}`),
  blacklistContact: (id, reason) => req('POST', `/contacts/${id}/blacklist`, { reason }),
  updateContactStatus: (id, data) => req('PUT', `/contacts/${id}/status`, data),
  bulkAction: (cid, action, contact_ids) => req('POST', `/campaigns/${cid}/contacts/bulk`, { action, contact_ids }),
  exportContacts: (cid, status) => {
    const qs = status && status !== 'all' ? '?status='+status : '';
    const a = document.createElement('a');
    a.href = BASE+'/campaigns/'+cid+'/contacts/export'+qs;
    a.download = 'contacts.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  },
  preview: (subject, body, contact) => req('POST', '/preview', { subject, body, contact }),
  getBlacklist: (params={}) => { const qs = new URLSearchParams(params).toString(); return req('GET', `/blacklist?${qs}`); },
  addToBlacklist: (email, reason) => req('POST', '/blacklist', { email, reason }),
  importBlacklist: (csv) => req('POST', '/blacklist/import', { csv }),
  removeFromBlacklist: (id) => req('DELETE', `/blacklist/${id}`),
  getInboxes: () => req('GET', '/inboxes'),
  createInbox: (data) => req('POST', '/inboxes', data),
  updateInbox: (id, data) => req('PUT', `/inboxes/${id}`, data),
  deleteInbox: (id) => req('DELETE', `/inboxes/${id}`),
  getSettings: () => req('GET', '/settings'),
  updateSettings: (data) => req('PUT', '/settings', data),
  getAnalytics: (params={}) => { const qs = new URLSearchParams(params).toString(); return req('GET', `/analytics?${qs}`); },
  getAnalyticsEvents: (params={}) => { const qs = new URLSearchParams(params).toString(); return req('GET', `/analytics/events?${qs}`); },
  getEmailBody: (sendId) => req('GET', `/email/body/${sendId}`),
  getCalculatorLeads: (params={}) => { const qs = new URLSearchParams(params).toString(); return req('GET', `/calculator-leads?${qs}`); },
  getReplies: (params={}) => { const qs = new URLSearchParams(params).toString(); return req('GET', `/replies?${qs}`); }
};
