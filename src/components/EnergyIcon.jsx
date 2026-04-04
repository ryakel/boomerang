import { Monitor, Users, MapPin, Palette, Dumbbell } from 'lucide-react'

const ICON_MAP = { Monitor, Users, MapPin, Palette, Dumbbell }

export default function EnergyIcon({ icon, color, size = 16 }) {
  const Icon = ICON_MAP[icon]
  if (!Icon) return null
  return <Icon size={size} color={color} strokeWidth={2} />
}
