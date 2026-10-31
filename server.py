#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
学习系统本地服务器

除了提供静态文件，还提供**数据备份**接口 —— 这是关键：

数据平时存在浏览器 localStorage 里，清缓存/换浏览器就没了（本项目已被清空过三次）。
所以这里加两个端点，把数据真正写到磁盘：

  POST /api/backup        把前端传来的整份数据存成带时间戳的快照
  GET  /api/backups       列出已有快照
  GET  /api/backup/latest 取最近一份快照（用于恢复）

快照存在 ./backups/ 下，文件名形如 backup-20261010-181530.json，
每个文件都是**完整可导入**的 JSON（就是前端「导出备份」的格式），
所以就算这个服务坏了，你也能直接用编辑器打开看、手动恢复。
"""
import http.server
import socketserver
import json
import os
import sys
import glob
import time
from datetime import datetime

PORT = 8080
DIRECTORY = os.path.dirname(os.path.abspath(__file__))
BACKUP_DIR = os.path.join(DIRECTORY, 'backups')

# 最多保留多少份快照（防止无限增长）
MAX_BACKUPS = 60


def ensure_backup_dir():
    os.makedirs(BACKUP_DIR, exist_ok=True)


def list_backups():
    """返回按时间倒序的快照列表"""
    ensure_backup_dir()
    files = glob.glob(os.path.join(BACKUP_DIR, 'backup-*.json'))
    out = []
    for f in files:
        try:
            st = os.stat(f)
            out.append({
                'name': os.path.basename(f),
                'size': st.st_size,
                'mtime': st.st_mtime,
                'time': datetime.fromtimestamp(st.st_mtime).strftime('%Y-%m-%d %H:%M:%S'),
            })
        except OSError:
            pass
    out.sort(key=lambda x: x['mtime'], reverse=True)
    return out


def prune_backups():
    """只保留最近 MAX_BACKUPS 份"""
    files = list_backups()
    for old in files[MAX_BACKUPS:]:
        try:
            os.remove(os.path.join(BACKUP_DIR, old['name']))
        except OSError:
            pass


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    # 绝对不要在 end_headers() 里再 send_header('Content-Type', ...)，
    # 那样会发出两个 Content-Type 头，浏览器会合并成
    # "text/css; charset=utf-8,text/html; charset=utf-8" 并直接拒绝应用样式表。
    # 统一走 guess_type()，它才是唯一的 Content-Type 出口。
    def guess_type(self, path):
        if path.endswith('.html') or path.endswith('.htm'):
            return 'text/html; charset=utf-8'
        elif path.endswith('.css'):
            return 'text/css; charset=utf-8'
        elif path.endswith('.js') or path.endswith('.mjs'):
            return 'application/javascript; charset=utf-8'
        elif path.endswith('.json'):
            return 'application/json; charset=utf-8'
        elif path.endswith('.svg'):
            return 'image/svg+xml; charset=utf-8'
        return super().guess_type(path)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        # 允许前端从本地页面调用这些接口
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

    # ────────── CORS 预检 ──────────
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    # ────────── 备份接口 ──────────
    def do_POST(self):
        if self.path.split('?')[0] != '/api/backup':
            self.send_error(404, 'Not Found')
            return

        try:
            length = int(self.headers.get('Content-Length') or 0)
            if length <= 0 or length > 64 * 1024 * 1024:      # 上限 64MB
                raise ValueError('body size invalid: ' + str(length))
            raw = self.rfile.read(length)
            payload = json.loads(raw.decode('utf-8'))

            # 必须是对象，且带 data 字段（防止误传垃圾数据覆盖备份）
            if not isinstance(payload, dict) or 'data' not in payload:
                raise ValueError('payload must be {"data": {...}}')

            # ★ 拒绝空数据：清空数据后的"保护性备份"会写出 67 字节空壳，
            #   如果让它成为"最新"，恢复时就取到空文件（实测踩过这个坑）。
            data_obj = payload.get('data') or {}
            has_content = False
            if isinstance(data_obj, dict):
                for k, v in data_obj.items():
                    if k in ('at', 'count'):
                        continue
                    if isinstance(v, (list, dict)) and len(v) > 0:
                        has_content = True
                        break
                    if v not in (None, '', 0, False):
                        has_content = True
                        break
            if not has_content:
                raise ValueError('数据是空的，不写入备份（避免空壳覆盖最新备份）')

            ensure_backup_dir()
            ts = datetime.now().strftime('%Y%m%d-%H%M%S')
            # 同一秒多次备份时加后缀，避免覆盖
            path = os.path.join(BACKUP_DIR, 'backup-%s.json' % ts)
            n = 1
            while os.path.exists(path):
                path = os.path.join(BACKUP_DIR, 'backup-%s-%d.json' % (ts, n))
                n += 1

            with open(path, 'w', encoding='utf-8') as fh:
                json.dump(payload, fh, ensure_ascii=False, indent=1)

            prune_backups()

            body = json.dumps({
                'ok': True,
                'file': os.path.basename(path),
                'size': os.path.getsize(path),
                'time': ts,
            }, ensure_ascii=False).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        except Exception as exc:                      # noqa: BLE001
            body = json.dumps({'ok': False, 'error': str(exc)}, ensure_ascii=False).encode('utf-8')
            self.send_response(400)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    def do_GET(self):
        path_only = self.path.split('?')[0]

        if path_only == '/api/backups':
            body = json.dumps({'ok': True, 'items': list_backups()}, ensure_ascii=False).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if path_only == '/api/backup/latest':
            items = list_backups()
            if not items:
                body = json.dumps({'ok': False, 'error': '还没有任何快照'}, ensure_ascii=False).encode('utf-8')
                self.send_response(404)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            latest = os.path.join(BACKUP_DIR, items[0]['name'])
            try:
                with open(latest, 'rb') as fh:
                    body = fh.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except OSError as exc:
                self.send_error(500, str(exc))
            return

        # 其它请求走静态文件
        super().do_GET()

    def log_message(self, fmt, *args):
        # 备份接口的日志打出来，静态文件不刷屏
        if '/api/' in (self.path or ''):
            sys.stderr.write('%s - %s\n' % (self.log_date_time_string(), fmt % args))


class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True


if __name__ == '__main__':
    os.chdir(DIRECTORY)
    ensure_backup_dir()

    with ReusableTCPServer(("127.0.0.1", PORT), Handler) as httpd:
        print(f"服务器运行在 http://127.0.0.1:{PORT}")
        print(f"服务目录: {DIRECTORY}")
        print(f"备份目录: {BACKUP_DIR}（最多保留 {MAX_BACKUPS} 份）")
        print("按 Ctrl+C 停止服务器")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n服务器已停止")
            sys.exit(0)
