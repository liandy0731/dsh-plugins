/**
 * dsh-meeting-mode —— 浏览器半边。
 *
 * 左侧栏「会议模式」入口 + 中央面板：
 *   1. 开始会议：POST /meeting-mode-api/start，然后 getUserMedia 取麦克风，
 *      16k/16bit/单声道 PCM 分块（约 128ms/块）POST 给 Host，由 Host 转发百炼；
 *   2. 实时转写：300ms 轮询 /state，滚动显示已定句 + 当前半句；
 *   3. 结束会议：POST /stop；一键「生成会议纪要」POST /minutes；
 *   4. 结果页：纪要预览、脑图 iframe 预览、四个文件的下载链接；
 *   5. 历史会议列表（读取输出目录 meta.json）。
 *
 * ⚠️ 第一原则：永远不能让 DSH 启动失败（与 dsh-parallel-sessions 相同的三层保护）。
 * 手写 __ModuleLoader__ 协议下的 CJS 包装，只 require("react")，无构建步骤。
 */

window.__ModuleLoader__.load({
  id: 'dsh-meeting-mode',
  factory(require) {
    var module = { exports: {} };
    var exports = module.exports;

    function exportNoop() {
      exports.apply = function () {};
      exports.inject = [];
    }

    try {
      var React = require('react');
      if (React === null || typeof React !== 'object' || typeof React.createElement !== 'function') {
        exportNoop();
        return module.exports;
      }
      var h = React.createElement;
      var useState = React.useState;
      var useEffect = React.useEffect;
      var useRef = React.useRef;

      var NS = 'dsh-meeting-mode';
      var PANEL_ID = 'meeting-mode';
      var SIDEBAR_ORDER = 31;
      var API = '/meeting-mode-api';
      var POLL_MS = 300;

      /* ------------------------------------------------------------ 文案 */

      var zh = {
        panelTitle: '会议模式',
        panelHint: '开始后自动用麦克风收音并实时转写（阿里云百炼）',
        titleLabel: '会议标题',
        titlePlaceholder: '例如：客户需求沟通',
        start: '开始会议',
        connecting: '正在连接转写服务…',
        live: '转写中',
        stop: '结束会议',
        stopping: '正在结束…',
        micOffNotice: '转写仍在进行，但本页面没有在收音（可能刷新过页面或从其他页面开始）。',
        reconnectMic: '重新连接麦克风',
        micRequesting: '正在请求麦克风权限…',
        micDenied: '麦克风权限被拒绝或不可用：请在浏览器地址栏允许麦克风后重试。',
        micUnsupported: '当前环境不支持麦克风采集（需要浏览器内核）。',
        emptyTranscript: '还没有识别到内容，请对着麦克风正常说话。',
        elapsedLabel: '已进行',
        audioLabel: '有效语音',
        sentenceUnit: '句',
        generating: '正在生成会议纪要与脑图…（约 10-40 秒）',
        generateMinutes: '生成会议纪要',
        regenerate: '重新生成',
        minutesReady: '纪要已生成，文件在输出目录中，可直接下载发给参会方：',
        minutesFailed: '纪要生成失败',
        summaryLabel: '摘要',
        decisionsLabel: '决议事项',
        todosLabel: '待办事项',
        ownerPrefix: '负责人',
        duePrefix: '截止',
        viewTranscript: '查看转写全文',
        hideTranscript: '收起转写全文',
        mindmapPreview: '脑图预览',
        mindmapPreviewHint: '脑图需要联网加载渲染脚本（cdn.jsdelivr.net）；下载后用浏览器打开效果相同。',
        download: '下载',
        fileMinutesDoc: '会议纪要（Word）',
        fileMinutesMd: '会议纪要（Markdown）',
        fileMindmap: '会议脑图（HTML）',
        fileTranscript: '转写全文（TXT）',
        historyTitle: '历史会议',
        historyEmpty: '还没有历史会议记录。',
        historyMinutesReady: '已出纪要',
        historyNoMinutes: '未生成纪要',
        open: '打开',
        errorTitle: '出错了',
        backIdle: '返回',
        retry: '重试',
        stopFailedKeep: '结束请求失败，可重试；转写内容仍保留在宿主中。',
      };
      var en = {
        panelTitle: 'Meeting Mode',
        panelHint: 'Captures the microphone and transcribes live via Alibaba DashScope',
        titleLabel: 'Meeting title',
        titlePlaceholder: 'e.g. Customer requirements sync',
        start: 'Start meeting',
        connecting: 'Connecting to transcription service…',
        live: 'Live',
        stop: 'End meeting',
        stopping: 'Ending…',
        micOffNotice: 'Transcription is still running, but this page is not capturing audio (page was reloaded, or the meeting started elsewhere).',
        reconnectMic: 'Reconnect microphone',
        micRequesting: 'Requesting microphone access…',
        micDenied: 'Microphone access denied or unavailable. Allow the microphone in the browser and retry.',
        micUnsupported: 'Microphone capture is unavailable in this environment (browser kernel required).',
        emptyTranscript: 'Nothing recognized yet — speak normally near the microphone.',
        elapsedLabel: 'Elapsed',
        audioLabel: 'Speech',
        sentenceUnit: ' sentences',
        generating: 'Generating minutes and mind map… (10-40s)',
        generateMinutes: 'Generate minutes',
        regenerate: 'Regenerate',
        minutesReady: 'Minutes generated. Files are in the output folder, ready to share:',
        minutesFailed: 'Failed to generate minutes',
        summaryLabel: 'Summary',
        decisionsLabel: 'Decisions',
        todosLabel: 'Action items',
        ownerPrefix: 'Owner',
        duePrefix: 'Due',
        viewTranscript: 'View transcript',
        hideTranscript: 'Hide transcript',
        mindmapPreview: 'Mind map preview',
        mindmapPreviewHint: 'The mind map loads its renderer from cdn.jsdelivr.net; the downloaded file renders the same in a browser.',
        download: 'Download',
        fileMinutesDoc: 'Minutes (Word)',
        fileMinutesMd: 'Minutes (Markdown)',
        fileMindmap: 'Mind map (HTML)',
        fileTranscript: 'Transcript (TXT)',
        historyTitle: 'Past meetings',
        historyEmpty: 'No past meetings yet.',
        historyMinutesReady: 'Minutes ready',
        historyNoMinutes: 'No minutes',
        open: 'Open',
        errorTitle: 'Something went wrong',
        backIdle: 'Back',
        retry: 'Retry',
        stopFailedKeep: 'Stop request failed — you can retry; the transcript is kept on the host.',
      };

      function makeT(dict) {
        return function t(key) {
          return Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : key;
        };
      }

      /* ------------------------------------------------------------ API 与音频 */

      function api(path, options) {
        var init = options || {};
        var fetchInit = { method: init.method || 'GET', headers: {} };
        if (init.body !== undefined) {
          fetchInit.headers['Content-Type'] = 'application/json';
          fetchInit.body = JSON.stringify(init.body);
        }
        return fetch(API + path, fetchInit).then(function (res) {
          return res.text().then(function (text) {
            var data = null;
            if (text) {
              try {
                data = JSON.parse(text);
              } catch (ignored) {
                data = null;
              }
            }
            if (!res.ok) throw new Error((data && data.error) || 'HTTP ' + res.status);
            return data || {};
          });
        });
      }

      function base64FromInt16(pcm) {
        var bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
        var binary = '';
        var chunk = 0x8000;
        for (var i = 0; i < bytes.length; i += chunk) {
          var end = Math.min(i + chunk, bytes.length);
          binary += String.fromCharCode.apply(null, bytes.subarray(i, end));
        }
        return btoa(binary);
      }

      function MicCapture(meetingId) {
        this.meetingId = meetingId;
        this.seq = 0;
        this.stream = null;
        this.audioCtx = null;
        this.source = null;
        this.processor = null;
        this.mute = null;
        this.onLevel = null;
        this.backlog = [];
        this.retryTimer = null;
        this.stopped = false;
      }

      MicCapture.prototype.start = function (initialSeq) {
        var self = this;
        self.seq = initialSeq || 0;
        if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
          return Promise.reject(new Error('UNSUPPORTED'));
        }
        return navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        }).then(function (stream) {
          if (self.stopped) {
            stream.getTracks().forEach(function (track) { track.stop(); });
            return;
          }
          self.stream = stream;
          var AC = window.AudioContext || window.webkitAudioContext;
          self.audioCtx = new AC({ sampleRate: 16000 });
          self.source = self.audioCtx.createMediaStreamSource(stream);
          self.processor = self.audioCtx.createScriptProcessor(2048, 1, 1);
          self.mute = self.audioCtx.createGain();
          self.mute.gain.value = 0;
          self.processor.onaudioprocess = function (event) {
            self.handleAudio(event.inputBuffer.getChannelData(0));
          };
          self.source.connect(self.processor);
          self.processor.connect(self.mute);
          self.mute.connect(self.audioCtx.destination);
          self.retryTimer = setInterval(function () { self.flushBacklog(); }, 2000);
        });
      };

      MicCapture.prototype.handleAudio = function (samples) {
        if (this.stopped) return;
        var pcm = new Int16Array(samples.length);
        var sum = 0;
        for (var i = 0; i < samples.length; i += 1) {
          var s = Math.max(-1, Math.min(1, samples[i]));
          pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          sum += s * s;
        }
        if (this.onLevel) this.onLevel(Math.sqrt(sum / samples.length));
        var seq = this.seq;
        this.seq += 1;
        this.send(seq, pcm, true);
      };

      MicCapture.prototype.send = function (seq, pcm, allowBacklog) {
        var self = this;
        var body = JSON.stringify({ id: this.meetingId, seq: seq, pcm: base64FromInt16(pcm) });
        return fetch(API + '/audio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body,
        }).then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return true;
        }).catch(function () {
          if (allowBacklog) {
            self.backlog.push({ seq: seq, pcm: pcm });
            if (self.backlog.length > 400) self.backlog.shift();
          }
          return false;
        });
      };

      MicCapture.prototype.flushBacklog = function () {
        if (this.backlog.length === 0 || this.stopped) return;
        var items = this.backlog.splice(0, this.backlog.length);
        var self = this;
        var chain = Promise.resolve();
        items.forEach(function (item) {
          chain = chain.then(function () { return self.send(item.seq, item.pcm, false); });
        });
      };

      MicCapture.prototype.stop = function () {
        this.stopped = true;
        if (this.retryTimer !== null) {
          clearInterval(this.retryTimer);
          this.retryTimer = null;
        }
        try { if (this.processor !== null) this.processor.onaudioprocess = null; } catch (ignored) {}
        try { if (this.source !== null) this.source.disconnect(); } catch (ignored) {}
        try { if (this.processor !== null) this.processor.disconnect(); } catch (ignored) {}
        try { if (this.mute !== null) this.mute.disconnect(); } catch (ignored) {}
        try { if (this.audioCtx !== null && typeof this.audioCtx.close === 'function') this.audioCtx.close(); } catch (ignored) {}
        try {
          if (this.stream !== null) this.stream.getTracks().forEach(function (track) { track.stop(); });
        } catch (ignored) {}
      };

      /* ------------------------------------------------------------ 工具 */

      function fileUrl(id, name) {
        return API + '/file?meeting=' + encodeURIComponent(id) + '&name=' + encodeURIComponent(name);
      }

      function fmtClock(totalSeconds) {
        var total = Math.max(0, Math.floor(totalSeconds || 0));
        var m = Math.floor(total / 60);
        var s = total % 60;
        return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
      }

      function fmtTime(ts) {
        if (!ts) return '';
        try {
          return new Date(ts).toLocaleString('zh-CN', { hour12: false });
        } catch (ignored) {
          return '';
        }
      }

      function log(ctx, message, error) {
        try {
          if (ctx && ctx.console && typeof ctx.console.error === 'function') {
            if (error === undefined) ctx.console.error(message);
            else ctx.console.error(message, error);
          }
        } catch (ignored) {
          /* 日志失败绝不影响主流程 */
        }
      }

      /* ------------------------------------------------------------ 样式 */

      var S = {
        wrap: { display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 860, padding: '20px 24px 48px', color: 'var(--dsw-alias-label-primary)' },
        header: { display: 'flex', alignItems: 'center', gap: 10 },
        title: { fontSize: 18, fontWeight: 600 },
        hint: { color: 'var(--dsw-alias-label-secondary)', fontSize: 13 },
        card: { background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 },
        row: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
        input: { flex: 1, minWidth: 220, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)', fontSize: 14, outline: 'none' },
        primaryBtn: { padding: '9px 18px', borderRadius: 8, border: 'none', background: 'var(--dsw-alias-brand-primary)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
        dangerBtn: { padding: '9px 18px', borderRadius: 8, border: 'none', background: 'var(--dsw-alias-state-error-primary)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
        ghostBtn: { padding: '7px 14px', borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent', color: 'var(--dsw-alias-label-primary)', fontSize: 13, cursor: 'pointer' },
        textBtn: { padding: 0, border: 'none', background: 'transparent', color: 'var(--dsw-alias-brand-primary)', fontSize: 13, cursor: 'pointer' },
        stat: { color: 'var(--dsw-alias-label-secondary)', fontSize: 13 },
        liveDot: { width: 10, height: 10, borderRadius: '50%', background: 'var(--dsw-alias-state-error-primary)', animation: 'dsh-meeting-pulse 1.2s ease-in-out infinite' },
        levelTrack: { flex: 1, minWidth: 120, height: 6, borderRadius: 3, background: 'var(--dsw-alias-bg-layer-2)', overflow: 'hidden' },
        levelBar: { height: '100%', background: 'var(--dsw-alias-state-success-primary)', borderRadius: 3 },
        transcript: { display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto', padding: '4px 2px' },
        sentence: { fontSize: 14, lineHeight: '22px' },
        sentenceTime: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12, marginRight: 8, fontVariantNumeric: 'tabular-nums' },
        partial: { fontSize: 14, lineHeight: '22px', color: 'var(--dsw-alias-label-secondary)', fontStyle: 'italic' },
        empty: { color: 'var(--dsw-alias-label-secondary)', fontSize: 13, padding: '8px 2px' },
        errorBox: { background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-state-error-primary)', borderRadius: 10, padding: '10px 14px', color: 'var(--dsw-alias-state-error-primary)', fontSize: 13 },
        noticeBox: { background: 'var(--dsw-alias-bg-layer-2)', border: '1px solid var(--dsw-alias-state-warn-primary)', borderRadius: 10, padding: '10px 14px', color: 'var(--dsw-alias-label-primary)', fontSize: 13 },
        fileRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '8px 10px', borderRadius: 8, background: 'var(--dsw-alias-bg-layer-2)' },
        fileName: { fontSize: 13 },
        historyRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--dsw-alias-border-l1)', cursor: 'pointer' },
        topBar: { position: 'sticky', top: 0, zIndex: 10, display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', background: 'var(--dsw-alias-bg-base)', borderBottom: '1px solid var(--dsw-alias-border-l1)', marginBottom: 4 },
        backBtn: { padding: '6px 14px', borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' },
        crumbTitle: { fontWeight: 600, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
        historyTitle: { fontSize: 13, fontWeight: 600 },
        historyMeta: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12 },
        badge: { fontSize: 11, padding: '2px 8px', borderRadius: 999, border: '1px solid var(--dsw-alias-border-l2)', color: 'var(--dsw-alias-label-secondary)' },
        badgeOk: { fontSize: 11, padding: '2px 8px', borderRadius: 999, border: '1px solid var(--dsw-alias-state-success-primary)', color: 'var(--dsw-alias-state-success-primary)' },
        iframe: { width: '100%', height: 460, border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 10, background: 'var(--dsw-alias-bg-base)' },
        pre: { whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: '21px', maxHeight: 320, overflowY: 'auto', background: 'var(--dsw-alias-bg-layer-2)', borderRadius: 8, padding: 12, margin: 0 },
        sectionLabel: { fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-secondary)' },
        todoItem: { fontSize: 13, lineHeight: '20px' },
      };

      var styleEl = null;
      function ensurePulseStyle() {
        if (styleEl !== null) return;
        try {
          styleEl = document.createElement('style');
          styleEl.textContent = '@keyframes dsh-meeting-pulse { 0% { opacity: 1; } 50% { opacity: 0.35; } 100% { opacity: 1; } }';
          document.head.appendChild(styleEl);
        } catch (ignored) {
          styleEl = null;
        }
      }

      /* ------------------------------------------------------------ 图标 */

      function PanelIcon() {
        return h('svg', {
          viewBox: '0 0 24 24', width: 22, height: 22, 'aria-hidden': true,
        },
        h('path', { d: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z', fill: 'currentColor' }),
        h('path', {
          d: 'M6 11a6 6 0 0 0 12 0M12 17v4M8.5 21h7',
          fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        }));
      }

      /* ------------------------------------------------------------ 面板 */

      function MeetingPanel(props) {
        var t = typeof props.t === 'function' ? props.t : makeT(zh);

        var phaseState = useState('boot'); // boot|idle|connecting|recording|stopping|stopped|error
        var phase = phaseState[0];
        var setPhase = phaseState[1];
        var titleState = useState('');
        var title = titleState[0];
        var setTitle = titleState[1];
        var meetingState = useState(null); // {id,title}
        var meeting = meetingState[0];
        var setMeeting = meetingState[1];
        var sentencesState = useState([]);
        var sentences = sentencesState[0];
        var setSentences = sentencesState[1];
        var partialState = useState('');
        var partial = partialState[0];
        var setPartial = partialState[1];
        var elapsedState = useState(0);
        var elapsed = elapsedState[0];
        var setElapsed = elapsedState[1];
        var audioState = useState(0);
        var audioSeconds = audioState[0];
        var setAudioSeconds = audioState[1];
        var errorState = useState('');
        var error = errorState[0];
        var setError = errorState[1];
        var minutesStatusState = useState('none'); // none|generating|done|error
        var minutesStatus = minutesStatusState[0];
        var setMinutesStatus = minutesStatusState[1];
        var minutesState = useState(null);
        var minutes = minutesState[0];
        var setMinutes = minutesState[1];
        var filesState = useState(null);
        var files = filesState[0];
        var setFiles = filesState[1];
        var historyState = useState([]);
        var history = historyState[0];
        var setHistory = historyState[1];
        var micState = useState('off'); // off|requesting|on|denied|unsupported
        var mic = micState[0];
        var setMic = micState[1];
        var levelState = useState(0);
        var level = levelState[0];
        var setLevel = levelState[1];
        var showTranscriptState = useState(false);
        var showTranscript = showTranscriptState[0];
        var setShowTranscript = showTranscriptState[1];

        var captureRef = useRef(null);
        var sinceRef = useRef(0);
        var meetingRef = useRef(null);
        var listRef = useRef(null);
        var wrapRef = useRef(null);

        meetingRef.current = meeting;

        /* 进入详情/错误页时滚回面板顶部，配合顶部粘性导航条 */
        useEffect(function () {
          if ((phase === 'stopped' || phase === 'error') && wrapRef.current !== null) {
            try { wrapRef.current.scrollIntoView({ block: 'start' }); } catch (ignored) {}
          }
        }, [phase]);

        /* 详情/错误页支持 ESC 键返回列表 */
        useEffect(function () {
          if (phase !== 'stopped' && phase !== 'error') return undefined;
          function onKey(event) {
            if (event.key === 'Escape') backToIdle();
          }
          document.addEventListener('keydown', onKey);
          return function () { document.removeEventListener('keydown', onKey); };
        }, [phase]);

        function applySnapshot(st) {
          if (!st || st.phase === 'idle') return false;
          if (st.id && (meetingRef.current === null || meetingRef.current.id !== st.id)) {
            setMeeting({ id: st.id, title: st.title || '' });
            meetingRef.current = { id: st.id, title: st.title || '' };
            sinceRef.current = 0;
            setSentences([]);
          }
          if (Array.isArray(st.sentences) && st.sentences.length > 0) {
            var incoming = st.sentences;
            setSentences(function (prev) { return prev.concat(incoming); });
            sinceRef.current += incoming.length;
          }
          setPartial(typeof st.partial === 'string' ? st.partial : '');
          setElapsed(st.elapsedSeconds || 0);
          setAudioSeconds(st.audioSeconds || 0);
          if (st.phase === 'recording' || st.phase === 'connecting') {
            setPhase(st.phase === 'connecting' ? 'connecting' : 'recording');
          } else if (st.phase === 'stopping') {
            setPhase('stopping');
          } else if (st.phase === 'finished') {
            setPhase('stopped');
            if (Array.isArray(st.files) && st.files.length > 0) setFiles(st.files);
          } else if (st.phase === 'error') {
            setPhase('error');
            setError(st.error || 'unknown');
          }
          return true;
        }

        /* 启动：读取宿主当前状态（页面刷新/重进面板时恢复） */
        useEffect(function () {
          var disposed = false;
          ensurePulseStyle();
          api('/state').then(function (st) {
            if (disposed) return;
            if (st && st.phase && st.phase !== 'idle') {
              applySnapshot(st);
            } else {
              setPhase('idle');
            }
            api('/meetings').then(function (data) {
              if (!disposed) setHistory((data && data.meetings) || []);
            }).catch(function () {});
          }).catch(function () {
            if (!disposed) setPhase('idle');
          });
          return function () { disposed = true; };
        }, []);

        /* 录制中轮询 */
        useEffect(function () {
          if (phase !== 'recording' && phase !== 'connecting' && phase !== 'stopping') return undefined;
          var disposed = false;
          function tick() {
            var current = meetingRef.current;
            if (current === null) return;
            api('/state?id=' + encodeURIComponent(current.id) + '&since=' + sinceRef.current).then(function (st) {
              if (!disposed) applySnapshot(st);
            }).catch(function () {});
          }
          var timer = setInterval(tick, POLL_MS);
          tick();
          return function () {
            disposed = true;
            clearInterval(timer);
          };
        }, [phase]);

        /* 自动滚动到底部 */
        useEffect(function () {
          var node = listRef.current;
          if (node !== null) node.scrollTop = node.scrollHeight;
        }, [sentences.length, partial]);

        /* 卸载时停掉本页收音（转写继续在宿主侧进行） */
        useEffect(function () {
          return function () {
            if (captureRef.current !== null) {
              captureRef.current.stop();
              captureRef.current = null;
            }
          };
        }, []);

        function startMic(id, initialSeq) {
          setMic('requesting');
          var capture = new MicCapture(id);
          captureRef.current = capture;
          capture.onLevel = function (value) { setLevel(value); };
          capture.start(initialSeq).then(function () {
            setMic('on');
          }).catch(function (err) {
            captureRef.current = null;
            if (err && err.message === 'UNSUPPORTED') setMic('unsupported');
            else setMic('denied');
          });
        }

        function startMeeting() {
          setError('');
          api('/start', { method: 'POST', body: { title: title } }).then(function (data) {
            setMeeting({ id: data.id, title: data.title || title });
            meetingRef.current = { id: data.id, title: data.title || title };
            sinceRef.current = 0;
            setSentences([]);
            setPartial('');
            setFiles(null);
            setMinutes(null);
            setMinutesStatus('none');
            setPhase('connecting');
            startMic(data.id, 0);
          }).catch(function (err) {
            setError(err.message);
            setPhase('idle');
          });
        }

        function reconnectMic() {
          var current = meetingRef.current;
          if (current === null) return;
          api('/state?id=' + encodeURIComponent(current.id)).then(function (st) {
            startMic(current.id, (st && typeof st.lastSeq === 'number' ? st.lastSeq : 0) + 1);
          }).catch(function () {
            startMic(current.id, 0);
          });
        }

        function stopMeeting() {
          var current = meetingRef.current;
          if (current === null) return;
          setPhase('stopping');
          if (captureRef.current !== null) {
            captureRef.current.stop();
            captureRef.current = null;
          }
          setMic('off');
          api('/stop', { method: 'POST', body: { id: current.id } }).then(function () {
            setPhase('stopped');
            api('/meetings').then(function (data) { setHistory((data && data.meetings) || []); }).catch(function () {});
          }).catch(function (err) {
            setError(err.message);
            setPhase('recording');
          });
        }

        function generateMinutes() {
          var current = meetingRef.current;
          if (current === null) return;
          setError('');
          setMinutesStatus('generating');
          api('/minutes', { method: 'POST', body: { id: current.id } }).then(function (data) {
            setMinutesStatus('done');
            setFiles((data && data.files) || []);
            setMinutes((data && data.minutes) || null);
            api('/meetings').then(function (list) { setHistory((list && list.meetings) || []); }).catch(function () {});
          }).catch(function (err) {
            setMinutesStatus('error');
            setError(err.message);
          });
        }

        function openHistory(row) {
          setMeeting({ id: row.id, title: row.title });
          meetingRef.current = { id: row.id, title: row.title };
          sinceRef.current = 0;
          setSentences([]);
          setPartial('');
          setElapsed(0);
          setAudioSeconds(row.audioSeconds || 0);
          var hasMinutes = Array.isArray(row.files) && row.files.indexOf('会议纪要.md') !== -1;
          setFiles(Array.isArray(row.files) && row.files.length > 0 ? row.files : null);
          setMinutesStatus(hasMinutes ? 'done' : 'none');
          setMinutes(row.minutes !== null && typeof row.minutes === 'object' && Array.isArray(row.minutes.summary) ? row.minutes : null);
          setPhase('stopped');
          api('/state?id=' + encodeURIComponent(row.id)).then(function (st) {
            if (st && st.phase && st.phase !== 'idle') applySnapshot(st);
          }).catch(function () {});
        }

        function backToIdle() {
          setPhase('idle');
          setMeeting(null);
          meetingRef.current = null;
          setSentences([]);
          setPartial('');
          setError('');
        }

        /* ------------------------------------------------------------ 视图 */

        var children = [];

        if (phase === 'stopped' || phase === 'error') {
          children.push(h('div', { key: 'nav', style: S.topBar },
            h('button', { key: 'back', style: S.backBtn, onClick: backToIdle }, '← ' + t('backIdle')),
            h('span', { key: 'crumb', style: S.crumbTitle }, meeting !== null ? meeting.title : '')));
        } else {
          children.push(h('div', { key: 'header', style: S.header },
            h(PanelIcon, { key: 'icon' }),
            h('div', { key: 'title', style: S.title }, t('panelTitle')),
            h('div', { key: 'hint', style: S.hint }, t('panelHint'))));
        }

        if (error) {
          children.push(h('div', { key: 'error', style: S.errorBox }, t('errorTitle') + '：' + error));
        }

        if (phase === 'boot') {
          children.push(h('div', { key: 'boot', style: S.empty }, '…'));
        } else if (phase === 'idle') {
          children.push(h('div', { key: 'startCard', style: S.card },
            h('div', { key: 'row', style: S.row },
              h('input', {
                key: 'input', style: S.input, value: title,
                placeholder: t('titlePlaceholder'),
                onChange: function (event) { setTitle(event.target.value); },
                onKeyDown: function (event) { if (event.key === 'Enter') startMeeting(); },
              }),
              h('button', { key: 'start', style: S.primaryBtn, onClick: startMeeting }, t('start'))),
            h('div', { key: 'hint', style: S.hint }, t('panelHint'))));

          children.push(h('div', { key: 'history', style: S.card },
            h('div', { key: 'label', style: S.sectionLabel }, t('historyTitle')),
            history.length === 0
              ? h('div', { key: 'empty', style: S.empty }, t('historyEmpty'))
              : h('div', { key: 'rows', style: { display: 'flex', flexDirection: 'column', gap: 8 } }, history.map(function (row, index) {
                return h('div', { key: row.id || index, style: S.historyRow, onClick: function () { openHistory(row); } },
                  h('div', { key: 'left' },
                    h('div', { style: S.historyTitle }, row.title),
                    h('div', { style: S.historyMeta }, fmtTime(row.startedAt))),
                  h('div', { key: 'right', style: S.row },
                    h('span', { style: Array.isArray(row.files) && row.files.indexOf('会议纪要.md') !== -1 ? S.badgeOk : S.badge },
                      Array.isArray(row.files) && row.files.indexOf('会议纪要.md') !== -1 ? t('historyMinutesReady') : t('historyNoMinutes')),
                    h('button', { style: S.ghostBtn, onClick: function (event) { event.stopPropagation(); openHistory(row); } }, t('open'))));
              }))));
        } else if (phase === 'connecting' || phase === 'recording' || phase === 'stopping') {
          var live = phase === 'recording';
          children.push(h('div', { key: 'live', style: S.card },
            h('div', { key: 'row', style: S.row },
              h('span', { key: 'dot', style: S.liveDot }),
              h('span', { key: 'title', style: { fontWeight: 600, fontSize: 15 } }, meeting !== null ? meeting.title : ''),
              h('span', { key: 'tag', style: S.badge }, live ? t('live') : t('connecting')),
              h('span', { key: 'elapsed', style: S.stat }, t('elapsedLabel') + ' ' + fmtClock(elapsed)),
              h('span', { key: 'audio', style: S.stat }, t('audioLabel') + ' ' + fmtClock(audioSeconds)),
              h('span', { key: 'count', style: S.stat }, sentences.length + t('sentenceUnit'))),
            h('div', { key: 'levelRow', style: S.row },
              h('div', { key: 'track', style: S.levelTrack },
                h('div', { key: 'bar', style: Object.assign({}, S.levelBar, { width: Math.min(100, Math.round(level * 400)) + '%' }) })),
              mic === 'requesting' ? h('span', { key: 'mic', style: S.stat }, t('micRequesting')) : null,
              mic === 'denied' ? h('span', { key: 'micdenied', style: Object.assign({}, S.stat, { color: 'var(--dsw-alias-state-error-primary)' }) }, t('micDenied')) : null,
              mic === 'unsupported' ? h('span', { key: 'micunsup', style: Object.assign({}, S.stat, { color: 'var(--dsw-alias-state-error-primary)' }) }, t('micUnsupported')) : null),
            mic === 'off' && phase !== 'stopping'
              ? h('div', { key: 'notice', style: S.noticeBox },
                h('span', null, t('micOffNotice') + ' '),
                h('button', { style: S.textBtn, onClick: reconnectMic }, t('reconnectMic')))
              : null,
            h('div', { key: 'transcript', style: S.transcript, ref: listRef },
              sentences.length === 0 && partial === ''
                ? h('div', { key: 'empty', style: S.empty }, t('emptyTranscript'))
                : sentences.map(function (sentence, index) {
                  return h('div', { key: index, style: S.sentence },
                    h('span', { style: S.sentenceTime }, '[' + fmtClock((sentence.beginTime || 0) / 1000) + ']'),
                    sentence.text);
                }),
              partial !== '' ? h('div', { key: 'partial', style: S.partial }, partial) : null),
            h('div', { key: 'actions', style: S.row },
              h('button', { key: 'stop', style: S.dangerBtn, onClick: stopMeeting, disabled: phase === 'stopping' },
                phase === 'stopping' ? t('stopping') : t('stop')))));
        } else if (phase === 'stopped') {
          var fileRows = [];
          var knownFiles = files || [];
          var fileLabels = { '会议纪要.docx': t('fileMinutesDoc'), '会议纪要.md': t('fileMinutesMd'), '脑图.html': t('fileMindmap'), '转写全文.txt': t('fileTranscript') };
          var order = ['会议纪要.docx', '脑图.html', '会议纪要.md', '转写全文.txt'];
          order.forEach(function (name) {
            if (knownFiles.indexOf(name) === -1) return;
            fileRows.push(h('div', { key: name, style: S.fileRow },
              h('span', { style: S.fileName }, fileLabels[name] || name),
              h('a', { href: fileUrl(meeting.id, name), download: name, style: Object.assign({}, S.textBtn, { textDecoration: 'none' }) }, t('download'))));
          });

          children.push(h('div', { key: 'result', style: S.card },
            h('div', { key: 'row', style: S.row },
              h('span', { key: 'stat', style: S.stat }, t('elapsedLabel') + ' ' + fmtClock(elapsed) + ' · ' + t('audioLabel') + ' ' + fmtClock(audioSeconds) + ' · ' + sentences.length + t('sentenceUnit'))),
            minutesStatus === 'none'
              ? h('div', { key: 'genRow', style: S.row },
                h('button', { style: S.primaryBtn, onClick: generateMinutes }, t('generateMinutes')))
              : null,
            minutesStatus === 'generating'
              ? h('div', { key: 'gen', style: S.empty }, t('generating'))
              : null,
            minutesStatus === 'error'
              ? h('div', { key: 'genErr', style: S.row },
                h('span', { style: Object.assign({}, S.stat, { color: 'var(--dsw-alias-state-error-primary)' }) }, t('minutesFailed')),
                h('button', { style: S.ghostBtn, onClick: generateMinutes }, t('retry')))
              : null,
            minutesStatus === 'done' && fileRows.length > 0
              ? h('div', { key: 'files', style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                h('div', { key: 'ready', style: S.hint }, t('minutesReady')),
                fileRows,
                h('div', { key: 'regen', style: S.row },
                  h('button', { style: S.ghostBtn, onClick: generateMinutes }, t('regenerate'))))
              : null,
            minutes !== null && minutes.summary && minutes.summary.length > 0
              ? h('div', { key: 'summary' },
                h('div', { style: S.sectionLabel }, t('summaryLabel')),
                h('ul', { style: { margin: '6px 0 0', paddingLeft: 20 } }, minutes.summary.map(function (item, index) {
                  return h('li', { key: index, style: S.todoItem }, item);
                })))
              : null,
            minutes !== null && Array.isArray(minutes.decisions) && minutes.decisions.length > 0
              ? h('div', { key: 'decisions' },
                h('div', { style: S.sectionLabel }, t('decisionsLabel')),
                h('ul', { style: { margin: '6px 0 0', paddingLeft: 20 } }, minutes.decisions.map(function (item, index) {
                  return h('li', { key: index, style: S.todoItem }, item);
                })))
              : null,
            minutes !== null && Array.isArray(minutes.todos) && minutes.todos.length > 0
              ? h('div', { key: 'todos' },
                h('div', { style: S.sectionLabel }, t('todosLabel')),
                h('ul', { style: { margin: '6px 0 0', paddingLeft: 20 } }, minutes.todos.map(function (item, index) {
                  return h('li', { key: index, style: S.todoItem },
                    item.task + '（' + t('ownerPrefix') + '：' + (item.owner || '—') + (item.due && item.due !== '未明确' ? '，' + t('duePrefix') + '：' + item.due : '') + '）');
                })))
              : null,
            minutesStatus === 'done' && knownFiles.indexOf('脑图.html') !== -1
              ? h('div', { key: 'mindmap' },
                h('div', { style: S.sectionLabel }, t('mindmapPreview')),
                h('div', { style: S.hint }, t('mindmapPreviewHint')),
                h('iframe', { key: 'mm' + knownFiles.indexOf('脑图.html'), style: S.iframe, src: fileUrl(meeting.id, '脑图.html'), title: 'mindmap' }))
              : null,
            h('div', { key: 'transcriptToggle', style: S.row },
              h('button', { style: S.textBtn, onClick: function () { setShowTranscript(!showTranscript); } },
                showTranscript ? t('hideTranscript') : t('viewTranscript'))),
            showTranscript
              ? h('iframe', { key: 'txt', style: Object.assign({}, S.iframe, { height: 320 }), src: fileUrl(meeting.id, '转写全文.txt'), title: 'transcript' })
              : null));
        } else if (phase === 'error') {
          children.push(h('div', { key: 'errCard', style: S.card },
            h('div', { style: S.errorBox }, t('errorTitle') + '：' + error)));
        }

        return h('div', { ref: wrapRef, style: S.wrap }, children);
      }

      /* ------------------------------------------------------------ 注册 */

      exports.inject = ['slots', 'locale'];

      exports.apply = function (ctx) {
        try {
          if (ctx.locale && typeof ctx.locale.register === 'function') {
            ctx.locale.register(NS, { zh: zh, en: en });
          }
        } catch (error) {
          log(ctx, 'dsh-meeting-mode: 注册词典失败（已忽略）', error);
        }

        try {
          ctx.slots.inject('sidebar.panellist', function () {
            return ctx.slots.register({
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: SIDEBAR_ORDER,
              label: 'panelTitle',
              locale: NS,
              inject: function () { return {}; },
            }, PanelIcon);
          });
        } catch (error) {
          log(ctx, 'dsh-meeting-mode: 注册侧栏入口失败（已忽略）', error);
        }

        try {
          ctx.slots.inject('main', function () {
            return ctx.slots.register({
              name: 'main',
              key: PANEL_ID,
              locale: NS,
              inject: function () { return {}; },
            }, MeetingPanel);
          });
        } catch (error) {
          log(ctx, 'dsh-meeting-mode: 注册主面板失败（已忽略）', error);
        }
      };
    } catch (error) {
      exportNoop();
    }

    return module.exports;
  },
});