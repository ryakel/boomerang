// Isolated render harness for the Wallaby Habits surface. Mounts the real
// HabitsView with mock routine data so the look can be verified via the
// screenshot harness WITHOUT touching AppV2. Dev-only; not shipped.
import { createRoot } from 'react-dom/client'
import './index.css'
import './v2/tokens.css'
import './v2/wallaby/palette.css'
import HabitsView from './v2/wallaby/HabitsView'
import TasksView from './v2/wallaby/TasksView'
import ProfileView from './v2/wallaby/ProfileView'
import GoalsView from './v2/wallaby/GoalsView'
import HomeView from './v2/wallaby/HomeView'

document.documentElement.setAttribute('data-ui', 'v2')
document.documentElement.setAttribute('data-theme', new URLSearchParams(location.search).get('theme') || 'wallaby-dark')

// Deterministic-ish completed_history generator over the past ~200 days.
function gen(seed, density, days = 200) {
  let s = seed
  const rand = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff }
  const out = []
  const now = Date.now()
  for (let i = 0; i < days; i++) {
    if (rand() < density) {
      const d = new Date(now - i * 86400000)
      d.setHours(9, 0, 0, 0)
      out.push(d.toISOString())
      if (rand() < density * 0.4) out.push(new Date(d.getTime() + 3600000).toISOString())
    }
  }
  return out
}

const routines = [
  { id: 'threads', title: 'Post on Threads', energy: 'desk', completed_history: gen(7, 0.55) },
  { id: 'saas', title: 'SaaS Work', energy: 'creative', completed_history: gen(19, 0.42) },
  { id: 'github', title: 'GitHub Activity', energy: 'desk', completed_history: gen(3, 0.72) },
  { id: 'reddit', title: 'Post on Reddit', energy: 'people', completed_history: gen(31, 0.24) },
  { id: 'cycling', title: 'Cycling', energy: 'physical', completed_history: gen(11, 0.35) },
  { id: 'reading', title: 'Read 20 pages', energy: 'creative', completed_history: gen(23, 0.5) },
]

// When the screenshot harness injects real routine rows from the dev API
// (window.__WALLABY_ROUTINES__), render those; otherwise fall back to mock.
const data = window.__WALLABY_ROUTINES__ && window.__WALLABY_ROUTINES__.length
  ? window.__WALLABY_ROUTINES__
  : routines

const surface = new URLSearchParams(location.search).get('surface') || 'habits'
const root = createRoot(document.getElementById('root'))

if (surface === 'tasks') {
  root.render(
    <TasksView
      tasks={window.__WALLABY_TASKS__ || []}
      labels={window.__WALLABY_LABELS__ || []}
      onToggleComplete={() => {}}
      onToggleItem={() => {}}
      onAdd={() => {}}
    />,
  )
} else if (surface === 'profile') {
  root.render(
    <ProfileView
      dailyStats={{ pointsToday: 14, tasksToday: 3 }}
      streak={6}
      records={{ longestStreak: 21, bestTasks: 9, bestPoints: 64 }}
      lifetimeDone={(window.__WALLABY_TASKS__ || []).filter(t => t.status === 'done').length || 142}
      routines={data}
      dailyHistory={window.__WALLABY_HISTORY__ || null}
    />,
  )
} else if (surface === 'goals') {
  const labels = [
    { id: 'lf', name: 'finance', color: '#41C083' },
    { id: 'lh', name: 'home', color: '#F0973E' },
  ]
  const projects = [
    { id: 'g1', title: 'Pay off mortgage', status: 'project', tags: ['lf'], due_date: '2026-09-09', notes: "I don't want to be stressed.", session_count: 4 },
    { id: 'g2', title: 'Renovate the kitchen', status: 'project', tags: ['lh'], notes: 'Make the space we actually want to cook in.', session_count: 2 },
    { id: 'g3', title: 'Learn Spanish', status: 'project', tags: [], session_count: 7, notes: 'So I can talk with abuela.' },
  ]
  const goalTasks = [
    { id: 'c1', parent_id: 'g2', status: 'done', title: 'Demo old cabinets' },
    { id: 'c2', parent_id: 'g2', status: 'done', title: 'Pick countertops' },
    { id: 'c3', parent_id: 'g2', status: 'not_started', title: 'Install backsplash' },
    { id: 'c4', parent_id: 'g2', status: 'not_started', title: 'Paint walls' },
  ]
  root.render(
    <GoalsView
      projects={projects}
      tasks={goalTasks}
      labels={labels}
      onLogSession={() => {}}
      onComplete={() => {}}
      onEdit={() => {}}
      onSetAside={() => {}}
      onDelete={() => {}}
      onAdd={() => {}}
    />,
  )
} else if (surface === 'home') {
  root.render(<HomeView routines={data} onToggleHabit={() => {}} onOpenProfile={() => {}} />)
} else {
  root.render(<HabitsView routines={data} onAdd={() => {}} />)
}
