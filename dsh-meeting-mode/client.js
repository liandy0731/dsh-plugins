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
        statusConnecting: '连接中',
        statusLive: '转写中',
        statusStopping: '收尾中',
        statusError: '异常',
        statusEnded: '已结束',
        statusSummarized: '已总结',
        statusMindmapped: '脑图已生成',
        hintRecording: '正在实时转写，请正常开会；切换到别的会话也不会中断。',
        hintEnded: '转写已保存。下一步：区分发言人（可选）或生成会议纪要。',
        hintSummarized: '纪要已生成。下一步：生成脑图。',
        hintMindmapped: '纪要 + 脑图都已生成，可在下方下载。',
        diarize: '区分发言人',
        diarizing: '正在区分发言人…（上传录音 + 离线识别，通常 1-5 分钟）',
        diarizeUploading: '正在上传录音…',
        diarizeTranscribing: '离线识别排队/识别中…',
        diarizeAligning: '正在对齐发言人…',
        diarizeDone: '已区分发言人',
        diarizeFailed: '区分发言人失败',
        diarizeHint: '用离线模型重跑整段录音，标出「说话人1 / 说话人2」；约 0.29 元/小时，通常 1-5 分钟。',
        speakersLabel: '发言人',
        generateMindmap: '生成脑图',
        mindmapPending: '纪要已生成，脑图还没出。',
        fileAudio: '录音音频（WAV）',
        regenMinutes: '重新生成纪要',
        regenMindmap: '重新生成脑图',
        saveSection: '沉淀归档',
        saveKb: '存入知识库',
        saveMemory: '存入记忆',
        saveSaving: '保存中…',
        savedKb: '已存入知识库',
        savedMemoryCreated: '已存入记忆',
        savedMemoryMerged: '已并入同名记忆',
        notInstalledKb: '未检测到知识库（WeKnora 未安装或服务未启动）',
        notInstalledMemory: '尚未安装「记忆」插件',
        memoryTokenLocked: '记忆插件配置了访问令牌，面板无法直接写入',
        needMinutesForSave: '生成会议纪要后，可一键存入知识库 / 记忆',
        kbHint: '纪要全文存入 WeKnora，之后可被检索',
        memoryHint: '摘要+决议+待办存为「项目记忆」，同名自动去重合并',
        probeHint: '检测归档目标…',
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
        statusConnecting: 'Connecting',
        statusLive: 'Live',
        statusStopping: 'Wrapping up',
        statusError: 'Error',
        statusEnded: 'Ended',
        statusSummarized: 'Minutes ready',
        statusMindmapped: 'Mind map ready',
        hintRecording: 'Transcribing live — switching to another session does not stop it.',
        hintEnded: 'Transcript saved. Next: separate speakers (optional) or generate minutes.',
        hintSummarized: 'Minutes are ready. Next: generate the mind map.',
        hintMindmapped: 'Minutes and mind map are ready to download.',
        diarize: 'Separate speakers',
        diarizing: 'Separating speakers… (upload + offline pass, usually 1-5 min)',
        diarizeUploading: 'Uploading audio…',
        diarizeTranscribing: 'Queued / transcribing…',
        diarizeAligning: 'Aligning speakers…',
        diarizeDone: 'Speakers separated',
        diarizeFailed: 'Speaker separation failed',
        diarizeHint: 'Runs an offline pass over the recording and labels speakers. About ¥0.29/hour, usually 1-5 min.',
        speakersLabel: 'Speakers',
        generateMindmap: 'Generate mind map',
        mindmapPending: 'Minutes are ready; the mind map is not generated yet.',
        fileAudio: 'Recording (WAV)',
        regenMinutes: 'Regenerate minutes',
        regenMindmap: 'Regenerate mind map',
        saveSection: 'Archive',
        saveKb: 'Save to knowledge base',
        saveMemory: 'Save to memory',
        saveSaving: 'Saving…',
        savedKb: 'Saved to knowledge base',
        savedMemoryCreated: 'Saved to memory',
        savedMemoryMerged: 'Merged into the existing memory',
        notInstalledKb: 'Knowledge base not detected (WeKnora missing or not running)',
        notInstalledMemory: 'Memory plugin not installed',
        memoryTokenLocked: 'Memory plugin requires an access token; cannot write from the panel',
        needMinutesForSave: 'Generate minutes first, then save to the knowledge base / memory',
        kbHint: 'Stores the full minutes in WeKnora for later retrieval',
        memoryHint: 'Summary + decisions + todos as a project memory; same title merges automatically',
        probeHint: 'Detecting archive targets…',
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

      /* ------------------------------------------------------------ 会议状态（跨组件共享） */

      /*
       * 左侧栏图标和面板主区是两棵独立的组件树，但用户想在任何地方都能看到
       * 这场会议进行到哪一步。这里用一个模块级小 store 共享生命周期状态：
       *   进行中（连接中/转写中/收尾中）来自 /state；
       *   结束后（已结束/已总结/脑图已生成）来自 /meetings 最近一条记录的文件清单。
       * 侧栏图标自己定时轮询（面板没打开/切到别的会话时仍然准确）。
       */

      var STATUS_TICK_ACTIVE = 1500;
      var STATUS_TICK_IDLE = 6000;
      var ROW_STATUS_ATTR = 'data-dsh-meeting-status';
      var ROW_TONE_ATTR = 'data-dsh-meeting-tone';
      var activeTranslate = makeT(zh);

      /* 自带词典兜底：locale 服务里的词典在「长驻页面 + 插件热重载」时会停留在旧版本
         （同名空间首次注册优先，重新 register 不会覆盖），新增的 key 会原样显示成英文。
         查不到就回退到本模块自带的 zh/en 词典，保证任何情况下都不出现裸 key。 */
      function ownDictT(key) {
        var lang = '';
        try {
          lang = String(document.documentElement.getAttribute('lang') || '').toLowerCase();
        } catch (ignored) {}
        return makeT(lang.indexOf('en') === 0 ? en : zh)(key);
      }

      function translateKey(key) {
        var value = activeTranslate(key);
        if (value !== key && value !== undefined && value !== null && value !== '') return value;
        return ownDictT(key);
      }

      var LIFECYCLE_TONE = {
        recording: 'ok',
        connecting: 'warn',
        stopping: 'warn',
        error: 'error',
        ended: 'warn',
        summarized: 'info',
        mindmapped: 'ok',
      };
      var LIFECYCLE_LABEL = {
        recording: 'statusLive',
        connecting: 'statusConnecting',
        stopping: 'statusStopping',
        error: 'statusError',
        ended: 'statusEnded',
        summarized: 'statusSummarized',
        mindmapped: 'statusMindmapped',
      };
      var LIFECYCLE_HINT = {
        connecting: 'connecting',
        recording: 'hintRecording',
        stopping: 'stopping',
        ended: 'hintEnded',
        summarized: 'hintSummarized',
        mindmapped: 'hintMindmapped',
      };

      var statusStore = {
        snapshot: {
          phase: 'idle',
          id: '',
          title: '',
          elapsedSeconds: 0,
          sentenceCount: 0,
          error: '',
          latest: null,
          lifecycle: 'idle',
        },
        seenId: '',
        trackId: '',
        listeners: [],
        timer: null,
        inflight: false,
        visibilityBound: false,
      };

      var SEEN_KEY = 'dsh-meeting-mode:seenId';

      function readSeenId() {
        try {
          return String(window.localStorage.getItem(SEEN_KEY) || '');
        } catch (ignored) {
          return '';
        }
      }

      /* 看过会议详情就把侧栏的「已结束/已总结/脑图已生成」提示清掉（未读语义）。
         记到 localStorage：刷新页面后对已看过的会议也不再复读。 */
      function markSeen(id) {
        statusStore.seenId = typeof id === 'string' ? id : '';
        try {
          if (statusStore.seenId === '') window.localStorage.removeItem(SEEN_KEY);
          else window.localStorage.setItem(SEEN_KEY, statusStore.seenId);
        } catch (ignored) {}
        var next = normalizeStatus(statusStore.snapshot, statusStore.snapshot.latest);
        if (statusEquals(statusStore.snapshot, next)) return;
        statusStore.snapshot = next;
        statusNotify(next);
      }

      statusStore.seenId = readSeenId();

      function lifecycleOf(phase, latest) {
        if (phase === 'connecting' || phase === 'recording' || phase === 'stopping' || phase === 'error') return phase;
        var row = latest;
        if (row === null || typeof row !== 'object') return 'idle';
        if (typeof row.id === 'string' && row.id !== '' && row.id === statusStore.seenId) return 'idle';
        var files = Array.isArray(row.files) ? row.files : [];
        if (files.indexOf('脑图.html') !== -1) return 'mindmapped';
        if (files.indexOf('会议纪要.md') !== -1 || files.indexOf('会议纪要.docx') !== -1) return 'summarized';
        if (files.indexOf('转写全文.txt') !== -1 && row.stoppedAt) return 'ended';
        return 'idle';
      }

      function statusTone(snapshot) {
        return LIFECYCLE_TONE[snapshot.lifecycle] || '';
      }

      function statusLabel(snapshot) {
        var key = LIFECYCLE_LABEL[snapshot.lifecycle];
        return key ? translateKey(key) : '';
      }

      function statusHint(snapshot) {
        var key = LIFECYCLE_HINT[snapshot.lifecycle];
        return key ? translateKey(key) : '';
      }

      function statusColorOf(tone) {
        if (tone === 'ok') return 'var(--dsw-alias-state-success-primary)';
        if (tone === 'warn') return 'var(--dsw-alias-state-warn-primary)';
        if (tone === 'error') return 'var(--dsw-alias-state-error-primary)';
        if (tone === 'info') return 'var(--dsw-alias-brand-primary)';
        return 'var(--dsw-alias-label-secondary)';
      }

      function statusTooltip(snapshot) {
        var label = statusLabel(snapshot);
        if (label === '') return '';
        var parts = [translateKey('panelTitle'), label];
        var active = snapshot.lifecycle === 'recording' || snapshot.lifecycle === 'connecting' || snapshot.lifecycle === 'stopping';
        var title = active ? snapshot.title : (snapshot.latest && snapshot.latest.title) || snapshot.title;
        if (title) parts.push(title);
        if (active) parts.push(fmtClock(snapshot.elapsedSeconds));
        if (snapshot.lifecycle === 'error' && snapshot.error) parts.push(snapshot.error);
        return parts.join(' · ');
      }

      function normalizeLatest(raw) {
        if (raw === null || typeof raw !== 'object') return null;
        return {
          id: typeof raw.id === 'string' ? raw.id : '',
          title: typeof raw.title === 'string' ? raw.title : '',
          startedAt: Number(raw.startedAt) || 0,
          stoppedAt: Number(raw.stoppedAt) || 0,
          files: Array.isArray(raw.files) ? raw.files.map(String) : [],
          minutesStatus: typeof raw.minutesStatus === 'string' ? raw.minutesStatus : 'none',
          diarized: raw.diarized === true,
        };
      }

      function normalizeStatus(active, latest) {
        var source = active || {};
        var latestRow = normalizeLatest(latest);
        var phase = typeof source.phase === 'string' && source.phase !== '' ? source.phase : 'idle';
        var snapshot = {
          phase: phase,
          id: typeof source.id === 'string' ? source.id : '',
          title: typeof source.title === 'string' ? source.title : '',
          elapsedSeconds: Number(source.elapsedSeconds) || 0,
          sentenceCount: Number(source.sentenceCount) || 0,
          error: typeof source.error === 'string' ? source.error : '',
          latest: latestRow,
          lifecycle: 'idle',
        };
        snapshot.lifecycle = lifecycleOf(phase, latestRow);
        return snapshot;
      }

      function statusEquals(a, b) {
        if (a.phase !== b.phase || a.id !== b.id || a.title !== b.title) return false;
        if (a.elapsedSeconds !== b.elapsedSeconds || a.sentenceCount !== b.sentenceCount || a.error !== b.error) return false;
        if (a.lifecycle !== b.lifecycle) return false;
        var x = a.latest;
        var y = b.latest;
        if (x === null || y === null) return x === y;
        return x.id === y.id && x.title === y.title && x.startedAt === y.startedAt && x.stoppedAt === y.stoppedAt
          && x.minutesStatus === y.minutesStatus && x.diarized === y.diarized
          && x.files.join('|') === y.files.join('|');
      }

      function statusNotify(next) {
        var listeners = statusStore.listeners.slice();
        for (var i = 0; i < listeners.length; i += 1) {
          try {
            listeners[i](next);
          } catch (ignored) {
            /* 单个订阅者出错不影响其他订阅者 */
          }
        }
      }

      function reconcileMic(next) {
        if (micStore.capture === null) return;
        var live = next.phase === 'connecting' || next.phase === 'recording' || next.phase === 'stopping';
        if (!live || (next.id !== '' && micStore.capture.meetingId !== next.id)) micStop();
      }

      function statusApply(active, latest) {
        var next = normalizeStatus(active, latest === undefined ? statusStore.snapshot.latest : latest);
        if (next.phase === 'connecting' || next.phase === 'recording' || next.phase === 'stopping') {
          statusStore.trackId = next.id || statusStore.trackId;
        } else if (next.phase === 'idle' || next.phase === 'finished') {
          statusStore.trackId = '';
        }
        if (statusEquals(statusStore.snapshot, next)) return false;
        statusStore.snapshot = next;
        statusNotify(next);
        reconcileMic(next);
        statusSchedule();
        return true;
      }

      function statusPoll() {
        if (statusStore.inflight) return;
        try {
          if (document.hidden) return;
        } catch (ignored) {}
        statusStore.inflight = true;
        /* 跟踪当前会议：出过错的会议不在 activeRecord 里，必须带 id 才查得到 */
        var tracked = statusStore.trackId;
        var stateUrl = tracked
          ? '/state?id=' + encodeURIComponent(tracked) + '&since=1000000'
          : '/state?since=1000000';
        api(stateUrl).then(function (active) {
          var phase = active && typeof active.phase === 'string' ? active.phase : 'idle';
          var live = phase === 'connecting' || phase === 'recording' || phase === 'stopping' || phase === 'error';
          if (live) {
            statusStore.inflight = false;
            statusApply(active, statusStore.snapshot.latest);
            return null;
          }
          return api('/meetings?brief=1').then(function (data) {
            statusStore.inflight = false;
            var rows = data && Array.isArray(data.meetings) ? data.meetings : [];
            statusApply(active || { phase: 'idle' }, rows.length > 0 ? rows[0] : null);
          });
        }).catch(function () {
          statusStore.inflight = false;
        });
      }

      function statusSchedule() {
        if (statusStore.timer !== null) {
          clearInterval(statusStore.timer);
          statusStore.timer = null;
        }
        if (statusStore.listeners.length === 0) return;
        var phase = statusStore.snapshot.phase;
        var active = phase === 'connecting' || phase === 'recording' || phase === 'stopping';
        statusStore.timer = setInterval(statusPoll, active ? STATUS_TICK_ACTIVE : STATUS_TICK_IDLE);
      }

      function statusSubscribe(listener) {
        statusStore.listeners.push(listener);
        if (!statusStore.visibilityBound) {
          statusStore.visibilityBound = true;
          try {
            document.addEventListener('visibilitychange', function () {
              if (!document.hidden) statusPoll();
            });
          } catch (ignored) {}
        }
        if (statusStore.listeners.length === 1) {
          statusSchedule();
          statusPoll();
        }
        return function () {
          var index = statusStore.listeners.indexOf(listener);
          if (index !== -1) statusStore.listeners.splice(index, 1);
          if (statusStore.listeners.length === 0) statusSchedule();
        };
      }

      function useMeetingStatus() {
        var state = useState(statusStore.snapshot);
        var snapshot = state[0];
        var setSnapshot = state[1];
        useEffect(function () {
          var unsubscribe = statusSubscribe(setSnapshot);
          setSnapshot(statusStore.snapshot);
          return unsubscribe;
        }, []);
        return snapshot;
      }

      /* ------------------------------------------------------------ 麦克风（页面级，不随面板卸载） */

      /*
       * 之前麦克风生命周期挂在面板组件上：切换会话时面板卸载，effect 清理把
       * MicCapture 停了，转写自然就断。现在改成模块级单例：只有「结束会议」
       * 或会议被宿主判定结束时才停；切到别的会话/面板继续收音。
       * 实例同时挂到 window 上一个固定 key，插件热重载/重新执行模块时可以接管，
       * 不会出现旧实例还在偷偷上送、或重载后必须手动重连的情况。
       */

      var CAPTURE_KEY = '__dshMeetingMicCapture__';

      var micStore = {
        snapshot: { status: 'off', level: 0, meetingId: '' },
        capture: null,
        listeners: [],
      };

      function micNotify() {
        var listeners = micStore.listeners.slice();
        for (var i = 0; i < listeners.length; i += 1) {
          try {
            listeners[i](micStore.snapshot);
          } catch (ignored) {}
        }
      }

      function micApply(patch) {
        var current = micStore.snapshot;
        var next = {
          status: patch.status === undefined ? current.status : patch.status,
          level: patch.level === undefined ? current.level : patch.level,
          meetingId: patch.meetingId === undefined ? current.meetingId : patch.meetingId,
        };
        if (next.status === current.status && next.level === current.level && next.meetingId === current.meetingId) return;
        micStore.snapshot = next;
        micNotify();
      }

      function micStop() {
        var capture = micStore.capture;
        micStore.capture = null;
        if (capture !== null) {
          try {
            capture.stop();
          } catch (ignored) {}
        }
        try {
          if (window[CAPTURE_KEY] === capture) delete window[CAPTURE_KEY];
        } catch (ignored) {}
        micApply({ status: 'off', level: 0 });
      }

      function micStart(meetingId, initialSeq) {
        if (micStore.capture !== null && micStore.capture.meetingId === meetingId) return;
        micStop();
        micApply({ status: 'requesting', meetingId: meetingId });
        var capture = new MicCapture(meetingId);
        capture.onLevel = function (value) {
          micApply({ level: value });
        };
        micStore.capture = capture;
        try {
          window[CAPTURE_KEY] = capture;
        } catch (ignored) {}
        capture.start(initialSeq).then(function () {
          if (micStore.capture !== capture) return;
          micApply({ status: 'on', level: 0 });
        }).catch(function (err) {
          if (micStore.capture === capture) {
            micStore.capture = null;
            try {
              if (window[CAPTURE_KEY] === capture) delete window[CAPTURE_KEY];
            } catch (ignored) {}
          }
          micApply({ status: err && err.message === 'UNSUPPORTED' ? 'unsupported' : 'denied' });
        });
      }

      /** 接管上一个模块实例留下的麦克风（插件热重载时无感续用）。 */
      function micAdopt() {
        var capture = null;
        try {
          capture = window[CAPTURE_KEY] || null;
        } catch (ignored) {}
        if (capture === null || typeof capture.stop !== 'function') return;
        micStore.capture = capture;
        capture.onLevel = function (value) {
          micApply({ level: value });
        };
        micApply({ status: 'on', meetingId: typeof capture.meetingId === 'string' ? capture.meetingId : '' });
      }

      function useMicStatus() {
        var state = useState(micStore.snapshot);
        var snapshot = state[0];
        var setSnapshot = state[1];
        useEffect(function () {
          micStore.listeners.push(setSnapshot);
          setSnapshot(micStore.snapshot);
          return function () {
            var index = micStore.listeners.indexOf(setSnapshot);
            if (index !== -1) micStore.listeners.splice(index, 1);
          };
        }, []);
        return snapshot;
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
        header: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
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
        statusPill: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, lineHeight: '18px', padding: '1px 9px', borderRadius: 999, border: '1px solid currentColor', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
        statusClock: { fontSize: 11, opacity: 0.75 },
        diarizeBox: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 10px', borderRadius: 8, background: 'var(--dsw-alias-bg-layer-2)' },
        errorText: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 12 },
        badgeOk: { fontSize: 11, padding: '2px 8px', borderRadius: 999, border: '1px solid var(--dsw-alias-state-success-primary)', color: 'var(--dsw-alias-state-success-primary)' },
        iframe: { width: '100%', height: 460, border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 10, background: 'var(--dsw-alias-bg-base)' },
        pre: { whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: '21px', maxHeight: 320, overflowY: 'auto', background: 'var(--dsw-alias-bg-layer-2)', borderRadius: 8, padding: 12, margin: 0 },
        sectionLabel: { fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-secondary)' },
        todoItem: { fontSize: 13, lineHeight: '20px' },
      };

      var styleEl = null;
      function ensureStatusStyle() {
        if (styleEl !== null) return;
        try {
          styleEl = document.createElement('style');
          styleEl.dataset.plugin = NS;
          styleEl.textContent = [
            '@keyframes dsh-meeting-pulse { 0% { opacity: 1; } 50% { opacity: 0.35; } 100% { opacity: 1; } }',
            /* 侧栏行右侧的「转写中 / 连接中 / 异常」胶囊：宿主类名带构建哈希，
               所以只挂在自己写的 data 属性上，不依赖宿主 className。 */
            'button[' + ROW_STATUS_ATTR + ']::after{content:attr(' + ROW_STATUS_ATTR + ');flex:none;margin-left:auto;font-size:11px;line-height:16px;padding:0 7px;border-radius:999px;border:1px solid currentColor;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;max-width:96px;text-overflow:ellipsis;opacity:.95}',
            'button[' + ROW_TONE_ATTR + '="ok"]::after{color:var(--dsw-alias-state-success-primary)}',
            'button[' + ROW_TONE_ATTR + '="warn"]::after{color:var(--dsw-alias-state-warn-primary)}',
            'button[' + ROW_TONE_ATTR + '="error"]::after{color:var(--dsw-alias-state-error-primary)}',
          ].join('\n');
          document.head.appendChild(styleEl);
        } catch (ignored) {
          styleEl = null;
        }
      }

      /* ------------------------------------------------------------ 图标 */

      /* 把状态同步到侧栏那一行（宿主侧栏行是 <button>）：
         - 彩色小圆点画在图标右下角，跟随图标自己重渲染；
         - 「转写中」文字胶囊由 CSS ::after 绘制（见 ensureStatusStyle），
           收起成 56px 轨道时按钮只有 36px 宽，不写文字，避免撑破行高。 */
      function applyRowStatus(iconEl, snapshot, size) {
        if (iconEl === null || typeof iconEl.closest !== 'function') return;
        var row = iconEl.closest('button');
        if (row === null) return;
        var tone = statusTone(snapshot);
        if (tone === '') {
          row.removeAttribute(ROW_STATUS_ATTR);
          row.removeAttribute(ROW_TONE_ATTR);
          return;
        }
        row.setAttribute(ROW_TONE_ATTR, tone);
        var label = statusLabel(snapshot);
        var wide = size === 16 || row.clientWidth > 80;
        if (wide && label !== '') row.setAttribute(ROW_STATUS_ATTR, label);
        else row.removeAttribute(ROW_STATUS_ATTR);
      }

      function PanelIcon(props) {
        var size = props && typeof props.size === 'number' && isFinite(props.size) ? props.size : 22;
        var snapshot = useMeetingStatus();
        var tone = statusTone(snapshot);
        var color = statusColorOf(tone);
        var tip = statusTooltip(snapshot);
        var dotSize = Math.max(6, Math.round(size * 0.36));
        var iconRef = useRef(null);

        useEffect(function () {
          ensureStatusStyle();
          applyRowStatus(iconRef.current, snapshot, size);
          return function () {
            var node = iconRef.current;
            if (node === null || typeof node.closest !== 'function') return;
            var row = node.closest('button');
            if (row !== null) {
              row.removeAttribute(ROW_STATUS_ATTR);
              row.removeAttribute(ROW_TONE_ATTR);
            }
          };
        }, [snapshot.lifecycle, snapshot.id, snapshot.title, snapshot.elapsedSeconds, snapshot.latest, size]);

        return h('span', {
          ref: iconRef,
          /* 收起轨道（18px）里宿主自带 Tooltip，别再叠一个原生 title */
          title: tip === '' || size === 18 ? undefined : tip,
          style: { position: 'relative', display: 'inline-flex', width: size, height: size, flex: 'none' },
        },
        h('svg', {
          viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': true,
        },
        h('path', { d: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z', fill: 'currentColor' }),
        h('path', {
          d: 'M6 11a6 6 0 0 0 12 0M12 17v4M8.5 21h7',
          fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        })),
        tone === ''
          ? null
          : h('span', {
            'aria-hidden': true,
            style: {
              position: 'absolute', right: -1, bottom: -1,
              width: dotSize, height: dotSize, borderRadius: '50%',
              background: color,
              boxShadow: '0 0 0 2px var(--dsw-specific-sidebar-fill)',
              animation: 'dsh-meeting-pulse 1.6s ease-in-out infinite',
            },
          }));
      }

      /* ------------------------------------------------------------ 面板 */

      function MeetingPanel(props) {
        var baseT = typeof props.t === 'function' ? props.t : makeT(zh);
        /* locale 词典在长驻页面热重载时可能是旧版：查不到 key 就回退到本模块自带词典 */
        var t = function (key) {
          var value = baseT(key);
          if (value !== key && value !== undefined && value !== null && value !== '') return value;
          return ownDictT(key);
        };
        activeTranslate = baseT;

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
        var micSnapshot = useMicStatus();
        var mic = micSnapshot.status; // off|requesting|on|denied|unsupported
        var level = micSnapshot.level;
        var showTranscriptState = useState(false);
        var showTranscript = showTranscriptState[0];
        var setShowTranscript = showTranscriptState[1];
        var diarizeStatusState = useState('none'); // none|uploading|transcribing|aligning|done|error
        var diarizeStatus = diarizeStatusState[0];
        var setDiarizeStatus = diarizeStatusState[1];
        var diarizeErrorState = useState('');
        var diarizeError = diarizeErrorState[0];
        var setDiarizeError = diarizeErrorState[1];
        var speakersState = useState([]);
        var speakers = speakersState[0];
        var setSpeakers = speakersState[1];
        var integrationsState = useState(null); // { memory: 'ok'|'absent'|'locked', weknora: 'ok'|'absent' }
        var integrations = integrationsState[0];
        var setIntegrations = integrationsState[1];
        var kbSaveState = useState('idle'); // idle|saving|done|error
        var kbSave = kbSaveState[0];
        var setKbSave = kbSaveState[1];
        var kbResultState = useState('');
        var kbResult = kbResultState[0];
        var setKbResult = kbResultState[1];
        var memSaveState = useState('idle');
        var memSave = memSaveState[0];
        var setMemSave = memSaveState[1];
        var memResultState = useState('');
        var memResult = memResultState[0];
        var setMemResult = memResultState[1];

        var sinceRef = useRef(0);
        var meetingRef = useRef(null);
        var listRef = useRef(null);
        var wrapRef = useRef(null);

        meetingRef.current = meeting;
        /* 面板也订阅共享状态：标题行的状态徽标用同一份数据 */
        var statusSnapshot = useMeetingStatus();

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

        /* 看过详情 → 侧栏那颗「待处理」提示熄灭 */
        useEffect(function () {
          if (phase !== 'stopped') return;
          var current = meetingRef.current;
          if (current === null || current.id === '') return;
          markSeen(current.id);
        }, [phase, meeting === null ? '' : meeting.id]);

        function applySnapshot(st) {
          if (!st || st.phase === 'idle') return false;
          /* 面板拿到的快照也推给侧栏：切换/返回面板时状态能立刻同步，不用等下一次轮询。
             注意 finished 是「这条历史记录已结束」，不代表宿主没有别的进行中会议，
             所以不往共享状态里推，交给侧栏自己的轮询判断。 */
          if (st.phase !== 'finished') statusApply(st);
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
          if (Array.isArray(st.files) && st.files.length > 0) setFiles(st.files);
          if (typeof st.diarizeStatus === 'string' && st.diarizeStatus !== '') setDiarizeStatus(st.diarizeStatus);
          if (Array.isArray(st.speakers)) setSpeakers(st.speakers);
          if (typeof st.diarizeError === 'string' && st.diarizeError !== '') setDiarizeError(st.diarizeError);
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
          ensureStatusStyle();
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

        /* 事后处理轮询：区分发言人是后台任务，靠 /state 看进度 */
        useEffect(function () {
          if (phase !== 'stopped') return undefined;
          if (diarizeStatus !== 'uploading' && diarizeStatus !== 'transcribing' && diarizeStatus !== 'aligning') return undefined;
          var disposed = false;
          var current = meetingRef.current;
          if (current === null) return undefined;
          function tick() {
            api('/state?id=' + encodeURIComponent(current.id)).then(function (st) {
              if (disposed || !st) return;
              if (st.diarizeStatus) setDiarizeStatus(st.diarizeStatus);
              if (Array.isArray(st.speakers)) setSpeakers(st.speakers);
              if (st.diarizeError) setDiarizeError(st.diarizeError);
              if (st.diarizeStatus === 'done') {
                api('/meetings').then(function (data) {
                  if (!disposed) setHistory((data && data.meetings) || []);
                }).catch(function () {});
              }
            }).catch(function () {});
          }
          var timer = setInterval(tick, 3000);
          tick();
          return function () {
            disposed = true;
            clearInterval(timer);
          };
        }, [phase, diarizeStatus]);

        /* 沉淀目标探测：记忆走 mneme 面板 API（与 GUI 同源），知识库由宿主探 WeKnora */
        useEffect(function () {
          if (phase !== 'stopped') return undefined;
          var disposed = false;
          fetch('/api/dsh-mneme/health').then(function (res) {
            if (disposed) return;
            var state = res.status === 200 ? 'ok' : res.status === 404 ? 'absent' : 'locked';
            setIntegrations(function (prev) { return Object.assign({}, prev, { memory: state }); });
          }).catch(function () {
            if (!disposed) setIntegrations(function (prev) { return Object.assign({}, prev, { memory: 'absent' }); });
          });
          api('/integrations').then(function (data) {
            if (disposed) return;
            var weknora = data && data.weknora ? data.weknora : null;
            setIntegrations(function (prev) { return Object.assign({}, prev, { weknora: weknora && weknora.available ? 'ok' : 'absent' }); });
          }).catch(function () {
            if (!disposed) setIntegrations(function (prev) { return Object.assign({}, prev, { weknora: 'absent' }); });
          });
          return function () { disposed = true; };
        }, [phase]);

        /* 麦克风归 micStore 所有：面板卸载不再停收音，切走会话继续转写 */

        function startMic(id, initialSeq) {
          micStart(id, initialSeq);
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
            statusApply({ phase: 'connecting', id: data.id, title: data.title || title });
            startMic(data.id, 0);
          }).catch(function (err) {
            setError(err.message);
            setPhase('idle');
            statusPoll();
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
          micStop();
          api('/stop', { method: 'POST', body: { id: current.id } }).then(function (data) {
            setPhase('stopped');
            setFiles((data && data.files) || null);
            statusApply({ phase: 'idle' });
            statusPoll();
            api('/meetings').then(function (list) { setHistory((list && list.meetings) || []); }).catch(function () {});
          }).catch(function (err) {
            setError(err.message);
            setPhase('recording');
            statusPoll();
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
            statusPoll();
            api('/meetings').then(function (list) { setHistory((list && list.meetings) || []); }).catch(function () {});
          }).catch(function (err) {
            setMinutesStatus('error');
            setError(err.message);
          });
        }

        function generateMindmap() {
          var current = meetingRef.current;
          if (current === null) return;
          setError('');
          api('/mindmap', { method: 'POST', body: { id: current.id } }).then(function (data) {
            setFiles((data && data.files) || files);
            statusPoll();
            api('/meetings').then(function (list) { setHistory((list && list.meetings) || []); }).catch(function () {});
          }).catch(function (err) {
            setError(err.message);
          });
        }

        function diarize() {
          var current = meetingRef.current;
          if (current === null) return;
          setError('');
          setDiarizeError('');
          setDiarizeStatus('uploading');
          api('/diarize', { method: 'POST', body: { id: current.id } }).then(function (data) {
            if (data && data.status) setDiarizeStatus(data.status);
          }).catch(function (err) {
            setDiarizeStatus('error');
            setDiarizeError(err.message);
          });
        }

        function saveToKnowledge() {
          var current = meetingRef.current;
          if (current === null) return;
          setKbSave('saving');
          setKbResult('');
          api('/save', { method: 'POST', body: { id: current.id, target: 'weknora' } }).then(function (data) {
            setKbSave('done');
            setKbResult(data && data.knowledge_id ? 'knowledge_id: ' + data.knowledge_id : '');
          }).catch(function (err) {
            setKbSave('error');
            setKbResult(err.message);
          });
        }

        function saveToMemory() {
          var current = meetingRef.current;
          if (current === null || minutes === null) return;
          setMemSave('saving');
          setMemResult('');
          var datePart = current.id.slice(0, 8);
          var dateText = datePart.length === 8 ? datePart.slice(0, 4) + '-' + datePart.slice(4, 6) + '-' + datePart.slice(6, 8) : '';
          var lines = ['【会议纪要】' + (minutes.title || current.title) + (dateText !== '' ? '（' + dateText + '）' : '')];
          lines.push('会议ID：' + current.id + '（会议模式输出目录内）');
          lines.push('');
          lines.push('## 摘要');
          (Array.isArray(minutes.summary) ? minutes.summary : []).forEach(function (item) { lines.push('- ' + item); });
          if (Array.isArray(minutes.decisions) && minutes.decisions.length > 0) {
            lines.push('');
            lines.push('## 决议事项');
            minutes.decisions.forEach(function (item) { lines.push('- ' + item); });
          }
          if (Array.isArray(minutes.todos) && minutes.todos.length > 0) {
            lines.push('');
            lines.push('## 待办事项');
            minutes.todos.forEach(function (item) {
              lines.push('- [ ] ' + item.task + '（负责人：' + (item.owner || '未明确') + (item.due && item.due !== '未明确' ? '，截止：' + item.due : '') + '）');
            });
          }
          fetch('/api/dsh-mneme/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'project',
              title: '会议纪要：' + (minutes.title || current.title),
              content: lines.join('\n'),
              importance: 3,
              tags: ['会议', '会议纪要'],
            }),
          }).then(function (res) {
            return res.text().then(function (text) {
              var data = null;
              try {
                data = text ? JSON.parse(text) : null;
              } catch (ignored) {
                data = null;
              }
              if (res.status === 200 || res.status === 201) {
                setMemSave('done');
                setMemResult(data && data.action === 'merged' ? t('savedMemoryMerged') : t('savedMemoryCreated'));
                return;
              }
              if (res.status === 404) throw new Error(t('notInstalledMemory'));
              if (res.status === 401) throw new Error(t('memoryTokenLocked'));
              throw new Error((data && data.error) || 'HTTP ' + res.status);
            });
          }).catch(function (err) {
            setMemSave('error');
            setMemResult(err.message);
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
          var hasMinutes = Array.isArray(row.files)
            && (row.files.indexOf('会议纪要.md') !== -1 || row.files.indexOf('会议纪要.docx') !== -1);
          setFiles(Array.isArray(row.files) && row.files.length > 0 ? row.files : null);
          setMinutesStatus(hasMinutes ? 'done' : 'none');
          setMinutes(row.minutes !== null && typeof row.minutes === 'object' && Array.isArray(row.minutes.summary) ? row.minutes : null);
          setDiarizeStatus(row.diarized === true ? 'done' : 'none');
          setDiarizeError('');
          setSpeakers(Array.isArray(row.speakers) ? row.speakers : []);
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
          var headerTone = statusTone(statusSnapshot);
          var headerLabel = statusLabel(statusSnapshot);
          var headerHint = statusHint(statusSnapshot) || t('panelHint');
          var headerLive = statusSnapshot.lifecycle === 'recording';
          children.push(h('div', { key: 'header', style: S.header },
            h(PanelIcon, { key: 'icon' }),
            h('div', { key: 'title', style: S.title }, t('panelTitle')),
            /* 徽标把状态说清楚：绿=转写中、琥珀=连接/收尾/已结束、蓝=已总结、红=异常 */
            headerTone === ''
              ? null
              : h('span', {
                key: 'status',
                style: Object.assign({}, S.statusPill, { color: statusColorOf(headerTone) }),
              },
              h('span', {
                key: 'dot',
                style: {
                  width: 7, height: 7, borderRadius: '50%', background: 'currentColor',
                  animation: headerLive ? 'dsh-meeting-pulse 1.6s ease-in-out infinite' : 'none',
                },
              }),
              headerLabel,
              headerLive ? h('span', { key: 'clock', style: S.statusClock }, fmtClock(elapsed)) : null),
            h('div', { key: 'hint', style: S.hint }, headerHint)));
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
                var rowFiles = Array.isArray(row.files) ? row.files : [];
                var rowState = rowFiles.indexOf('脑图.html') !== -1
                  ? 'mindmapped'
                  : (rowFiles.indexOf('会议纪要.md') !== -1 || rowFiles.indexOf('会议纪要.docx') !== -1)
                    ? 'summarized'
                    : rowFiles.indexOf('转写全文.txt') !== -1
                      ? 'ended'
                      : 'recording';
                var rowTone = LIFECYCLE_TONE[rowState] || '';
                return h('div', { key: row.id || index, style: S.historyRow, onClick: function () { openHistory(row); } },
                  h('div', { key: 'left' },
                    h('div', { style: S.historyTitle }, row.title),
                    h('div', { style: S.historyMeta }, fmtTime(row.startedAt) + (row.speakers && row.speakers.length > 0 ? ' · ' + row.speakers.join(' / ') : ''))),
                  h('div', { key: 'right', style: S.row },
                    h('span', { style: Object.assign({}, S.badge, { color: statusColorOf(rowTone), borderColor: 'currentColor' }) },
                      t(LIFECYCLE_LABEL[rowState])),
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
          var fileLabels = {
            '会议纪要.docx': t('fileMinutesDoc'),
            '会议纪要.md': t('fileMinutesMd'),
            '脑图.html': t('fileMindmap'),
            '转写全文.txt': t('fileTranscript'),
            '音频.wav': t('fileAudio'),
          };
          var order = ['会议纪要.docx', '脑图.html', '会议纪要.md', '转写全文.txt', '音频.wav'];
          order.forEach(function (name) {
            if (knownFiles.indexOf(name) === -1) return;
            fileRows.push(h('div', { key: name, style: S.fileRow },
              h('span', { style: S.fileName }, fileLabels[name] || name),
              h('a', { href: fileUrl(meeting.id, name), download: name, style: Object.assign({}, S.textBtn, { textDecoration: 'none' }) }, t('download'))));
          });

          var hasMinutes = knownFiles.indexOf('会议纪要.md') !== -1 || knownFiles.indexOf('会议纪要.docx') !== -1;
          var hasMindmap = knownFiles.indexOf('脑图.html') !== -1;
          var hasAudio = knownFiles.indexOf('音频.wav') !== -1;
          var resultLifecycle = hasMindmap ? 'mindmapped' : hasMinutes ? 'summarized' : 'ended';
          var resultTone = resultLifecycle === 'mindmapped' ? 'ok' : resultLifecycle === 'summarized' ? 'info' : 'warn';
          var resultLabel = t(resultLifecycle === 'mindmapped' ? 'statusMindmapped' : resultLifecycle === 'summarized' ? 'statusSummarized' : 'statusEnded');
          var resultHint = t(resultLifecycle === 'mindmapped' ? 'hintMindmapped' : resultLifecycle === 'summarized' ? 'hintSummarized' : 'hintEnded');
          var diarizeBusy = diarizeStatus === 'uploading' || diarizeStatus === 'transcribing' || diarizeStatus === 'aligning';
          var diarizeProgress = diarizeStatus === 'uploading' ? t('diarizeUploading') : diarizeStatus === 'transcribing' ? t('diarizeTranscribing') : t('diarizeAligning');
          var kbState = integrations === null ? null : (integrations.weknora || null);
          var memState = integrations === null ? null : (integrations.memory || null);

          children.push(h('div', { key: 'result', style: S.card },
            h('div', { key: 'row', style: S.row },
              h('span', { key: 'stat', style: S.stat }, t('elapsedLabel') + ' ' + fmtClock(elapsed) + ' · ' + t('audioLabel') + ' ' + fmtClock(audioSeconds) + ' · ' + sentences.length + t('sentenceUnit'))),
            h('div', { key: 'lifecycle', style: S.row },
              h('span', { style: Object.assign({}, S.statusPill, { color: statusColorOf(resultTone) }) },
                h('span', { style: { width: 7, height: 7, borderRadius: '50%', background: 'currentColor' } }),
                resultLabel),
              h('span', { key: 'hint', style: S.hint }, resultHint)),

            /* 说话人分离：用录音离线重跑，耗时几分钟，做成独立一步 */
            diarizeStatus === 'done'
              ? h('div', { key: 'diarize', style: S.diarizeBox },
                h('span', { key: 'badge', style: S.badgeOk }, t('diarizeDone')),
                speakers.length > 0 ? h('span', { key: 'who', style: S.stat }, speakers.join(' · ')) : null)
              : diarizeBusy
                ? h('div', { key: 'diarize', style: S.diarizeBox },
                  h('span', { key: 'busy', style: S.stat }, t('diarizing')),
                  h('span', { key: 'step', style: S.statusClock }, diarizeProgress))
                : hasAudio
                  ? h('div', { key: 'diarize', style: S.diarizeBox },
                    h('button', { key: 'btn', style: S.ghostBtn, onClick: diarize }, diarizeStatus === 'error' ? t('retry') : t('diarize')),
                    h('span', { key: 'hint', style: S.hint }, t('diarizeHint')),
                    diarizeStatus === 'error' && diarizeError
                      ? h('div', { key: 'err', style: S.errorBox }, t('diarizeFailed') + '：' + diarizeError)
                      : null)
                  : null,

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
            minutesStatus === 'done' && !hasMindmap
              ? h('div', { key: 'mindmapPending', style: S.row },
                h('button', { key: 'genMm', style: S.primaryBtn, onClick: generateMindmap }, t('generateMindmap')),
                h('span', { key: 'hint', style: S.hint }, t('mindmapPending')))
              : null,
            fileRows.length > 0
              ? h('div', { key: 'files', style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                minutesStatus === 'done' ? h('div', { key: 'ready', style: S.hint }, t('minutesReady')) : null,
                fileRows,
                minutesStatus === 'done'
                  ? h('div', { key: 'regen', style: S.row },
                    h('button', { key: 'min', style: S.ghostBtn, onClick: generateMinutes }, t('regenMinutes')),
                    hasMindmap ? h('button', { key: 'mm', style: S.ghostBtn, onClick: generateMindmap }, t('regenMindmap')) : null)
                  : null)
              : null,
            /* 沉淀归档：纪要一键进知识库 / 记忆；对应插件没装就明说 */
            h('div', { key: 'archive', style: S.diarizeBox },
              h('span', { key: 'label', style: S.sectionLabel }, t('saveSection')),
              !hasMinutes
                ? h('span', { key: 'need', style: S.hint }, t('needMinutesForSave'))
                : h('span', { key: 'row', style: S.row },
                  kbState === 'ok'
                    ? h('button', {
                      key: 'kb',
                      style: kbSave === 'done' ? S.ghostBtn : S.primaryBtn,
                      onClick: saveToKnowledge,
                      disabled: kbSave === 'saving' || kbSave === 'done',
                    },
                    kbSave === 'saving' ? t('saveSaving') : kbSave === 'done' ? t('savedKb') : t('saveKb'))
                    : h('span', { key: 'kbna', style: S.stat }, kbState === null ? t('probeHint') : t('notInstalledKb')),
                  memState === 'ok'
                    ? h('button', {
                      key: 'mem',
                      style: memSave === 'done' ? S.ghostBtn : S.primaryBtn,
                      onClick: saveToMemory,
                      disabled: memSave === 'saving' || memSave === 'done',
                    },
                    memSave === 'saving' ? t('saveSaving') : memSave === 'done' ? (memResult || t('savedMemoryCreated')) : t('saveMemory'))
                    : h('span', { key: 'memna', style: S.stat }, memState === 'locked' ? t('memoryTokenLocked') : memState === null ? t('probeHint') : t('notInstalledMemory')),
                  kbSave === 'done' && kbResult !== '' ? h('span', { key: 'kbr', style: S.statusClock }, kbResult) : null,
                  kbSave === 'error' ? h('span', { key: 'kbe', style: S.errorText }, kbResult) : null,
                  memSave === 'error' ? h('span', { key: 'meme', style: S.errorText }, memResult) : null),
              hasMinutes ? h('span', { key: 'hint', style: S.hint }, t('kbHint') + '；' + t('memoryHint')) : null),

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
              ? h('iframe', { key: 'txt-' + diarizeStatus, style: Object.assign({}, S.iframe, { height: 320 }), src: fileUrl(meeting.id, '转写全文.txt'), title: 'transcript' })
              : null));
        } else if (phase === 'error') {
          children.push(h('div', { key: 'errCard', style: S.card },
            h('div', { style: S.errorBox }, t('errorTitle') + '：' + error)));
        }

        return h('div', { ref: wrapRef, style: S.wrap }, children);
      }

      /* ------------------------------------------------------------ 注册 */

      /* 插件热重载/重新执行模块时，接管仍在运行的麦克风，避免转写中断 */
      micAdopt();

      exports.inject = ['slots', 'locale'];

      exports.apply = function (ctx) {
        try {
          if (ctx.locale && typeof ctx.locale.register === 'function') {
            ctx.locale.register(NS, { zh: zh, en: en });
          }
          /* 侧栏图标不经过主面板也可能显示状态，语言直接从 locale 服务取 */
          if (ctx.locale && typeof ctx.locale.bind === 'function') {
            var bound = ctx.locale.bind(NS);
            if (typeof bound === 'function') activeTranslate = bound;
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
              /* 直接返回译文而不是裸 key：宿主的 resolveSlotLabel 在命名空间解析失败时
                 会把 key 原样显示出来（表现为侧栏名字变成 panelTitle），这里用函数
                 返回带兜底的中文/英文，不再依赖宿主的 key 翻译链路。 */
              label: function () { return translateKey('panelTitle'); },
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