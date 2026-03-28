import express from 'express'
import cors from 'cors'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { execFile, spawn } from 'child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const app = express()
const PORT = process.env.CLAWCOMMAND_PORT || 4310
const DATA_DIR = path.join(__dirname, 'data')
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json')
const TASK_QUEUE_FILE = path.join(DATA_DIR, 'task_queue.json') // legacy — replaced by workspace queue tree.
const EVENTS_FILE = path.join(DATA_DIR, 'events.json')
const RUNTIME_LOG_DIR = path.join(DATA_DIR, 'runtime-logs')
const GEMINI_IMAGE_EDITS_DIR = path.join(DATA_DIR, 'gemini-image-edits')
const GEMINI_IMAGE_EDITS_INDEX_FILE = path.join(DATA_DIR, 'gemini-image-edits.json')
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || ''
const GEMINI_IMAGE_EDIT_MODEL = process.env.GEMINI_IMAGE_EDIT_MODEL || 'gemini-2.0-flash-preview-image-generation'
const BORIS_WORKSPACE =
  process.env.BORIS_WORKSPACE ||
  (process.env.USERPROFILE
    ? path.join(process.env.USERPROFILE, '.openclaw', 'workspace')
    : path.join(os.homedir(), '.openclaw', 'workspace'))
const WORKSPACE_QUEUE = path.join(BORIS_WORKSPACE, 'queue')
const WORKSPACE_QUEUE_REVIEW_FILE = path.join(WORKSPACE_QUEUE, 'reviews', 'latest.json')
const WORKSPACE_QUEUE_RESULTS_DIR = path.join(WORKSPACE_QUEUE, 'results')
const WORKSPACE_TRIAGE_SCRIPT = path.join(BORIS_WORKSPACE, 'tools', 'queue_triage.py')
const WORKSPACE_DISPATCHER_SCRIPT = path.join(BORIS_WORKSPACE, 'tools', 'dispatcher.py')
const WORKSPACE_ACTIVITY_LOG = path.join(BORIS_WORKSPACE, 'memory', 'activity.log')
const WORKSPACE_MEMORY_DIR = path.join(BORIS_WORKSPACE, 'memory')
const OPENCLAW_PATH = path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming', 'npm', 'openclaw.cmd')
/** Prefer USERPROFILE so paths match npm's openclaw.cmd and ~/.openclaw (os.homedir() can differ for services). */
const OPENCLAW_HOME =
  process.env.OPENCLAW_HOME ||
  (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, '.openclaw') : path.join(os.homedir(), '.openclaw'))
const OPENCLAW_SESSIONS_INDEX =
  process.env.OPENCLAW_SESSIONS_INDEX || path.join(OPENCLAW_HOME, 'agents', 'main', 'sessions', 'sessions.json')
const OPENCLAW_GATEWAY_URL = String(process.env.OPENCLAW_GATEWAY_URL || 'http://127.0.0.1:18789').replace(/\/$/, '')
const OPENCLAW_CLI_STATUS_TIMEOUT_MS = Number(process.env.OPENCLAW_CLI_STATUS_TIMEOUT_MS) || 20000
const OPENCLAW_CLI_SESSIONS_TIMEOUT_MS = Number(process.env.OPENCLAW_CLI_SESSIONS_TIMEOUT_MS) || 120000
const OPENCLAW_SESSIONS_INDEX_SCHEMA_VERSION = Number(process.env.OPENCLAW_SESSIONS_INDEX_SCHEMA_VERSION || 0)
const QUEUE_PROPOSED_DIR = path.join(WORKSPACE_QUEUE, 'proposed')
const QUEUE_STATE_DIRS = ['proposed', 'pending', 'claimed', 'running', 'done', 'failed', 'dead']
const MPD_ROOT = 'F:\\mpd-streamdeck'
const CLAWCOMMAND_ROOT = __dirname

const telemetryState = {
  lastGatewaySummary: null,
  sessionsByKey: new Map(),
  lastSessionCount: null,
  lastStatusParsed: null,
  lastStatusOutput: '',
  lastStatusFetchedAt: null,
  lastSessions: [],
  lastSessionsFetchedAt: null,
  lastStatusError: null,
  lastSessionsError: null,
  lastGatewayHttpProbe: null,
  lastCliStatusOk: null,
  lastCliSessionsOk: null,
  lastSessionsListingDegraded: false,
  lastSessionsListingDetail: null,
}

/** Point-in-time copy for HTTP GETs — avoids torn reads while collectTelemetry() mutates telemetryState */
let telemetryReadSnapshot = null

function publishTelemetrySnapshot() {
  const probe = telemetryState.lastGatewayHttpProbe
  telemetryReadSnapshot = {
    lastStatusParsed: telemetryState.lastStatusParsed ? { ...telemetryState.lastStatusParsed } : null,
    lastStatusOutput: telemetryState.lastStatusOutput,
    lastStatusError: telemetryState.lastStatusError,
    lastStatusFetchedAt: telemetryState.lastStatusFetchedAt,
    lastGatewayHttpProbe: probe ? { ...probe } : null,
    lastCliStatusOk: telemetryState.lastCliStatusOk,
    lastCliSessionsOk: telemetryState.lastCliSessionsOk,
    lastSessions: telemetryState.lastSessions.map((s) => ({ ...s })),
    lastSessionsFetchedAt: telemetryState.lastSessionsFetchedAt,
    lastSessionsError: telemetryState.lastSessionsError,
    lastSessionsListingDegraded: telemetryState.lastSessionsListingDegraded,
    lastSessionsListingDetail: telemetryState.lastSessionsListingDetail,
  }
}

function apiTelemetry() {
  return telemetryReadSnapshot || telemetryState
}

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'dist')))
fs.mkdirSync(DATA_DIR, { recursive: true })
fs.mkdirSync(RUNTIME_LOG_DIR, { recursive: true })
fs.mkdirSync(GEMINI_IMAGE_EDITS_DIR, { recursive: true })

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
ensureJsonFile(TASK_QUEUE_FILE, { tasks: [], activeTaskId: null })
ensureJsonFile(EVENTS_FILE, [])
ensureJsonFile(GEMINI_IMAGE_EDITS_INDEX_FILE, { edits: [] })

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf-8'))
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf-8')
}


function sanitizeFileStem(value, fallback = 'image-edit') {
  const normalized = String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return normalized || fallback
}

function decodeDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/)
  if (!match) {
    const error = new Error('expected a base64 data URL')
    error.statusCode = 400
    throw error
  }
  return { mimeType: match[1], buffer: Buffer.from(match[2], 'base64') }
}

function extensionForMimeType(mimeType, fallback = 'bin') {
  const normalized = String(mimeType || '').toLowerCase()
  if (normalized === 'image/png') return 'png'
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'jpg'
  if (normalized === 'image/webp') return 'webp'
  if (normalized === 'image/gif') return 'gif'
  return fallback
}

function readGeminiImageEdits() {
  const parsed = readJson(GEMINI_IMAGE_EDITS_INDEX_FILE)
  return Array.isArray(parsed?.edits) ? parsed.edits : []
}

function writeGeminiImageEdits(edits) {
  writeJson(GEMINI_IMAGE_EDITS_INDEX_FILE, { edits })
}

function listGeminiImageEdits(limit = 20) {
  return readGeminiImageEdits()
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .slice(0, limit)
}

async function runGeminiImageEdit({ prompt, inputImageDataUrl, inputFilename, maskImageDataUrl, model }) {
  if (!GEMINI_API_KEY) {
    const error = new Error('Missing GEMINI_API_KEY or GOOGLE_API_KEY in ClawCommand server environment')
    error.statusCode = 503
    throw error
  }

  const inputImage = decodeDataUrl(inputImageDataUrl)
  const maskImage = maskImageDataUrl ? decodeDataUrl(maskImageDataUrl) : null
  const requestModel = String(model || GEMINI_IMAGE_EDIT_MODEL || '').trim() || 'gemini-2.0-flash-preview-image-generation'
  const id = `imgedit_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`
  const createdAt = new Date().toISOString()
  const stemBase = sanitizeFileStem(path.basename(String(inputFilename || 'image-edit'), path.extname(String(inputFilename || ''))), 'image-edit')
  const workDir = path.join(GEMINI_IMAGE_EDITS_DIR, id)
  fs.mkdirSync(workDir, { recursive: true })

  const inputExt = extensionForMimeType(inputImage.mimeType, 'png')
  const inputPath = path.join(workDir, `input.${inputExt}`)
  fs.writeFileSync(inputPath, inputImage.buffer)

  let maskPath = null
  const parts = [{ text: String(prompt || '').trim() }, { inlineData: { mimeType: inputImage.mimeType, data: inputImage.buffer.toString('base64') } }]
  if (maskImage) {
    const maskExt = extensionForMimeType(maskImage.mimeType, 'png')
    maskPath = path.join(workDir, `mask.${maskExt}`)
    fs.writeFileSync(maskPath, maskImage.buffer)
    parts.push({ text: 'Use the following mask/secondary image as an additional editing constraint.' })
    parts.push({ inlineData: { mimeType: maskImage.mimeType, data: maskImage.buffer.toString('base64') } })
  }

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(requestModel)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
    }),
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `Gemini image edit request failed (${response.status})`)
    error.statusCode = response.status
    throw error
  }

  const candidateParts = payload?.candidates?.flatMap((candidate) => candidate?.content?.parts || []) || []
  const imagePart = candidateParts.find((part) => part?.inlineData?.data)
  if (!imagePart?.inlineData?.data) {
    const error = new Error('Gemini returned no edited image payload')
    error.statusCode = 502
    throw error
  }

  const outputMimeType = imagePart.inlineData.mimeType || 'image/png'
  const outputExt = extensionForMimeType(outputMimeType, 'png')
  const outputPath = path.join(workDir, `edited.${outputExt}`)
  fs.writeFileSync(outputPath, Buffer.from(imagePart.inlineData.data, 'base64'))

  const textParts = candidateParts.filter((part) => typeof part?.text === 'string').map((part) => part.text.trim()).filter(Boolean)
  const record = {
    id,
    created_at: createdAt,
    model: requestModel,
    prompt: String(prompt || '').trim(),
    input_filename: inputFilename || null,
    input_path: inputPath,
    mask_path: maskPath,
    output_path: outputPath,
    input_mime_type: inputImage.mimeType,
    output_mime_type: outputMimeType,
    response_text: textParts.join('\n\n') || null,
  }

  const edits = readGeminiImageEdits()
  edits.unshift(record)
  writeGeminiImageEdits(edits.slice(0, 100))
  addEvent('gemini.image_edit.completed', `Gemini image edit saved: ${path.basename(outputPath)}`, { id, model: requestModel, outputPath })
  return record
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

function execCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 20000, windowsHide: true, maxBuffer: 32 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
      resolve({ error, stdout: stdout || '', stderr: stderr || '' })
    })
  })
}

function runOpenClaw(args, opts = {}) {
  const cwd =
    fs.existsSync(OPENCLAW_HOME) ? OPENCLAW_HOME : process.env.USERPROFILE || process.env.HOME || os.homedir()
  return execCommand('cmd.exe', ['/c', OPENCLAW_PATH, ...args], { cwd, ...opts })
}

function parseJsonFromCliStdout(stdout) {
  const text = String(stdout || '').trim()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    const startObj = text.indexOf('{')
    const startArr = text.indexOf('[')
    let start = -1
    if (startObj >= 0 && startArr >= 0) start = Math.min(startObj, startArr)
    else start = Math.max(startObj, startArr)
    if (start < 0) return null
    try {
      return JSON.parse(text.slice(start))
    } catch {
      return null
    }
  }
}

function summarizeCliFailure(kind, { error, stdout, stderr } = {}) {
  const combined = String(stderr || stdout || error?.message || error || '').trim()
  const normalized = combined.replace(/\s+/g, ' ')
  if (!normalized) return `${kind} probe failed.`
  if (/timed? out|timeout/i.test(normalized)) return `${kind} probe timed out.`
  if (/not recognized|cannot find|enoent/i.test(normalized)) return `OpenClaw CLI unavailable while fetching ${kind}.`
  if (/econnrefused|connect|reachable|refused/i.test(normalized)) return `${kind} probe could not reach OpenClaw.`
  return `${kind} probe failed.`
}

function summarizeParseFailure(kind) {
  return `OpenClaw returned an unexpected ${kind} payload.`
}

function readSessionsIndexPayload(file) {
  if (!fs.existsSync(file)) return null
  const raw = fs.readFileSync(file, 'utf-8')
  const parsed = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const sessions = normalizeSessions(parsed)
  if (!sessions.length) return null
  const schemaOk = sessions.every((session) => {
    const version = session?.skillsSnapshot?.version
    return version === undefined || version === OPENCLAW_SESSIONS_INDEX_SCHEMA_VERSION
  })
  if (!schemaOk) return null
  return sessions.map(parseSessionRow)
}

function listCandidateOpenClawSessionIndexPaths() {
  const out = []
  const push = (p) => {
    if (p && !out.includes(p)) out.push(p)
  }
  if (process.env.OPENCLAW_SESSIONS_INDEX) push(process.env.OPENCLAW_SESSIONS_INDEX)
  push(OPENCLAW_SESSIONS_INDEX)
  const wsParent = path.dirname(BORIS_WORKSPACE)
  push(path.join(wsParent, 'agents', 'main', 'sessions', 'sessions.json'))
  try {
    const agentsRoot = path.join(OPENCLAW_HOME, 'agents')
    if (fs.existsSync(agentsRoot)) {
      for (const agentId of fs.readdirSync(agentsRoot)) {
        push(path.join(agentsRoot, agentId, 'sessions', 'sessions.json'))
      }
    }
  } catch {
    /* ignore */
  }
  return out
}

function tryReadSessionsFromIndexFile() {
  for (const file of listCandidateOpenClawSessionIndexPaths()) {
    try {
      const sessions = readSessionsIndexPayload(file)
      if (sessions?.length) return sessions
    } catch {
      /* try next path */
    }
  }
  return null
}

function replaceTelemetrySessions(sessions) {
  const nextMap = new Map(sessions.map((session) => [session.key, session]))
  telemetryState.lastSessions = sessions
  telemetryState.lastSessionsFetchedAt = new Date().toISOString()
  telemetryState.lastSessionsError = null
  telemetryState.lastSessionsListingDegraded = false
  if (sessions.length) telemetryState.lastSessionsListingDetail = null
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
}

async function probeOpenClawGatewayHttp() {
  const healthUrl = `${OPENCLAW_GATEWAY_URL}/health`
  const started = Date.now()
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 3000)
    const res = await fetch(healthUrl, { signal: controller.signal })
    clearTimeout(timer)
    const latencyMs = Date.now() - started
    const text = await res.text()
    let body = {}
    try {
      body = JSON.parse(text)
    } catch {
      body = {}
    }
    const live = body.ok === true || body.status === 'live' || (res.ok && /"ok"\s*:\s*true/.test(text))
    return {
      reachable: res.ok && live,
      statusCode: res.status,
      latencyMs,
      url: healthUrl,
      baseUrl: OPENCLAW_GATEWAY_URL,
    }
  } catch (err) {
    return {
      reachable: false,
      statusCode: null,
      latencyMs: Date.now() - started,
      url: healthUrl,
      baseUrl: OPENCLAW_GATEWAY_URL,
      error: String(err?.message || err),
    }
  }
}

function runPowerShell(script, opts = {}) {
  return execCommand('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], opts)
}

function runQueueTriage() {
  if (!fs.existsSync(WORKSPACE_TRIAGE_SCRIPT)) return Promise.resolve(null)
  const python = process.env.PYTHON || 'C:\\Python310\\python.exe'
  return execCommand(python, [WORKSPACE_TRIAGE_SCRIPT], { timeout: 20000 })
}

function ensureWorkspaceQueueDirs() {
  ;['proposed', 'pending', 'claimed', 'running', 'done', 'failed', 'dead', 'reviews', 'results'].forEach((dir) => {
    fs.mkdirSync(path.join(WORKSPACE_QUEUE, dir), { recursive: true })
  })
}

function normalizeQueueText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ')
}

function conciseTitle(value, fallback = 'Untitled item') {
  const text = normalizeQueueText(value)
  if (!text) return fallback
  if (text.length <= 72) return text
  const firstSentence = text.split(/[.;:]/, 1)[0]?.trim()
  if (firstSentence && firstSentence.length >= 12 && firstSentence.length <= 72) return firstSentence
  return `${text.slice(0, 69).trimEnd()}...`
}

function recordTitle(record, fallback = 'Untitled record') {
  return conciseTitle(
    record?.title || record?.task || record?.input || record?.summary || record?.result || record?.plan || record?.text || '',
    fallback,
  )
}

function getLatestProposedTask() {
  ensureWorkspaceQueueDirs()
  const files = fs.readdirSync(QUEUE_PROPOSED_DIR)
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      const fullPath = path.join(QUEUE_PROPOSED_DIR, file)
      const stat = fs.statSync(fullPath)
      const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf-8'))
      return {
        file,
        fullPath,
        stat,
        task: parsed,
        createdAt: toIsoSafe(parsed.created_at) || stat.birthtime.toISOString(),
      }
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  return files[0] || null
}

async function runQueueDispatcher() {
  if (!fs.existsSync(WORKSPACE_DISPATCHER_SCRIPT)) {
    const error = new Error(`dispatcher script missing: ${WORKSPACE_DISPATCHER_SCRIPT}`)
    error.statusCode = 500
    throw error
  }
  const python = process.env.PYTHON || 'C:\\Python310\\python.exe'
  const { error, stdout, stderr } = await execCommand(python, [WORKSPACE_DISPATCHER_SCRIPT], {
    cwd: BORIS_WORKSPACE,
    timeout: 30000,
  })
  const parsed = parseJsonFromCliStdout(stdout)
  if (error && !parsed) {
    const runtimeError = new Error(String(stderr || stdout || error.message || error))
    runtimeError.statusCode = 500
    throw runtimeError
  }
  return {
    ok: Boolean(parsed?.ok),
    taskId: parsed?.task_id || null,
    raw: parsed || null,
    stdout,
    stderr,
  }
}

async function dispatchQueueTaskNow(taskId, reason = 'do_now') {
  const dispatch = await runQueueDispatcher()
  return {
    requestedTaskId: taskId,
    dispatched: dispatch.taskId === taskId,
    dispatchedTaskId: dispatch.taskId,
    dispatchReason: reason,
    dispatcher: dispatch.raw,
  }
}

async function approveProposedTask(taskId, options = {}) {
  ensureWorkspaceQueueDirs()
  const requestedId = taskId || getLatestProposedTask()?.task?.id
  if (!requestedId) {
    const error = new Error('no proposed task awaiting approval')
    error.statusCode = 404
    throw error
  }

  const proposedPath = path.join(QUEUE_PROPOSED_DIR, `${requestedId}.json`)
  if (!fs.existsSync(proposedPath)) {
    const error = new Error(`proposed task not found: ${requestedId}`)
    error.statusCode = 404
    throw error
  }

  const task = JSON.parse(fs.readFileSync(proposedPath, 'utf-8'))
  const approvedAt = new Date().toISOString()
  const wantsImmediateDispatch = Boolean(options.dispatchNow) || /urgent|do now/i.test(String(options.approvedByText || ''))
  const approvedTask = {
    ...task,
    status: 'queued',
    approval_state: 'approved',
    approved_at: approvedAt,
    updated_at: approvedAt,
    priority: Number.isFinite(Number(task.priority)) ? Number(task.priority) : 0,
  }
  if (options.approvedByText) {
    approvedTask.approved_by = 'text'
    approvedTask.approval_text = normalizeQueueText(options.approvedByText)
  }
  if (wantsImmediateDispatch) {
    approvedTask.priority = Math.max(approvedTask.priority, Number(options.priority ?? 12) || 12)
    approvedTask.bumped_at = approvedAt
    approvedTask.dispatch_requested_at = approvedAt
    approvedTask.dispatch_requested_by = 'clawcommand'
    approvedTask.priority_note = 'Marked urgent / DO NOW from ClawCommand for immediate dispatch'
  }
  const pendingPath = path.join(WORKSPACE_QUEUE, 'pending', `${requestedId}.json`)
  fs.renameSync(proposedPath, pendingPath)
  fs.writeFileSync(pendingPath, JSON.stringify(approvedTask, null, 2), 'utf-8')
  await runQueueTriage()
  const reviewedTask = fs.existsSync(pendingPath) ? JSON.parse(fs.readFileSync(pendingPath, 'utf-8')) : approvedTask
  let dispatchMeta = null
  if (wantsImmediateDispatch) {
    dispatchMeta = await dispatchQueueTaskNow(requestedId, 'approve_urgent')
  }
  addEvent(
    wantsImmediateDispatch ? 'queue.approved_urgent' : 'queue.approved',
    wantsImmediateDispatch
      ? `Approved urgent queued task for immediate dispatch: ${reviewedTask.text}`
      : `Approved queued task: ${reviewedTask.text}`,
    {
      taskId: requestedId,
      priority: reviewedTask.priority,
      approvedBy: reviewedTask.approved_by || 'api',
      dispatchedTaskId: dispatchMeta?.dispatchedTaskId || null,
      dispatched: dispatchMeta?.dispatched || false,
    },
  )
  if (dispatchMeta) {
    return { ...reviewedTask, immediate_dispatch: dispatchMeta }
  }
  return reviewedTask
}

function readQueueReview() {
  try {
    if (!fs.existsSync(WORKSPACE_QUEUE_REVIEW_FILE)) return null
    return JSON.parse(fs.readFileSync(WORKSPACE_QUEUE_REVIEW_FILE, 'utf-8'))
  } catch {
    return null
  }
}

function spawnDetachedPowerShell({ command, cwd, logFile }) {
  return new Promise((resolve, reject) => {
    try {
      fs.mkdirSync(path.dirname(logFile), { recursive: true })
      const out = fs.openSync(logFile, 'a')
      const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
        cwd,
        detached: true,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', out, out],
      })
      child.on('error', reject)
      child.unref()
      fs.closeSync(out)
      resolve({ pid: child.pid })
    } catch (error) {
      reject(error)
    }
  })
}

function isSessionRecordLike(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return (
    Object.prototype.hasOwnProperty.call(value, 'sessionId') ||
    Object.prototype.hasOwnProperty.call(value, 'updatedAt') ||
    Object.prototype.hasOwnProperty.call(value, 'sessionFile') ||
    Object.prototype.hasOwnProperty.call(value, 'chatType')
  )
}

function normalizeSessions(data) {
  if (data == null) return []
  if (Array.isArray(data)) return data
  if (Array.isArray(data.sessions)) return data.sessions
  if (Array.isArray(data.items)) return data.items
  if (typeof data === 'object') {
    const entries = Object.entries(data).filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v))
    const sessionLike = entries.filter(([, v]) => isSessionRecordLike(v))
    if (sessionLike.length > 0) {
      return sessionLike.map(([k, v]) => ({ ...v, key: v.key || k }))
    }
  }
  return []
}

function parseSessionRow(session) {
  const key = session.key || session.sessionKey || session.id || 'session'
  const updatedAt = session.updatedAt || session.lastUpdated || session.updated_at || null
  const age = session.age || updatedAt || session.ageMs || 'unknown'
  const model = session.model || session.modelName || 'unknown'
  const kind = session.kind || session.type || 'unknown'
  const tokens = session.tokens || session.tokenUsage || session.totalTokens || session.context || ''
  const status = session.status || (session.abortedLastRun ? 'aborted' : 'active')
  const channel =
    session.channel || session.modelProvider || session.agentId || session.deliveryContext?.channel || session.deliveryContext?.surface || ''
  const sessionId = session.sessionId || session.id || ''
  return { key, age, updatedAt, model, kind, tokens, status, channel, sessionId }
}

function parseStatusDetails(output) {
  const text = String(output || '')
  const gatewayState = text.includes('RPC probe: ok') || text.includes('reachable') ? 'online' : 'unknown'
  const telegramState = text.includes('Telegram │ ON │ OK') || text.includes('Telegram') ? 'configured' : 'missing'
  const sessionMatch = text.match(/Sessions\s*│\s*([^\n]+)/)
  const sessionsSummary = sessionMatch ? sessionMatch[1].trim() : 'unknown'
  return { gatewayState, telegramState, sessionsSummary }
}

function toIsoSafe(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function queueSortTimestamp(task, stat) {
  return (
    toIsoSafe(task.bumped_at) ||
    toIsoSafe(task.started_at) ||
    toIsoSafe(task.finished_at) ||
    toIsoSafe(task.created_at) ||
    toIsoSafe(task.createdAt) ||
    stat.mtime.toISOString()
  )
}

function queuePriorityValue(task) {
  const value = Number(task.priority ?? 0)
  return Number.isFinite(value) ? value : 0
}

function readQueueResultsIndex() {
  try {
    if (!fs.existsSync(WORKSPACE_QUEUE_RESULTS_DIR)) return new Map()
    return new Map(
      fs.readdirSync(WORKSPACE_QUEUE_RESULTS_DIR)
        .filter((file) => file.endsWith('.json'))
        .map((file) => {
          const fullPath = path.join(WORKSPACE_QUEUE_RESULTS_DIR, file)
          const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf-8'))
          return [parsed.task_id || path.basename(file, '.json'), parsed]
        }),
    )
  } catch {
    return new Map()
  }
}

function readWorkspaceQueue() {
  const counts = {}
  const tasks = []
  const resultsIndex = readQueueResultsIndex()

  for (const dir of QUEUE_STATE_DIRS) {
    const p = path.join(WORKSPACE_QUEUE, dir)
    try {
      const files = fs.existsSync(p) ? fs.readdirSync(p).filter((f) => f.endsWith('.json')) : []
      counts[dir] = files.length

      files.forEach((f) => {
        const fullPath = path.join(p, f)
        try {
          const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf-8'))
          const stat = fs.statSync(fullPath)
          const taskId = parsed.id || path.basename(f, '.json')
          const result = resultsIndex.get(taskId) || null
          const createdAt = parsed.created_at || parsed.createdAt || stat.birthtime.toISOString()
          const priority = queuePriorityValue(parsed)
          tasks.push({
            ...result,
            ...parsed,
            id: taskId,
            title: parsed.title || conciseTitle(parsed.text || parsed.result || parsed.reason || path.basename(f, '.json'), 'Queued item'),
            status: parsed.status || dir,
            queue_dir: dir,
            created_at: createdAt,
            priority,
            started_at: parsed.started_at || null,
            finished_at: parsed.finished_at || result?.completed_at || null,
            updated_at: stat.mtime.toISOString(),
            reason: parsed.reason || null,
            source: parsed.source || 'unknown',
            attempt: Number(parsed.attempt || 0),
            completion_summary: parsed.completion_summary || result?.completion_summary || null,
            dispatch_summary: result?.summary || null,
            completion_recorded_at: parsed.completion_recorded_at || result?.completion_recorded_at || null,
            _sortTs: queueSortTimestamp(parsed, stat),
          })
        } catch {}
      })
    } catch {
      counts[dir] = 0
    }
  }

  const activeStates = new Set(['proposed', 'pending', 'claimed', 'running'])
  const active = tasks
    .filter((task) => activeStates.has(task.queue_dir))
    .sort((a, b) => {
      const priorityDelta = Number(b.priority || 0) - Number(a.priority || 0)
      if (priorityDelta !== 0) return priorityDelta
      return String(a.created_at || '').localeCompare(String(b.created_at || ''))
    })

  const recent = tasks
    .filter((task) => !activeStates.has(task.queue_dir))
    .sort((a, b) => String(b._sortTs || '').localeCompare(String(a._sortTs || '')))
    .slice(0, 25)

  const ordered = [...active, ...recent].map(({ _sortTs, ...task }) => task)

  return {
    counts,
    tasks: ordered,
    active,
    recent,
    review: readQueueReview(),
  }
}

function getQueueTaskFile(taskId) {
  for (const dir of QUEUE_STATE_DIRS) {
    const candidate = path.join(WORKSPACE_QUEUE, dir, `${taskId}.json`)
    if (fs.existsSync(candidate)) {
      return { dir, path: candidate }
    }
  }
  return null
}

function updateQueueTask(taskId, mutate) {
  const file = getQueueTaskFile(taskId)
  if (!file) return null
  const task = JSON.parse(fs.readFileSync(file.path, 'utf-8'))
  const nextTask = mutate({ ...task }, file.dir)
  fs.writeFileSync(file.path, JSON.stringify(nextTask, null, 2), 'utf-8')
  return { dir: file.dir, task: nextTask }
}

function removeQueueTask(taskId, mutate) {
  const file = getQueueTaskFile(taskId)
  if (!file) return null
  const task = JSON.parse(fs.readFileSync(file.path, 'utf-8'))
  const nextTask = mutate ? mutate({ ...task }, file.dir) : task
  fs.unlinkSync(file.path)
  return { dir: file.dir, task: nextTask }
}

function getActivityLines(limit = 100) {
  const logFile = fs.existsSync(WORKSPACE_ACTIVITY_LOG) ? WORKSPACE_ACTIVITY_LOG : path.join(WORKSPACE_MEMORY_DIR, 'activity.log')
  if (!fs.existsSync(logFile)) return []
  return fs.readFileSync(logFile, 'utf-8')
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-limit)
    .map((line) => {
      try {
        const e = JSON.parse(line)
        return `[${(e.ts || '').slice(0, 19).replace('T', ' ')}] ${e.event} — ${e.summary}`
      } catch {
        return line
      }
    })
}

function getRecentMemoryText() {
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const yesterdayDate = new Date(now)
  yesterdayDate.setDate(now.getDate() - 1)
  const yesterday = yesterdayDate.toISOString().slice(0, 10)
  const files = [path.join(WORKSPACE_MEMORY_DIR, `${today}.md`), path.join(WORKSPACE_MEMORY_DIR, `${yesterday}.md`)]
  return files.map((file) => fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '').filter(Boolean).join('\n\n')
}

function listMemoryRecords(limitPerSection = 8) {
  const sections = [
    { key: 'tasks', dir: path.join(WORKSPACE_MEMORY_DIR, 'tasks') },
    { key: 'sessions', dir: path.join(WORKSPACE_MEMORY_DIR, 'sessions') },
    { key: 'decisions', dir: path.join(WORKSPACE_MEMORY_DIR, 'decisions') },
  ]

  return sections.map(({ key, dir }) => {
    const items = fs.existsSync(dir)
      ? fs.readdirSync(dir)
          .filter((file) => file.endsWith('.json'))
          .map((file) => {
            const fullPath = path.join(dir, file)
            try {
              const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf-8'))
              const stat = fs.statSync(fullPath)
              return {
                ...parsed,
                title: parsed.title || recordTitle(parsed, `${key.slice(0, -1)} record`),
                section: key,
                updated_at: parsed.updated_at || stat.mtime.toISOString(),
                created_at: parsed.created_at || stat.birthtime.toISOString(),
              }
            } catch {
              return null
            }
          })
          .filter(Boolean)
          .sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')))
          .slice(0, limitPerSection)
      : []

    return { key, items }
  })
}

function getCommandCenterStatus() {
  const lines = getActivityLines(100)
  const wq = readWorkspaceQueue()
  const lastActivity = lines.length ? lines[lines.length - 1] : ''
  const taskKeywords = ['task.claimed', 'task.running', 'task.dispatched', 'task.completed', 'task.failed', 'task.dead', 'task.retried', 'task.enqueued']
  const taskLines = [...lines].reverse().filter((line) => taskKeywords.some((keyword) => line.includes(keyword)) || line.includes('TASK START'))
  const lastTask = taskLines.length ? taskLines[0] : ''
  const proposed = Number(wq.counts.proposed || 0)
  const pending = Number(wq.counts.pending || 0)
  const running = Number(wq.counts.running || 0)
  const attention = Number(wq.counts.failed || 0) + Number(wq.counts.dead || 0)
  const status = running > 0 ? 'running' : attention > 0 ? 'attention' : (pending > 0 || proposed > 0) ? 'queued' : 'idle'
  return { lastActivity, lastTask, status }
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'unknown'
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

function formatPid(pid) {
  return Number.isFinite(Number(pid)) ? String(pid) : null
}

function tailFile(file, maxLines = 12) {
  try {
    if (!file || !fs.existsSync(file)) return []
    return fs.readFileSync(file, 'utf-8').split(/\r?\n/).filter(Boolean).slice(-maxLines)
  } catch {
    return []
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

async function findProcessMatch(matchers = []) {
  const sanitized = matchers.filter(Boolean)
  if (!sanitized.length) return null
  const conditions = sanitized.map((matcher) => `$_.CommandLine -match ${shellQuote(matcher)}`).join(' -and ')
  const script = `
    $proc = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Where-Object { ${conditions} } |
      Select-Object -First 1 ProcessId, CreationDate, Name, CommandLine
    if ($proc) { $proc | ConvertTo-Json -Compress }
  `
  const result = await runPowerShell(script, { timeout: 4000 })
  if (result.error || !result.stdout.trim()) return null
  try {
    const parsed = JSON.parse(result.stdout.trim())
    const startedAt = parsed.CreationDate ? new Date(parsed.CreationDate) : null
    return {
      pid: Number(parsed.ProcessId),
      name: parsed.Name || null,
      commandLine: parsed.CommandLine || '',
      startedAt: startedAt && !Number.isNaN(startedAt.getTime()) ? startedAt.toISOString() : null,
      uptime: startedAt ? formatDuration(Date.now() - startedAt.getTime()) : null,
    }
  } catch {
    return null
  }
}

const runtimeServices = [
  {
    id: 'clawcommand-api',
    label: 'ClawCommand API',
    group: 'dashboard',
    description: 'This Node/Express control-plane process serving the dashboard API.',
    controllable: false,
    actions: [],
    async getStatus() {
      const recentEvents = readJson(EVENTS_FILE)
        .slice(0, 8)
        .map((event) => `[${new Date(event.ts).toLocaleTimeString()}] ${event.type}: ${event.message}`)
      return {
        status: 'running',
        pid: formatPid(process.pid),
        uptime: formatDuration(process.uptime() * 1000),
        startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
        logLines: recentEvents.length ? recentEvents : ['No recent API events captured yet.'],
        meta: {
          cwd: CLAWCOMMAND_ROOT,
          transport: 'express',
          port: String(PORT),
        },
      }
    },
    async control(action) {
      throw new Error(`Unsupported action: ${action}`)
    },
  },
  {
    id: 'gateway',
    label: 'OpenClaw Gateway',
    group: 'runtime',
    description: 'Core OpenClaw daemon and hook entrypoint.',
    controllable: true,
    actions: ['start', 'stop', 'restart'],
    async getStatus() {
      const tel = apiTelemetry()
      const parsed = tel.lastStatusParsed
      const text = tel.lastStatusOutput || tel.lastStatusError || ''
      const gatewayState = String(parsed?.gatewayState || '').toLowerCase()
      const state = gatewayState.includes('running') || gatewayState.includes('online') ? 'running' : (tel.lastStatusError ? 'unknown' : 'stopped')
      return {
        status: state,
        pid: null,
        uptime: null,
        startedAt: null,
        logLines: text ? text.split(/\r?\n/).slice(-12) : ['Waiting for OpenClaw status telemetry...'],
        meta: {
          transport: 'openclaw status cache',
          command: 'openclaw status',
          scope: 'daemon',
          freshness: tel.lastStatusFetchedAt ? new Date(tel.lastStatusFetchedAt).toLocaleTimeString() : 'warming up',
        },
      }
    },
    async control(action) {
      const result = await runOpenClaw(['gateway', action])
      if (result.error) {
        throw new Error(result.stderr || result.stdout || String(result.error.message || result.error))
      }
      return { output: [result.stdout, result.stderr].filter(Boolean).join('\n').trim() }
    },
  },
  {
    id: 'voice-sidecar',
    label: 'Boris Voice Sidecar',
    group: 'voice',
    description: 'Speaks fresh Boris replies from local session logs.',
    controllable: true,
    actions: ['start', 'stop', 'restart'],
    logFile: path.join(RUNTIME_LOG_DIR, 'voice-sidecar.log'),
    matchers: ['boris_voice_sidecar\\.py', 'run-boris-voice\\.ps1'],
    async getStatus() {
      const proc = await findProcessMatch(this.matchers)
      const logLines = tailFile(this.logFile)
      return {
        status: proc ? 'running' : 'stopped',
        pid: proc ? formatPid(proc.pid) : null,
        uptime: proc?.uptime || null,
        startedAt: proc?.startedAt || null,
        logLines: logLines.length ? logLines : ['No captured sidecar logs yet.'],
        meta: {
          cwd: MPD_ROOT,
          command: '.\\run-boris-voice.ps1',
          logFile: this.logFile,
        },
      }
    },
    async control(action) {
      if (action === 'start' || action === 'restart') {
        if (action === 'restart') await this.control('stop')
        const cmd = `Set-Location ${shellQuote(MPD_ROOT)}; & .\\run-boris-voice.ps1`
        const started = await spawnDetachedPowerShell({ command: cmd, cwd: MPD_ROOT, logFile: this.logFile })
        return { output: `Started voice sidecar${started.pid ? ` (PID ${started.pid})` : ''}.` }
      }
      if (action === 'stop') {
        const proc = await findProcessMatch(this.matchers)
        if (!proc?.pid) return { output: 'Voice sidecar was not running.' }
        const result = await runPowerShell(`Stop-Process -Id ${proc.pid} -Force`)
        if (result.error) throw new Error(result.stderr || result.stdout || 'Failed to stop voice sidecar.')
        return { output: `Stopped voice sidecar (PID ${proc.pid}).` }
      }
      throw new Error(`Unsupported action: ${action}`)
    },
  },
  {
    id: 'mpd-controller',
    label: 'MPD Controller',
    group: 'device',
    description: 'Akai MPD218 bridge and OpenClaw interaction controller.',
    controllable: true,
    actions: ['start', 'stop', 'restart'],
    logFile: path.join(RUNTIME_LOG_DIR, 'mpd-controller.log'),
    matchers: ['controller\\.py', 'config\\.json', 'mpd-streamdeck'],
    async getStatus() {
      const proc = await findProcessMatch(this.matchers)
      const logLines = tailFile(this.logFile)
      return {
        status: proc ? 'running' : 'stopped',
        pid: proc ? formatPid(proc.pid) : null,
        uptime: proc?.uptime || null,
        startedAt: proc?.startedAt || null,
        logLines: logLines.length ? logLines : ['No captured controller logs yet.'],
        meta: {
          cwd: MPD_ROOT,
          command: '.\\run.ps1',
          logFile: this.logFile,
        },
      }
    },
    async control(action) {
      if (action === 'start' || action === 'restart') {
        if (action === 'restart') await this.control('stop')
        const cmd = `Set-Location ${shellQuote(MPD_ROOT)}; & .\\run.ps1`
        const started = await spawnDetachedPowerShell({ command: cmd, cwd: MPD_ROOT, logFile: this.logFile })
        return { output: `Started MPD controller${started.pid ? ` (PID ${started.pid})` : ''}.` }
      }
      if (action === 'stop') {
        const proc = await findProcessMatch(this.matchers)
        if (!proc?.pid) return { output: 'MPD controller was not running.' }
        const result = await runPowerShell(`Stop-Process -Id ${proc.pid} -Force`)
        if (result.error) throw new Error(result.stderr || result.stdout || 'Failed to stop MPD controller.')
        return { output: `Stopped MPD controller (PID ${proc.pid}).` }
      }
      throw new Error(`Unsupported action: ${action}`)
    },
  },
  {
    id: 'clawcommand-web',
    label: 'ClawCommand Web Dev Server',
    group: 'dashboard',
    description: 'Vite frontend dev server for the dashboard UI.',
    controllable: true,
    actions: ['start', 'stop', 'restart'],
    logFile: path.join(RUNTIME_LOG_DIR, 'clawcommand-web.log'),
    matchers: ['vite', 'F:\\\\ClawCommand'],
    async getStatus() {
      const proc = await findProcessMatch(this.matchers)
      const logLines = tailFile(this.logFile)
      return {
        status: proc ? 'running' : 'stopped',
        pid: proc ? formatPid(proc.pid) : null,
        uptime: proc?.uptime || null,
        startedAt: proc?.startedAt || null,
        logLines: logLines.length ? logLines : ['No captured web dev logs yet.'],
        meta: {
          cwd: CLAWCOMMAND_ROOT,
          command: 'npm run dev -- --host 127.0.0.1',
          logFile: this.logFile,
          port: '5173',
        },
      }
    },
    async control(action) {
      if (action === 'start' || action === 'restart') {
        if (action === 'restart') await this.control('stop')
        const cmd = `Set-Location ${shellQuote(CLAWCOMMAND_ROOT)}; npm run dev -- --host 127.0.0.1`
        const started = await spawnDetachedPowerShell({ command: cmd, cwd: CLAWCOMMAND_ROOT, logFile: this.logFile })
        return { output: `Started ClawCommand web dev server${started.pid ? ` (PID ${started.pid})` : ''}.` }
      }
      if (action === 'stop') {
        const proc = await findProcessMatch(this.matchers)
        if (!proc?.pid) return { output: 'ClawCommand web dev server was not running.' }
        const result = await runPowerShell(`Stop-Process -Id ${proc.pid} -Force`)
        if (result.error) throw new Error(result.stderr || result.stdout || 'Failed to stop ClawCommand web dev server.')
        return { output: `Stopped ClawCommand web dev server (PID ${proc.pid}).` }
      }
      throw new Error(`Unsupported action: ${action}`)
    },
  },
]

function getRuntimeServiceDefinition(id) {
  return runtimeServices.find((service) => service.id === id) || null
}

async function hydrateRuntimeService(service) {
  const status = await service.getStatus()
  return {
    id: service.id,
    label: service.label,
    group: service.group,
    description: service.description,
    controllable: service.controllable,
    actions: service.actions,
    ...status,
  }
}

async function collectTelemetry() {
  try {
    await runCollectTelemetryBody()
  } finally {
    publishTelemetrySnapshot()
  }
}

async function runCollectTelemetryBody() {
  const [statusResult, sessionsResult, httpProbe] = await Promise.all([
    runOpenClaw(['status'], { timeout: OPENCLAW_CLI_STATUS_TIMEOUT_MS }),
    runOpenClaw(['sessions', '--json'], { timeout: OPENCLAW_CLI_SESSIONS_TIMEOUT_MS }),
    probeOpenClawGatewayHttp(),
  ])

  telemetryState.lastGatewayHttpProbe = httpProbe
  const gatewayHttpOk = Boolean(httpProbe?.reachable)

  telemetryState.lastCliStatusOk = !statusResult.error
  telemetryState.lastCliSessionsOk = !sessionsResult.error

  let parsedFromCli = null
  if (!statusResult.error) {
    parsedFromCli = parseStatusDetails(statusResult.stdout)
    telemetryState.lastStatusOutput = statusResult.stdout || ''
    telemetryState.lastStatusFetchedAt = new Date().toISOString()
    telemetryState.lastStatusError = null
    const summary = JSON.stringify(parsedFromCli)
    if (summary !== telemetryState.lastGatewaySummary) {
      telemetryState.lastGatewaySummary = summary
      addEvent('openclaw.status.change', 'Gateway snapshot changed', parsedFromCli)
    }
  } else {
    telemetryState.lastStatusError = summarizeCliFailure('status', statusResult)
    if (gatewayHttpOk) {
      telemetryState.lastStatusOutput = `[HTTP ${httpProbe.url} reachable, ${httpProbe.latencyMs}ms]\nOpenClaw CLI status unavailable. Showing HTTP gateway reachability only.`
    } else {
      telemetryState.lastStatusOutput = 'OpenClaw status unavailable. Gateway reachability probe also failed.'
    }
  }

  const fallbackParsed = { gatewayState: 'unknown', telegramState: 'unknown', sessionsSummary: 'unknown' }
  const prevParsed = telemetryState.lastStatusParsed
  let mergedParsed = parsedFromCli || prevParsed || fallbackParsed
  if (gatewayHttpOk) {
    mergedParsed = {
      ...mergedParsed,
      gatewayState: 'online',
      gatewayProbe: 'http',
      gatewayHttpLatencyMs: httpProbe.latencyMs,
    }
    if (statusResult.error) {
      mergedParsed.cliStatus = 'unavailable'
      mergedParsed.telegramState = mergedParsed.telegramState === 'missing' && !parsedFromCli ? 'unknown' : mergedParsed.telegramState
    } else {
      mergedParsed.cliStatus = 'ok'
    }
  } else {
    const gwFromCli = parsedFromCli?.gatewayState
    const gatewayState = gwFromCli || (prevParsed?.gatewayProbe === 'http' ? 'unknown' : prevParsed?.gatewayState) || 'unknown'
    mergedParsed = {
      ...mergedParsed,
      gatewayState,
      cliStatus: statusResult.error ? 'unavailable' : 'ok',
    }
    delete mergedParsed.gatewayProbe
    delete mergedParsed.gatewayHttpLatencyMs
  }
  telemetryState.lastStatusParsed = mergedParsed

  telemetryState.lastSessionsListingDegraded = false
  telemetryState.lastSessionsListingDetail = null

  if (!sessionsResult.error) {
    try {
      const parsed = parseJsonFromCliStdout(sessionsResult.stdout) ?? JSON.parse(sessionsResult.stdout || '[]')
      const sessions = normalizeSessions(parsed).map(parseSessionRow)
      if (!sessions.length && gatewayHttpOk) {
        const fsFallback = tryReadSessionsFromIndexFile()
        if (fsFallback?.length) {
          replaceTelemetrySessions(fsFallback)
          telemetryState.lastCliSessionsOk = false
          telemetryState.lastSessionsListingDetail = 'session list read from local index (CLI output unusable)'
        } else {
          replaceTelemetrySessions([])
        }
      } else {
        replaceTelemetrySessions(sessions)
      }
    } catch {
      const fsFallback = gatewayHttpOk ? tryReadSessionsFromIndexFile() : null
      if (fsFallback?.length) {
        replaceTelemetrySessions(fsFallback)
        telemetryState.lastCliSessionsOk = false
        telemetryState.lastSessionsListingDetail = 'session list read from local index (CLI JSON parse failed)'
      } else {
        const parseDetail = summarizeParseFailure('session list')
        telemetryState.lastSessionsFetchedAt = new Date().toISOString()
        if (gatewayHttpOk) {
          telemetryState.lastSessionsListingDegraded = true
          telemetryState.lastSessionsListingDetail = parseDetail
          telemetryState.lastSessionsError = null
          telemetryState.lastSessions = []
        } else {
          telemetryState.lastSessionsError = parseDetail
        }
        addEvent('openclaw.parse.error', 'Failed to parse session telemetry output')
      }
    }
  } else {
    let salvaged = false
    try {
      const parsed = parseJsonFromCliStdout(sessionsResult.stdout) ?? JSON.parse(sessionsResult.stdout || 'null')
      const sessions = normalizeSessions(parsed).map(parseSessionRow)
      if (sessions.length) {
        replaceTelemetrySessions(sessions)
        telemetryState.lastCliSessionsOk = true
        salvaged = true
      }
    } catch {
      salvaged = false
    }

    if (!salvaged) {
      const fsFallback = gatewayHttpOk ? tryReadSessionsFromIndexFile() : null
      if (fsFallback?.length) {
        replaceTelemetrySessions(fsFallback)
        telemetryState.lastCliSessionsOk = false
      } else {
        const sessionFailDetail = summarizeCliFailure('session list', sessionsResult)
        telemetryState.lastSessionsFetchedAt = new Date().toISOString()
        if (gatewayHttpOk) {
          telemetryState.lastSessionsListingDegraded = true
          telemetryState.lastSessionsListingDetail = sessionFailDetail
          telemetryState.lastSessionsError = null
          telemetryState.lastSessions = []
        } else {
          telemetryState.lastSessionsError = sessionFailDetail
        }
      }
    }
  }

  const sessionsList = telemetryState.lastSessions || []
  if (sessionsList.length && telemetryState.lastStatusParsed) {
    const telegramSignal = sessionsList.some((s) => {
      const key = String(s.key || '')
      const ch = String(s.channel || '').toLowerCase()
      return key.includes('telegram') || ch.includes('telegram')
    })
    if (telegramSignal) {
      telemetryState.lastStatusParsed = {
        ...telemetryState.lastStatusParsed,
        telegramState: 'configured',
        telegramHint: 'sessions_json',
      }
    }
  }

  if (telemetryState.lastSessions.length > 0) {
    telemetryState.lastSessionsListingDegraded = false
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'ClawCommand', ts: new Date().toISOString() })
})

app.get('/api/tasks', (_req, res) => {
  res.json(readJson(TASKS_FILE))
})

app.get('/api/task-queue', async (_req, res) => {
  await runQueueTriage()
  const wq = readWorkspaceQueue()
  res.json({ tasks: wq.tasks, active: wq.active, recent: wq.recent, counts: wq.counts, review: wq.review })
})

app.post('/api/task-queue', async (req, res) => {
  const { text, priority, mode } = req.body || {}
  if (!text || !String(text).trim()) return res.status(400).json({ error: 'text required' })

  const normalizedText = normalizeQueueText(text)
  const numericPriority = Number(priority ?? 0)

  try {
    ensureWorkspaceQueueDirs()

    const id = `t_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`
    const wantsImmediateQueue = mode === 'queue' || mode === 'approved'
    const status = wantsImmediateQueue ? 'queued' : 'proposed'
    const approvalState = wantsImmediateQueue ? 'approved' : 'awaiting_approval'
    const targetDir = path.join(WORKSPACE_QUEUE, wantsImmediateQueue ? 'pending' : 'proposed')
    const task = {
      id,
      title: conciseTitle(normalizedText, 'Queued item'),
      text: normalizedText,
      source: 'clawcommand',
      created_at: new Date().toISOString(),
      status,
      attempt: 0,
      priority: Number.isFinite(numericPriority) ? numericPriority : 0,
      approval_state: approvalState,
      proposed_at: new Date().toISOString(),
    }
    if (wantsImmediateQueue) {
      task.approved_at = task.proposed_at
      task.approved_by = 'operator'
    }

    const taskPath = path.join(targetDir, `${id}.json`)
    fs.writeFileSync(taskPath, JSON.stringify(task, null, 2))
    if (wantsImmediateQueue) {
      await runQueueTriage()
    }
    const reviewedTask = fs.existsSync(taskPath) ? JSON.parse(fs.readFileSync(taskPath, 'utf-8')) : task
    addEvent(
      wantsImmediateQueue ? 'queue.created' : 'queue.proposed',
      wantsImmediateQueue ? `Queued task: ${task.text}` : `Proposed task awaiting approval: ${task.text}`,
      { taskId: id, priority: task.priority, approvalState: task.approval_state },
    )
    res.json(reviewedTask)
  } catch (err) {
    res.status(err?.statusCode || 500).json({ error: String(err?.message || err) })
  }
})

app.post('/api/task-queue/:taskId/approve', async (req, res) => {
  const { taskId } = req.params
  try {
    const approvedTask = await approveProposedTask(taskId, { approvedByText: req.body?.approvalText })
    res.json(approvedTask)
  } catch (err) {
    res.status(err?.statusCode || 500).json({ error: String(err?.message || err) })
  }
})

app.patch('/api/task-queue/:taskId', async (req, res) => {
  const { taskId } = req.params
  const nextText = normalizeQueueText(req.body?.text)
  const requestedPriority = req.body?.priority

  if (!nextText) {
    return res.status(400).json({ error: 'text required' })
  }

  try {
    const updated = updateQueueTask(taskId, (task, dir) => {
      if (dir !== 'proposed') {
        const error = new Error(`Only proposed tasks can be edited here (found ${dir})`)
        error.statusCode = 409
        throw error
      }
      task.text = nextText
      task.title = conciseTitle(nextText, 'Queued item')
      task.updated_at = new Date().toISOString()
      if (requestedPriority !== undefined) {
        const numericPriority = Number(requestedPriority)
        if (Number.isFinite(numericPriority)) {
          task.priority = Math.max(-100, Math.min(100, numericPriority))
        }
      }
      return task
    })

    if (!updated) return res.status(404).json({ error: 'task not found' })
    addEvent('queue.proposed.edited', `Edited proposed task: ${updated.task.text}`, { taskId, priority: updated.task.priority })
    res.json(updated.task)
  } catch (err) {
    res.status(err?.statusCode || 500).json({ error: String(err?.message || err) })
  }
})

app.post('/api/task-queue/:taskId/reject', (req, res) => {
  const { taskId } = req.params
  try {
    const removed = removeQueueTask(taskId, (task, dir) => {
      if (dir !== 'proposed') {
        const error = new Error(`Only proposed tasks can be rejected here (found ${dir})`)
        error.statusCode = 409
        throw error
      }
      return {
        ...task,
        status: 'rejected',
        rejected_at: new Date().toISOString(),
        rejected_by: 'operator',
        reason: normalizeQueueText(req.body?.reason || 'Rejected from ClawCommand'),
      }
    })

    if (!removed) return res.status(404).json({ error: 'task not found' })
    addEvent('queue.proposed.rejected', `Rejected proposed task: ${removed.task.text}`, { taskId, reason: removed.task.reason })
    res.json(removed.task)
  } catch (err) {
    res.status(err?.statusCode || 500).json({ error: String(err?.message || err) })
  }
})

app.post('/api/task-queue/:taskId/bump', (req, res) => {
  const { taskId } = req.params
  const amount = Number(req.body?.amount ?? 1)
  const safeAmount = Number.isFinite(amount) ? Math.max(1, Math.min(10, amount)) : 1
  const updated = updateQueueTask(taskId, (task, dir) => {
    if (dir !== 'pending') {
      const error = new Error(`Only pending tasks can be reprioritized (found ${dir})`)
      error.statusCode = 409
      throw error
    }
    const nextPriority = queuePriorityValue(task) + safeAmount
    task.priority = nextPriority
    task.bumped_at = new Date().toISOString()
    task.updated_at = task.bumped_at
    task.priority_note = `Bumped +${safeAmount} from ClawCommand`
    return task
  })

  if (!updated) return res.status(404).json({ error: 'task not found' })
  addEvent('queue.bumped', `Bumped queue task ${taskId} to priority ${updated.task.priority}`, { taskId, priority: updated.task.priority })
  res.json(updated.task)
})

app.post('/api/task-queue/:taskId/priority', (req, res) => {
  const { taskId } = req.params
  const requestedPriority = Number(req.body?.priority)
  if (!Number.isFinite(requestedPriority)) {
    return res.status(400).json({ error: 'numeric priority required' })
  }

  try {
    const updated = updateQueueTask(taskId, (task, dir) => {
      if (dir !== 'pending') {
        const error = new Error(`Only pending tasks can be reprioritized (found ${dir})`)
        error.statusCode = 409
        throw error
      }
      task.priority = Math.max(-100, Math.min(100, requestedPriority))
      task.bumped_at = new Date().toISOString()
      task.updated_at = task.bumped_at
      task.priority_note = 'Priority set from ClawCommand'
      return task
    })

    if (!updated) return res.status(404).json({ error: 'task not found' })
    addEvent('queue.priority.set', `Set queue task ${taskId} priority to ${updated.task.priority}`, { taskId, priority: updated.task.priority })
    res.json(updated.task)
  } catch (err) {
    const statusCode = err?.statusCode || 500
    res.status(statusCode).json({ error: String(err.message || err) })
  }
})

app.post('/api/task-queue/:taskId/do-now', async (req, res) => {
  const { taskId } = req.params

  try {
    const wq = readWorkspaceQueue()
    const maxPendingPriority = wq.tasks
      .filter((task) => task.queue_dir === 'pending')
      .reduce((max, task) => Math.max(max, queuePriorityValue(task)), 0)

    const updated = updateQueueTask(taskId, (task, dir) => {
      if (dir !== 'pending') {
        const error = new Error(`Only pending tasks can be moved to the front (found ${dir})`)
        error.statusCode = 409
        throw error
      }
      const requestedAt = new Date().toISOString()
      task.priority = Math.max(queuePriorityValue(task), maxPendingPriority + 1, Number(req.body?.priority ?? 12) || 12)
      task.bumped_at = requestedAt
      task.updated_at = task.bumped_at
      task.dispatch_requested_at = requestedAt
      task.dispatch_requested_by = 'clawcommand'
      task.priority_note = 'Marked urgent / DO NOW from ClawCommand for immediate dispatch'
      return task
    })

    if (!updated) return res.status(404).json({ error: 'task not found' })
    const dispatchMeta = await dispatchQueueTaskNow(taskId, 'do_now')
    addEvent('queue.do_now', `Marked queue task ${taskId} DO NOW for immediate dispatch`, {
      taskId,
      priority: updated.task.priority,
      dispatchedTaskId: dispatchMeta?.dispatchedTaskId || null,
      dispatched: dispatchMeta?.dispatched || false,
    })
    res.json({ ...updated.task, immediate_dispatch: dispatchMeta })
  } catch (err) {
    const statusCode = err?.statusCode || 500
    res.status(statusCode).json({ error: String(err.message || err) })
  }
})

app.post('/api/task-queue/:taskId/cancel', (req, res) => {
  const { taskId } = req.params
  const reasonText = normalizeQueueText(req.body?.reason || 'Canceled from ClawCommand queue panel')

  try {
    const file = getQueueTaskFile(taskId)
    if (!file) return res.status(404).json({ error: 'task not found' })
    if (!['pending', 'claimed'].includes(file.dir)) {
      return res.status(409).json({ error: `Only pending/claimed tasks can be canceled here (found ${file.dir})` })
    }

    const task = JSON.parse(fs.readFileSync(file.path, 'utf-8'))
    const canceledAt = new Date().toISOString()
    const canceledTask = {
      ...task,
      status: 'dead',
      reason: reasonText,
      canceled_at: canceledAt,
      canceled_by: 'operator',
      finished_at: task.finished_at || canceledAt,
      updated_at: canceledAt,
      priority_note: task.priority_note || 'Canceled from ClawCommand',
    }

    const deadPath = path.join(WORKSPACE_QUEUE, 'dead', `${taskId}.json`)
    fs.renameSync(file.path, deadPath)
    fs.writeFileSync(deadPath, JSON.stringify(canceledTask, null, 2), 'utf-8')

    addEvent('queue.canceled', `Canceled queued task: ${canceledTask.text}`, { taskId, previousState: file.dir, reason: canceledTask.reason })
    res.json(canceledTask)
  } catch (err) {
    const statusCode = err?.statusCode || 500
    res.status(statusCode).json({ error: String(err.message || err) })
  }
})

// removed — state transitions owned by tools/dispatcher.py.

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

app.get('/api/memory-items', (_req, res) => {
  res.json({ sections: listMemoryRecords() })
})

app.get('/api/gemini-image-edits', (_req, res) => {
  res.json({
    edits: listGeminiImageEdits(),
    config: {
      apiKeyConfigured: Boolean(GEMINI_API_KEY),
      model: GEMINI_IMAGE_EDIT_MODEL,
      outputDir: GEMINI_IMAGE_EDITS_DIR,
    },
  })
})

app.post('/api/gemini-image-edits', async (req, res) => {
  const prompt = normalizeQueueText(req.body?.prompt)
  const inputImageDataUrl = req.body?.inputImageDataUrl
  const inputFilename = normalizeQueueText(req.body?.inputFilename || 'upload.png')
  const maskImageDataUrl = req.body?.maskImageDataUrl || null
  const requestedModel = normalizeQueueText(req.body?.model || GEMINI_IMAGE_EDIT_MODEL)

  if (!prompt) return res.status(400).json({ error: 'prompt required' })
  if (!inputImageDataUrl) return res.status(400).json({ error: 'input image required' })

  try {
    const edit = await runGeminiImageEdit({
      prompt,
      inputImageDataUrl,
      inputFilename,
      maskImageDataUrl,
      model: requestedModel,
    })
    res.json({ edit })
  } catch (error) {
    addEvent('gemini.image_edit.failed', `Gemini image edit failed: ${prompt}`, { error: String(error.message || error) })
    res.status(error?.statusCode || 500).json({ error: String(error.message || error) })
  }
})

app.get('/api/status', (_req, res) => {
  res.json(getCommandCenterStatus())
})

app.get('/api/workspace-queue', async (_req, res) => {
  await runQueueTriage()
  res.json(readWorkspaceQueue())
})

app.get('/api/runtime/services', async (_req, res) => {
  try {
    const services = await Promise.all(runtimeServices.map((service) => hydrateRuntimeService(service)))
    res.json({ services, ts: new Date().toISOString() })
  } catch (error) {
    res.status(500).json({ error: String(error.message || error) })
  }
})

app.get('/api/runtime-services', async (_req, res) => {
  try {
    const services = await Promise.all(runtimeServices.map((service) => hydrateRuntimeService(service)))
    res.json({ services, ts: new Date().toISOString() })
  } catch (error) {
    res.status(500).json({ error: String(error.message || error) })
  }
})

async function handleRuntimeServiceAction(req, res) {
  const service = getRuntimeServiceDefinition(req.params.id)
  const action = String(req.params.action || '').toLowerCase()
  if (!service) return res.status(404).json({ error: 'service not found' })
  if (!service.actions?.includes(action)) return res.status(400).json({ error: `unsupported action: ${action}` })

  try {
    const result = await service.control(action)
    addEvent('runtime.service.control', `${service.label}: ${action}`, { serviceId: service.id, action })
    const hydrated = await hydrateRuntimeService(service)
    res.json({ ok: true, action, service: hydrated, output: result?.output || '' })
  } catch (error) {
    addEvent('runtime.service.control.error', `${service.label}: ${action} failed`, { serviceId: service.id, action, error: String(error.message || error) })
    res.status(500).json({ error: String(error.message || error) })
  }
}

app.post('/api/runtime/services/:id/:action', handleRuntimeServiceAction)
app.post('/api/runtime-services/:id/:action', handleRuntimeServiceAction)

app.get('/api/openclaw/status', async (_req, res) => {
  const tel = apiTelemetry()
  const http = tel.lastGatewayHttpProbe
  const httpReachable = Boolean(http?.reachable)
  const payload = {
    output: tel.lastStatusOutput || tel.lastStatusError || 'Waiting for OpenClaw status telemetry...',
    parsed: tel.lastStatusParsed || { gatewayState: 'unknown', telegramState: 'unknown', sessionsSummary: 'warming up' },
    gatewayHttp: http
      ? {
          reachable: http.reachable,
          latencyMs: http.latencyMs,
          baseUrl: http.baseUrl,
          url: http.url,
          error: http.error || null,
        }
      : { reachable: false, latencyMs: null, baseUrl: OPENCLAW_GATEWAY_URL, url: null, error: 'not probed yet' },
    cliStatus: {
      ok: tel.lastCliStatusOk,
      error: tel.lastCliStatusOk ? null : tel.lastStatusError,
    },
    cached: true,
    fetchedAt: tel.lastStatusFetchedAt,
    error: httpReachable ? null : tel.lastStatusError,
  }

  if (tel.lastStatusParsed || tel.lastStatusError || http) {
    return res.json(payload)
  }

  return res.json({
    ...payload,
    output: 'Waiting for OpenClaw status telemetry...',
    parsed: { gatewayState: 'unknown', telegramState: 'unknown', sessionsSummary: 'warming up' },
    fetchedAt: null,
    warmingUp: true,
  })
})

app.get('/api/openclaw/sessions', async (_req, res) => {
  const tel = apiTelemetry()
  if (tel.lastSessionsListingDegraded && tel.lastSessions.length === 0) {
    return res.json({
      sessions: [],
      gatewayReachable: true,
      listingUnavailable: true,
      listingDetail: tel.lastSessionsListingDetail || 'OpenClaw CLI did not return session JSON.',
      cached: true,
      fetchedAt: tel.lastSessionsFetchedAt,
      cliSessionsOk: false,
    })
  }

  if (tel.lastSessions.length || tel.lastSessionsError) {
    if (tel.lastSessionsError) {
      return res.json({
        sessions: [{
          key: 'session listing degraded',
          kind: 'control plane',
          model: 'OpenClaw',
          status: 'error',
          errorCode: 'session_list_failed',
          errorMessage: tel.lastSessionsError || 'OpenClaw did not return session data.',
        }],
        error: 'Failed to load sessions',
        errorCode: 'session_list_failed',
        gatewayReachable: Boolean(tel.lastGatewayHttpProbe?.reachable),
        cached: true,
        fetchedAt: tel.lastSessionsFetchedAt,
      })
    }

    return res.json({
      sessions: tel.lastSessions,
      gatewayReachable: Boolean(tel.lastGatewayHttpProbe?.reachable),
      cached: true,
      fetchedAt: tel.lastSessionsFetchedAt,
    })
  }

  return res.json({
    sessions: [{
      key: 'session telemetry warming up',
      kind: 'control plane',
      model: 'OpenClaw',
      status: 'warning',
      errorCode: 'session_cache_warming',
      errorMessage: 'OpenClaw session telemetry has not arrived yet. This panel is cache-backed on purpose so the overview stays responsive.',
    }],
    gatewayReachable: Boolean(tel.lastGatewayHttpProbe?.reachable),
    cached: true,
    fetchedAt: null,
    warmingUp: true,
  })
})

app.delete('/api/openclaw/sessions/:key', async (req, res) => {
  const { key } = req.params
  if (!key) return res.status(400).json({ error: 'session key required' })
  const result = await runOpenClaw(['sessions', 'kill', key])
  if (result.error && result.stderr && !result.stdout) {
    const errorMessage = summarizeCliFailure('session kill', result)
    addEvent('openclaw.session.kill.error', `Failed to kill session: ${key}`, { error: errorMessage })
    return res.status(500).json({ error: errorMessage, errorCode: 'session_kill_failed' })
  }
  addEvent('openclaw.session.killed', `Session killed: ${key}`, { key })
  res.json({ ok: true, key, output: result.stdout })
})

app.post('/api/openclaw/refresh', async (_req, res) => {
  addEvent('openclaw.refresh', 'Manual OpenClaw refresh requested')
  await collectTelemetry()
  const tel = apiTelemetry()
  res.json({
    ok: Boolean(tel.lastCliStatusOk || tel.lastGatewayHttpProbe?.reachable),
    status: {
      output: tel.lastStatusOutput || 'Waiting for OpenClaw status telemetry...',
      parsed: tel.lastStatusParsed || { gatewayState: 'unknown', telegramState: 'unknown', sessionsSummary: 'warming up' },
      cliOk: tel.lastCliStatusOk,
      error: tel.lastCliStatusOk ? null : tel.lastStatusError,
    },
    sessions: {
      count: tel.lastSessions.length,
      cliOk: tel.lastCliSessionsOk,
      degraded: tel.lastSessionsListingDegraded,
      detail: tel.lastSessionsListingDetail || tel.lastSessionsError || null,
    },
  })
})

const distIndex = path.join(__dirname, 'dist', 'index.html')
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next()
  if (req.path.startsWith('/api/')) return next()
  if (req.path.includes('.')) return next()
  if (fs.existsSync(distIndex)) return res.sendFile(distIndex)
  next()
})

app.listen(PORT, () => {
  console.log(`[clawcommand] api listening on http://127.0.0.1:${PORT}`)
  addEvent('server.started', `ClawCommand API started on ${PORT}`)
  collectTelemetry().catch(() => addEvent('openclaw.telemetry.error', 'Initial telemetry collection failed'))
  setInterval(() => {
    collectTelemetry().catch(() => addEvent('openclaw.telemetry.error', 'Periodic telemetry collection failed'))
  }, 10000)
})
