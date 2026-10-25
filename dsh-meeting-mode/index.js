/**
 * dsh-meeting-mode —— Host 半边。
 *
 * 职责：
 *  1. 在 DSH 自带 HTTP 服务（webServer）上注册 /meeting-mode-api 前缀路由，
 *     供浏览器半边（client.js）调用；
 *  2. 把浏览器发来的 16k/16bit/单声道 PCM 块，经出站 WebSocket 转发给
 *     阿里云百炼实时语音识别（run-task 协议，Authorization 头鉴权——浏览器
 *     无法自带该头，所以必须由宿主代理）；
 *  3. 会后调用百炼 OpenAI 兼容接口（qwen-plus）生成会议纪要 JSON，
 *     落盘：转写全文.txt / 会议纪要.md / 会议纪要.docx / 脑图.html / meta.json。
 *
 * 只依赖 node: 内置模块，不引入任何第三方包。
 * 路由仅绑定在本机回环地址上（webServer 的约束），供本机 GUI 使用。
 */

import crypto from 'node:crypto';
import https from 'node:https';
import fs from 'node:fs/promises';
import path from 'node:path';

export const name = 'dsh-meeting-mode';

/** 依赖 webServer（dsh-base 自带）；缺失时不阻止加载，只是面板不可用。 */
export const inject = ['webServer'];

const DEFAULTS = {
  apiKey: '',
  keyFile: 'D:/DSH/插件/ec-img/key.txt',
  asrEndpoint: 'wss://dashscope.aliyuncs.com/api-ws/v1/inference',
  asrModel: 'qwen-audio-3.1-asr-flash-streaming',
  sampleRate: 16000,
  languageHints: 'zh,en',
  llmBaseUrl: 'https://api.deepseek.com',
  llmModel: 'deepseek-chat',
  llmApiKey: '',
  llmKeyRef: 'DEEPSEEK_API_KEY',
  outputDir: 'D:/DSH/本地会议/meetings',
};

const PREFIX = '/meeting-mode-api';
const FILE_NAMES = ['转写全文.txt', '会议纪要.md', '会议纪要.docx', '脑图.html', 'meta.json'];

/* ================================================================ 小工具 */

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readJsonBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sanitizeTitle(title) {
  const cleaned = String(title || '')
    .replace(/[\\/:*?"<>|\r\n]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40)
    .replace(/_+$/g, '');
  return cleaned || '会议';
}

function pad2(n) {
  return n < 10 ? `0${n}` : String(n);
}

function stampOf(date) {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}`;
}

/** 毫秒 → [mm:ss]（超过 1 小时用 h:mm:ss） */
function fmtClock(ms) {
  if (typeof ms !== 'number' || ms < 0 || !Number.isFinite(ms)) ms = 0;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
}

function fmtDuration(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m} 分 ${s} 秒`;
}

function escapeXml(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function escapeHtml(text) {
  return escapeXml(text);
}

/* ================================================================ 最小 WebSocket 客户端 */

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** 只实现百炼 run-task 需要的部分：文本/二进制帧、ping/pong、分片重组、关闭。 */
class WsClient {
  constructor(url, headers) {
    this.url = new URL(url);
    this.headers = headers || {};
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.fragments = null;
    this.open = false;
    this.onText = null;
    this.onClose = null;
    this.onError = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const key = crypto.randomBytes(16).toString('base64');
      const port = Number(this.url.port) || 443;
      const req = https.request({
        hostname: this.url.hostname,
        port,
        path: `${this.url.pathname}${this.url.search}`,
        method: 'GET',
        headers: {
          ...this.headers,
          Host: `${this.url.hostname}:${port}`,
          Upgrade: 'websocket',
          Connection: 'Upgrade',
          'Sec-WebSocket-Key': key,
          'Sec-WebSocket-Version': '13',
        },
      });
      req.on('upgrade', (res, socket, head) => {
        const expect = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
        if (res.headers['sec-websocket-accept'] !== expect) {
          socket.destroy();
          reject(new Error('WebSocket 握手校验失败'));
          return;
        }
        this.socket = socket;
        this.open = true;
        if (head && head.length > 0) this.feed(head);
        socket.on('data', (chunk) => this.feed(chunk));
        socket.on('close', () => this.handleClose());
        socket.on('error', (err) => {
          this.open = false;
          if (this.onError) this.onError(err);
        });
        resolve();
      });
      req.on('response', (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
          if (body.length > 4096) body = body.slice(0, 4096);
        });
        res.on('end', () => {
          const hint = res.statusCode === 401 ? '（API Key 无效或未开通该模型）' : '';
          reject(new Error(`转写服务连接被拒绝（HTTP ${res.statusCode}）${hint}${body ? `：${body.slice(0, 200)}` : ''}`));
        });
      });
      req.on('error', reject);
      req.end();
    });
  }

  feed(chunk) {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    this.drain();
  }

  drain() {
    const b = this.buffer;
    let pos = 0;
    for (;;) {
      if (b.length - pos < 2) break;
      const b0 = b[pos];
      const b1 = b[pos + 1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = pos + 2;
      if (len === 126) {
        if (b.length - off < 2) break;
        len = b.readUInt16BE(off);
        off += 2;
      } else if (len === 127) {
        if (b.length - off < 8) break;
        const big = b.readBigUInt64BE(off);
        if (big > 33554432n) {
          this.destroy();
          break;
        }
        len = Number(big);
        off += 8;
      }
      let mask = null;
      if (masked) {
        if (b.length - off < 4) break;
        mask = b.subarray(off, off + 4);
        off += 4;
      }
      if (b.length - off < len) break;
      let payload = b.subarray(off, off + len);
      if (mask) {
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i & 3];
      }
      pos = off + len;
      this.handleFrame(fin, opcode, payload);
    }
    this.buffer = pos >= b.length ? Buffer.alloc(0) : b.subarray(pos);
  }

  handleFrame(fin, opcode, payload) {
    if (opcode === 0x9) {
      this.sendFrame(0xa, payload);
      return;
    }
    if (opcode === 0xa) return;
    if (opcode === 0x8) {
      this.destroy();
      this.handleClose();
      return;
    }
    if (opcode === 0x1 || opcode === 0x2 || opcode === 0x0) {
      if (!fin || this.fragments !== null) {
        if (this.fragments === null) this.fragments = { opcode, chunks: [] };
        else if (opcode !== 0x0) this.fragments.opcode = opcode;
        this.fragments.chunks.push(payload);
        if (fin) {
          const buf = Buffer.concat(this.fragments.chunks);
          const op = this.fragments.opcode;
          this.fragments = null;
          this.dispatch(op, buf);
        }
        return;
      }
      this.dispatch(opcode, payload);
    }
  }

  dispatch(opcode, buf) {
    if (opcode === 0x1 && this.onText) this.onText(buf.toString('utf8'));
  }

  sendFrame(opcode, payload) {
    if (!this.open || this.socket === null) throw new Error('WebSocket 未连接');
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.from([0x80 | opcode, 0x80 | len]);
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    const mask = crypto.randomBytes(4);
    const masked = Buffer.from(payload);
    for (let i = 0; i < masked.length; i += 1) masked[i] ^= mask[i & 3];
    this.socket.write(Buffer.concat([header, mask, masked]));
  }

  sendText(text) {
    this.sendFrame(0x1, Buffer.from(text, 'utf8'));
  }

  sendBinary(buf) {
    this.sendFrame(0x2, buf);
  }

  destroy() {
    this.open = false;
    try {
      this.socket?.destroy();
    } catch {
      /* 忽略 */
    }
  }

  handleClose() {
    const wasOpen = this.open;
    this.open = false;
    if (wasOpen && this.onClose) this.onClose();
  }
}

/* ================================================================ 百炼实时转写会话 */

class AsrSession {
  constructor(cfg) {
    this.cfg = cfg;
    this.phase = 'connecting';
    this.error = '';
    this.sentences = [];
    this.partial = '';
    this.audioSeconds = 0;
    this.expectedSeq = 0;
    this.pending = new Map();
    this.ready = false;
    this.ws = null;
    this.taskId = crypto.randomUUID();
    this.lastAudioAt = 0;
    this.reconnectAttempts = 0;
    this.closedByUs = false;
    this.keepalive = null;
    this.readyResolve = null;
    this.readyReject = null;
    this.finishResolve = null;
  }

  async start() {
    await this.connect();
    this.keepalive = setInterval(() => {
      if (this.phase === 'recording' && Date.now() - this.lastAudioAt > 8000) {
        try {
          this.ws.sendBinary(Buffer.alloc(3200));
        } catch {
          /* 静默保活失败交给重连逻辑 */
        }
      }
    }, 10000);
  }

  async connect() {
    this.taskId = crypto.randomUUID();
    const ws = new WsClient(this.cfg.asrEndpoint, { Authorization: `Bearer ${this.cfg.apiKey}` });
    ws.onText = (text) => this.handleMessage(text);
    ws.onClose = () => this.handleDrop('连接被服务端关闭');
    ws.onError = (err) => this.handleDrop(err instanceof Error ? err.message : String(err));
    this.ws = ws;
    this.ready = false;
    await ws.connect();
    const parameters = {
      format: 'pcm',
      sample_rate: Number(this.cfg.sampleRate) || 16000,
      disfluency_removal_enabled: false,
      semantic_punctuation_enabled: true,
    };
    const hints = String(this.cfg.languageHints || 'zh,en')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    if (hints.length > 0) parameters.language_hints = hints;
    ws.sendText(JSON.stringify({
      header: { action: 'run-task', task_id: this.taskId, streaming: 'duplex' },
      payload: {
        task_group: 'audio',
        task: 'asr',
        function: 'recognition',
        model: this.cfg.asrModel,
        parameters,
        input: {},
      },
    }));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('等待识别任务启动超时（服务端无响应）')), 15000);
      this.readyResolve = () => {
        clearTimeout(timer);
        this.readyResolve = null;
        this.readyReject = null;
        resolve();
      };
      this.readyReject = (err) => {
        clearTimeout(timer);
        this.readyResolve = null;
        this.readyReject = null;
        reject(err);
      };
    });
    this.phase = 'recording';
    this.drainPending();
  }

  handleMessage(text) {
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    const event = msg?.header?.event;
    if (event === 'task-started') {
      this.ready = true;
      if (this.readyResolve) this.readyResolve();
    } else if (event === 'result-generated') {      const sentence = msg?.payload?.output?.sentence;
      if (sentence && typeof sentence.text === 'string' && sentence.text.length > 0) {
        if (sentence.sentence_end === true) {
          this.sentences.push({
            beginTime: typeof sentence.begin_time === 'number' ? sentence.begin_time : null,
            endTime: typeof sentence.end_time === 'number' ? sentence.end_time : null,
            text: sentence.text,
          });
          this.partial = '';
        } else {
          this.partial = sentence.text;
        }
      }
      const usage = msg?.payload?.usage;
      if (usage && typeof usage.duration === 'number') this.audioSeconds = usage.duration;
    } else if (event === 'task-finished') {
      if (this.finishResolve) this.finishResolve();
    } else if (event === 'task-failed') {
      const code = msg?.header?.error_code || '';
      let message = msg?.header?.error_message || '识别任务失败';
      if (code === 'Arrearage') message = '百炼账户欠费或未开通该模型（Arrearage）：请到百炼控制台确认账户余额与模型开通状态';
      if (this.readyReject) {
        const rejectReady = this.readyReject;
        this.readyReject = null;
        rejectReady(new Error(message));
      }
      if (this.phase === 'recording' || this.phase === 'connecting' || this.phase === 'stopping') {
        this.fail(message);
      }
      if (this.finishResolve) this.finishResolve();
    }
  }

  pushAudio(seq, pcmBase64) {
    const numeric = Number(seq);
    if (!Number.isInteger(numeric) || numeric < this.expectedSeq) return;
    let buf;
    try {
      buf = Buffer.from(pcmBase64, 'base64');
    } catch {
      return;
    }
    if (buf.length === 0) return;
    this.pending.set(numeric, buf);
    if (this.pending.size > 40) {
      let smallest = null;
      for (const key of this.pending.keys()) {
        if (smallest === null || key < smallest) smallest = key;
      }
      if (smallest !== null) this.expectedSeq = smallest;
    }
    this.lastAudioAt = Date.now();
    if (this.ready) this.drainPending();
  }

  drainPending() {
    while (this.pending.has(this.expectedSeq)) {
      const buf = this.pending.get(this.expectedSeq);
      this.pending.delete(this.expectedSeq);
      try {
        this.ws.sendBinary(buf);
      } catch {
        break;
      }
      this.expectedSeq += 1;
    }
  }

  handleDrop(reason) {
    if (this.closedByUs || this.phase === 'finished' || this.phase === 'error') return;
    if (this.phase === 'recording' || this.phase === 'connecting') {
      if (this.reconnectAttempts < 3) {
        this.reconnectAttempts += 1;
        this.phase = 'connecting';
        setTimeout(() => {
          if (this.closedByUs) return;
          this.connect().then(() => {
            this.reconnectAttempts = 0;
          }).catch((err) => {
            this.fail(`转写重连失败：${err instanceof Error ? err.message : String(err)}`);
          });
        }, 2000);
        return;
      }
      this.fail(`转写连接中断：${reason}`);
    }
  }

  fail(message) {
    if (this.phase === 'error' || this.phase === 'finished') return;
    this.phase = 'error';
    this.error = message;
    this.closedByUs = true;
    this.destroyWs();
    this.stopKeepalive();
  }

  destroyWs() {
    try {
      this.ws?.destroy();
    } catch {
      /* 忽略 */
    }
  }

  stopKeepalive() {
    if (this.keepalive !== null) {
      clearInterval(this.keepalive);
      this.keepalive = null;
    }
  }

  async stop() {
    if (this.phase === 'finished') return;
    if (this.phase === 'error') {
      this.stopKeepalive();
      return;
    }
    this.phase = 'stopping';
    try {
      this.ws.sendText(JSON.stringify({
        header: { action: 'finish-task', task_id: this.taskId, streaming: 'duplex' },
        payload: { input: {} },
      }));
    } catch {
      /* 连接已断则直接结束 */
    }
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 8000);
      this.finishResolve = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    this.finishResolve = null;
    this.closedByUs = true;
    this.destroyWs();
    this.stopKeepalive();
    this.phase = 'finished';
  }
}

/* ================================================================ 会议记录（内存态 + 落盘） */

/** meetingId -> record；进程生命周期内保留，供面板随时读取。 */
const meetings = new Map();

function activeRecord() {
  for (const record of meetings.values()) {
    if (record.asr && ['connecting', 'recording', 'stopping'].includes(record.asr.phase)) return record;
  }
  return null;
}

function recordSnapshot(record, since) {
  const asr = record.asr;
  const base = Math.max(0, Math.min(Number(since) || 0, asr.sentences.length));
  return {
    id: record.id,
    title: record.title,
    dir: record.dir,
    phase: asr.phase,
    error: asr.error,
    startedAt: record.startedAt,
    stoppedAt: record.stoppedAt ?? null,
    elapsedSeconds: Math.floor(((record.stoppedAt ?? Date.now()) - record.startedAt) / 1000),
    audioSeconds: Math.round(asr.audioSeconds * 10) / 10,
    sentenceCount: asr.sentences.length,
    lastSeq: asr.expectedSeq - 1,
    partial: asr.partial,
    sentenceBase: base,
    sentences: asr.sentences.slice(base),
    minutesStatus: record.minutesStatus ?? 'none',
    minutesError: record.minutesError ?? '',
    files: record.files ?? null,
  };
}

async function writeTranscriptFiles(record) {
  const lines = record.asr.sentences.map((sentence) => `[${fmtClock(sentence.beginTime)}] ${sentence.text}`);
  await fs.mkdir(record.dir, { recursive: true });
  await fs.writeFile(path.join(record.dir, '转写全文.txt'), `${record.title}\n${new Date(record.startedAt).toLocaleString('zh-CN')}\n\n${lines.join('\n')}\n`, 'utf8');
  await fs.writeFile(path.join(record.dir, 'meta.json'), JSON.stringify({
    id: record.id,
    title: record.title,
    startedAt: record.startedAt,
    stoppedAt: record.stoppedAt,
    audioSeconds: Math.round(record.asr.audioSeconds * 10) / 10,
    sentenceCount: record.asr.sentences.length,
    asrModel: record.cfg.asrModel,
    files: ['转写全文.txt'],
  }, null, 2), 'utf8');
}

/** 从落盘的转写全文恢复句子（宿主重启后仍可对历史会议生成纪要）。 */
async function loadRecordFromDisk(cfg, id) {
  if (!/^[0-9]{8}-[0-9]{4}_[^\\/:*?"<>|]+$/.test(id)) return null;
  const dir = path.join(cfg.outputDir, id);
  try {
    const meta = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8'));
    const txt = await fs.readFile(path.join(dir, '转写全文.txt'), 'utf8');
    const sentences = [];
    for (const line of txt.split(/\r?\n/)) {
      const match = /^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s?(.*)$/.exec(line);
      if (match && match[2]) {
        const parts = match[1].split(':').map(Number);
        const ms = parts.length === 3 ? (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000 : (parts[0] * 60 + parts[1]) * 1000;
        sentences.push({ beginTime: ms, endTime: null, text: match[2] });
      }
    }
    if (sentences.length === 0) return null;
    const record = {
      id,
      title: meta.title || id,
      dir,
      startedAt: meta.startedAt || Date.now(),
      stoppedAt: meta.stoppedAt || Date.now(),
      cfg,
      asr: {
        phase: 'finished',
        error: '',
        sentences,
        partial: '',
        audioSeconds: meta.audioSeconds ?? 0,
        expectedSeq: sentences.length,
        stop: async () => {},
      },
      minutesStatus: 'none',
      minutesError: '',
      files: null,
    };
    meetings.set(id, record);
    return record;
  } catch {
    return null;
  }
}

/* ================================================================ ZIP（store，无压缩）与 docx */

let CRC_TABLE = null;

function crc32(buf) {
  if (CRC_TABLE === null) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i += 1) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function zipStore(files) {
  const date = new Date();
  const dosTime = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(0, 10);
    entry.writeUInt16LE(dosTime, 12);
    entry.writeUInt16LE(dosDate, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([entry, name]));
    offset += 30 + name.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, centralBuf, eocd]);
}

function docxParagraph(text, { bold = false, sizeHalf = 22, center = false, spaceAfter = 120 } = {}) {
  const props = [
    center ? '<w:jc w:val="center"/>' : '',
    `<w:spacing w:after="${spaceAfter}"/>`,
  ].join('');
  const runProps = `<w:rPr>${bold ? '<w:b/>' : ''}<w:sz w:val="${sizeHalf}"/><w:szCs w:val="${sizeHalf}"/></w:rPr>`;
  return `<w:p><w:pPr>${props}</w:pPr><w:r>${runProps}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function buildDocx(minutes) {
  const paragraphs = [];
  paragraphs.push(docxParagraph(`会议纪要：${minutes.title}`, { bold: true, sizeHalf: 36, center: true, spaceAfter: 240 }));
  paragraphs.push(docxParagraph(minutes.metaLine, { sizeHalf: 18, center: true, spaceAfter: 240 }));
  paragraphs.push(docxParagraph('一、摘要', { bold: true, sizeHalf: 28 }));
  for (const line of minutes.summary) paragraphs.push(docxParagraph(line, { spaceAfter: 80 }));
  paragraphs.push(docxParagraph('二、讨论要点', { bold: true, sizeHalf: 28 }));
  for (const topic of minutes.discussion) {
    paragraphs.push(docxParagraph(topic.topic, { bold: true, sizeHalf: 22, spaceAfter: 60 }));
    for (const point of topic.points) paragraphs.push(docxParagraph(`• ${point}`, { spaceAfter: 40 }));
  }
  paragraphs.push(docxParagraph('三、决议事项', { bold: true, sizeHalf: 28 }));
  for (const item of minutes.decisions) paragraphs.push(docxParagraph(`• ${item}`, { spaceAfter: 40 }));
  paragraphs.push(docxParagraph('四、待办事项', { bold: true, sizeHalf: 28 }));
  for (const todo of minutes.todos) {
    const owner = todo.owner && todo.owner !== '未明确' ? `（负责人：${todo.owner}` : '（负责人：未明确';
    const due = todo.due && todo.due !== '未明确' ? `，截止：${todo.due}）` : '）';
    paragraphs.push(docxParagraph(`□ ${todo.task}${owner}${due}`, { spaceAfter: 40 }));
  }
  if (minutes.risks.length > 0) {
    paragraphs.push(docxParagraph('五、风险与备注', { bold: true, sizeHalf: 28 }));
    for (const risk of minutes.risks) paragraphs.push(docxParagraph(`• ${risk}`, { spaceAfter: 40 }));
  }
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
  const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
  return zipStore([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rels },
    { name: 'word/document.xml', data: document },
  ]);
}

function buildMindmapHtml(title, mindmapMarkdown) {
  const safe = mindmapMarkdown.replaceAll('</script', '<\\/script');
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · 会议脑图</title>
<style>
  html, body { margin: 0; height: 100%; background: #fafafa; }
  .markmap { position: relative; width: 100vw; height: 100vh; }
  .markmap > svg { width: 100%; height: 100%; }
  .fallback { display: none; position: fixed; inset: auto 0 0 0; padding: 12px 20px; background: #fff7ed; color: #9a3412; font: 14px/1.6 system-ui, sans-serif; }
</style>
<script>window.addEventListener('error', function (event) { if (String(event.message || '').indexOf('markmap') !== -1 || String(event.filename || '').indexOf('jsdelivr') !== -1) document.getElementById('fb').style.display = 'block'; }, true);</script>
<script src="https://cdn.jsdelivr.net/npm/markmap-autoloader@0.16"></script>
</head>
<body>
<div class="markmap"><script type="text/template">
${safe}
</script></div>
<div id="fb" class="fallback">脑图脚本加载失败（需要联网访问 cdn.jsdelivr.net）。脑图大纲同时保存在「会议纪要.md」末尾，可复制到 markmap.js 或 XMind 使用。</div>
</body>
</html>
`;
}

/* ================================================================ 纪要生成 */

function buildMinutesPrompt(meta) {
  return [
    '你是资深会议纪要撰写专家。请根据会议转写原文输出一份中文会议纪要，严格只输出一个 JSON 对象，不要输出任何其他文字或代码块标记。',
    'JSON 字段要求：',
    '{"title": "会议标题（若转写中能推断出更准确的会议主题可修正）",',
    ' "summary": ["摘要要点，3-6 条，每条一句话"],',
    ' "discussion": [{"topic": "议题", "points": ["该议题下的讨论要点，保留关键数字与结论"]}],',
    ' "decisions": ["明确达成的决议，没有则空数组"],',
    ' "todos": [{"task": "待办事项", "owner": "负责人（从转写推断，推断不出写 未明确）", "due": "截止时间（没有写 未明确）"}],',
    ' "risks": ["风险、分歧或待确认事项，没有则空数组"],',
    ' "mindmap": "脑图大纲，markdown 格式：第一行 # 会议主题，二级 ## 议题/结论/待办，三级 - 要点，内容必须来自会议原文"}',
    '要求：只依据转写原文，不要编造；转写可能有语音识别错别字，输出时请按上下文纠正明显错字；语气客观简洁。',
    `会议信息：标题「${meta.title}」，时长约 ${fmtDuration(meta.audioSeconds)}，转写句数 ${meta.sentenceCount}。`,
  ].join('\n');
}

function httpsJson(options, bodyObj) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(bodyObj);
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 400) {
          reject(new Error(`LLM 接口返回 HTTP ${res.statusCode}：${text.slice(0, 300)}`));
          return;
        }
        try {
          resolve(JSON.parse(text));
        } catch {
          reject(new Error('LLM 接口返回了非 JSON 响应'));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(180000, () => {
      req.destroy(new Error('LLM 请求超时'));
    });
    req.write(payload);
    req.end();
  });
}

function extractJson(text) {
  const trimmed = String(text || '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* 继续尝试从文本中截取 */
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      /* 继续尝试 */
    }
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1));
  }
  throw new Error('无法从模型输出中解析 JSON');
}

async function callLlmForMinutes(cfg, apiKey, meta, transcriptText) {
  const base = new URL(cfg.llmBaseUrl);
  const options = {
    hostname: base.hostname,
    port: base.port || 443,
    path: `${base.pathname.replace(/\/$/, '')}/chat/completions`,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  };
  const messages = [
    { role: 'system', content: buildMinutesPrompt(meta) },
    { role: 'user', content: transcriptText.slice(0, 200000) },
  ];
  const baseBody = { model: cfg.llmModel, messages, temperature: 0.3 };
  try {
    const data = await httpsJson(options, { ...baseBody, response_format: { type: 'json_object' } });
    return extractJson(data?.choices?.[0]?.message?.content ?? '');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.startsWith('LLM 接口返回 HTTP 4')) throw err;
    const data = await httpsJson(options, baseBody);
    return extractJson(data?.choices?.[0]?.message?.content ?? '');
  }
}

function asStringArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter((item) => item.trim().length > 0);
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function normalizeMinutes(raw, meta) {
  const mindmapRaw = typeof raw.mindmap === 'string' && raw.mindmap.trim() ? raw.mindmap.trim() : null;
  const todos = Array.isArray(raw.todos) ? raw.todos : [];
  return {
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : meta.title,
    summary: asStringArray(raw.summary),
    discussion: (Array.isArray(raw.discussion) ? raw.discussion : []).map((item) => ({
      topic: String(item?.topic ?? '未命名议题'),
      points: asStringArray(item?.points),
    })).filter((item) => item.points.length > 0),
    decisions: asStringArray(raw.decisions),
    todos: todos.map((item) => ({
      task: String(item?.task ?? '').trim(),
      owner: String(item?.owner ?? '未明确').trim() || '未明确',
      due: String(item?.due ?? '未明确').trim() || '未明确',
    })).filter((item) => item.task.length > 0),
    risks: asStringArray(raw.risks),
    mindmap: mindmapRaw ?? buildFallbackMindmap(meta.title, raw),
  };
}

function buildFallbackMindmap(title, raw) {
  const lines = [`# ${title}`];
  for (const item of asStringArray(raw?.summary)) lines.push(`## 摘要\n- ${item}`);
  for (const decision of asStringArray(raw?.decisions)) lines.push(`## 决议\n- ${decision}`);
  for (const todo of Array.isArray(raw?.todos) ? raw.todos : []) lines.push(`## 待办\n- ${todo?.task ?? ''}`);
  if (lines.length === 1) lines.push('## 会议内容', '- （模型未返回脑图，请查看会议纪要）');
  return lines.join('\n');
}

function buildMinutesMarkdown(minutes, meta) {
  const lines = [];
  lines.push(`# 会议纪要：${minutes.title}`);
  lines.push('');
  lines.push(`> ${meta.metaLine}`);
  lines.push('');
  lines.push('## 摘要');
  for (const item of minutes.summary) lines.push(`- ${item}`);
  if (minutes.discussion.length > 0) {
    lines.push('');
    lines.push('## 讨论要点');
    for (const topic of minutes.discussion) {
      lines.push('');
      lines.push(`### ${topic.topic}`);
      for (const point of topic.points) lines.push(`- ${point}`);
    }
  }
  if (minutes.decisions.length > 0) {
    lines.push('');
    lines.push('## 决议事项');
    for (const item of minutes.decisions) lines.push(`- ${item}`);
  }
  if (minutes.todos.length > 0) {
    lines.push('');
    lines.push('## 待办事项');
    for (const todo of minutes.todos) {
      const owner = `负责人：${todo.owner}`;
      const due = todo.due !== '未明确' ? `，截止：${todo.due}` : '';
      lines.push(`- [ ] ${todo.task}（${owner}${due}）`);
    }
  }
  if (minutes.risks.length > 0) {
    lines.push('');
    lines.push('## 风险与备注');
    for (const item of minutes.risks) lines.push(`- ${item}`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 脑图大纲（markmap）');
  lines.push('');
  lines.push('```markmap');
  lines.push(minutes.mindmap);
  lines.push('```');
  lines.push('');
  return lines.join('\n');
}

async function generateMinutes(cfg, apiKey, record) {
  const sentences = record.asr.sentences;
  if (sentences.length === 0) throw new Error('没有可用的转写内容');
  const transcriptText = sentences.map((sentence) => `[${fmtClock(sentence.beginTime)}] ${sentence.text}`).join('\n');
  const meta = {
    title: record.title,
    audioSeconds: record.asr.audioSeconds,
    sentenceCount: sentences.length,
    metaLine: `会议时间：${new Date(record.startedAt).toLocaleString('zh-CN')} · 时长：${fmtDuration(record.stoppedAt ? (record.stoppedAt - record.startedAt) / 1000 : record.asr.audioSeconds)} · 转写：${record.cfg.asrModel} · 纪要：${record.cfg.llmModel}`,
  };
  const raw = await callLlmForMinutes(cfg, apiKey, meta, transcriptText);
  const minutes = normalizeMinutes(raw, meta);
  const markdown = buildMinutesMarkdown(minutes, { ...meta, metaLine: meta.metaLine });
  const docx = buildDocx({ ...minutes, metaLine: meta.metaLine });
  const html = buildMindmapHtml(minutes.title, minutes.mindmap);
  await fs.mkdir(record.dir, { recursive: true });
  await fs.writeFile(path.join(record.dir, '会议纪要.md'), markdown, 'utf8');
  await fs.writeFile(path.join(record.dir, '会议纪要.docx'), docx);
  await fs.writeFile(path.join(record.dir, '脑图.html'), html, 'utf8');
  const metaPath = path.join(record.dir, 'meta.json');
  let metaJson = {};
  try {
    metaJson = JSON.parse(await fs.readFile(metaPath, 'utf8'));
  } catch {
    /* 旧记录可能没有 meta */
  }
  metaJson.files = ['转写全文.txt', '会议纪要.md', '会议纪要.docx', '脑图.html'];
  metaJson.minutes = {
    title: minutes.title,
    summaryCount: minutes.summary.length,
    todoCount: minutes.todos.length,
    generatedAt: Date.now(),
    summary: minutes.summary,
    decisions: minutes.decisions,
    todos: minutes.todos,
  };
  await fs.writeFile(metaPath, JSON.stringify(metaJson, null, 2), 'utf8');
  return {
    files: ['转写全文.txt', '会议纪要.md', '会议纪要.docx', '脑图.html'],
    minutes: {
      title: minutes.title,
      summary: minutes.summary,
      decisions: minutes.decisions,
      todos: minutes.todos,
    },
  };
}

/* ================================================================ 路由 */

async function resolveApiKey(cfg) {
  if (cfg.apiKey && String(cfg.apiKey).trim()) return String(cfg.apiKey).trim();
  if (cfg.keyFile) {
    try {
      const text = (await fs.readFile(cfg.keyFile, 'utf8')).trim();
      const firstLine = text.split(/\r?\n/)[0].trim();
      if (firstLine) return firstLine;
    } catch {
      /* key 文件不存在时走环境变量 */
    }
  }
  if (process.env.DASHSCOPE_API_KEY) return process.env.DASHSCOPE_API_KEY;
  return '';
}

/**
 * 纪要生成用的 LLM Key：显式配置 > 凭据库引用（默认 DEEPSEEK_API_KEY）> 百炼 key 兜底。
 * credentials 是可选服务（ctx.get 拿不到就跳过）。
 */
async function resolveLlmKey(ctx, cfg, asrKey) {
  if (cfg.llmApiKey && String(cfg.llmApiKey).trim()) return String(cfg.llmApiKey).trim();
  if (cfg.llmKeyRef) {
    try {
      const credentials = typeof ctx.get === 'function' ? ctx.get('credentials') : undefined;
      if (credentials && typeof credentials.resolve === 'function') {
        const resolved = await credentials.resolve(cfg.llmKeyRef);
        if (resolved) {
          const value = typeof resolved === 'string' ? resolved : (resolved.value ?? resolved.secret ?? '');
          if (value && String(value).trim()) return String(value).trim();
        }
      }
    } catch {
      /* 凭据解析失败则回退到百炼 key */
    }
  }
  return asrKey;
}

async function listMeetings(cfg) {
  let entries = [];
  try {
    entries = await fs.readdir(cfg.outputDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const rows = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    let meta = null;
    try {
      meta = JSON.parse(await fs.readFile(path.join(cfg.outputDir, entry.name, 'meta.json'), 'utf8'));
    } catch {
      meta = null;
    }
    const files = Array.isArray(meta?.files) ? meta.files : [];
    rows.push({
      id: entry.name,
      title: meta?.title || entry.name.replace(/^[0-9]{8}-[0-9]{4}_/, ''),
      startedAt: meta?.startedAt ?? null,
      stoppedAt: meta?.stoppedAt ?? null,
      audioSeconds: meta?.audioSeconds ?? null,
      sentenceCount: meta?.sentenceCount ?? null,
      files,
      minutesStatus: meta?.minutes ? 'done' : 'none',
      minutes: meta?.minutes ?? null,
    });
  }
  rows.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
  return rows.slice(0, 50);
}

const MIME = {
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.json': 'application/json; charset=utf-8',
};

async function serveFile(cfg, res, query) {
  const id = String(query.get('meeting') || '');
  const name = path.basename(String(query.get('name') || ''));
  if (!id || !FILE_NAMES.includes(name)) {
    json(res, 400, { error: '参数不合法' });
    return;
  }
  if (!/^[0-9]{8}-[0-9]{4}_[^\\/:*?"<>|]+$/.test(id)) {
    json(res, 400, { error: '会议 ID 不合法' });
    return;
  }
  const filePath = path.join(cfg.outputDir, id, name);
  let data;
  try {
    data = await fs.readFile(filePath);
  } catch {
    json(res, 404, { error: `文件不存在：${name}（若尚未生成纪要，请先点「生成会议纪要」）` });
    return;
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(name)] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

async function route(req, res, cfg, ctx) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const sub = url.pathname.slice(PREFIX.length) || '/';
  const query = url.searchParams;

  if (req.method === 'POST' && sub === '/start') {
    const body = await readJsonBody(req);
    const existing = activeRecord();
    if (existing) {
      json(res, 409, { error: `已有进行中的会议「${existing.title}」，请先结束它` });
      return;
    }
    const apiKey = await resolveApiKey(cfg);
    if (!apiKey) {
      json(res, 400, { error: `未找到百炼 API Key：请确认 ${cfg.keyFile} 存在，或在插件配置中直接填写 apiKey` });
      return;
    }
    const title = sanitizeTitle(body.title);
    const startedAt = Date.now();
    const dir = path.join(cfg.outputDir, `${stampOf(new Date(startedAt))}_${title}`);
    const asr = new AsrSession({ ...cfg, apiKey });
    const record = {
      id: path.basename(dir),
      title,
      dir,
      startedAt,
      stoppedAt: null,
      cfg: { ...cfg, apiKey },
      asr,
      minutesStatus: 'none',
      minutesError: '',
      files: null,
    };
    meetings.set(record.id, record);
    try {
      await asr.start();
    } catch (err) {
      meetings.delete(record.id);
      json(res, 502, { error: `转写服务连接失败：${err instanceof Error ? err.message : String(err)}` });
      return;
    }
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify({
        id: record.id,
        title,
        startedAt,
        stoppedAt: null,
        asrModel: cfg.asrModel,
        files: [],
      }, null, 2), 'utf8');
    } catch (err) {
      ctx.logger?.warn?.(`dsh-meeting-mode: 会议目录创建失败（转写不受影响）：${err instanceof Error ? err.message : String(err)}`);
    }
    json(res, 200, { id: record.id, title, startedAt, model: cfg.asrModel });
    return;
  }

  if (req.method === 'POST' && sub === '/audio') {
    const body = await readJsonBody(req);
    const record = meetings.get(String(body.id || ''));
    if (!record) {
      json(res, 404, { error: '会议不存在或宿主已重启，请停止后重新开始' });
      return;
    }
    if (record.asr.phase === 'error') {
      json(res, 409, { error: record.asr.error });
      return;
    }
    record.asr.pushAudio(body.seq, String(body.pcm || ''));
    json(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && sub === '/state') {
    const id = query.get('id');
    const record = (id && meetings.get(id)) || activeRecord() || null;
    if (!record) {
      json(res, 200, { phase: 'idle' });
      return;
    }
    json(res, 200, recordSnapshot(record, Number(query.get('since')) || 0));
    return;
  }

  if (req.method === 'POST' && sub === '/stop') {
    const body = await readJsonBody(req);
    const record = meetings.get(String(body.id || ''));
    if (!record) {
      json(res, 404, { error: '会议不存在' });
      return;
    }
    await record.asr.stop();
    record.stoppedAt = Date.now();
    try {
      await writeTranscriptFiles(record);
    } catch (err) {
      json(res, 500, { error: `保存转写文件失败：${err instanceof Error ? err.message : String(err)}` });
      return;
    }
    json(res, 200, {
      id: record.id,
      sentenceCount: record.asr.sentences.length,
      audioSeconds: Math.round(record.asr.audioSeconds * 10) / 10,
      dir: record.dir,
    });
    return;
  }

  if (req.method === 'POST' && sub === '/minutes') {
    const body = await readJsonBody(req);
    const id = String(body.id || '');
    let record = meetings.get(id) ?? null;
    if (record === null) record = await loadRecordFromDisk(cfg, id);
    if (record === null) {
      json(res, 404, { error: '会议不存在，或转写全文尚未保存' });
      return;
    }
    if (record.minutesStatus === 'generating') {
      json(res, 409, { error: '纪要正在生成中，请稍候' });
      return;
    }
    const asrKey = await resolveApiKey(cfg);
    const apiKey = await resolveLlmKey(ctx, cfg, asrKey);
    if (!apiKey) {
      json(res, 400, { error: '未找到可用的 LLM Key（llmApiKey、凭据库引用与百炼 key 均为空）' });
      return;
    }
    record.minutesStatus = 'generating';
    record.minutesError = '';
    try {
      const result = await generateMinutes(cfg, apiKey, record);
      record.minutesStatus = 'done';
      record.files = result.files;
      json(res, 200, result);
    } catch (err) {
      record.minutesStatus = 'error';
      record.minutesError = err instanceof Error ? err.message : String(err);
      json(res, 502, { error: `纪要生成失败：${record.minutesError}` });
    }
    return;
  }

  if (req.method === 'GET' && sub === '/meetings') {
    json(res, 200, { meetings: await listMeetings(cfg) });
    return;
  }

  if (req.method === 'GET' && sub === '/file') {
    await serveFile(cfg, res, query);
    return;
  }

  json(res, 404, { error: `未知接口：${req.method} ${sub}` });
}

/* ================================================================ 插件入口 */

export function apply(ctx, config) {
  const cfg = { ...DEFAULTS, ...(config ?? {}) };
  const webServer = (typeof ctx.get === 'function' ? ctx.get('webServer') : ctx.webServer) ?? null;
  if (!webServer || typeof webServer.register !== 'function') {
    ctx.logger?.warn?.('dsh-meeting-mode: webServer 服务不可用，会议模式面板不会生效');
    return;
  }

  ctx.effect(() => {
    const disposeRoute = webServer.register({
      kind: 'prefix',
      path: PREFIX,
      handler: (req, res) => {
        route(req, res, cfg, ctx).catch((err) => {
          ctx.logger?.warn?.(`dsh-meeting-mode: ${err instanceof Error ? err.message : String(err)}`);
          if (!res.headersSent) json(res, 500, { error: err instanceof Error ? err.message : String(err) });
          else res.end();
        });
      },
    });
    return () => {
      disposeRoute();
      for (const record of meetings.values()) {
        try {
          record.asr?.fail?.('插件已卸载');
        } catch {
          /* 忽略 */
        }
      }
      meetings.clear();
    };
  }, 'meeting-mode: http routes');

  ctx.logger?.info?.(`dsh-meeting-mode: 已注册 ${PREFIX} 路由（模型 ${cfg.asrModel} / ${cfg.llmModel}，输出目录 ${cfg.outputDir}）`);
}
