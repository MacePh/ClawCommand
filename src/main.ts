import './style.css'

type Task = { id: string; title: string; detail: string; lane: string }
type TasksPayload = { columns: Record<string, Task[]> }
type EventItem = { id: string; ts: string; type: string; message: string }

const apiBase = 'http://127.0.0.1:4310/api'

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <div class="shell">
    <header class="topbar">
      <div>
        <div class="eyebrow">ClawCommand</div>
        <h1>Hybrid Agent Command Center</h1>
      </div>
      <div class="status-strip">
        <div class="pill" id="health-pill">API: ...</div>
        <div class="pill" id="gateway-pill">Gateway: ...</div>
        <button id="refresh-btn">Refresh OpenClaw</button>
      </div>
    </header>

    <section class="hero-grid">
      <div class="panel">
        <div class="panel-title">Live Activity Feed</div>
        <div id="events" class="feed"></div>
      </div>
      <div class="panel">
        <div class="panel-title">Quick Task Intake</div>
        <form id="task-form" class="task-form">
          <input id="task-title" placeholder="Create a task..." />
          <textarea id="task-detail" placeholder="Why it matters / next step"></textarea>
          <select id="task-lane">
            <option value="todo">To Do</option>
            <option value="doing">Doing</option>
            <option value="done">Done</option>
          </select>
          <button type="submit">Add Task</button>
        </form>
      </div>
    </section>

    <section class="main-grid">
      <div class="panel wide">
        <div class="panel-title">Task Pipeline</div>
        <div class="kanban" id="kanban"></div>
      </div>
      <div class="panel">
        <div class="panel-title">OpenClaw Status</div>
        <pre id="status-output" class="status-output">Loading...</pre>
      </div>
      <div class="panel">
        <div class="panel-title">Sessions / Workers</div>
        <div id="sessions" class="sessions"></div>
      </div>
    </section>
  </div>
`

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

async function loadHealth() {
  const pill = document.getElementById('health-pill')!
  try {
    const health = await fetchJson<{ ok: boolean }>(`${apiBase}/health`)
    pill.textContent = health.ok ? 'API: online' : 'API: degraded'
  } catch {
    pill.textContent = 'API: offline'
  }
}

async function loadStatus() {
  const out = document.getElementById('status-output')!
  const pill = document.getElementById('gateway-pill')!
  try {
    const data = await fetchJson<{ output: string }>(`${apiBase}/openclaw/status`)
    out.textContent = data.output || 'No output'
    pill.textContent = data.output.includes('Gateway') ? 'Gateway: visible' : 'Gateway: unknown'
  } catch (err) {
    out.textContent = `Status fetch failed\n\n${String(err)}`
    pill.textContent = 'Gateway: error'
  }
}

async function loadSessions() {
  const wrap = document.getElementById('sessions')!
  try {
    const data = await fetchJson<any>(`${apiBase}/openclaw/sessions`)
    const items = Array.isArray(data) ? data : (data.sessions || [])
    wrap.innerHTML = items.length
      ? items.map((s: any) => `<div class="session-card"><div class="session-key">${s.key || s.sessionKey || 'session'}</div><div class="session-meta">${s.kind || 'unknown'} · ${s.model || 'model?'}</div></div>`).join('')
      : '<div class="muted">No sessions returned yet.</div>'
  } catch (err) {
    wrap.innerHTML = `<div class="muted">Session load failed: ${String(err)}</div>`
  }
}

function laneLabel(key: string) {
  if (key === 'todo') return 'To Do'
  if (key === 'doing') return 'Doing'
  if (key === 'done') return 'Done'
  return key
}

async function loadTasks() {
  const wrap = document.getElementById('kanban')!
  const data = await fetchJson<TasksPayload>(`${apiBase}/tasks`)
  wrap.innerHTML = Object.entries(data.columns).map(([lane, tasks]) => `
    <div class="lane">
      <div class="lane-title">${laneLabel(lane)}</div>
      <div class="lane-body">
        ${tasks.map((task) => `
          <div class="task-card">
            <div class="task-title">${task.title}</div>
            <div class="task-detail">${task.detail || ''}</div>
            <div class="task-actions">
              ${lane !== 'todo' ? `<button data-task="${task.id}" data-move="todo">To Do</button>` : ''}
              ${lane !== 'doing' ? `<button data-task="${task.id}" data-move="doing">Doing</button>` : ''}
              ${lane !== 'done' ? `<button data-task="${task.id}" data-move="done">Done</button>` : ''}
            </div>
          </div>
        `).join('') || '<div class="muted">Empty</div>'}
      </div>
    </div>
  `).join('')

  wrap.querySelectorAll<HTMLButtonElement>('button[data-task]').forEach((btn) => {
    btn.onclick = async () => {
      await fetchJson(`${apiBase}/tasks/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: btn.dataset.task, toLane: btn.dataset.move })
      })
      await Promise.all([loadTasks(), loadEvents()])
    }
  })
}

async function loadEvents() {
  const wrap = document.getElementById('events')!
  const events = await fetchJson<EventItem[]>(`${apiBase}/events`)
  wrap.innerHTML = events.map((event) => `
    <div class="event-item">
      <div class="event-type">${event.type}</div>
      <div class="event-message">${event.message}</div>
      <div class="event-ts">${new Date(event.ts).toLocaleString()}</div>
    </div>
  `).join('') || '<div class="muted">No events yet.</div>'
}

document.getElementById('task-form')!.addEventListener('submit', async (event) => {
  event.preventDefault()
  const title = (document.getElementById('task-title') as HTMLInputElement).value
  const detail = (document.getElementById('task-detail') as HTMLTextAreaElement).value
  const lane = (document.getElementById('task-lane') as HTMLSelectElement).value
  await fetchJson(`${apiBase}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, detail, lane })
  })
  ;(document.getElementById('task-title') as HTMLInputElement).value = ''
  ;(document.getElementById('task-detail') as HTMLTextAreaElement).value = ''
  await Promise.all([loadTasks(), loadEvents()])
})

document.getElementById('refresh-btn')!.addEventListener('click', async () => {
  await fetchJson(`${apiBase}/openclaw/refresh`, { method: 'POST' })
  await Promise.all([loadStatus(), loadSessions(), loadEvents()])
})

async function boot() {
  await Promise.all([loadHealth(), loadStatus(), loadSessions(), loadTasks(), loadEvents()])
  setInterval(() => {
    loadHealth()
    loadStatus()
    loadSessions()
    loadEvents()
  }, 15000)
}

boot()
