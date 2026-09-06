# -*- coding: utf-8 -*-
"""本地开发/使用服务器:在系统 http.server 基础上增加 no-cache 头,
保证修改文件后刷新页面即可看到最新版本。
用法:python tools/serve.py [端口] [目录](默认 8765 与 app/)"""
import sys, io
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
DIRECTORY = sys.argv[2] if len(sys.argv) > 2 else str(ROOT / "app")


class NoCacheHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # 静默日志,保持控制台干净


if __name__ == "__main__":
    print(f"AI 面试学习站已启动: http://127.0.0.1:{PORT}/index.html  (目录: {DIRECTORY})")
    print("关闭本窗口或按 Ctrl+C 停止服务。")
    ThreadingHTTPServer(("127.0.0.1", PORT), NoCacheHandler).serve_forever()
