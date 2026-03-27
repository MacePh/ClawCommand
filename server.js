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
  events.unshift({ id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`, ts: new Date().toISOString(), type, message, meta })
  writeJson(EVENTS_FILE, events.slice(0, 200))
}

function runOpenClaw(args) {
  return new Promise((resolve) => {
    execFile('openclaw', args, { timeout: 20000, windowsHide: true }, (error, stdout, stderr) => {
      resolve({ error, stdout: stdout || '', stderr: stderr || '' })
    })
  })
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

app.get('/api/events', (_req, res) => {
  res.json(readJson(EVENTS_FILE))
})

app.get('/api/openclaw/status', async (_req, res) => {
  const result = await runOpenClaw(['status'])
  if (result.error) {
    addEvent('openclaw.error', 'Failed to fetch OpenClaw status', { error: String(result.error.message || result.error) })
    return res.status(500).json({ error: String(result.error.message || result.error), stdout: result.stdout, stderr: result.stderr })
  }
  res.json({ output: result.stdout })
})

app.get('/api/openclaw/sessions', async (_req, res) => {
  const result = await runOpenClaw(['sessions', '--json'])
  if (result.error) {
    return res.status(500).json({ error: String(result.error.message || result.error), stdout: result.stdout, stderr: result.stderr })
  }
  try {
    res.json(JSON.parse(result.stdout || '[]'))
  } catch {
    res.json({ raw: result.stdout })
  }
})

app.post('/api/openclaw/refresh', async (_req, res) => {
  addEvent('openclaw.refresh', 'Manual OpenClaw refresh requested')
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
})
