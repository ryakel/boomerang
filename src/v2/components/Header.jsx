import { Plus, Sparkles, Package, MoreVertical, Target } from 'lucide-react'
import Logo from '../../components/Logo'
import './Header.css'

export default function Header({ onOpenAdviser, onOpenPackages, onOpenMenu, onOpenAdd, onOpenWhatNow }) {
  return (
    <header className="v2-header">
      <div className="v2-header-brand">
        <Logo size={26} />
        <span className="v2-header-wordmark">BOOMERANG</span>
      </div>
      <nav className="v2-header-actions">
        {onOpenWhatNow && (
          <button className="v2-header-whatnow" onClick={onOpenWhatNow}>
            <Target size={14} strokeWidth={2} />
            <span className="v2-header-whatnow-label">What now?</span>
          </button>
        )}
        {onOpenAdd && (
          <button className="v2-header-icon v2-header-icon-primary" onClick={onOpenAdd} aria-label="New task">
            <Plus size={20} strokeWidth={2} />
          </button>
        )}
        <button className="v2-header-icon v2-header-icon-quokka" onClick={onOpenAdviser} aria-label="Quokka">
          <Sparkles size={20} strokeWidth={1.75} />
        </button>
        <button className="v2-header-icon v2-header-icon-packages" onClick={onOpenPackages} aria-label="Packages">
          <Package size={20} strokeWidth={1.75} />
        </button>
        <button className="v2-header-icon" onClick={onOpenMenu} aria-label="More">
          <MoreVertical size={20} strokeWidth={1.75} />
        </button>
      </nav>
    </header>
  )
}
