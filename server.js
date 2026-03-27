import express from 'express'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { execFile } from 'child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const app = express()
const PORT = process.env.CLAWCOMMAND_PORT || 4310
const DATA_DIR = path.join(__dirname, 'data')
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json')
const EVENTS_FILE = path.join(DATA_DIR, 'events.json')
const WORKSPACE_DIR = path.join(process.env.USERPROFILE || __dirname, '.openclaw', 'workspace')
const MEMORY_DIR = path.join(WORKSPACE_DIR, 'memory')
const ACTIVITY_LOG_FILE = path.join(MEMORY_DIR, 'activity.log')

const telemetryState = {
  lastGatewaySummary: null,
  sessionsByKey: new Map(),
  lastSessionCount: null,
  lastStatusParsed: null,
}

app.use(cors())
app.use(express.json())

fs.mkdirSync(DATA_DIR, { recursive: true })

function ensureJsonFile(file, fallback) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(fallback, null, 2), 'utf-8')
  }
}

ensureJsonFile(TASKS_FILE, {
  columns: {
    todo: [{ id: 'seed-1', title: 'Inspect active OpenClaw sessions', detail: 'Baseline visibility into Boris activity.', lane: 'todo' }],
    doing: [{ id: 'seed-2', title: 'Build ClawCommand v1 shell', detail: 'Hybrid dashboard with local persistence + OpenClaw adapters.', lane: 'doing' }],
    done: []
  }
})
ensureJsonFile(EVENTS_FILE, [])

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf-8'))
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf-8')
}

function addEvent(type, message, meta = {}) {
  const events = readJson(EVENTS_FILE)
  const last = events[0]
  if (last && last.type === type && last.message === message) {
    return
  }
  events.unshift({ id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`, ts: new Date().toISOString(), type, message, meta })
  writeJson(EVENTS_FILE, events.slice(0, 300))
}

function runOpenClaw(args) {
  return new Promise((resolve) => {
    execFile('openclaw', args, { timeout: 20000, windowsHide: true }, (error, stdout, stderr) => {
      resolve({ error, stdout: stdout || '', stderr: stderr || '' })
    })
  })
}

function normalizeSessions(data) {
  if (Array.isArray(data)) return data
  if (Array.isArray(data.sessions)) return data.sessions
  if (Array.isArray(data.items)) return data.items
  return []
}

function parseSessionRow(session) {
  const key = session.key || session.sessionKey || session.id || 'session'
  const age = session.age || session.updatedAt || session.lastUpdated || 'unknown'
  const model = session.model || session.modelName || 'unknown'
  const kind = session.kind || session.type || 'unknown'
  const tokens = session.tokens || session.tokenUsage || session.context || ''
  return { key, age, model, kind, tokens }
}

function parseStatusDetails(output) {
  const text = String(output || '')
  const gatewayState = text.includes('RPC probe: ok') || text.includes('reachable') ? 'online' : 'unknown'
  const telegramState = text.includes('Telegram │ ON │ OK') || text.includes('Telegram') ? 'configured' : 'missing'
  const sessionMatch = text.match(/Sessions\s*│\s*([^\n]+)/)
  const sessionsSummary = sessionMatch ? sessionMatch[1].trim() : 'unknown'
  return { gatewayState, telegramState, sessionsSummary }
}

function getActivityLines(limit = 100) {
  if (!fs.existsSync(ACTIVITY_LOG_FILE)) return []
  const lines = fs.readFileSync(ACTIVITY_LOG_FILE, 'utf-8').split(/\r?\n/).filter(Boolean)
  return lines.slice(-limit)
}

function getRecentMemoryText() {
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const yesterdayDate = new Date(now)
  yesterdayDate.setDate(now.getDate() - 1)
  const yesterday = yesterdayDate.toISOString().slice(0, 10)
  const files = [path.join(MEMORY_DIR, `${today}.md`), path.join(MEMORY_DIR, `${yesterday}.md`)]
  return files.map((file) => fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '').filter(Boolean).join('\n\n')
}

function getCommandCenterStatus() {
  const lines = getActivityLines(100)
  const lastActivity = lines.length ? lines[lines.length - 1] : ''
  const taskLines = [...lines].reverse().filter((line) => line.includes('TASK START'))
  const lastTask = taskLines.length ? taskLines[0] : ''
  const status = lines.length && lastTask && !lines.slice().reverse().find((line) => line.includes('TASK COMPLETE')) ? 'running' : 'idle'
  return { lastActivity, lastTask, status }
}

async function collectTelemetry() {
  const [statusResult, sessionsResult] = await Promise.all([
    runOpenClaw(['status']),
    runOpenClaw(['sessions', '--json'])
  ])

  if (!statusResult.error) {
    const parsedStatus = parseStatusDetails(statusResult.stdout)
    const summary = JSON.stringify(parsedStatus)
    if (summary !== telemetryState.lastGatewaySummary) {
      telemetryState.lastGatewaySummary = summary
      telemetryState.lastStatusParsed = parsedStatus
      addEvent('openclaw.status.change', 'Gateway snapshot changed', parsedStatus)
    }
  }

  if (!sessionsResult.error) {
    try {
      const parsed = JSON.parse(sessionsResult.stdout || '[]')
      const sessions = normalizeSessions(parsed).map(parseSessionRow)
      const nextMap = new Map(sessions.map((session) => [session.key, session]))

      if (telemetryState.lastSessionCount !== null && telemetryState.lastSessionCount !== sessions.length) {
        addEvent('openclaw.session.count', `Session count changed: ${telemetryState.lastSessionCount} -> ${sessions.length}`, { count: sessions.length })
      }
      telemetryState.lastSessionCount = sessions.length

      for (const session of sessions) {
        if (!telemetryState.sessionsByKey.has(session.key)) {
          addEvent('openclaw.session.started', `Session appeared: ${session.key}`, session)
        }
      }

      for (const [key, session] of telemetryState.sessionsByKey.entries()) {
        if (!nextMap.has(key)) {
          addEvent('openclaw.session.ended', `Session disappeared: ${key}`, session)
        }
      }

      telemetryState.sessionsByKey = nextMap
    } catch {
      addEvent('openclaw.parse.error', 'Failed to parse session telemetry output')
    }
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'ClawCommand', ts: new Date().toISOString() })
})

app.get('/api/tasks', (_req, res) => {
  res.json(readJson(TASKS_FILE))
})

app.post('/api/tasks', (req, res) => {
  const { title, detail = '', lane = 'todo' } = req.body || {}
  if (!title || !String(title).trim()) {
    return res.status(400).json({ error: 'title required' })
  }
  const data = readJson(TASKS_FILE)
  const task = { id: `${Date.now()}`, title: String(title).trim(), detail: String(detail), lane }
  if (!data.columns[lane]) data.columns[lane] = []
  data.columns[lane].unshift(task)
  writeJson(TASKS_FILE, data)
  addEvent('task.created', `Task created: ${task.title}`, { lane })
  res.json(task)
})

app.put('/api/tasks/:taskId', (req, res) => {
  const { taskId } = req.params
  const { title, detail } = req.body || {}
  const data = readJson(TASKS_FILE)
  for (const lane of Object.keys(data.columns)) {
    const task = data.columns[lane].find((t) => t.id === taskId)
    if (task) {
      task.title = String(title ?? task.title).trim()
      task.detail = String(detail ?? task.detail)
      writeJson(TASKS_FILE, data)
      addEvent('task.updated', `Task updated: ${task.title}`, { lane })
      return res.json(task)
    }
  }
  return res.status(404).json({ error: 'task not found' })
})

app.post('/api/tasks/move', (req, res) => {
  const { taskId, toLane } = req.body || {}
  const data = readJson(TASKS_FILE)
  let found = null
  for (const lane of Object.keys(data.columns)) {
    const idx = data.columns[lane].findIndex((t) => t.id === taskId)
    if (idx >= 0) {
      found = data.columns[lane].splice(idx, 1)[0]
      break
    }
  }
  if (!found) return res.status(404).json({ error: 'task not found' })
  found.lane = toLane
  if (!data.columns[toLane]) data.columns[toLane] = []
  data.columns[toLane].unshift(found)
  writeJson(TASKS_FILE, data)
  addEvent('task.moved', `Task moved: ${found.title}`, { toLane })
  res.json(found)
})

app.delete('/api/tasks/:taskId', (req, res) => {
  const { taskId } = req.params
  const data = readJson(TASKS_FILE)
  for (const lane of Object.keys(data.columns)) {
    const idx = data.columns[lane].findIndex((t) => t.id === taskId)
    if (idx >= 0) {
      const [deleted] = data.columns[lane].splice(idx, 1)
      writeJson(TASKS_FILE, data)
      addEvent('task.deleted', `Task deleted: ${deleted.title}`, { lane })
      return res.json({ ok: true })
    }
  }
  return res.status(404).json({ error: 'task not found' })
})

app.get('/api/events', (_req, res) => {
  res.json(readJson(EVENTS_FILE))
})

app.get('/api/activity', (_req, res) => {
  res.json(getActivityLines(100))
})

app.get('/api/memory', (_req, res) => {
  res.json({ text: getRecentMemoryText() })
})

app.get('/api/status', (_req, res) => {
  res.json(getCommandCenterStatus())
})

app.get('/api/openclaw/status', async (_req, res) => {
  const result = await runOpenClaw(['status'])
  if (result.error) {
    addEvent('openclaw.error', 'Failed to fetch OpenClaw status', { error: String(result.error.message || result.error) })
    return res.status(500).json({ error: String(result.error.message || result.error), stdout: result.stdout, stderr: result.stderr })
  }
  res.json({ output: result.stdout, parsed: parseStatusDetails(result.stdout) })
})

app.get('/api/openclaw/sessions', async (_req, res) => {
  const result = await runOpenClaw(['sessions', '--json'])
  if (result.error) {
    return res.status(500).json({ error: String(result.error.message || result.error), stdout: result.stdout, stderr: result.stderr })
  }
  try {
    const parsed = JSON.parse(result.stdout || '[]')
    const sessions = normalizeSessions(parsed).map(parseSessionRow)
    res.json({ sessions })
  } catch {
    res.json({ sessions: [], raw: result.stdout })
  }
})

app.post('/api/openclaw/refresh', async (_req, res) => {
  addEvent('openclaw.refresh', 'Manual OpenClaw refresh requested')
  await collectTelemetry()
  const [status, sessions] = await Promise.all([
    runOpenClaw(['status']),
    runOpenClaw(['sessions', '--json'])
  ])
  res.json({
    status: status.stdout,
    sessions: sessions.stdout,
    ok: !status.error && !sessions.error
  })
})

app.listen(PORT, () => {
  console.log(`[clawcommand] api listening on http://127.0.0.1:${PORT}`)
  addEvent('server.started', `ClawCommand API started on ${PORT}`)
  collectTelemetry().catch(() => addEvent('openclaw.telemetry.error', 'Initial telemetry collection failed'))
  setInterval(() => {
    collectTelemetry().catch(() => addEvent('openclaw.telemetry.error', 'Periodic telemetry collection failed'))
  }, 10000)
})
