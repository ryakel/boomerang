import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import Header from './components/Header'
import ModalShell from './components/ModalShell'
import EmptyState from './components/EmptyState'
import './AppV2.css'

const STORAGE_KEY = 'ui_version'

const PLACEHOLDER_COPY = {
  adviser: {
    title: 'Quokka',
    body: 'The v2 Quokka adviser lands in a later release. Pop back to v1 to chat with Quokka in the meantime.',
  },
  packages: {
    title: 'Packages',
    body: 'Package tracking ports to v2 in a later release. v1 still works — flip back to use it.',
  },
  menu: {
    title: 'More',
    body: 'Settings, Projects, Analytics, and Activity Log will land here as v2 surfaces ship. The Beta toggle lives in v1 → Settings → Beta for now.',
  },
}

export default function AppV2() {
  const [openModal, setOpenModal] = useState(null)

  useEffect(() => {
    document.documentElement.setAttribute('data-ui', 'v2')
    return () => {
      document.documentElement.removeAttribute('data-ui')
    }
  }, [])

  const switchToV1 = () => {
    localStorage.setItem(STORAGE_KEY, 'v1')
    window.location.reload()
  }

  const meta = openModal ? PLACEHOLDER_COPY[openModal] : null

  return (
    <div className="v2-app">
      <Header
        onOpenAdviser={() => setOpenModal('adviser')}
        onOpenPackages={() => setOpenModal('packages')}
        onOpenMenu={() => setOpenModal('menu')}
      />
      <main className="v2-main">
        <EmptyState
          icon={Sparkles}
          title="Welcome to v2"
          body="The redesign is being built incrementally. The header above and this empty state are the design foundation — typography, color discipline, modal language. Task list, full modals, and analytics ship in the coming releases."
          cta="Back to v1"
          ctaOnClick={switchToV1}
        />
      </main>

      <ModalShell
        open={!!openModal}
        onClose={() => setOpenModal(null)}
        title={meta?.title || ''}
        subtitle="Coming soon in v2"
      >
        <EmptyState
          title="Not yet ported"
          body={meta?.body || ''}
          cta="Use v1 for this"
          ctaOnClick={switchToV1}
        />
      </ModalShell>
    </div>
  )
}
