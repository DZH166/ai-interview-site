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

    def do_GET(self):
        # 测试种子页:空 HTML(浏览器测试用它做「非应用页」中转,
        # 在这里写 localStorage 后再进应用页,绕开 pagehide 兜底的写回)
        if self.path.split("?")[0] == "/__seed__":
            body = ("<!DOCTYPE html><html><head><meta charset='UTF-8'>"
                    "<title>seed</title></head><body>seed page (test only)</body></html>")
            data = body.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.end_headers()
            self.wfile.write(data)
            return
        super().do_GET()

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
