import './style.css'

type Task = { id: string; title: string; detail: string; lane: string }
type TasksPayload = { columns: Record<string, Task[]> }
type SessionItem = { key: string; age: string; model: string; kind: string; tokens?: string }
type StatusParsed = { gatewayState: string; telegramState: string; sessionsSummary: string }
type CommandCenterStatus = { lastActivity: string; lastTask: string; status: 'idle' | 'running' }
type QueueTask = { id: string; createdAt?: string; created_at?: string; text: string; status: 'queued' | 'running' | 'done' | 'error' | 'failed'; result?: string; attempt?: number }

const apiBase = 'http://127.0.0.1:4310/api'
let draggedTaskId: string | null = null
let editingTaskId: string | null = null

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <div class="shell">
    <div class="ambient ambient-a"></div>
    <div class="ambient ambient-b"></div>

    <header class="topbar glass">
      <div>
        <div class="eyebrow">ClawCommand</div>
        <h1>Hybrid Agent Command Center</h1>
        <p class="subtitle">Observe state. Route work. Watch Boris stop being a black box.</p>
      </div>
      <div class="status-strip">
        <div class="pill" id="health-pill">API: ...</div>
        <div class="pill" id="gateway-pill">Gateway: ...</div>
        <div class="pill" id="session-pill">Workers: ...</div>
        <div class="pill" id="telegram-pill">Telegram: ...</div>
        <div class="pill" id="queue-pill">Queue: ...</div>
        <button id="refresh-btn" class="primary-btn">Refresh OpenClaw</button>
      </div>
    </header>

    <section class="hero-grid">
      <div class="panel glass">
        <div class="panel-title">Activity</div>
        <pre id="activity-panel" class="status-output">Loading...</pre>
      </div>
      <div class="panel glass stack-panel">
        <div>
          <div class="panel-title">Status</div>
          <pre id="command-status-panel" class="status-output compact-output">Loading...</pre>
        </div>
        <div>
          <div class="panel-title">Memory</div>
          <pre id="memory-panel" class="status-output compact-output">Loading...</pre>
        </div>
        <div>
          <div class="panel-title">Tasks</div>
          <div class="queue-input-row">
            <input id="queue-task-input" placeholder="Add queued task..." />
            <button id="queue-task-submit">Queue</button>
          </div>
          <div id="queue-task-list" class="queue-task-list"></div>
        </div>
      </div>
    </section>

    <section class="main-grid">
      <div class="panel glass wide">
        <div class="panel-title">Task Pipeline</div>
        <div class="kanban" id="kanban"></div>
      </div>
      <div class="panel glass">
        <div class="panel-title">OpenClaw Status</div>
        <pre id="status-output" class="status-output">Loading...</pre>
      </div>
      <div class="panel glass">
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
  const gatewayPill = document.getElementById('gateway-pill')!
  const telegramPill = document.getElementById('telegram-pill')!
  try {
    const data = await fetchJson<{ output: string; parsed: StatusParsed }>(`${apiBase}/openclaw/status`)
    out.textContent = data.output || 'No output'
    gatewayPill.textContent = `Gateway: ${data.parsed.gatewayState}`
    telegramPill.textContent = `Telegram: ${data.parsed.telegramState}`
  } catch (err) {
    out.textContent = `Status fetch failed\n\n${String(err)}`
    gatewayPill.textContent = 'Gateway: error'
    telegramPill.textContent = 'Telegram: error'
  }
}

async function loadSessions() {
  const wrap = document.getElementById('sessions')!
  const pill = document.getElementById('session-pill')!
  try {
    const data = await fetchJson<{ sessions: SessionItem[] }>(`${apiBase}/openclaw/sessions`)
    const items = data.sessions || []
    pill.textContent = `Workers: ${items.length}`
    wrap.innerHTML = items.length
      ? items.map((s) => `
          <div class="session-card neon-card">
            <div class="session-key">${s.key}</div>
            <div class="session-meta">${s.kind} · ${s.model}</div>
            <div class="session-meta">age: ${s.age}</div>
            ${s.tokens ? `<div class="session-meta">tokens: ${s.tokens}</div>` : ''}
          </div>
        `).join('')
      : '<div class="muted">No sessions returned yet.</div>'
  } catch (err) {
    pill.textContent = 'Workers: error'
    wrap.innerHTML = `<div class="muted">Session load failed: ${String(err)}</div>`
  }
}

function laneLabel(key: string) {
  if (key === 'todo') return 'To Do'
  if (key === 'doing') return 'Doing'
  if (key === 'done') return 'Done'
  return key
}

function laneSummary(tasks: Task[]) {
  return `${tasks.length} item${tasks.length === 1 ? '' : 's'}`
}

async function moveTask(taskId: string, toLane: string) {
  await fetchJson(`${apiBase}/tasks/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId, toLane })
  })
  await Promise.all([loadTasks(), loadEvents()])
}

async function deleteTask(taskId: string) {
  await fetchJson(`${apiBase}/tasks/${taskId}`, { method: 'DELETE' })
  await Promise.all([loadTasks(), loadEvents()])
}

async function saveTask(taskId: string) {
  const title = (document.querySelector(`[data-edit-title="${taskId}"]`) as HTMLInputElement).value
  const detail = (document.querySelector(`[data-edit-detail="${taskId}"]`) as HTMLTextAreaElement).value
  await fetchJson(`${apiBase}/tasks/${taskId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, detail })
  })
  editingTaskId = null
  await Promise.all([loadTasks(), loadEvents()])
}

function laneClass(lane: string) {
  return `lane lane-${lane}`
}

function renderTask(task: Task, lane: string) {
  const isEditing = editingTaskId === task.id
  if (isEditing) {
    return `
      <div class="task-card neon-card" draggable="false" data-task-card="${task.id}">
        <input data-edit-title="${task.id}" value="${task.title.replace(/"/g, '&quot;')}" />
        <textarea data-edit-detail="${task.id}">${task.detail || ''}</textarea>
        <div class="task-actions">
          <button data-save="${task.id}">Save</button>
          <button data-cancel="${task.id}">Cancel</button>
        </div>
      </div>
    `
  }
  return `
    <div class="task-card neon-card" draggable="true" data-task-card="${task.id}">
      <div class="task-title">${task.title}</div>
      <div class="task-detail">${task.detail || ''}</div>
      <div class="task-actions">
        <button data-edit="${task.id}">Edit</button>
        ${lane !== 'todo' ? `<button data-task="${task.id}" data-move="todo">To Do</button>` : ''}
        ${lane !== 'doing' ? `<button data-task="${task.id}" data-move="doing">Doing</button>` : ''}
        ${lane !== 'done' ? `<button data-task="${task.id}" data-move="done">Done</button>` : ''}
        <button class="danger" data-delete="${task.id}">Delete</button>
      </div>
    </div>
  `
}

async function loadTasks() {
  const wrap = document.getElementById('kanban')!
  try {
    const data = await fetchJson<TasksPayload>(`${apiBase}/tasks`)
    wrap.innerHTML = Object.entries(data.columns).map(([lane, tasks]) => `
      <div class="${laneClass(lane)}" data-lane="${lane}">
        <div class="lane-title-row">
          <div class="lane-title">${laneLabel(lane)}</div>
          <div class="lane-count">${laneSummary(tasks)}</div>
        </div>
        <div class="lane-body" data-dropzone="${lane}">
          ${tasks.map((task) => renderTask(task, lane)).join('') || '<div class="muted">Empty</div>'}
        </div>
      </div>
    `).join('')
  } catch (err) {
    wrap.innerHTML = `<div class="muted">Kanban load failed: ${String(err)}</div>`
    return
  }

  wrap.querySelectorAll<HTMLButtonElement>('button[data-task]').forEach((btn) => {
    btn.onclick = async () => moveTask(btn.dataset.task!, btn.dataset.move!)
  })
  wrap.querySelectorAll<HTMLButtonElement>('button[data-delete]').forEach((btn) => {
    btn.onclick = async () => deleteTask(btn.dataset.delete!)
  })
  wrap.querySelectorAll<HTMLButtonElement>('button[data-edit]').forEach((btn) => {
    btn.onclick = async () => {
      editingTaskId = btn.dataset.edit!
      await loadTasks()
    }
  })
  wrap.querySelectorAll<HTMLButtonElement>('button[data-save]').forEach((btn) => {
    btn.onclick = async () => saveTask(btn.dataset.save!)
  })
  wrap.querySelectorAll<HTMLButtonElement>('button[data-cancel]').forEach((btn) => {
    btn.onclick = async () => {
      editingTaskId = null
      await loadTasks()
    }
  })
  wrap.querySelectorAll<HTMLElement>('[data-task-card]').forEach((card) => {
    if (editingTaskId) return
    card.addEventListener('dragstart', () => {
      draggedTaskId = card.dataset.taskCard || null
      card.classList.add('dragging')
    })
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging')
    })
  })
  wrap.querySelectorAll<HTMLElement>('[data-dropzone]').forEach((zone) => {
    zone.addEventListener('dragover', (event) => {
      event.preventDefault()
      zone.classList.add('dropzone-active')
    })
    zone.addEventListener('dragleave', () => zone.classList.remove('dropzone-active'))
    zone.addEventListener('drop', async (event) => {
      event.preventDefault()
      zone.classList.remove('dropzone-active')
      if (draggedTaskId) {
        await moveTask(draggedTaskId, zone.dataset.dropzone!)
        draggedTaskId = null
      }
    })
  })
}

async function loadEvents() {
  const panel = document.getElementById('activity-panel')!
  try {
    const lines = await fetchJson<string[]>(`${apiBase}/activity`)
    panel.textContent = lines.length ? lines.join('\n') : 'No activity yet.'
  } catch (err) {
    panel.textContent = `Activity load failed\n\n${String(err)}`
  }
}

async function loadMemoryPanel() {
  const panel = document.getElementById('memory-panel')!
  try {
    const data = await fetchJson<{ text: string }>(`${apiBase}/memory`)
    panel.textContent = data.text || 'No recent memory.'
  } catch (err) {
    panel.textContent = `Memory load failed\n\n${String(err)}`
  }
}

async function loadCommandStatus() {
  const panel = document.getElementById('command-status-panel')!
  try {
    const data = await fetchJson<CommandCenterStatus>(`${apiBase}/status`)
    panel.textContent = [
      `last activity: ${data.lastActivity || 'none'}`,
      `last task: ${data.lastTask || 'none'}`,
      `system status: ${data.status}`,
    ].join('\n')
  } catch (err) {
    panel.textContent = `Status load failed\n\n${String(err)}`
  }
}

async function loadQueueDepth() {
  const pill = document.getElementById('queue-pill')!
  try {
    const data = await fetchJson<{ counts: Record<string, number> }>(`${apiBase}/workspace-queue`)
    const p = data.counts.pending || 0
    const r = data.counts.running || 0
    pill.textContent = r > 0 ? `Queue: ${r} running` : p > 0 ? `Queue: ${p} pending` : 'Queue: idle'
  } catch {
    pill.textContent = 'Queue: ?'
  }
}

async function loadQueueTasks() {
  const wrap = document.getElementById('queue-task-list')!
  try {
    const data = await fetchJson<{ tasks: QueueTask[] }>(`${apiBase}/task-queue`)
    const tasks = Array.isArray(data.tasks) ? data.tasks : []
    wrap.innerHTML = tasks.map((task) => {
      const created = task.created_at || task.createdAt || ''
      const when = created ? new Date(created).toLocaleString() : 'unknown time'
      const attempt = typeof task.attempt === 'number' && task.attempt > 0 ? ` · attempt ${task.attempt}` : ''
      return `
        <div class="queue-task-card neon-card">
          <div class="task-title">${task.text}</div>
          <div class="session-meta">${task.status} · ${when}${attempt}</div>
        </div>
      `
    }).join('') || '<div class="muted">No queued tasks.</div>'
  } catch (err) {
    wrap.innerHTML = `<div class="muted">Queue load failed: ${String(err)}</div>`
  }
}

document.getElementById('refresh-btn')!.addEventListener('click', async () => {
  await fetchJson(`${apiBase}/openclaw/refresh`, { method: 'POST' })
  await Promise.all([loadStatus(), loadSessions(), loadEvents(), loadQueueDepth()])
})

document.getElementById('queue-task-submit')!.addEventListener('click', async () => {
  const input = document.getElementById('queue-task-input') as HTMLInputElement
  const text = input.value.trim()
  if (!text) return
  await fetchJson(`${apiBase}/task-queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  })
  input.value = ''
  await loadQueueTasks()
  await loadQueueDepth()
})

async function boot() {
  await Promise.allSettled([
    loadHealth(),
    loadStatus(),
    loadSessions(),
    loadTasks(),
    loadEvents(),
    loadMemoryPanel(),
    loadCommandStatus(),
    loadQueueTasks(),
    loadQueueDepth(),
  ])
  setInterval(() => {
    loadHealth()
    loadStatus()
    loadSessions()
    loadTasks()
    loadEvents()
    loadCommandStatus()
    loadQueueTasks()
    loadQueueDepth()
  }, 2000)
  setInterval(() => {
    loadMemoryPanel()
  }, 5000)
}

boot()
