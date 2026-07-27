// The settings component family (wiki/Settings-Design-Language.md §7).
//
// One component per job — one row family, one group wrapper, one navigation
// shell. A new settings screen COMPOSES these; it does not define a local
// SectionHeader. That rule exists because the surface being replaced grew
// seven parallel collapse implementations, four row-title styles and four
// row paddings, all by well-meant local invention.
export { default as SettingsNav } from './SettingsNav'
export { default as SettingsPage } from './SettingsPage'
export { default as SettingsGroup } from './SettingsGroup'
export { default as Toggle } from './Toggle'
export {
  SettingRow,
  ToggleRow,
  ValueRow,
  SegmentRow,
  NavRow,
  ActionRow,
  StatusRow,
  SecretRow,
} from './SettingRow'
