import './style.css'

type Task = { id: string; title: string; detail: string; lane: string }
type TasksPayload = { columns: Record<string, Task[]> }
type SessionItem = {
  key: string
  age?: string
  model?: string
  kind?: string
  tokens?: string | number
  status?: string
  updatedAt?: string | number
  sessionId?: string
  channel?: string
  errorCode?: string
  errorMessage?: string
}
type StatusParsed = { gatewayState: string; telegramState: string; sessionsSummary: string }
type CommandCenterStatus = { lastActivity: string; lastTask: string; status: 'idle' | 'running' | 'queued' | 'attention' }
type QueueTriageRelatedTask = { task_id: string; title?: string; score?: number; relation?: string }
type QueueTriageConflict = { task_id: string; reason?: string; shared_terms?: string[] }
type QueueTriage = {
  recommended_action?: string
  summary?: string
  similar_tasks?: QueueTriageRelatedTask[]
  vagueness_flags?: string[]
  conflict_flags?: QueueTriageConflict[]
  execution_plan?: string[]
  reviewed_at?: string
}
type QueueReviewPayload = { reviewed_at?: string; pending_count?: number; recommended_order?: string[] }

type QueueTriageFreshness = {
  label: string
  stale: boolean
  reviewedAtIso: string | null
  reviewedAtText: string | null
}
type MemoryItem = {
  id: string
  title?: string
  created_at?: string
  updated_at?: string
  summary?: string
  result?: string
  plan?: string
  task?: string
  input?: string
  text?: string
  record_type?: string
  section?: string
  tags?: string[]
}
type MemorySection = { key: string; items: MemoryItem[] }
type QueueTaskImmediateDispatch = {
  requestedTaskId?: string
  dispatched?: boolean
  dispatchedTaskId?: string | null
  dispatchReason?: string
  dispatcher?: { ok?: boolean; task_id?: string | null } | null
}

type QueueTask = {
  id: string
  title?: string
  createdAt?: string
  created_at?: string
  updated_at?: string
  started_at?: string | null
  finished_at?: string | null
  bumped_at?: string | null
  proposed_at?: string | null
  approved_at?: string | null
  rejected_at?: string | null
  dispatch_requested_at?: string | null
  dispatch_requested_by?: string | null
  text: string
  status: 'proposed' | 'queued' | 'running' | 'done' | 'error' | 'failed' | 'claimed' | 'dead' | 'rejected'
  queue_dir?: string
  result?: string
  attempt?: number
  priority?: number
  source?: string
  reason?: string | null
  priority_note?: string
  approval_state?: 'awaiting_approval' | 'approved'
  approval_text?: string
  approved_by?: string
  action?: string
  triage?: QueueTriage
  completion_summary?: string | null
  dispatch_summary?: string | null
  completion_recorded_at?: string | null
  immediate_dispatch?: QueueTaskImmediateDispatch | null
}
type RuntimeService = {
  id: string
  label: string
  group: string
  description: string
  controllable: boolean
  actions: string[]
  status: 'running' | 'stopped' | 'unknown'
  pid?: string | null
  uptime?: string | null
  startedAt?: string | null
  logLines?: string[]
  meta?: Record<string, string>
}

type RuntimeServicesPayload = { services: RuntimeService[]; ts: string }
type GeminiImageEditRecord = {
  id: string
  created_at: string
  model: string
  prompt: string
  input_filename?: string | null
  input_path: string
  mask_path?: string | null
  output_path: string
  input_mime_type?: string
  output_mime_type?: string
  response_text?: string | null
}
type GeminiImageEditsPayload = {
  edits: GeminiImageEditRecord[]
  config: { apiKeyConfigured: boolean; model: string; outputDir: string }
}

const apiBase = 'http://127.0.0.1:4310/api'
let draggedTaskId: string | null = null
let editingTaskId: string | null = null
let queueSubmitInFlight = false
let queueTasksState: QueueTask[] = []
let queueCountsState: Record<string, number> = {}
let runtimeActionInFlight = new Set<string>()
let activeView: 'overview' | 'runtime' | 'deep-dive' | 'image-lab' = 'overview'
let geminiImageEditsState: GeminiImageEditRecord[] = []
let geminiImageEditConfigState: GeminiImageEditsPayload['config'] | null = null
let geminiImageEditInFlight = false
let queuePanelExpanded = true
let activeQueueTab: 'active' | 'done' | 'attention' = 'active'
let cachedRealSessionsForPills: SessionItem[] = []

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <div class="shell">
    <header class="topbar glass">
      <div class="topbar-brand">
        <div class="eyebrow">ClawCommand</div>
        <h1>Hybrid Agent Command Center</h1>
        <p class="subtitle">Observe state. Route work. Watch Boris stop being a black box.</p>
      </div>
      <div class="status-strip">
        <div class="status-group">
          <div class="status-label">System</div>
          <div class="status-indicator" id="health-pill" data-state="unknown">
            <span class="status-dot"></span>
            <span class="status-text">API</span>
          </div>
        </div>
        <div class="status-divider"></div>
        <div class="status-group">
          <div class="status-label">Services</div>
          <div class="status-indicator" id="gateway-pill" data-state="unknown">
            <span class="status-dot"></span>
            <span class="status-text">Gateway</span>
          </div>
          <div class="status-indicator" id="telegram-pill" data-state="unknown">
            <span class="status-dot"></span>
            <span class="status-text">Telegram</span>
          </div>
        </div>
        <div class="status-divider"></div>
        <div class="status-group">
          <div class="status-label">Resources</div>
          <div class="status-indicator" id="session-pill" data-state="unknown">
            <span class="status-dot"></span>
            <span class="status-text">Workers</span>
          </div>
          <div class="status-indicator" id="queue-pill" data-state="unknown">
            <span class="status-dot"></span>
            <span class="status-text">Queue</span>
          </div>
        </div>
        <div class="status-divider"></div>
        <div class="view-toggle" role="tablist" aria-label="ClawCommand views">
          <button id="view-overview" class="view-btn active" data-view="overview">Overview</button>
          <button id="view-runtime" class="view-btn" data-view="runtime">Runtime</button>
          <button id="view-deep-dive" class="view-btn" data-view="deep-dive">Deep Dive</button>
          <button id="view-image-lab" class="view-btn" data-view="image-lab">Image Lab</button>
        </div>
        <button id="refresh-btn" class="control-btn">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M13.5 8C13.5 10.7614 11.2614 13 8.5 13C5.73858 13 3.5 10.7614 3.5 8C3.5 5.23858 5.73858 3 8.5 3C10.5 3 12.2 4.1 13 5.75M13 3V5.75M13 5.75H10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          Refresh
        </button>
      </div>
    </header>

    <main class="view-stack">
      <section class="view-panel active" id="overview-view">
        <section class="overview-grid minimal-overview-grid">
          <div class="overview-primary">
            <div class="panel glass queue-ops-panel" id="task-queue-panel">
              <div class="panel-header queue-panel-header compact-panel-header">
                <div>
                  <div class="panel-title">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M3 8L6 11L13 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    Queue / Active Work
                  </div>
                  <div class="panel-microcopy">Only live queue state and immediate actions stay here.</div>
                </div>
                <button id="queue-panel-toggle" class="queue-panel-toggle" aria-expanded="true">Collapse queue</button>
              </div>
              <div id="queue-panel-body" class="queue-panel-body">
                <div class="command-input-wrapper">
                  <input id="queue-task-input" class="command-input" placeholder="Draft a task for Proposed review..." />
                  <button id="queue-task-submit" class="command-submit">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M2 8H14M14 8L10 4M14 8L10 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </button>
                </div>
                <div id="queue-task-list" class="queue-task-list priority-list"></div>
              </div>
            </div>
          </div>

          <aside class="overview-sidebar overview-sidebar-tight">
            <div class="panel glass compact-overview-panel">
              <div class="panel-header compact-panel-header">
                <div class="panel-title">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5" fill="none"/>
                    <circle cx="8" cy="8" r="2" fill="currentColor"/>
                  </svg>
                  Command Status
                </div>
              </div>
              <div class="status-grid tight-grid overview-status-grid" id="command-status-panel">Loading...</div>
            </div>

            <div class="panel glass compact-overview-panel">
              <div class="panel-header compact-panel-header">
                <div class="panel-title">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <circle cx="5" cy="5" r="2" stroke="currentColor" stroke-width="1.5" fill="none"/>
                    <circle cx="11" cy="5" r="2" stroke="currentColor" stroke-width="1.5" fill="none"/>
                    <circle cx="8" cy="11" r="2" stroke="currentColor" stroke-width="1.5" fill="none"/>
                    <path d="M6.5 6.5L7 10M9.5 6.5L9 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                  </svg>
                  Workers / Sessions
                </div>
              </div>
              <div id="sessions" class="sessions-grid compact-sessions tighter-sessions">Loading...</div>
            </div>
          </aside>
        </section>
      </section>

      <section class="view-panel" id="runtime-view">
        <div class="panel glass">
          <div class="panel-header">
            <div>
              <div class="panel-title">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <rect x="2" y="2.5" width="12" height="11" rx="2" stroke="currentColor" stroke-width="1.5" fill="none"/>
                  <path d="M5 5.5H11M5 8H9M5 10.5H8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
                Runtime / Services
              </div>
              <div class="panel-subtitle runtime-subtitle">Separate control room for background processes. Kept off the main page on purpose.</div>
            </div>
          </div>
          <div id="runtime-services-panel" class="runtime-grid">Loading...</div>
        </div>
      </section>

      <section class="view-panel" id="image-lab-view">
        <section class="deep-dive-section standalone-deep-dive">
          <div>
            <div class="section-kicker">Gemini image edit</div>
            <div class="section-intro">Standalone edit surface first; queue handoff and saved outputs stay one click away.</div>
          </div>
          <div class="image-lab-grid">
            <div class="panel glass image-lab-panel">
              <div class="panel-header">
                <div>
                  <div class="panel-title">Image Edit Request</div>
                  <div class="panel-subtitle">Upload an image, optionally add a mask/reference image, then send a practical edit prompt to Gemini.</div>
                </div>
              </div>
              <div class="image-lab-form">
                <label class="field-block">
                  <span>Gemini model</span>
                  <input id="gemini-model-input" class="command-input" placeholder="gemini-2.0-flash-preview-image-generation" />
                </label>
                <label class="field-block">
                  <span>Input image</span>
                  <input id="gemini-image-input" class="file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" />
                </label>
                <label class="field-block">
                  <span>Mask / reference image (optional)</span>
                  <input id="gemini-mask-input" class="file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" />
                </label>
                <label class="field-block">
                  <span>Edit prompt</span>
                  <textarea id="gemini-prompt-input" class="command-textarea" rows="7" placeholder="Example: Remove the background, keep the subject lighting realistic, and replace the backdrop with a neon control room."></textarea>
                </label>
                <div class="image-lab-actions">
                  <button id="gemini-submit-btn" class="control-btn">Run Gemini edit</button>
                  <button id="gemini-queue-btn" class="view-btn" type="button">Enqueue follow-up task from latest result</button>
                </div>
                <div id="gemini-image-edit-status" class="muted">Waiting for input.</div>
              </div>
            </div>
            <div class="panel glass">
              <div class="panel-header">
                <div>
                  <div class="panel-title">Saved Outputs</div>
                  <div class="panel-subtitle">Outputs are saved locally so operator follow-up has a stable file path.</div>
                </div>
              </div>
              <div id="gemini-image-edit-history" class="image-history-list">Loading...</div>
            </div>
          </div>
        </section>
      </section>

      <section class="view-panel" id="deep-dive-view">
        <section class="deep-dive-section standalone-deep-dive">
          <div>
            <div class="section-kicker">Deep dive</div>
            <div class="section-intro">Planning scratchpads, memory, and raw diagnostics live here so Overview stays readable at normal zoom.</div>
          </div>
          <div class="deep-dive-grid">
            <div class="panel glass planning-panel">
              <div class="panel-header">
                <div>
                  <div class="panel-title">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M2 5H6M10 5H14M2 11H6M10 11H14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                      <circle cx="8" cy="5" r="2" stroke="currentColor" stroke-width="1.5" fill="none"/>
                      <circle cx="8" cy="11" r="2" stroke="currentColor" stroke-width="1.5" fill="none"/>
                    </svg>
                    Local Planning Board
                  </div>
                  <div class="panel-subtitle">Useful scratchpad, but honest about scope: moving cards here does not change runtime or queue execution.</div>
                </div>
              </div>
              <div class="planning-board-banner" role="note" aria-label="Planning board scope notice">
                <div>
                  <strong>Planning only.</strong> This board is stored in <code>data/tasks.json</code> and is not wired to the real Boris workspace queue.
                  Dragging a card to <strong>Done</strong> does not dispatch, complete, or approve anything.
                </div>
                <button class="ghost" id="planning-board-open-queue" type="button">Open real queue</button>
              </div>
              <div class="kanban compact-kanban" id="kanban">Loading...</div>
            </div>

            <div class="panel glass">
              <div class="panel-header">
                <div class="panel-title">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <rect x="2" y="3" width="12" height="10" rx="2" stroke="currentColor" stroke-width="1.5" fill="none"/>
                    <path d="M5 7H11M5 10H8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                  </svg>
                  Working Memory
                </div>
              </div>
              <div class="memory-content compact-memory" id="memory-panel">Loading...</div>
            </div>

            <details class="panel glass detail-panel" open>
              <summary class="detail-summary">
                <span class="panel-title">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M2 8L6 12L14 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                  Recent Activity
                </span>
              </summary>
              <div class="activity-feed detail-body" id="activity-panel">Loading...</div>
            </details>

            <details class="panel glass detail-panel">
              <summary class="detail-summary">
                <span class="panel-title">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.5" fill="none"/>
                    <path d="M6 6L10 10M10 6L6 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                  </svg>
                  Raw OpenClaw Status
                </span>
              </summary>
              <pre id="status-output" class="terminal-output detail-body">Loading...</pre>
            </details>
          </div>
        </section>
      </section>
    </main>
  </div>
`

async function fetchJson<T>(url: string, options?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? 8000
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...options, signal: controller.signal })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms`)
    }
    throw error
  } finally {
    window.clearTimeout(timer)
  }
}

function updateIndicatorState(id: string, state: 'online' | 'error' | 'warning' | 'unknown', text?: string) {
  const pill = document.getElementById(id)!
  pill.setAttribute('data-state', state)
  if (text) {
    const textEl = pill.querySelector('.status-text')
    if (textEl) textEl.textContent = text
  }
}

function applySessionDerivedPills() {
  const telegramLive = cachedRealSessionsForPills.some((s) =>
    String(s.key || '').toLowerCase().includes('telegram'))
  if (telegramLive) {
    updateIndicatorState('telegram-pill', 'online', 'Telegram')
  }
}

function setActiveView(view: 'overview' | 'runtime' | 'deep-dive' | 'image-lab') {
  activeView = view
  document.querySelectorAll<HTMLElement>('.view-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `${view}-view`)
  })
  document.querySelectorAll<HTMLButtonElement>('.view-btn').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === view)
  })
}

function queueTaskState(task: QueueTask): 'online' | 'warning' | 'error' | 'unknown' {
  if (task.status === 'running') return 'online'
  if (task.status === 'proposed' || task.status === 'queued' || task.status === 'claimed') return 'warning'
  if (task.status === 'failed' || task.status === 'error' || task.status === 'dead') return 'error'
  return 'unknown'
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatQueueTimestamp(label: string, value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  const text = Number.isNaN(date.getTime()) ? value : date.toLocaleString()
  return `<span><strong>${label}:</strong> ${escapeHtml(text)}</span>`
}

function conciseTitle(value: string, fallback = 'Untitled item') {
  const text = String(value || '').trim().replace(/\s+/g, ' ')
  if (!text) return fallback
  if (text.length <= 72) return text
  const firstSentence = text.split(/[.;:]/, 1)[0]?.trim()
  if (firstSentence && firstSentence.length >= 12 && firstSentence.length <= 72) return firstSentence
  return `${text.slice(0, 69).trimEnd()}...`
}

function titleFirstSummary(item: MemoryItem) {
  return conciseTitle(
    item.title || item.task || item.input || item.summary || item.result || item.plan || item.text || '',
    'Untitled memory item',
  )
}

function detailPreview(text?: string, max = 180) {
  const normalized = String(text || '').trim().replace(/\s+/g, ' ')
  if (!normalized) return ''
  return normalized.length > max ? `${normalized.slice(0, max - 3).trimEnd()}...` : normalized
}

function formatRelativeAge(value?: string | number | null) {
  if (value === null || value === undefined || value === '') return 'Unknown'
  if (typeof value === 'string' && /^\d+[smhd]$/i.test(value.trim())) return value.trim()

  const numeric = typeof value === 'number' ? value : Number(value)
  if (Number.isFinite(numeric) && numeric > 0 && numeric < 10 * 365 * 24 * 60 * 60 * 1000) {
    const seconds = Math.max(1, Math.round(numeric / 1000))
    if (seconds < 60) return `${seconds}s ago`
    const minutes = Math.round(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.round(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.round(hours / 24)
    return `${days}d ago`
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  const diffMs = Date.now() - date.getTime()
  return formatRelativeAge(diffMs)
}

function triageFreshness(reviewedAt?: string | null, staleAfterMs = 2 * 60 * 60 * 1000): QueueTriageFreshness | null {
  if (!reviewedAt) return null
  const reviewedDate = new Date(reviewedAt)
  if (Number.isNaN(reviewedDate.getTime())) {
    return {
      label: `triage reviewed ${reviewedAt}`,
      stale: false,
      reviewedAtIso: null,
      reviewedAtText: reviewedAt,
    }
  }

  const ageMs = Date.now() - reviewedDate.getTime()
  const ageLabel = formatRelativeAge(Math.max(0, ageMs))
  const stale = ageMs >= staleAfterMs
  return {
    label: stale ? `triaged ${ageLabel} · stale` : `triaged ${ageLabel}`,
    stale,
    reviewedAtIso: reviewedDate.toISOString(),
    reviewedAtText: reviewedDate.toLocaleString(),
  }
}

function formatTokenCount(value?: string | number) {
  if (value === null || value === undefined || value === '') return '—'
  const numeric = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''))
  if (Number.isFinite(numeric)) return numeric.toLocaleString()
  return String(value)
}

function sessionState(item: SessionItem): 'online' | 'warning' | 'error' | 'unknown' {
  const status = String(item.status || '').toLowerCase()
  const error = String(item.errorCode || item.errorMessage || '').toLowerCase()
  if (status.includes('error') || status.includes('failed') || error) return 'error'
  if (status.includes('warn') || status.includes('stale')) return 'warning'
  if (status.includes('running') || status.includes('active') || status.includes('ok') || String(item.key || '')) return 'online'
  return 'unknown'
}

function sessionStateLabel(item: SessionItem) {
  const status = String(item.status || '').trim()
  if (status) return status
  if (item.errorCode) return 'Load issue'
  return 'Active'
}

function queuePriorityOptions(selected: number) {
  const values = [-5, -3, -1, 0, 1, 3, 5, 10]
  const set = Array.from(new Set([...values, selected])).sort((a, b) => a - b)
  return set.map((value) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${value > 0 ? `+${value}` : value}</option>`).join('')
}

function updateQueuePanelToggleLabel() {
  const button = document.getElementById('queue-panel-toggle') as HTMLButtonElement | null
  const body = document.getElementById('queue-panel-body')
  if (!button || !body) return
  body.classList.toggle('collapsed', !queuePanelExpanded)
  button.textContent = queuePanelExpanded ? 'Collapse queue' : 'Expand queue'
  button.setAttribute('aria-expanded', String(queuePanelExpanded))
}

function renderQueueTasks(tasks: QueueTask[], review?: QueueReviewPayload | null) {
  const wrap = document.getElementById('queue-task-list')!
  const proposedTasks = tasks.filter((task) => task.queue_dir === 'proposed')
  const runningTasks = tasks.filter((task) => task.queue_dir === 'running')
  const queuedTasks = tasks.filter((task) => task.queue_dir === 'pending' || task.queue_dir === 'claimed')
  const doneTasks = tasks.filter((task) => task.queue_dir === 'done')
  const attentionTasks = tasks.filter((task) => ['failed', 'dead'].includes(task.queue_dir || '') || ['failed', 'error', 'dead'].includes(task.status))
  const activeTasks = [...proposedTasks, ...runningTasks, ...queuedTasks]
  const reviewFreshness = triageFreshness(review?.reviewed_at)
  const reviewStamp = reviewFreshness?.reviewedAtText || null

  if (activeQueueTab === 'done' && !doneTasks.length && activeTasks.length) activeQueueTab = 'active'
  if (activeQueueTab === 'attention' && !attentionTasks.length && activeTasks.length) activeQueueTab = 'active'

  const renderTaskCard = (task: QueueTask) => {
    const created = task.created_at || task.createdAt || ''
    const when = created ? new Date(created).toLocaleString() : 'unknown time'
    const attempt = typeof task.attempt === 'number' && task.attempt > 0 ? ` · attempt ${task.attempt}` : ''
    const state = queueTaskState(task)
    const triage = task.triage
    const triageStamp = triageFreshness(triage?.reviewed_at || review?.reviewed_at)
    const related = (triage?.similar_tasks || []).slice(0, 2).map((item) => `${escapeHtml(item.relation || 'related')}: ${escapeHtml(item.title || item.task_id)}`).join('<br/>')
    const vagueness = (triage?.vagueness_flags || []).map((item) => escapeHtml(item)).join(' · ')
    const conflicts = (triage?.conflict_flags || []).slice(0, 1).map((item) => `conflict with ${escapeHtml(item.task_id)}${item.reason ? ` — ${escapeHtml(item.reason)}` : ''}`).join('<br/>')
    const plan = (triage?.execution_plan || []).slice(0, 3).map((step) => `<li>${escapeHtml(step)}</li>`).join('')
    const triageFreshnessBadge = triageStamp
      ? `<div class="queue-triage-freshness${triageStamp.stale ? ' queue-triage-freshness-stale' : ''}"${triageStamp.reviewedAtIso ? ` title="Reviewed ${escapeHtml(triageStamp.reviewedAtText || triageStamp.reviewedAtIso)}"` : ''}>${escapeHtml(triageStamp.label)}</div>`
      : ''
    const title = escapeHtml(task.title || task.text)
    const detailText = escapeHtml(task.text)
    const statusLabel = escapeHtml(task.status)
    const source = escapeHtml(task.source || 'unknown')
    const priority = Number(task.priority ?? 0)
    const priorityNote = task.priority_note ? `<div class="task-detail"><strong>Priority note:</strong> ${escapeHtml(task.priority_note)}</div>` : ''
    const immediateDispatch = task.immediate_dispatch
      ? `<div class="task-detail"><strong>Immediate dispatch:</strong> ${task.immediate_dispatch.dispatched ? `sent now${task.immediate_dispatch.dispatchedTaskId ? ` as ${escapeHtml(String(task.immediate_dispatch.dispatchedTaskId))}` : ''}` : `requested, but dispatcher picked ${escapeHtml(String(task.immediate_dispatch.dispatchedTaskId || 'nothing'))}`}</div>`
      : task.dispatch_requested_at
        ? `<div class="task-detail"><strong>Dispatch requested:</strong> ${escapeHtml(task.dispatch_requested_by || 'operator')} at ${escapeHtml(new Date(task.dispatch_requested_at).toLocaleString())}</div>`
        : ''
    const reason = task.reason ? `<div class="task-detail"><strong>Reason:</strong> ${escapeHtml(task.reason)}</div>` : ''
    const completionSummary = task.completion_summary
      ? `<div class="task-detail"><strong>Completion summary:</strong> ${escapeHtml(task.completion_summary)}</div>`
      : task.queue_dir === 'done'
        ? '<div class="task-detail"><strong>Completion summary:</strong> No completion summary recorded yet.</div>'
        : ''
    const dispatchSummary = task.dispatch_summary && task.dispatch_summary !== task.completion_summary
      ? `<div class="task-detail"><strong>Dispatch artifact:</strong> ${escapeHtml(task.dispatch_summary)}</div>`
      : ''
    const timestamps = [
      formatQueueTimestamp('created', task.created_at || task.createdAt),
      formatQueueTimestamp('started', task.started_at),
      formatQueueTimestamp('finished', task.finished_at),
      formatQueueTimestamp('bumped', task.bumped_at),
      formatQueueTimestamp('updated', task.updated_at),
    ].filter(Boolean).join(' · ')
    const approvalControls = task.queue_dir === 'proposed'
      ? `
        <div class="queue-priority-controls">
          <button class="queue-inline-btn primary-btn" data-approve-task="${escapeHtml(task.id)}">Approve</button>
          <button class="queue-inline-btn primary-btn" data-approve-urgent-task="${escapeHtml(task.id)}">Approve urgent + dispatch now</button>
          <button class="queue-inline-btn" data-edit-task="${escapeHtml(task.id)}">Edit</button>
          <button class="queue-inline-btn danger-btn" data-reject-task="${escapeHtml(task.id)}">Reject</button>
        </div>
      `
      : ''
    const priorityControls = task.queue_dir === 'pending'
      ? `
        <div class="queue-priority-controls">
          <button class="queue-inline-btn" data-bump-task="${escapeHtml(task.id)}" data-amount="1">Bump +1</button>
          <button class="queue-inline-btn" data-bump-task="${escapeHtml(task.id)}" data-amount="5">Bump +5</button>
          <button class="queue-inline-btn primary-btn" data-do-now-task="${escapeHtml(task.id)}">Do now → dispatch now</button>
          <button class="queue-inline-btn danger-btn" data-cancel-task="${escapeHtml(task.id)}">Cancel</button>
          <label class="queue-priority-select-wrap">
            <span>Priority</span>
            <select data-priority-select="${escapeHtml(task.id)}">${queuePriorityOptions(priority)}</select>
          </label>
          <button class="queue-inline-btn" data-priority-save="${escapeHtml(task.id)}">Set</button>
        </div>
      `
      : task.queue_dir === 'claimed'
        ? `
          <div class="queue-priority-controls">
            <button class="queue-inline-btn danger-btn" data-cancel-task="${escapeHtml(task.id)}">Cancel before run</button>
          </div>
        `
        : ''

    return `
      <details class="queue-task-card neon-card queue-task-card-${task.queue_dir || task.status}${triageStamp?.stale ? ' queue-task-card-triage-stale' : ''}" data-state="${state}" ${['proposed', 'running', 'claimed', 'pending'].includes(task.queue_dir || '') ? 'open' : ''}>
        <summary class="detail-summary" style="padding:0; border-bottom:none;">
          <div class="queue-card-topline">
            <div>
              <div class="task-title queue-task-title">${title}</div>
              ${task.title && task.title !== task.text ? `<div class="session-meta">${detailText}</div>` : ''}
            </div>
            <div class="queue-status-pill" data-state="${state}">${statusLabel}</div>
          </div>
          <div class="session-meta">${escapeHtml(when)}${attempt}${triage?.recommended_action ? ` · ${escapeHtml(triage.recommended_action)}` : ''}</div>
          ${triageFreshnessBadge}
          ${triage?.summary ? `<div class="task-detail" style="margin-top:8px; margin-bottom:0;">${escapeHtml(triage.summary)}</div>` : ''}
        </summary>
        <div class="detail-body" style="padding-top:10px;">
          <div class="task-detail"><strong>Queue:</strong> ${escapeHtml(task.queue_dir || task.status)} · <strong>Priority:</strong> ${priority >= 0 ? `+${priority}` : priority} · <strong>Source:</strong> ${source}${task.approval_state ? ` · <strong>Approval:</strong> ${escapeHtml(task.approval_state)}` : ''}</div>
          ${timestamps ? `<div class="task-detail">${timestamps}</div>` : ''}
          ${approvalControls}
          ${priorityControls}
          ${priorityNote}
          ${immediateDispatch}
          ${reason}
          ${completionSummary}
          ${dispatchSummary}
          ${related ? `<div class="task-detail"><strong>Related:</strong><br/>${related}</div>` : ''}
          ${vagueness ? `<div class="task-detail"><strong>Vague bits:</strong> ${vagueness}</div>` : ''}
          ${conflicts ? `<div class="task-detail"><strong>Conflict:</strong><br/>${conflicts}</div>` : ''}
          ${plan ? `<div class="task-detail"><strong>Suggested plan:</strong><ol style="margin:6px 0 0 18px;">${plan}</ol></div>` : ''}
        </div>
      </details>
    `
  }

  const renderSection = (title: string, subtitle: string, laneClass: string, items: QueueTask[], emptyText: string) => `
    <section class="queue-lane ${laneClass}">
      <div class="queue-lane-header">
        <div>
          <div class="queue-lane-title">${title}</div>
          <div class="queue-lane-subtitle">${subtitle}</div>
        </div>
        <div class="queue-lane-count">${items.length}</div>
      </div>
      <div class="queue-lane-body">
        ${items.length ? items.map(renderTaskCard).join('') : `<div class="muted">${emptyText}</div>`}
      </div>
    </section>
  `

  const summary = `
    <div class="queue-summary-row">
      <div class="queue-summary-card emphasis-card">
        <div class="queue-summary-value">${activeTasks.length}</div>
        <div class="queue-summary-label">active</div>
      </div>
      <div class="queue-summary-card queue-summary-card-done">
        <div class="queue-summary-value">${doneTasks.length}</div>
        <div class="queue-summary-label">done</div>
      </div>
      <div class="queue-summary-card queue-summary-card-attention">
        <div class="queue-summary-value">${attentionTasks.length}</div>
        <div class="queue-summary-label">needs attention</div>
      </div>
      <div class="queue-summary-card muted-card">
        <div class="queue-summary-value">${runningTasks.length}</div>
        <div class="queue-summary-label">running now</div>
      </div>
    </div>
    ${reviewFreshness ? `<div class="session-meta${reviewFreshness.stale ? ' queue-review-stale-note' : ''}" style="margin: 0 0 8px 0;">${escapeHtml(reviewFreshness.label)}${reviewStamp ? ` · ${escapeHtml(reviewStamp)}` : ''}</div>` : ''}
  `

  const activeView = `
    <div class="queue-lane-grid">
      ${renderSection('Proposed', 'Review here first. Nothing executes until approved.', 'queue-lane-proposed', proposedTasks, 'No proposed work waiting for approval.')}
      ${renderSection('Execution Queue', 'Approved work only. Reprioritize here.', 'queue-lane-queued', [...runningTasks, ...queuedTasks], 'No approved tasks are waiting or running.')}
    </div>
  `

  const doneView = `
    <section class="queue-lane queue-lane-done-view">
      <div class="queue-lane-header">
        <div>
          <div class="queue-lane-title">Done</div>
          <div class="queue-lane-subtitle">Successful work lives here so the active queue stays readable.</div>
        </div>
        <div class="queue-lane-count">${doneTasks.length}</div>
      </div>
      <div class="queue-lane-body queue-lane-body-compact">
        ${doneTasks.length ? doneTasks.map(renderTaskCard).join('') : '<div class="muted">No successfully completed tasks yet.</div>'}
      </div>
    </section>
  `

  const attentionView = `
    <section class="queue-lane queue-lane-attention-view">
      <div class="queue-lane-header">
        <div>
          <div class="queue-lane-title">Needs Attention</div>
          <div class="queue-lane-subtitle">Failed, dead, or operator-stopped work that needs review.</div>
        </div>
        <div class="queue-lane-count">${attentionTasks.length}</div>
      </div>
      <div class="queue-lane-body queue-lane-body-compact">
        ${attentionTasks.length ? attentionTasks.map(renderTaskCard).join('') : '<div class="muted">Nothing is currently asking for attention.</div>'}
      </div>
    </section>
  `

  wrap.innerHTML = summary + `
    <div class="queue-tab-row" role="tablist" aria-label="Queue views">
      <button class="queue-tab-btn ${activeQueueTab === 'active' ? 'active' : ''}" data-queue-tab="active">Active <span>${activeTasks.length}</span></button>
      <button class="queue-tab-btn ${activeQueueTab === 'done' ? 'active queue-tab-btn-done' : 'queue-tab-btn-done'}" data-queue-tab="done">Done <span>${doneTasks.length}</span></button>
      <button class="queue-tab-btn ${activeQueueTab === 'attention' ? 'active queue-tab-btn-attention' : 'queue-tab-btn-attention'}" data-queue-tab="attention">Needs Attention <span>${attentionTasks.length}</span></button>
    </div>
    <div class="queue-tab-panel ${activeQueueTab === 'active' ? 'active' : ''}" data-queue-panel="active">${activeView}</div>
    <div class="queue-tab-panel ${activeQueueTab === 'done' ? 'active' : ''}" data-queue-panel="done">${doneView}</div>
    <div class="queue-tab-panel ${activeQueueTab === 'attention' ? 'active' : ''}" data-queue-panel="attention">${attentionView}</div>
  `

  wrap.querySelectorAll<HTMLButtonElement>('[data-queue-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      const tab = button.dataset.queueTab === 'done'
        ? 'done'
        : button.dataset.queueTab === 'attention'
          ? 'attention'
          : 'active'
      activeQueueTab = tab
      renderQueueTasks(queueTasksState, review)
    })
  })

  wrap.querySelectorAll<HTMLButtonElement>('[data-approve-task]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.preventDefault()
      event.stopPropagation()
      const taskId = button.dataset.approveTask
      if (!taskId) return
      await approveQueueTask(taskId, false, button)
    })
  })

  wrap.querySelectorAll<HTMLButtonElement>('[data-approve-urgent-task]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.preventDefault()
      event.stopPropagation()
      const taskId = button.dataset.approveUrgentTask
      if (!taskId) return
      await approveQueueTask(taskId, true, button)
    })
  })

  wrap.querySelectorAll<HTMLButtonElement>('[data-edit-task]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.preventDefault()
      event.stopPropagation()
      const taskId = button.dataset.editTask
      if (!taskId) return
      const task = queueTasksState.find((item) => item.id === taskId)
      if (!task) return
      const nextText = window.prompt('Edit proposed task', task.text)
      if (!nextText || !nextText.trim()) return
      await editQueueTask(taskId, nextText.trim(), Number(task.priority ?? 0), button)
    })
  })

  wrap.querySelectorAll<HTMLButtonElement>('[data-reject-task]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.preventDefault()
      event.stopPropagation()
      const taskId = button.dataset.rejectTask
      if (!taskId) return
      if (!window.confirm('Reject and remove this proposed task?')) return
      await rejectQueueTask(taskId, button)
    })
  })

  wrap.querySelectorAll<HTMLButtonElement>('[data-bump-task]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.preventDefault()
      event.stopPropagation()
      const taskId = button.dataset.bumpTask
      const amount = Number(button.dataset.amount || '1')
      if (!taskId) return
      await bumpQueueTask(taskId, amount, button)
    })
  })

  wrap.querySelectorAll<HTMLButtonElement>('[data-do-now-task]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.preventDefault()
      event.stopPropagation()
      const taskId = button.dataset.doNowTask
      if (!taskId) return
      await doNowQueueTask(taskId, button)
    })
  })

  wrap.querySelectorAll<HTMLButtonElement>('[data-cancel-task]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.preventDefault()
      event.stopPropagation()
      const taskId = button.dataset.cancelTask
      if (!taskId) return
      if (!window.confirm('Cancel this queued item and move it out of the execution queue?')) return
      await cancelQueueTask(taskId, button)
    })
  })

  wrap.querySelectorAll<HTMLButtonElement>('[data-priority-save]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.preventDefault()
      event.stopPropagation()
      const taskId = button.dataset.prioritySave
      if (!taskId) return
      const select = wrap.querySelector<HTMLSelectElement>(`[data-priority-select="${taskId}"]`)
      if (!select) return
      await setQueueTaskPriority(taskId, Number(select.value), button)
    })
  })
}

function renderQueueDepth(counts: Record<string, number>) {
  const proposed = counts.proposed || 0
  const pending = counts.pending || 0
  const running = counts.running || 0

  if (running > 0) {
    updateIndicatorState('queue-pill', 'online', `Queue: ${running} running`)
  } else if (pending > 0 || proposed > 0) {
    const label = proposed > 0 ? `${proposed} proposed / ${pending} queued` : `${pending} queued`
    updateIndicatorState('queue-pill', 'warning', `Queue: ${label}`)
  } else {
    updateIndicatorState('queue-pill', 'unknown', 'Queue')
  }
}

function updateQueueSubmitUi() {
  const input = document.getElementById('queue-task-input') as HTMLInputElement
  const button = document.getElementById('queue-task-submit') as HTMLButtonElement
  button.disabled = queueSubmitInFlight
  button.setAttribute('aria-busy', String(queueSubmitInFlight))
  input.setAttribute('aria-busy', String(queueSubmitInFlight))
}

async function mutateQueueTask(url: string, body: Record<string, unknown> | undefined, button?: HTMLButtonElement) {
  const originalLabel = button?.textContent || ''
  if (button) {
    button.disabled = true
    button.textContent = '...'
  }
  try {
    await fetchJson<QueueTask>(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    })
    await loadQueueTasks()
    await loadEvents()
  } catch (err) {
    alert(`Queue update failed: ${String(err)}`)
  } finally {
    if (button) {
      button.disabled = false
      button.textContent = originalLabel
    }
  }
}

async function approveQueueTask(taskId: string, urgent: boolean, button?: HTMLButtonElement) {
  const originalLabel = button?.textContent || ''
  if (button) {
    button.disabled = true
    button.textContent = '...'
  }
  try {
    await fetchJson<QueueTask>(`${apiBase}/task-queue/${encodeURIComponent(taskId)}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvalText: urgent ? 'urgent' : 'approve', dispatchNow: urgent }),
    })
    await Promise.all([loadQueueTasks(), loadEvents()])
  } catch (err) {
    alert(`Queue approval failed: ${String(err)}`)
  } finally {
    if (button) {
      button.disabled = false
      button.textContent = originalLabel
    }
  }
}

async function editQueueTask(taskId: string, text: string, priority: number, button?: HTMLButtonElement) {
  const originalLabel = button?.textContent || ''
  if (button) {
    button.disabled = true
    button.textContent = '...'
  }
  try {
    await fetchJson<QueueTask>(`${apiBase}/task-queue/${encodeURIComponent(taskId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, priority }),
    })
    await Promise.all([loadQueueTasks(), loadEvents()])
  } catch (err) {
    alert(`Queue edit failed: ${String(err)}`)
  } finally {
    if (button) {
      button.disabled = false
      button.textContent = originalLabel
    }
  }
}

async function rejectQueueTask(taskId: string, button?: HTMLButtonElement) {
  await mutateQueueTask(`${apiBase}/task-queue/${encodeURIComponent(taskId)}/reject`, { reason: 'Rejected from Proposed lane' }, button)
}

async function bumpQueueTask(taskId: string, amount: number, button?: HTMLButtonElement) {
  await mutateQueueTask(`${apiBase}/task-queue/${encodeURIComponent(taskId)}/bump`, { amount }, button)
}

async function setQueueTaskPriority(taskId: string, priority: number, button?: HTMLButtonElement) {
  await mutateQueueTask(`${apiBase}/task-queue/${encodeURIComponent(taskId)}/priority`, { priority }, button)
}

async function doNowQueueTask(taskId: string, button?: HTMLButtonElement) {
  await mutateQueueTask(`${apiBase}/task-queue/${encodeURIComponent(taskId)}/do-now`, {}, button)
}

async function cancelQueueTask(taskId: string, button?: HTMLButtonElement) {
  await mutateQueueTask(`${apiBase}/task-queue/${encodeURIComponent(taskId)}/cancel`, {}, button)
}

function runtimeStateToPill(state: string): 'online' | 'warning' | 'error' | 'unknown' {
  if (state === 'running') return 'online'
  if (state === 'stopped') return 'warning'
  return 'unknown'
}

function formatRuntimeWhen(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function renderRuntimeServices(services: RuntimeService[]) {
  const wrap = document.getElementById('runtime-services-panel')!
  const running = services.filter((service) => service.status === 'running').length
  const stopped = services.filter((service) => service.status === 'stopped').length
  const controllable = services.filter((service) => service.controllable).length
  const groups = Array.from(new Set(services.map((service) => service.group || 'other')))
  const grouped = groups.map((group) => ({
    group,
    services: services.filter((service) => (service.group || 'other') === group),
  }))

  const summary = `
    <div class="runtime-summary-row">
      <div class="runtime-summary-card neon-card">
        <div class="runtime-summary-value">${running}</div>
        <div class="runtime-summary-label">running</div>
      </div>
      <div class="runtime-summary-card neon-card">
        <div class="runtime-summary-value">${stopped}</div>
        <div class="runtime-summary-label">stopped</div>
      </div>
      <div class="runtime-summary-card neon-card">
        <div class="runtime-summary-value">${controllable}</div>
        <div class="runtime-summary-label">controllable</div>
      </div>
      <div class="runtime-summary-card neon-card muted-card">
        <div class="runtime-summary-value">${services.length}</div>
        <div class="runtime-summary-label">services</div>
      </div>
    </div>
  `

  const sections = grouped.map(({ group, services: groupServices }) => {
    const cards = groupServices.map((service) => {
      const actionButtons = (service.actions || []).map((action) => {
        const busyKey = `${service.id}:${action}`
        const busy = runtimeActionInFlight.has(busyKey)
        return `<button class="runtime-action-btn ${action === 'stop' ? 'danger-btn' : ''}" data-service-action="${service.id}:${action}" ${busy ? 'disabled' : ''}>${busy ? `${action}...` : action}</button>`
      }).join('')

      const logLines = (service.logLines?.length ? service.logLines : ['No recent logs.'])
        .map((line) => `<div>${escapeHtml(line)}</div>`)
        .join('')

      const metaEntries = Object.entries(service.meta || {})
        .filter(([, value]) => value)
        .map(([key, value]) => `<div class="runtime-meta-pill"><span>${escapeHtml(key)}</span><strong>${escapeHtml(value)}</strong></div>`)
        .join('')

      return `
        <article class="runtime-card neon-card">
          <div class="runtime-card-header">
            <div>
              <div class="runtime-service-title">${escapeHtml(service.label)}</div>
              <div class="runtime-service-desc">${escapeHtml(service.description)}</div>
            </div>
            <div class="status-indicator runtime-state-pill" data-state="${runtimeStateToPill(service.status)}">
              <span class="status-dot"></span>
              <span class="status-text">${escapeHtml(service.status)}</span>
            </div>
          </div>
          <div class="runtime-meta-grid">
            <div class="status-item compact">
              <div class="status-item-label">PID</div>
              <div class="status-item-value">${escapeHtml(service.pid || '—')}</div>
            </div>
            <div class="status-item compact">
              <div class="status-item-label">Uptime</div>
              <div class="status-item-value">${escapeHtml(service.uptime || '—')}</div>
            </div>
            <div class="status-item compact">
              <div class="status-item-label">Started</div>
              <div class="status-item-value">${escapeHtml(formatRuntimeWhen(service.startedAt))}</div>
            </div>
            <div class="status-item compact">
              <div class="status-item-label">Group</div>
              <div class="status-item-value">${escapeHtml(service.group || '—')}</div>
            </div>
          </div>
          ${metaEntries ? `<div class="runtime-meta-pills">${metaEntries}</div>` : ''}
          <div class="runtime-actions-row">
            ${service.controllable ? actionButtons : '<div class="muted inline">Read-only</div>'}
          </div>
          <div class="runtime-log-wrap">
            <div class="runtime-log-label">Recent logs / output</div>
            <div class="runtime-log">${logLines}</div>
          </div>
        </article>
      `
    }).join('')

    return `
      <section class="runtime-group-block">
        <div class="runtime-group-header">
          <div class="section-kicker">${escapeHtml(group)}</div>
          <div class="session-meta">${groupServices.length} service${groupServices.length === 1 ? '' : 's'}</div>
        </div>
        <div class="runtime-group-grid">${cards}</div>
      </section>
    `
  }).join('')

  wrap.innerHTML = services.length
    ? summary + sections
    : '<div class="muted">No runtime services configured.</div>'

  wrap.querySelectorAll<HTMLButtonElement>('[data-service-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      const value = button.dataset.serviceAction
      if (!value) return
      const [serviceId, action] = value.split(':')
      await runRuntimeAction(serviceId, action)
    })
  })
}

async function loadHealth() {
  try {
    const health = await fetchJson<{ ok: boolean }>(`${apiBase}/health`)
    updateIndicatorState('health-pill', health.ok ? 'online' : 'error', 'API')
  } catch {
    updateIndicatorState('health-pill', 'error', 'API')
  }
}

async function loadStatus() {
  const out = document.getElementById('status-output')!
  try {
    const data = await fetchJson<{
      output: string
      parsed: StatusParsed
      error?: string | null
      gatewayHttp?: { reachable: boolean; latencyMs?: number | null; baseUrl?: string }
      cliStatus?: { ok: boolean | null; error?: string | null }
    }>(`${apiBase}/openclaw/status`)
    out.textContent = data.output || 'No output'

    const httpOk = data.gatewayHttp?.reachable === true
    const cliOk = data.cliStatus?.ok !== false
    const gwState = data.parsed.gatewayState.toLowerCase()

    if (httpOk || gwState.includes('running') || gwState.includes('online')) {
      const label = httpOk && data.gatewayHttp?.latencyMs != null
        ? `Gateway (${data.gatewayHttp.latencyMs}ms)`
        : 'Gateway'
      updateIndicatorState('gateway-pill', 'online', label)
    } else if (gwState === 'unknown') {
      updateIndicatorState('gateway-pill', 'warning', 'Gateway: unreachable')
    } else {
      updateIndicatorState('gateway-pill', 'error', 'Gateway')
    }

    const tgState = data.parsed.telegramState.toLowerCase()
    if (tgState.includes('running') || tgState.includes('configured')) {
      updateIndicatorState('telegram-pill', 'online', 'Telegram')
    } else if (!cliOk && httpOk) {
      updateIndicatorState('telegram-pill', 'warning', 'Telegram: unknown (CLI)')
    } else if (tgState === 'unknown') {
      updateIndicatorState('telegram-pill', 'warning', 'Telegram: unknown')
    } else if (tgState === 'missing') {
      updateIndicatorState('telegram-pill', 'warning', 'Telegram: not configured')
    } else {
      updateIndicatorState('telegram-pill', 'error', 'Telegram')
    }

    applySessionDerivedPills()
  } catch (err) {
    out.textContent = `Status fetch failed\n\n${String(err)}`
    updateIndicatorState('gateway-pill', 'error', 'Gateway')
    updateIndicatorState('telegram-pill', 'error', 'Telegram')
  }
}

async function loadSessions() {
  const wrap = document.getElementById('sessions')!
  try {
    const data = await fetchJson<{
      sessions: SessionItem[]
      error?: string
      errorCode?: string
      gatewayReachable?: boolean
      listingUnavailable?: boolean
      listingDetail?: string
    }>(`${apiBase}/openclaw/sessions`)

    const rawSessions = data.sessions || []
    const hasRealSessions = rawSessions.some((item) => !item.errorCode)

    if (data.listingUnavailable && data.gatewayReachable && !hasRealSessions) {
      cachedRealSessionsForPills = []
      updateIndicatorState('session-pill', 'warning', 'Workers: list unavailable (CLI)')
      const detail = detailPreview(data.listingDetail || '', 220)
      wrap.innerHTML = `
        <div class="session-error-state" data-state="warning">
          <div class="session-error-title">Gateway is up; session list via CLI failed</div>
          <div class="session-error-copy">The OpenClaw HTTP gateway is reachable, but <code>openclaw sessions --json</code> did not return usable data from this process. Boris may still be running; only the CLI bridge from ClawCommand failed.</div>
          ${detail ? `<div class="session-error-copy muted">${escapeHtml(detail)}</div>` : ''}
        </div>
      `
      return
    }

    const items = rawSessions
    const realSessions = items.filter((item) => !item.errorCode)
    cachedRealSessionsForPills = realSessions
    const syntheticErrors = items.filter((item) => item.errorCode)

    if (syntheticErrors.length && !realSessions.length) {
      cachedRealSessionsForPills = []
      updateIndicatorState('session-pill', 'warning', data.gatewayReachable ? 'Workers: list failed' : 'Workers: offline')
      const errorDetail = detailPreview(syntheticErrors[0]?.errorMessage || data.error || '', 200)
      wrap.innerHTML = `
        <div class="session-error-state" data-state="warning">
          <div class="session-error-title">${data.gatewayReachable ? 'Session listing unavailable' : 'OpenClaw gateway offline'}</div>
          <div class="session-error-copy">${data.gatewayReachable
            ? 'Gateway responded to HTTP, but session listing via OpenClaw CLI failed. Check Runtime and Deep Dive → Raw OpenClaw Status.'
            : 'Session listing unavailable because the gateway is not responding. Start the gateway from the Runtime tab or run <code>openclaw gateway start</code>.'}</div>
          ${errorDetail ? `<div class="session-error-copy muted">${escapeHtml(errorDetail)}</div>` : ''}
        </div>
      `
      return
    }

    const errored = realSessions.filter((item) => sessionState(item) === 'error').length
    updateIndicatorState(
      'session-pill',
      errored ? 'error' : realSessions.length > 0 ? 'online' : 'warning',
      errored ? `Workers: ${realSessions.length} (${errored} issue${errored === 1 ? '' : 's'})` : `Workers: ${realSessions.length}`,
    )
    wrap.innerHTML = realSessions.length
      ? realSessions.map((s) => {
          const state = sessionState(s)
          const stateLabel = sessionStateLabel(s)
          const ageLabel = formatRelativeAge(s.age ?? s.updatedAt)
          const tokensLabel = formatTokenCount(s.tokens)
          const secondaryMeta = [s.kind || 'unknown', s.model || 'unknown', s.channel || 'local']
            .filter(Boolean)
            .map((value) => escapeHtml(String(value)))
            .join(' · ')
          const errorDetail = detailPreview(s.errorMessage || s.errorCode || '', 140)
          return `
          <div class="session-card neon-card session-card-${state}">
            <div class="session-card-topline">
              <div class="session-key" title="${escapeHtml(s.key)}">${escapeHtml(conciseTitle(s.key, 'session'))}</div>
              <span class="session-state-badge" data-state="${state}">${escapeHtml(stateLabel)}</span>
            </div>
            <div class="session-meta">${secondaryMeta}</div>
            <div class="session-facts">
              <span><strong>Age:</strong> ${escapeHtml(ageLabel)}</span>
              <span><strong>Tokens:</strong> ${escapeHtml(tokensLabel)}</span>
              ${s.sessionId ? `<span><strong>ID:</strong> ${escapeHtml(String(s.sessionId).slice(0, 8))}</span>` : ''}
            </div>
            ${errorDetail ? `<div class="session-error-summary">${escapeHtml(errorDetail)}</div>` : ''}
            <button class="kill-session-btn danger-btn" data-key="${escapeHtml(s.key)}">Kill Session</button>
          </div>
        `}).join('')
      : '<div class="muted">No active sessions.</div>'

    wrap.querySelectorAll<HTMLButtonElement>('.kill-session-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const key = btn.dataset.key
        if (!key) return
        if (!confirm(`Kill session "${key}"?\n\nBoris will reload from workspace files on next message. Memory is safe.`)) return
        btn.disabled = true
        btn.textContent = 'Killing...'
        try {
          await fetchJson(`${apiBase}/openclaw/sessions/${encodeURIComponent(key)}`, { method: 'DELETE' })
          btn.textContent = 'Killed'
          setTimeout(() => loadSessions(), 1500)
        } catch (err) {
          btn.disabled = false
          btn.textContent = 'Kill Session'
          alert(`Failed to kill session: ${String(err)}`)
        }
      })
    })
  } catch (err) {
    cachedRealSessionsForPills = []
    updateIndicatorState('session-pill', 'error', 'Workers')
    wrap.innerHTML = `
      <div class="session-error-state" data-state="error">
        <div class="session-error-title">Session panel unavailable</div>
        <div class="session-error-copy">ClawCommand could not load worker/session data right now. Refresh the panel or check Runtime / OpenClaw status instead.</div>
      </div>
    `
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
  const preview = detailPreview(task.detail, 140)
  return `
    <details class="task-card neon-card" draggable="true" data-task-card="${task.id}">
      <summary class="detail-summary task-card-summary">
        <div class="task-title">${escapeHtml(task.title)}</div>
        ${preview ? `<div class="task-detail">${escapeHtml(preview)}</div>` : ''}
      </summary>
      <div class="detail-body task-card-body">
        <div class="task-detail">${escapeHtml(task.detail || 'No detail yet.')}</div>
        <div class="task-actions">
          <button data-edit="${task.id}">Edit</button>
          ${lane !== 'todo' ? `<button data-task="${task.id}" data-move="todo">To Do</button>` : ''}
          ${lane !== 'doing' ? `<button data-task="${task.id}" data-move="doing">Doing</button>` : ''}
          ${lane !== 'done' ? `<button data-task="${task.id}" data-move="done">Done</button>` : ''}
          <button class="danger" data-delete="${task.id}">Delete</button>
        </div>
      </div>
    </details>
  `
}

async function loadTasks() {
  const wrap = document.getElementById('kanban')!
  const openQueueButton = document.getElementById('planning-board-open-queue') as HTMLButtonElement | null
  if (openQueueButton) {
    openQueueButton.onclick = () => {
      setActiveView('overview')
      document.getElementById('task-queue-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }
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

function renderMemoryPanel(sections: MemorySection[]) {
  const panel = document.getElementById('memory-panel')!
  const html = sections
    .filter((section) => section.items?.length)
    .map((section) => {
      const cards = section.items.map((item) => {
        const title = titleFirstSummary(item)
        const preview = detailPreview(item.summary || item.result || item.plan || item.task || item.input || item.text, 160)
        const body = [item.task, item.input, item.summary, item.plan, item.result, item.text]
          .filter(Boolean)
          .map((value) => `<div class="task-detail">${escapeHtml(String(value))}</div>`)
          .join('')
        const when = item.updated_at || item.created_at
        const whenText = when ? new Date(when).toLocaleString() : 'unknown time'
        return `
          <details class="queue-task-card neon-card memory-item-card">
            <summary class="detail-summary task-card-summary">
              <div class="task-title">${escapeHtml(title)}</div>
              <div class="session-meta">${escapeHtml(section.key)} · ${escapeHtml(whenText)}</div>
              ${preview ? `<div class="task-detail">${escapeHtml(preview)}</div>` : ''}
            </summary>
            <div class="detail-body task-card-body">${body || '<div class="task-detail">No stored detail.</div>'}</div>
          </details>
        `
      }).join('')
      return `
        <section class="memory-section-block">
          <div class="queue-lane-header">
            <div>
              <div class="queue-lane-title">${escapeHtml(section.key)}</div>
              <div class="queue-lane-subtitle">Recent ${escapeHtml(section.key)} records with title-first summaries.</div>
            </div>
            <div class="queue-lane-count">${section.items.length}</div>
          </div>
          <div class="queue-lane-body">${cards}</div>
        </section>
      `
    }).join('')

  panel.innerHTML = html || '<div class="muted">No recent memory records.</div>'
}

async function loadMemoryPanel() {
  const panel = document.getElementById('memory-panel')!
  try {
    const data = await fetchJson<{ sections: MemorySection[] }>(`${apiBase}/memory-items`)
    renderMemoryPanel(data.sections || [])
    return
  } catch (err) {
    const message = String(err)
    if (!message.includes('404')) {
      panel.textContent = `Memory load failed\n\n${message}`
      return
    }
  }

  try {
    const fallback = await fetchJson<{ text: string }>(`${apiBase}/memory`)
    const text = String(fallback.text || '').trim()
    panel.innerHTML = text
      ? `<div class="task-detail" style="white-space: pre-wrap; margin: 0;">${escapeHtml(text)}</div>`
      : '<div class="muted">No recent memory text available.</div>'
  } catch (err) {
    panel.innerHTML = '<div class="muted">Working Memory unavailable on this API build. Upgrade/restart the ClawCommand API to restore structured memory cards.</div>'
  }
}

async function loadCommandStatus() {
  const panel = document.getElementById('command-status-panel')!
  try {
    const data = await fetchJson<CommandCenterStatus>(`${apiBase}/status`)
    const statusTone = data.status === 'running' ? 'online' : data.status === 'attention' ? 'error' : data.status === 'queued' ? 'warning' : 'unknown'
    panel.innerHTML = `
      <div class="status-item">
        <div class="status-item-label">Last Activity</div>
        <div class="status-item-value">${data.lastActivity || 'none'}</div>
      </div>
      <div class="status-item">
        <div class="status-item-label">Last Task</div>
        <div class="status-item-value">${data.lastTask || 'none'}</div>
      </div>
      <div class="status-item">
        <div class="status-item-label">System Status</div>
        <div class="status-item-value"><span class="session-state-badge" data-state="${statusTone}">${escapeHtml(data.status)}</span></div>
      </div>
    `
  } catch (err) {
    panel.innerHTML = `<div class="muted">Status load failed: ${String(err)}</div>`
  }
}

async function loadQueueDepth() {
  try {
    const data = await fetchJson<{ counts: Record<string, number> }>(`${apiBase}/workspace-queue`)
    queueCountsState = data.counts || {}
    renderQueueDepth(queueCountsState)
  } catch {
    updateIndicatorState('queue-pill', 'error', 'Queue')
  }
}

async function loadQueueTasks() {
  const wrap = document.getElementById('queue-task-list')!
  try {
    const data = await fetchJson<{ tasks: QueueTask[]; counts?: Record<string, number>; review?: QueueReviewPayload | null }>(`${apiBase}/task-queue`)
    queueTasksState = Array.isArray(data.tasks) ? data.tasks : []
    if (data.counts) {
      queueCountsState = data.counts
      renderQueueDepth(queueCountsState)
    }
    renderQueueTasks(queueTasksState, data.review)
  } catch (err) {
    wrap.innerHTML = `<div class="muted">Queue load failed: ${String(err)}</div>`
  }
}

async function loadRuntimeServices() {
  const wrap = document.getElementById('runtime-services-panel')!
  const endpoints = [`${apiBase}/runtime-services`, `${apiBase}/runtime/services`]

  for (const endpoint of endpoints) {
    try {
      const data = await fetchJson<RuntimeServicesPayload>(endpoint, { timeoutMs: 12000 })
      renderRuntimeServices(data.services || [])
      return
    } catch (err) {
      const message = String(err)
      if (!message.includes('404')) {
        wrap.innerHTML = `<div class="muted">Runtime services load failed: ${message}</div>`
        return
      }
    }
  }

  wrap.innerHTML = `
    <div class="session-error-state" data-state="warning">
      <div class="session-error-title">Runtime services unavailable</div>
      <div class="session-error-copy">This ClawCommand API instance does not expose the runtime-services endpoint, so the Runtime view is intentionally demoted instead of pretending to have controls.</div>
    </div>
  `
}


function setGeminiImageEditStatus(message: string, tone: 'online' | 'warning' | 'error' | 'unknown' = 'unknown') {
  const el = document.getElementById('gemini-image-edit-status')
  if (!el) return
  el.textContent = message
  el.setAttribute('data-state', tone)
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'))
    reader.onload = () => resolve(String(reader.result || ''))
    reader.readAsDataURL(file)
  })
}

function renderGeminiImageEditHistory(edits: GeminiImageEditRecord[], config?: GeminiImageEditsPayload['config'] | null) {
  const wrap = document.getElementById('gemini-image-edit-history')
  if (!wrap) return
  if (!edits.length) {
    wrap.innerHTML = `<div class="muted">No saved Gemini image edits yet.${config ? ` Output dir: ${escapeHtml(config.outputDir)}` : ''}</div>`
    return
  }
  wrap.innerHTML = edits.map((edit) => `
    <details class="queue-task-card neon-card memory-item-card image-history-card" ${edits[0]?.id === edit.id ? 'open' : ''}>
      <summary>
        <div class="queue-card-topline">
          <div>
            <div class="task-title queue-task-title">${escapeHtml(conciseTitle(edit.prompt || edit.input_filename || 'Gemini image edit', 'Gemini image edit'))}</div>
            <div class="task-detail"><strong>Saved:</strong> ${escapeHtml(new Date(edit.created_at).toLocaleString())} ? <strong>Model:</strong> ${escapeHtml(edit.model || 'unknown')}</div>
          </div>
          <div class="queue-status-pill" data-state="online">saved</div>
        </div>
      </summary>
      <div class="task-body">
        <div class="task-detail"><strong>Prompt:</strong> ${escapeHtml(edit.prompt || '')}</div>
        <div class="task-detail"><strong>Input:</strong> <code>${escapeHtml(edit.input_path)}</code></div>
        ${edit.mask_path ? `<div class="task-detail"><strong>Mask:</strong> <code>${escapeHtml(edit.mask_path)}</code></div>` : ''}
        <div class="task-detail"><strong>Output:</strong> <code>${escapeHtml(edit.output_path)}</code></div>
        ${edit.response_text ? `<div class="task-detail"><strong>Gemini notes:</strong> ${escapeHtml(edit.response_text)}</div>` : ''}
      </div>
    </details>
  `).join('')
}

async function loadGeminiImageEdits() {
  try {
    const data = await fetchJson<GeminiImageEditsPayload>(`${apiBase}/gemini-image-edits`)
    geminiImageEditsState = Array.isArray(data.edits) ? data.edits : []
    geminiImageEditConfigState = data.config || null
    const modelInput = document.getElementById('gemini-model-input') as HTMLInputElement | null
    if (modelInput && !modelInput.value.trim() && data.config?.model) modelInput.value = data.config.model
    renderGeminiImageEditHistory(geminiImageEditsState, geminiImageEditConfigState)
    if (!data.config?.apiKeyConfigured) {
      setGeminiImageEditStatus('Gemini API key not configured on the ClawCommand server. Set GEMINI_API_KEY or GOOGLE_API_KEY first.', 'warning')
    }
  } catch (error) {
    const message = String(error)
    renderGeminiImageEditHistory([], null)
    if (message.includes('404')) {
      setGeminiImageEditStatus('Image Lab is unavailable on this API build. Restart/update the ClawCommand API to enable Gemini image edit routes.', 'warning')
      return
    }
    setGeminiImageEditStatus(`Image edit history failed to load: ${message}`, 'error')
  }
}

async function submitGeminiImageEdit() {
  if (geminiImageEditInFlight) return
  const imageInput = document.getElementById('gemini-image-input') as HTMLInputElement
  const maskInput = document.getElementById('gemini-mask-input') as HTMLInputElement
  const promptInput = document.getElementById('gemini-prompt-input') as HTMLTextAreaElement
  const modelInput = document.getElementById('gemini-model-input') as HTMLInputElement
  const submitButton = document.getElementById('gemini-submit-btn') as HTMLButtonElement
  const file = imageInput.files?.[0]
  const maskFile = maskInput.files?.[0]
  const prompt = promptInput.value.trim()
  const model = modelInput.value.trim()
  if (!file) {
    setGeminiImageEditStatus('Pick an input image first.', 'warning')
    return
  }
  if (!prompt) {
    setGeminiImageEditStatus('Write the edit prompt first.', 'warning')
    return
  }

  geminiImageEditInFlight = true
  submitButton.disabled = true
  setGeminiImageEditStatus('Uploading image and waiting on Gemini...', 'warning')
  try {
    const [inputImageDataUrl, maskImageDataUrl] = await Promise.all([
      fileToDataUrl(file),
      maskFile ? fileToDataUrl(maskFile) : Promise.resolve(''),
    ])
    const data = await fetchJson<{ edit: GeminiImageEditRecord }>(`${apiBase}/gemini-image-edits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeoutMs: 120000,
      body: JSON.stringify({
        prompt,
        model,
        inputFilename: file.name,
        inputImageDataUrl,
        maskImageDataUrl: maskImageDataUrl || undefined,
      }),
    })
    geminiImageEditsState = [data.edit, ...geminiImageEditsState.filter((item) => item.id !== data.edit.id)]
    renderGeminiImageEditHistory(geminiImageEditsState, geminiImageEditConfigState)
    setGeminiImageEditStatus(`Saved edited image to ${data.edit.output_path}`, 'online')
    await Promise.allSettled([loadEvents(), loadGeminiImageEdits()])
  } catch (error) {
    setGeminiImageEditStatus(`Gemini image edit failed: ${String(error)}`, 'error')
  } finally {
    geminiImageEditInFlight = false
    submitButton.disabled = false
  }
}

async function draftQueueTaskFromLatestImageEdit() {
  const latest = geminiImageEditsState[0]
  if (!latest) {
    setGeminiImageEditStatus('Run at least one image edit first so there is something to hand off.', 'warning')
    return
  }
  const text = `Use the Gemini-edited asset at ${latest.output_path}. Prompt: ${latest.prompt}. Input image: ${latest.input_path}.${latest.mask_path ? ` Mask/reference: ${latest.mask_path}.` : ''} Review whether this should be wired into the next Boris/ClawCommand operator step, then stage any follow-up implementation task with the saved asset path.`
  try {
    await fetchJson<QueueTask>(`${apiBase}/task-queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, mode: 'queue' }),
    })
    setGeminiImageEditStatus('Queued a real follow-up task from the latest image edit.', 'online')
    await Promise.allSettled([loadQueueTasks(), loadQueueDepth(), loadEvents()])
  } catch (error) {
    setGeminiImageEditStatus(`Failed to enqueue follow-up task: ${String(error)}`, 'error')
  }
}

async function runRuntimeAction(serviceId: string, action: string) {
  const key = `${serviceId}:${action}`
  runtimeActionInFlight.add(key)
  await loadRuntimeServices()
  try {
    await fetchJson(`${apiBase}/runtime-services/${encodeURIComponent(serviceId)}/${encodeURIComponent(action)}`, { method: 'POST' })
  } catch (err) {
    alert(`Runtime action failed: ${String(err)}`)
  } finally {
    runtimeActionInFlight.delete(key)
    await Promise.all([loadRuntimeServices(), loadStatus(), loadSessions(), loadEvents()])
    applySessionDerivedPills()
  }
}

async function refreshDashboard() {
  await fetchJson(`${apiBase}/openclaw/refresh`, { method: 'POST', timeoutMs: 12000 })
  await Promise.all([
    loadStatus(),
    loadSessions(),
    loadEvents(),
    loadQueueTasks(),
    loadQueueDepth(),
    activeView === 'runtime' ? loadRuntimeServices() : Promise.resolve(),
    activeView === 'image-lab' ? loadGeminiImageEdits() : Promise.resolve(),
    loadCommandStatus(),
    loadMemoryPanel(),
  ])
  applySessionDerivedPills()
}

document.getElementById('refresh-btn')!.addEventListener('click', refreshDashboard)

document.querySelectorAll<HTMLButtonElement>('.view-btn').forEach((button) => {
  button.addEventListener('click', async () => {
    const view = button.dataset.view === 'runtime'
      ? 'runtime'
      : button.dataset.view === 'deep-dive'
        ? 'deep-dive'
        : button.dataset.view === 'image-lab'
          ? 'image-lab'
          : 'overview'
    setActiveView(view)
    if (view === 'runtime') await loadRuntimeServices()
    if (view === 'image-lab') await loadGeminiImageEdits()
  })
})

async function submitQueueTask() {
  if (queueSubmitInFlight) return

  const input = document.getElementById('queue-task-input') as HTMLInputElement
  const text = input.value.trim()
  if (!text) return

  queueSubmitInFlight = true
  updateQueueSubmitUi()

  try {
    const createdTask = await fetchJson<QueueTask>(`${apiBase}/task-queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, mode: 'proposed' })
    })

    input.value = ''
    queueTasksState = [createdTask, ...queueTasksState.filter((task) => task.id !== createdTask.id)]
    if (createdTask.status === 'proposed') {
      queueCountsState = { ...queueCountsState, proposed: (queueCountsState.proposed || 0) + 1 }
    } else {
      queueCountsState = { ...queueCountsState, pending: (queueCountsState.pending || 0) + 1 }
    }
    renderQueueTasks(queueTasksState)
    renderQueueDepth(queueCountsState)

    await loadQueueTasks()
  } finally {
    queueSubmitInFlight = false
    updateQueueSubmitUi()
  }
}

document.getElementById('queue-task-submit')!.addEventListener('click', submitQueueTask)
document.getElementById('queue-task-input')!.addEventListener('keydown', async (event) => {
  if (event.key !== 'Enter') return
  event.preventDefault()
  await submitQueueTask()
})
document.getElementById('queue-panel-toggle')!.addEventListener('click', () => {
  queuePanelExpanded = !queuePanelExpanded
  updateQueuePanelToggleLabel()
})
document.getElementById('gemini-submit-btn')?.addEventListener('click', submitGeminiImageEdit)
document.getElementById('gemini-queue-btn')?.addEventListener('click', draftQueueTaskFromLatestImageEdit)

let coreRefreshInFlight = false

async function refreshCorePanels() {
  if (coreRefreshInFlight) return
  coreRefreshInFlight = true
  try {
    await Promise.allSettled([
      loadHealth(),
      loadStatus(),
      loadSessions(),
      loadTasks(),
      loadEvents(),
      loadCommandStatus(),
      loadQueueTasks(),
      loadQueueDepth(),
      activeView === 'runtime' ? loadRuntimeServices() : Promise.resolve(),
      activeView === 'image-lab' ? loadGeminiImageEdits() : Promise.resolve(),
    ])
    applySessionDerivedPills()
  } finally {
    coreRefreshInFlight = false
  }
}

async function boot() {
  updateQueueSubmitUi()
  updateQueuePanelToggleLabel()
  setActiveView('overview')
  await Promise.allSettled([
    refreshCorePanels(),
    loadMemoryPanel(),
  ])
  setInterval(() => {
    refreshCorePanels()
  }, 10000)
  setInterval(() => {
    loadMemoryPanel()
  }, 30000)
}

boot()
