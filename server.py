import http.server,socketserver,os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
class H(http.server.SimpleHTTPRequestHandler):
    extensions_map={**http.server.SimpleHTTPRequestHandler.extensions_map,'.js':'text/javascript','.json':'application/json'}
    def end_headers(self):
        self.send_header('Cache-Control','no-cache'); super().end_headers()
    def list_directory(self,p): self.send_error(404); return None
class S(socketserver.ThreadingMixIn,http.server.HTTPServer): daemon_threads=True
S(('127.0.0.1',8797),H).serve_forever()
