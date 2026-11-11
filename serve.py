# Dev server with no browser caching, so code changes show up on a plain refresh.
# Run:  python serve.py  (serves this folder on http://127.0.0.1:8741)
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 8741), NoCacheHandler).serve_forever()
