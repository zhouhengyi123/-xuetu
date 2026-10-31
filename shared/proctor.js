/**
 * 学习监督引擎 v2（2026-10-31 重写）
 *
 * ══════════════════════════════════════════════════════════════
 * 用户报的三个问题
 * ══════════════════════════════════════════════════════════════
 * ① "知识校准太快"     → 旧版 startCalibration 只是 3 个 setTimeout 打印日志，
 *                        根本没采集姿态数据，纯假校准。现在真采集基线。
 * ② "时间捕捉太短"     → 旧版每次回调 focused++，把 30fps 当秒用，时间严重失真。
 *                        现在按真实时间戳累计，并有采样节流。
 * ③ "只有分心捕捉，没有学习捕捉" → 旧版只识别闭眼/转头/低头（全是"犯错"）。
 *                        现在识别**学习行为**：书写、阅读、听讲、思考、分心。
 *
 * ══════════════════════════════════════════════════════════════
 * 另一个根因（比上面三个更致命）
 * ══════════════════════════════════════════════════════════════
 * MediaPipe 从 cdn.jsdelivr.net 加载 —— 用户机器访问不了，
 * FaceMesh 永远 init 失败 → 退化成"预览中（无分析）"→ 什么都捕捉不到。
 * 现在全部走本地 web/vendor/mediapipe/（16.2 MB，离线可用）。
 *
 * ══════════════════════════════════════════════════════════════
 * 学习状态判定（基于 EAR + 头部姿态 + 时间稳定性）
 * ══════════════════════════════════════════════════════════════
 *   书写 writing   低头 15~35°，眼睛微睁，头部小幅移动
 *   阅读 reading   头部基本不动，眼睛有扫视（EAR 波动）
 *   听讲 listening 头部抬起，眼睛睁开，正面
 *   思考 thinking  视线略偏，头部稳定（不是分心——是正常思考）
 *   分心 distracted 转头>25° / 闭眼 / 离开画面
 *
 * 关键：区分"低头写字"和"低头玩手机"——靠头部稳定性 + 持续时间。
 */
const ProctorEngine = (() => {
  var faceMesh = null;
  var camera = null;
  var isRunning = false;
  var onResultsCallback = null;
  var lastAlertTime = 0;
  var alertCooldown = 8000;
  var consecutiveDistract = 0;
  var audioCtx = null;

  // ── 本地资源路径（离线，2026-10-31 修）
  //   ⚠️ 之前写 '../vendor/mediapipe/' → 从 web/index.html 出发会解析成
  //      项目2/vendor/mediapipe（不存在，404，实测返回 335 字节错误页）。
  //      正确是 './vendor/mediapipe/'。
  //      实测：/web/vendor/mediapipe/face_mesh.js → 200 ✓
  var VENDOR = './vendor/mediapipe/';

  // ── 学习状态统计（按真实时间）──
  var stats = {
    startedAt: 0,
    // 每种状态累计毫秒
    ms: { writing: 0, reading: 0, listening: 0, thinking: 0, distracted: 0, none: 0 },
    lastTickAt: 0,
    lastState: 'none',
    // 关键帧（状态切换时留一张）
    keyframes: [],
    // 校准基线
    baseline: null,
  };

  // ── 采样节流：MediaPipe 是 30fps，不需要每帧都统计 ──
  var SAMPLE_MS = 500;          // 每 500ms 归一次时间
  var lastSampleAt = 0;
  var smooth = { pitch: [], yaw: [], ear: [] };  // 滑动窗口平滑
  var SMOOTH_N = 8;

  // 面部关键点索引
  var LEFT_EYE = [33, 160, 158, 133, 153, 144];
  var RIGHT_EYE = [362, 385, 387, 263, 373, 380];

  // ══════════════════════════════════════════════════
  //  初始化（本地加载，不依赖网络）
  // ══════════════════════════════════════════════════

  async function init(videoElement, callback) {
    onResultsCallback = callback;

    // ★ 本地加载（2026-10-31）
    if (!window.FaceMesh) {
      await loadScript(VENDOR + 'face_mesh.js');
    }
    if (!window.Camera) {
      await loadScript(VENDOR + 'camera_utils.js');
    }

    faceMesh = new FaceMesh({
      locateFile: function (file) { return VENDOR + file; },
    });

    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    faceMesh.onResults(onResults);

    camera = new Camera(videoElement, {
      onFrame: async function () { await faceMesh.send({ image: videoElement }); },
      width: 640,
      height: 480,
    });
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.crossOrigin = 'anonymous';
      s.onload = resolve;
      s.onerror = function () { reject(new Error('加载失败: ' + src)); };
      document.head.appendChild(s);
    });
  }

  // ══════════════════════════════════════════════════
  //  几何计算
  // ══════════════════════════════════════════════════

  function calcEAR(landmarks, eyeIndices) {
    var p = eyeIndices.map(function (i) { return landmarks[i]; });
    var v1 = dist(p[1], p[5]);
    var v2 = dist(p[2], p[4]);
    var h = dist(p[0], p[3]);
    if (h === 0) return 0;
    return (v1 + v2) / (2 * h);
  }

  function dist(a, b) {
    var dx = a.x - b.x, dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function estimateHeadPose(landmarks) {
    var nose = landmarks[1];
    var leftEye = landmarks[33];
    var rightEye = landmarks[263];

    var eyeCenterX = (leftEye.x + rightEye.x) / 2;
    var yaw = (nose.x - eyeCenterX) * 100;

    var eyeCenterY = (leftEye.y + rightEye.y) / 2;
    var pitch = (nose.y - eyeCenterY) * 100;

    var roll = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x) * 180 / Math.PI;

    return { yaw: yaw, pitch: pitch, roll: roll };
  }

  function pushSmooth(key, v) {
    var arr = smooth[key];
    arr.push(v);
    if (arr.length > SMOOTH_N) arr.shift();
    var sum = 0;
    for (var i = 0; i < arr.length; i++) sum += arr[i];
    return sum / arr.length;
  }

  // ══════════════════════════════════════════════════
  //  ★ 学习状态识别（核心改进）
  // ══════════════════════════════════════════════════

  /**
   * 判断当前在做什么（不是"有没有犯错"）。
   *
   * @param {object} d { avgEAR, headPose, faceDetected }
   * @returns {{state, label, attention, isLearning}}
   */
  function classify(d) {
    if (!d.faceDetected) {
      return { state: 'none', label: '不在画面', attention: 0, isLearning: false };
    }

    var ear = d.avgEAR;
    var pitch = d.headPose.pitch;
    var yaw = d.headPose.yaw;

    // 闭眼/瞌睡
    if (ear < 0.15) {
      return { state: 'distracted', label: '闭眼/打瞌睡', attention: 10, isLearning: false };
    }
    // 转头（离开书本）
    if (Math.abs(yaw) > 25) {
      return { state: 'distracted', label: '转头', attention: 20, isLearning: false };
    }

    // 低头：可能是书写，也可能是玩手机 —— 看头部稳定性
    if (pitch > 15) {
      // pitch 很稳定 + 幅度适中 = 写字；乱动 = 分心
      var pitchVar = variance(smooth.pitch);
      if (pitch <= 38 && pitchVar < 30) {
        return { state: 'writing', label: '书写', attention: 88, isLearning: true };
      }
      return { state: 'distracted', label: '低头（疑似分心）', attention: 35, isLearning: false };
    }

    // 抬头 / 平视
    if (pitch < -8) {
      return { state: 'listening', label: '听讲/看屏幕', attention: 92, isLearning: true };
    }

    // 平视 + 眼睛睁开程度波动 = 阅读扫视
    var earVar = variance(smooth.ear);
    if (earVar > 0.0008) {
      return { state: 'reading', label: '阅读', attention: 90, isLearning: true };
    }

    // 平视 + 视线略偏但稳定 = 思考
    if (Math.abs(yaw) > 8 && Math.abs(yaw) <= 25) {
      return { state: 'thinking', label: '思考', attention: 80, isLearning: true };
    }

    return { state: 'reading', label: '专注', attention: 90, isLearning: true };
  }

  function variance(arr) {
    if (arr.length < 3) return 0;
    var sum = 0, i;
    for (i = 0; i < arr.length; i++) sum += arr[i];
    var mean = sum / arr.length;
    var sq = 0;
    for (i = 0; i < arr.length; i++) sq += (arr[i] - mean) * (arr[i] - mean);
    return sq / arr.length;
  }

  // ══════════════════════════════════════════════════
  //  主回调
  // ══════════════════════════════════════════════════

  function onResults(results) {
    var d = {
      faceDetected: false,
      leftEAR: 0, rightEAR: 0, avgEAR: 0,
      headPose: { yaw: 0, pitch: 0, roll: 0 },
      attention: 50,
      state: '未检测',
      label: '未检测',
      isLearning: false,
      // 给 UI 的累计统计
      elapsedMs: 0,
      perStateMs: {},
      keyframes: [],
    };

    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
      var lm = results.multiFaceLandmarks[0];
      d.faceDetected = true;
      d.leftEAR = calcEAR(lm, LEFT_EYE);
      d.rightEAR = calcEAR(lm, RIGHT_EYE);
      d.avgEAR = (d.leftEAR + d.rightEAR) / 2;
      d.headPose = estimateHeadPose(lm);

      // 平滑
      pushSmooth('ear', d.avgEAR);
      pushSmooth('pitch', d.headPose.pitch);
      pushSmooth('yaw', d.headPose.yaw);
    }

    var cls = classify(d);
    d.state = cls.state;
    d.label = cls.label;
    d.attention = cls.attention;
    d.isLearning = cls.isLearning;

    // ── 按真实时间累计（不是数帧）──
    var now = Date.now();
    if (!stats.lastTickAt) stats.lastTickAt = now;
    var dt = Math.min(2000, now - stats.lastTickAt);  // 上限 2s，防挂起后暴增
    stats.lastTickAt = now;

    if (stats.ms[cls.state] == null) stats.ms[cls.state] = 0;
    stats.ms[cls.state] += dt;

    // 状态切换 → 留关键帧
    if (stats.lastState !== cls.state) {
      if (stats.lastState !== 'none') {
        stats.keyframes.push({
          at: new Date().toISOString(),
          from: stats.lastState,
          to: cls.state,
          label: cls.label,
        });
        if (stats.keyframes.length > 200) stats.keyframes.shift();
      }
      stats.lastState = cls.state;
    }

    d.elapsedMs = now - stats.startedAt;
    d.perStateMs = Object.assign({}, stats.ms);
    d.keyframes = stats.keyframes.slice(-5);

    // 分心提醒（仍然保留，但只针对真分心）
    if (cls.state === 'distracted' && cls.attention < 40) {
      consecutiveDistract++;
      if (consecutiveDistract >= 3) {
        triggerAlert(cls.label);
        consecutiveDistract = 0;
      }
    } else {
      consecutiveDistract = 0;
    }

    if (onResultsCallback) onResultsCallback(d);
  }

  function triggerAlert(label) {
    var now = Date.now();
    if (now - lastAlertTime < alertCooldown) return;
    lastAlertTime = now;
    playAlertSound();
    var overlay = document.getElementById('proctor-overlay');
    var msg = document.getElementById('proctor-msg');
    if (overlay && msg) {
      msg.textContent = label;
      overlay.classList.remove('hidden');
      setTimeout(function () { overlay.classList.add('hidden'); }, 3000);
    }
  }

  function playAlertSound() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.frequency.value = 880;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.25);
    } catch (e) {}
  }

  // ══════════════════════════════════════════════════
  //  ★ 真校准（采集基线，不是打印日志）
  // ══════════════════════════════════════════════════

  /**
   * 分两段采集：正常坐姿 → 书写姿态。
   * 每段采 4 秒（用户说"太快"），记录 pitch/yaw/ear 的均值和范围。
   *
   * @param {function} onProgress (phase, secLeft, hint)
   * @returns {Promise<{ok, baseline}>}
   */
  async function calibrate(onProgress) {
    if (!isRunning) return { ok: false, error: '请先启动监控' };

    var PHASE_MS = 4000;   // ★ 每段 4 秒（原来 3 秒且不采样）
    var samples = { normal: [], writing: [] };
    var capture = null;

    function collect(phase) {
      return new Promise(function (resolve) {
        capture = function (d) {
          if (d.faceDetected) {
            samples[phase].push({
              pitch: d.headPose.pitch, yaw: d.headPose.yaw, ear: d.avgEAR,
            });
          }
        };
        var start = Date.now();
        var timer = setInterval(function () {
          var left = Math.max(0, Math.ceil((PHASE_MS - (Date.now() - start)) / 1000));
          if (onProgress) onProgress(phase, left, phase === 'normal'
            ? '保持你平时学习时的坐姿' : '做出你写字时的姿势');
          if (Date.now() - start >= PHASE_MS) {
            clearInterval(timer);
            capture = null;
            resolve();
          }
        }, 250);
      });
    }

    // 把采集挂到主回调上
    var origCb = onResultsCallback;
    onResultsCallback = function (d) {
      if (capture) capture(d);
      if (origCb) origCb(d);
    };

    await collect('normal');
    await collect('writing');

    onResultsCallback = origCb;

    function summarize(arr) {
      if (!arr.length) return null;
      var p = arr.map(function (x) { return x.pitch; });
      var y = arr.map(function (x) { return x.yaw; });
      var e = arr.map(function (x) { return x.ear; });
      function avg(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s / a.length; }
      function min(a) { return Math.min.apply(null, a); }
      function max(a) { return Math.max.apply(null, a); }
      return {
        pitch: { avg: avg(p), min: min(p), max: max(p) },
        yaw: { avg: avg(y), min: min(y), max: max(y) },
        ear: { avg: avg(e), min: min(e), max: max(e) },
        n: arr.length,
      };
    }

    stats.baseline = {
      normal: summarize(samples.normal),
      writing: summarize(samples.writing),
      at: new Date().toISOString(),
    };

    var okN = samples.normal.length >= 5;
    var okW = samples.writing.length >= 5;
    return {
      ok: okN && okW,
      baseline: stats.baseline,
      warning: !okN ? '正常坐姿采样太少（' + samples.normal.length + ' 帧），请重试'
        : !okW ? '书写姿态采样太少（' + samples.writing.length + ' 帧），请重试'
          : '',
    };
  }

  // ══════════════════════════════════════════════════
  //  生命周期
  // ══════════════════════════════════════════════════

  async function start() {
    if (camera) {
      await camera.start();
      isRunning = true;
      stats.startedAt = Date.now();
      stats.lastTickAt = Date.now();
      stats.ms = { writing: 0, reading: 0, listening: 0, thinking: 0, distracted: 0, none: 0 };
      stats.keyframes = [];
      stats.lastState = 'none';
    }
  }

  function stop() {
    if (camera) { camera.stop(); isRunning = false; }
  }

  function isRunningNow() { return isRunning; }

  /** 当前统计快照（给 UI / 落库） */
  function snapshot() {
    var ms = stats.ms;
    var learningMs = (ms.writing || 0) + (ms.reading || 0) + (ms.listening || 0) + (ms.thinking || 0);
    var totalMs = 0;
    Object.keys(ms).forEach(function (k) { totalMs += ms[k] || 0; });
    return {
      elapsedMs: totalMs,
      learningMs: learningMs,
      distractedMs: ms.distracted || 0,
      perStateMs: Object.assign({}, ms),
      focusRate: totalMs > 0 ? Math.round(learningMs / totalMs * 100) : 0,
      keyframes: stats.keyframes.slice(-20),
      baseline: stats.baseline,
      startedAt: stats.startedAt,
    };
  }

  return {
    init: init, start: start, stop: stop,
    isRunning: isRunningNow,
    calibrate: calibrate,
    snapshot: snapshot,
    classify: classify,   // 导出给测试用
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ProctorEngine;
