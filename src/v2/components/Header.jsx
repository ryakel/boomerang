import { Sparkles, Package, MoreVertical } from 'lucide-react'
import Logo from '../../components/Logo'
import './Header.css'

export default function Header({ onOpenAdviser, onOpenPackages, onOpenMenu }) {
  return (
    <header className="v2-header">
      <div className="v2-header-brand">
        <Logo size={26} />
        <span className="v2-header-wordmark">BOOMERANG</span>
      </div>
      <nav className="v2-header-actions">
        <button className="v2-header-icon" onClick={onOpenAdviser} aria-label="Quokka">
          <Sparkles size={20} strokeWidth={1.75} />
        </button>
        <button className="v2-header-icon" onClick={onOpenPackages} aria-label="Packages">
          <Package size={20} strokeWidth={1.75} />
        </button>
        <button className="v2-header-icon" onClick={onOpenMenu} aria-label="More">
          <MoreVertical size={20} strokeWidth={1.75} />
        </button>
      </nav>
    </header>
  )
}
