import { useState } from 'react'
import ModalShell from './ModalShell'
import EmptyState from './EmptyState'
import './SettingsModal.css'

const STORAGE_KEY = 'ui_version'

const TABS = ['General', 'AI', 'Labels', 'Integrations', 'Notifications', 'Data', 'Logs', 'Beta']

// Tabs whose v2 port hasn't shipped yet — they fall through to a placeholder
// EmptyState that points users to the v1 Settings. As tabs port in PR5b/f,
// remove them from this set.
const PLACEHOLDER_TABS = new Set(['General', 'AI', 'Labels', 'Integrations', 'Notifications', 'Data', 'Logs'])

const PLACEHOLDER_BODY = {
  General: 'Theme + defaults. Ports in a later release.',
  AI: 'Anthropic API key, model picker, custom instructions. Ports in a later release.',
  Labels: 'Create + manage tag colors. Ports in a later release.',
  Integrations: 'Trello, Notion, Google Calendar, Gmail, 17track, Pushover. Many fields — ports last.',
  Notifications: 'Per-channel × per-type matrix. Ports in a later release.',
  Data: 'Export, clear completed, clear all. Ports in a later release.',
  Logs: 'Server-side log tail. Ports in a later release.',
}

export default function SettingsModal({ open, onClose }) {
  const [activeTab, setActiveTab] = useState('Beta')

  const switchToV1 = () => {
    localStorage.setItem(STORAGE_KEY, 'v1')
    window.location.reload()
  }

  return (
    <ModalShell open={open} onClose={onClose} title="Settings" width="wide">
      <div className="v2-settings-tabs">
        {TABS.map(tab => (
          <button
            key={tab}
            className={`v2-settings-tab${activeTab === tab ? ' v2-settings-tab-active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="v2-settings-content">
        {PLACEHOLDER_TABS.has(activeTab) && (
          <EmptyState
            title={`${activeTab} settings`}
            body={`${PLACEHOLDER_BODY[activeTab]} Use v1 → Settings to configure for now.`}
            cta="Open v1"
            ctaOnClick={switchToV1}
          />
        )}

        {activeTab === 'Beta' && (
          <div className="v2-settings-beta">
            <div className="v2-settings-block">
              <h3 className="v2-settings-heading">Interface</h3>
              <p className="v2-settings-body">
                You're using <strong>v2</strong>. Toggle off to flip back to v1 instantly. Your
                data stays put — only the interface changes.
              </p>
              <label className="v2-settings-toggle">
                <input
                  type="checkbox"
                  checked
                  onChange={e => {
                    if (!e.target.checked) {
                      localStorage.setItem(STORAGE_KEY, 'v1')
                      window.location.reload()
                    }
                  }}
                />
                <span className="v2-settings-toggle-track">
                  <span className="v2-settings-toggle-thumb" />
                </span>
                <span className="v2-settings-toggle-label">Use v2 interface</span>
              </label>
              <p className="v2-settings-hint">
                URL escape hatch: <code>?ui=v1</code> or <code>?ui=v2</code> sets the flag and reloads.
              </p>
            </div>

            <div className="v2-settings-block">
              <h3 className="v2-settings-heading">Build</h3>
              <p className="v2-settings-body">Static identifier of the running build — never overwritten by autosave.</p>
              <code className="v2-settings-build">{__APP_VERSION__}</code>
            </div>

            <div className="v2-settings-block">
              <h3 className="v2-settings-heading">What's coming</h3>
              <ul className="v2-settings-roadmap">
                <li>Settings tabs (General, AI, Labels, Integrations, Notifications, Data, Logs)</li>
                <li>Routines, Projects, Packages, Quokka, Analytics, Activity Log</li>
                <li>KanbanBoard for desktop</li>
                <li>Toast + motion polish + dark mode parity sweep</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </ModalShell>
  )
}
