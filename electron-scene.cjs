/**
 * 3D 场景生成器（2026-10-24 独立成文件）
 *
 * 从 electron-tools.js 抽出来，原因：
 *   ① 模板字符串里嵌 JS，嵌套太深容易出错
 *   ② 这个文件单独可测
 *
 * 关键修复：Three.js 内嵌，不依赖 CDN。
 */
const fs = require('fs');
const path = require('path');

/** 读本地 Three.js */
function readThree() {
  const cands = [
    path.join(__dirname, 'three', 'three.module.min.js'),
    path.join(__dirname, 'web', 'vendor', 'three', 'three.module.min.js'),
    path.join(__dirname, 'vendor', 'three', 'three.module.min.js'),
  ];
  for (const p of cands) {
    try { if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8'); } catch (e) {}
  }
  return null;
}

function readOrbit() {
  const cands = [
    path.join(__dirname, 'three', 'OrbitControls.js'),
    path.join(__dirname, 'web', 'vendor', 'three', 'OrbitControls.js'),
    path.join(__dirname, 'vendor', 'three', 'OrbitControls.js'),
  ];
  for (const p of cands) {
    try { if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8'); } catch (e) {}
  }
  return null;
}

function escXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * 生成 3D 场景 HTML。
 * @param {object} args { title, objects }
 * @returns {{ok, html?, error?, objects?}}
 */
function buildScene(args) {
  const title = String((args && args.title) || '3D 场景');
  const objects = Array.isArray(args && args.objects) ? args.objects : [];

  const three = readThree();
  if (!three) {
    return {
      ok: false,
      error: '缺少 Three.js 库（three.module.min.js）。3D 功能不可用，' +
        '请确认安装包里带 resources/three/three.module.min.js。',
      hint: 'missing-three-lib',
    };
  }

  const orbit = readOrbit();

  const norm = objects.map(o => ({
    type: o.type || 'box',
    color: o.color || '#4176e6',
    position: Array.isArray(o.position) ? o.position : [0, 0, 0],
    size: Array.isArray(o.size) ? o.size : [1, 1, 1],
    label: o.label || '',
    rotate: o.rotate !== false,
    opacity: o.opacity == null ? 1 : Number(o.opacity),
    wireframe: !!o.wireframe,
    lineTo: Array.isArray(o.lineTo) ? o.lineTo : null,
    // ★ 新增：两点之间画一根管子（自动算方向和长度）
    from: Array.isArray(o.from) ? o.from : null,
    to: Array.isArray(o.to) ? o.to : null,
    radius: o.radius == null ? 0.03 : Number(o.radius),
  }));

  // base64 内嵌
  const threeB64 = Buffer.from(three, 'utf8').toString('base64');

  /**
   * ★ OrbitControls 必须重写 import（2026-10-24）
   *
   * 原文件第一行是 `import { ... } from 'three';`
   * 但 blob URL 加载时，"three" 这个裸标识符解析不了：
   *   TypeError: Failed to resolve module specifier "three"
   *   （实测就是这个错误，导致鼠标拖拽失效）
   *
   * 解决：把 'three' 换成一个**全局变量路径**。
   *   我们在主模块里已经把 THREE 拿到了，
   *   所以把 OrbitControls 的 import 改成从 window.__THREE__ 取。
   */
  const orbitPatched = orbit
    ? orbit.replace(
        /import\s*\{([^}]+)\}\s*from\s*['"]three['"];?/,
        (m, names) => {
          // 保留名字列表，改成从 window 取
          return 'const {' + names + '} = window.__THREE__;';
        }
      )
    : '';

  const orbitB64 = orbitPatched ? Buffer.from(orbitPatched, 'utf8').toString('base64') : '';

  const sceneJson = JSON.stringify(norm);
  const titleEsc = escXml(title);

  // ⚠️ 这里用数组拼 HTML，不用嵌套模板字符串 —— 避免转义地狱
  const H = [];

  H.push('<!DOCTYPE html>');
  H.push('<html lang="zh-CN">');
  H.push('<head>');
  H.push('<meta charset="UTF-8">');
  H.push('<title>' + titleEsc + '</title>');
  H.push('<style>');
  H.push('* { box-sizing: border-box; }');
  H.push('body { margin:0; overflow:hidden; background:#0f172a; font-family:-apple-system,"Segoe UI","PingFang SC",sans-serif; }');
  H.push('#info { position:absolute; top:16px; left:16px; color:#e2e8f0; font-size:14px; z-index:10;');
  H.push("  background:rgba(15,23,42,.75); padding:10px 16px; border-radius:8px; backdrop-filter:blur(8px); max-width:60%; }");
  H.push('#info h1 { margin:0 0 6px; font-size:16px; font-weight:600; }');
  H.push('#info p { margin:0; font-size:12px; color:#94a3b8; }');
  H.push('#labels { position:absolute; inset:0; pointer-events:none; z-index:5; }');
  H.push('.lbl { position:absolute; color:#e2e8f0; font-size:12px; background:rgba(15,23,42,.85);');
  H.push('       padding:3px 8px; border-radius:5px; transform:translate(-50%,-50%); white-space:nowrap;');
  H.push('       border:1px solid rgba(148,163,184,.3); }');
  H.push('#err { position:absolute; inset:0; display:none; flex-direction:column; align-items:center;');
  H.push('       justify-content:center; color:#f87171; font-size:14px; padding:40px; text-align:center; z-index:20; }');
  H.push('#load { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;');
  H.push('        color:#94a3b8; font-size:13px; z-index:15; }');
  H.push('</style>');
  H.push('</head>');
  H.push('<body>');
  H.push('<div id="info"><h1>' + titleEsc + '</h1><p>鼠标拖动旋转 · 滚轮缩放 · 右键平移</p></div>');
  H.push('<div id="labels"></div>');
  H.push('<div id="load">正在初始化 3D…</div>');
  H.push('<div id="err"></div>');
  H.push('');
  H.push('<script>');
  H.push('var THREE_B64 = "' + threeB64 + '";');
  H.push('var ORBIT_B64 = "' + orbitB64 + '";');
  H.push('var OBJECTS = ' + sceneJson + ';');
  H.push('var HAS_ORBIT = ' + (orbit ? 'true' : 'false') + ';');
  H.push('');
  H.push('function b64Url(b64) {');
  H.push('  var bin = atob(b64);');
  H.push('  var bytes = new Uint8Array(bin.length);');
  H.push('  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);');
  H.push("  return URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }));");
  H.push('}');
  H.push('');
  H.push('function showErr(msg) {');
  H.push("  var e = document.getElementById('err');");
  H.push("  if (e) { e.style.display = 'flex'; e.textContent = msg; }");
  H.push("  var l = document.getElementById('load'); if (l) l.style.display = 'none';");
  H.push('}');
  H.push('<\/script>');
  H.push('');
  H.push('<script type="module">');
  H.push('// ── 用 blob URL 建 Three.js 模块 ──');
  H.push('var threeUrl = b64Url(THREE_B64);');
  H.push('var orbitUrl = HAS_ORBIT ? b64Url(ORBIT_B64) : null;');
  H.push('');
  H.push('// 动态构建：把 three 的源码包成一个 module 导出');
  H.push("var THREE = await import(threeUrl);");
  H.push('// ★ 挂到 window，供 OrbitControls 使用（它内部要把 three 解构出来）');
  H.push('window.__THREE__ = THREE;');
  H.push('var OrbitControls = null;');
  H.push("if (orbitUrl) { try { var m = await import(orbitUrl); OrbitControls = m.OrbitControls; } catch(e) { console.warn('OrbitControls 加载失败', e); } }");
  H.push('');
  H.push('// ── 场景 ──');
  H.push('var scene = new THREE.Scene();');
  H.push('scene.background = new THREE.Color(0x0f172a);');
  H.push('scene.fog = new THREE.Fog(0x0f172a, 24, 80);');
  H.push('');
  H.push('var camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 2000);');
  H.push('');
  H.push('var renderer = new THREE.WebGLRenderer({ antialias: true });');
  H.push('renderer.setSize(innerWidth, innerHeight);');
  H.push('renderer.setPixelRatio(Math.min(devicePixelRatio, 2));');
  H.push('renderer.shadowMap.enabled = true;');
  H.push('renderer.shadowMap.type = THREE.PCFSoftShadowMap;');
  H.push('document.body.appendChild(renderer.domElement);');
  H.push('');
  H.push('// 灯光');
  H.push('scene.add(new THREE.AmbientLight(0xffffff, 0.75));');
  H.push('var dir = new THREE.DirectionalLight(0xffffff, 1.5);');
  H.push('dir.position.set(10, 16, 8);');
  H.push('dir.castShadow = true;');
  H.push('dir.shadow.mapSize.set(2048, 2048);');
  H.push('scene.add(dir);');
  H.push('var fill = new THREE.DirectionalLight(0x88aaff, 0.5);');
  H.push('fill.position.set(-8, 6, -8);');
  H.push('scene.add(fill);');
  H.push('var rim = new THREE.DirectionalLight(0xffffff, 0.35);');
  H.push('rim.position.set(0, -8, -10);');
  H.push('scene.add(rim);');
  H.push('');
  H.push('var grid = new THREE.GridHelper(40, 40, 0x334155, 0x1e293b);');
  H.push('grid.position.y = -0.02;');
  H.push('scene.add(grid);');
  H.push('');
  H.push('// ── 造物体 ──');
  H.push('var labelData = [];');
  H.push('var spinning = [];');
  H.push('var box = new THREE.Box3();');
  H.push('');
  H.push('OBJECTS.forEach(function(o) {');
  H.push('  var s = (o.size && o.size.length) ? o.size : [1, 1, 1];');
  H.push('');
  H.push('  // ★ edge：两点之间画一根管子（自动算方向和长度）');
  H.push('  if (o.type === "edge" && o.from && o.to) {');
  H.push('    var a = new THREE.Vector3(o.from[0], o.from[1], o.from[2]);');
  H.push('    var b = new THREE.Vector3(o.to[0], o.to[1], o.to[2]);');
  H.push('    var len = a.distanceTo(b) || 0.01;');
  H.push('    var rad = o.radius || 0.03;');
  H.push('    var eg = new THREE.CylinderGeometry(rad, rad, len, 12);');
  H.push('    var em = new THREE.MeshStandardMaterial({');
  H.push('      color: new THREE.Color(o.color), roughness: 0.35, metalness: 0.2');
  H.push('    });');
  H.push('    var emesh = new THREE.Mesh(eg, em);');
  H.push('    emesh.position.copy(a).add(b).multiplyScalar(0.5);');
  H.push('    // 默认圆柱沿 Y 轴，转到 a→b 方向');
  H.push('    var dir = new THREE.Vector3().subVectors(b, a).normalize();');
  H.push('    emesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);');
  H.push('    emesh.castShadow = true;');
  H.push('    scene.add(emesh);');
  H.push('    box.expandByPoint(a); box.expandByPoint(b);');
  H.push('    if (o.label) labelData.push({ obj: emesh, text: o.label, offset: 0 });');
  H.push('    return;');
  H.push('  }');
  H.push('');
  H.push('  if (o.type === "line" && o.lineTo) {');
  H.push('    var p0 = new THREE.Vector3(o.position[0], o.position[1], o.position[2]);');
  H.push('    var p1 = new THREE.Vector3(o.lineTo[0], o.lineTo[1], o.lineTo[2]);');
  H.push('    var g = new THREE.BufferGeometry().setFromPoints([p0, p1]);');
  H.push('    var mt = new THREE.LineBasicMaterial({ color: new THREE.Color(o.color) });');
  H.push('    var ln = new THREE.Line(g, mt);');
  H.push('    scene.add(ln);');
  H.push('    box.expandByPoint(p0); box.expandByPoint(p1);');
  H.push('    if (o.label) labelData.push({ obj: ln, text: o.label, offset: 0 });');
  H.push('    return;');
  H.push('  }');
  H.push('');
  H.push('  if (o.type === "point") {');
  H.push('    var pg = new THREE.SphereGeometry(s[0] / 2 || 0.07, 16, 12);');
  H.push('    var pm = new THREE.MeshBasicMaterial({ color: new THREE.Color(o.color) });');
  H.push('    var pmesh = new THREE.Mesh(pg, pm);');
  H.push('    pmesh.position.set(o.position[0], o.position[1], o.position[2]);');
  H.push('    scene.add(pmesh);');
  H.push('    box.expandByPoint(pmesh.position);');
  H.push('    if (o.label) labelData.push({ obj: pmesh, text: o.label, offset: 0.3 });');
  H.push('    return;');
  H.push('  }');
  H.push('');
  H.push('  var geo;');
  H.push('  switch (o.type) {');
  H.push('    case "sphere":   geo = new THREE.SphereGeometry(s[0] / 2, 40, 28); break;');
  H.push('    case "cylinder": geo = new THREE.CylinderGeometry(s[0] / 2, s[0] / 2, s[1] || s[0], 40); break;');
  H.push('    case "cone":     geo = new THREE.ConeGeometry(s[0] / 2, s[1] || s[0], 40); break;');
  H.push('    case "torus":    geo = new THREE.TorusGeometry(s[0] / 2, s[0] / 5, 20, 60); break;');
  H.push('    case "plane":    geo = new THREE.PlaneGeometry(s[0], s[1] || s[0]); break;');
  H.push('    case "tetra":    geo = new THREE.TetrahedronGeometry(s[0] / 2); break;');
  H.push('    case "octa":     geo = new THREE.OctahedronGeometry(s[0] / 2); break;');
  H.push('    case "dodeca":   geo = new THREE.DodecahedronGeometry(s[0] / 2); break;');
  H.push('    default:         geo = new THREE.BoxGeometry(s[0], s[1] || s[0], s[2] || s[0]);');
  H.push('  }');
  H.push('');
  H.push('  var opaque = o.opacity >= 1;');
  H.push('  var mat = new THREE.MeshStandardMaterial({');
  H.push('    color: new THREE.Color(o.color),');
  H.push('    roughness: 0.4, metalness: 0.12,');
  H.push('    transparent: !opaque, opacity: o.opacity,');
  H.push('    wireframe: o.wireframe');
  H.push('  });');
  H.push('');
  H.push('  var mesh = new THREE.Mesh(geo, mat);');
  H.push('  mesh.position.set(o.position[0], o.position[1], o.position[2]);');
  H.push('  mesh.castShadow = opaque; mesh.receiveShadow = opaque;');
  H.push('  scene.add(mesh);');
  H.push('  mesh.updateMatrixWorld(true);');
  H.push('  box.expandByObject(mesh);');
  H.push('');
  H.push('  if (o.label) labelData.push({ obj: mesh, text: o.label, offset: 0 });');
  H.push('  if (o.rotate) spinning.push(mesh);');
  H.push('});');
  H.push('');
  H.push('// ── 相机自动 fit ──');
  H.push('if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(0, 1, 0), new THREE.Vector3(4, 4, 4));');
  H.push('var center = new THREE.Vector3(); var size = new THREE.Vector3();');
  H.push('box.getCenter(center); box.getSize(size);');
  H.push('var maxDim = Math.max(size.x, size.y, size.z) || 4;');
  H.push('var dist = maxDim * 2.2 + 4;');
  H.push('camera.position.set(center.x + dist * 0.7, center.y + dist * 0.55, center.z + dist * 0.85);');
  H.push('camera.lookAt(center);');
  H.push('');
  H.push('var controls = null;');
  H.push('if (OrbitControls) {');
  H.push('  try {');
  H.push('    controls = new OrbitControls(camera, renderer.domElement);');
  H.push('    controls.target.copy(center);');
  H.push('    controls.enableDamping = true;');
  H.push('    controls.dampingFactor = 0.07;');
  H.push('    controls.minDistance = maxDim * 0.5;');
  H.push('    controls.maxDistance = maxDim * 12;');
  H.push('    controls.update();');
  H.push("  } catch(e) { console.warn('OrbitControls 初始化失败', e); }");
  H.push('}');
  H.push('');
  H.push('// ── 标签 ──');
  H.push("var labelHost = document.getElementById('labels');");
  H.push('labelData.forEach(function(d) {');
  H.push("  var el = document.createElement('div');");
  H.push("  el.className = 'lbl';");
  H.push('  el.textContent = d.text;');
  H.push('  labelHost.appendChild(el);');
  H.push('  d.el = el;');
  H.push('});');
  H.push('');
  H.push('var v3 = new THREE.Vector3();');
  H.push('function updateLabels() {');
  H.push('  labelData.forEach(function(d) {');
  H.push('    if (d.obj.getWorldPosition) d.obj.getWorldPosition(v3);');
  H.push('    else v3.copy(d.obj.position);');
  H.push('    v3.y += (d.offset || 0);');
  H.push('    v3.project(camera);');
  H.push('    var x = (v3.x * 0.5 + 0.5) * innerWidth;');
  H.push('    var y = (-v3.y * 0.5 + 0.5) * innerHeight;');
  H.push('    d.el.style.display = (v3.z < 1) ? "block" : "none";');
  H.push('    d.el.style.left = x + "px";');
  H.push('    d.el.style.top = y + "px";');
  H.push('  });');
  H.push('}');
  H.push('');
  H.push('addEventListener("resize", function() {');
  H.push('  camera.aspect = innerWidth / innerHeight;');
  H.push('  camera.updateProjectionMatrix();');
  H.push('  renderer.setSize(innerWidth, innerHeight);');
  H.push('});');
  H.push('');
  H.push("var loadEl = document.getElementById('load'); if (loadEl) loadEl.style.display = 'none';");
  H.push('');
  H.push('var clock = new THREE.Clock();');
  H.push('(function loop() {');
  H.push('  requestAnimationFrame(loop);');
  H.push('  var dt = clock.getDelta();');
  H.push('  spinning.forEach(function(m) { m.rotation.y += dt * 0.25; });');
  H.push('  if (controls) controls.update();');
  H.push('  updateLabels();');
  H.push('  renderer.render(scene, camera);');
  H.push('})();');
  H.push('<\/script>');
  H.push('');
  H.push('<script>');
  H.push("window.addEventListener('error', function(ev) {");
  H.push("  if (ev && ev.message) showErr('运行错误: ' + ev.message);");
  H.push('});');
  H.push('<\/script>');
  H.push('</body>');
  H.push('</html>');

  return { ok: true, html: H.join('\n'), objects: objects.length, offline: true };
}

module.exports = { buildScene, readThree, readOrbit };
